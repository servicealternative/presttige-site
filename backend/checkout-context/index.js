"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

function loadTierContractModule() {
  const candidates = [
    path.join(__dirname, "..", "lib", "stripe-tier-contract.js"),
    path.join(__dirname, "lib", "stripe-tier-contract.js"),
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") {
        throw error;
      }
    }
  }

  throw new Error("Stripe tier contract module not found");
}

const {
  CHECKOUT_TOKEN_INDEX_NAME,
  LEAD_PAYMENT_FIELDS,
  getTierContract,
} = loadTierContractModule();

const REGION = "us-east-1";
const TABLE_NAME = "presttige-db";
const APP_ORIGIN = "https://presttige.net";
const UPGRADE_ELIGIBLE_UNTIL = "2026-12-31T23:59:59Z";
const ACTIVE_MEMBERSHIP_STATES = new Set([
  "paid",
  "subscription_active",
  "subscription_cancel_at_period_end",
  "renewal_failed_retrying",
  "subscription_past_due",
]);

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function errorResponse(statusCode, code, message, details = {}) {
  return response(statusCode, {
    error: {
      code,
      message,
      ...details,
    },
  });
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function isTruthy(value) {
  if (value === true) {
    return true;
  }
  if (value === false || value === undefined || value === null) {
    return false;
  }
  const normalized = normalizeString(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseIsoDate(value) {
  const input = normalizeString(value);
  if (!input) {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

async function findLeadByCheckoutToken(token) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: CHECKOUT_TOKEN_INDEX_NAME,
      KeyConditionExpression: "#checkout_token = :checkout_token",
      ExpressionAttributeNames: {
        "#checkout_token": LEAD_PAYMENT_FIELDS.checkoutToken,
      },
      ExpressionAttributeValues: {
        ":checkout_token": token,
      },
      Limit: 2,
    })
  );

  if (!result.Items?.length) {
    return null;
  }

  if (result.Items.length > 1) {
    throw new Error("Checkout token lookup returned multiple records");
  }

  return result.Items[0];
}

async function findLeadByLeadId(leadId) {
  const normalizedLeadId = normalizeString(leadId);
  if (!normalizedLeadId) {
    return null;
  }

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        lead_id: normalizedLeadId,
      },
    })
  );

  return result.Item || null;
}

async function findLeadByAnyToken(token) {
  const byCheckoutToken = await findLeadByCheckoutToken(token);
  if (byCheckoutToken) {
    return {
      lead: byCheckoutToken,
      tokenType: "checkout",
    };
  }

  return null;
}

async function findLeadByRouteToken(token, leadId = "") {
  const byLeadId = await findLeadByLeadId(leadId);
  if (byLeadId) {
    const checkoutToken = normalizeString(byLeadId[LEAD_PAYMENT_FIELDS.checkoutToken]);
    const magicToken = normalizeString(byLeadId.magic_token);

    if (token && token === checkoutToken) {
      return {
        lead: byLeadId,
        tokenType: "checkout",
      };
    }

    if (token && token === magicToken) {
      return {
        lead: byLeadId,
        tokenType: "magic",
      };
    }

    return null;
  }

  return findLeadByAnyToken(token);
}

function getCurrentTier(lead) {
  return (
    normalizeString(
      lead[LEAD_PAYMENT_FIELDS.selectedTier] ||
        lead.selected_tier ||
        lead.effective_tier
    ).toLowerCase() || null
  );
}

function isFounderOnlyLead(lead) {
  const founderGate = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.founderGateStatus] ||
      lead[LEAD_PAYMENT_FIELDS.ambassadorConfirmationStatus]
  ).toLowerCase();
  const tierIntent = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.tierIntent]
  ).toLowerCase();
  const reviewStatus = normalizeString(lead.review_status).toLowerCase();

  return (
    isTruthy(lead[LEAD_PAYMENT_FIELDS.founderEligible]) &&
    founderGate === "confirmed" &&
    tierIntent === "founder" &&
    reviewStatus === "approved"
  );
}

function buildBillingChoice(contractKey) {
  const contract = getTierContract(contractKey);
  if (!contract) {
    return null;
  }

  const labelByBilling = {
    monthly: `$${formatUsd(contract.amountUsdCents)} / month`,
    quarterly: `$${formatUsd(contract.amountUsdCents)} / quarter`,
    yearly: `$${formatUsd(contract.amountUsdCents)} / year`,
    lifetime: `$${formatUsd(contract.amountUsdCents)} lifetime`,
  };

  return {
    contractKey: contract.contractKey,
    billing: contract.billing,
    label: labelByBilling[contract.billing] || `$${formatUsd(contract.amountUsdCents)}`,
  };
}

function buildHeadlinePriceLabel(contractKey) {
  const contract = getTierContract(contractKey);
  if (!contract) {
    return "";
  }

  if (contract.billing === "lifetime") {
    return `$${formatUsd(contract.amountUsdCents)} lifetime`;
  }

  return `$${formatUsd(contract.amountUsdCents)} / year`;
}

function buildPatronOption(lead) {
  const currentTier = getCurrentTier(lead);
  if (currentTier === "club") {
    const contract = getTierContract("club_to_patron_upgrade");
    return {
      tier: "patron",
      contractKey: contract.contractKey,
      displayMode: "upgrade",
      upgradeFrom: "club",
      headlinePriceLabel: buildHeadlinePriceLabel("patron_yearly"),
      initialChargeUsdCents: contract.initialChargeUsdCents,
      renewalAmountUsdCents: contract.renewalAmountUsdCents,
    };
  }

  if (currentTier === "premier") {
    const contract = getTierContract("premier_to_patron_upgrade");
    return {
      tier: "patron",
      contractKey: contract.contractKey,
      displayMode: "upgrade",
      upgradeFrom: "premier",
      headlinePriceLabel: buildHeadlinePriceLabel("patron_yearly"),
      initialChargeUsdCents: contract.initialChargeUsdCents,
      renewalAmountUsdCents: contract.renewalAmountUsdCents,
    };
  }

  return {
    tier: "patron",
    contractKey: "patron_yearly",
    displayMode: "standard",
    headlinePriceLabel: buildHeadlinePriceLabel("patron_yearly"),
  };
}

function buildStandardOptions(lead) {
  return {
    subscriber: {
      tier: "subscriber",
      contractKey: null,
      displayMode: "free",
    },
    club: {
      tier: "club",
      displayMode: "standard",
      headlinePriceLabel: buildHeadlinePriceLabel("club_yearly"),
      billingChoices: ["club_monthly", "club_quarterly", "club_yearly"]
        .map(buildBillingChoice)
        .filter(Boolean),
    },
    premier: {
      tier: "premier",
      displayMode: "standard",
      headlinePriceLabel: buildHeadlinePriceLabel("premier_yearly"),
      billingChoices: ["premier_monthly", "premier_quarterly", "premier_yearly"]
        .map(buildBillingChoice)
        .filter(Boolean),
    },
    patron: buildPatronOption(lead),
  };
}

function buildFounderOptions() {
  return {
    founder: {
      tier: "founder",
      contractKey: "founder_lifetime",
      displayMode: "standard",
      headlinePriceLabel: buildHeadlinePriceLabel("founder_lifetime"),
    },
  };
}

function buildResponseBody(lead, tokenType) {
  const founderOnly = isFounderOnlyLead(lead);
  const checkoutToken = normalizeString(lead[LEAD_PAYMENT_FIELDS.checkoutToken]);
  const magicToken = normalizeString(lead.magic_token);
  const paymentStatus = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.paymentStatus] || lead.payment_status
  ).toLowerCase();

  return {
    profile: {
      leadId: lead.lead_id,
      name: lead.name || null,
      email: lead.email || null,
      phone: lead.phone || lead.phone_full || null,
      country: lead.country || lead.country_code || null,
    },
    lead: {
      reviewStatus: normalizeString(lead.review_status).toLowerCase() || null,
      paymentStatus: paymentStatus || null,
      currentTier: getCurrentTier(lead),
      tierIntent:
        normalizeString(lead[LEAD_PAYMENT_FIELDS.tierIntent]).toLowerCase() ||
        null,
      founderEligible: isTruthy(lead[LEAD_PAYMENT_FIELDS.founderEligible]),
      founderGateStatus:
        normalizeString(lead[LEAD_PAYMENT_FIELDS.founderGateStatus]) || null,
    },
    token: {
      tokenType,
      checkoutToken: checkoutToken || null,
      checkoutTokenStatus:
        normalizeString(lead[LEAD_PAYMENT_FIELDS.checkoutTokenStatus]) || null,
      checkoutTokenExpiresAt:
        normalizeString(lead[LEAD_PAYMENT_FIELDS.checkoutTokenExpiresAt]) ||
        null,
      magicToken: magicToken || null,
    },
    paidCheckoutReady:
      Boolean(checkoutToken) &&
      normalizeString(lead[LEAD_PAYMENT_FIELDS.checkoutTokenStatus]).toLowerCase() ===
        "active",
    tierVisibility: founderOnly ? "founder_only" : "standard",
    upgradeEligibleUntil: UPGRADE_ELIGIBLE_UNTIL,
    hasActiveMembership: ACTIVE_MEMBERSHIP_STATES.has(paymentStatus),
    options: founderOnly ? buildFounderOptions() : buildStandardOptions(lead),
  };
}

function formatUsd(cents) {
  const number = Number(cents || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: number % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(number);
}

function listAllowedContractKeys(lead) {
  const options = isFounderOnlyLead(lead)
    ? buildFounderOptions()
    : buildStandardOptions(lead);
  const allowed = new Set();

  for (const option of Object.values(options)) {
    if (!option) {
      continue;
    }

    if (normalizeString(option.contractKey)) {
      allowed.add(option.contractKey);
    }

    if (Array.isArray(option.billingChoices)) {
      for (const choice of option.billingChoices) {
        if (normalizeString(choice?.contractKey)) {
          allowed.add(choice.contractKey);
        }
      }
    }
  }

  return allowed;
}

function validateApprovedLead(lead) {
  const reviewStatus = normalizeString(lead.review_status).toLowerCase();
  if (reviewStatus !== "approved") {
    return errorResponse(
      403,
      "lead_not_approved",
      "Lead is not approved for checkout.",
      {
        reviewStatus: reviewStatus || null,
      }
    );
  }

  return null;
}

function validateMagicTokenState(lead, providedToken) {
  const leadMagicToken = normalizeString(lead.magic_token);
  if (!leadMagicToken || leadMagicToken !== normalizeString(providedToken)) {
    return errorResponse(404, "token_not_found", "Token not found.");
  }

  const magicStatus = normalizeString(lead.magic_token_status).toLowerCase();
  if (magicStatus && magicStatus !== "active") {
    return errorResponse(
      410,
      "magic_token_inactive",
      "Tier-selection link is not active."
    );
  }

  const magicExpiresAt = parseIsoDate(lead.magic_token_expires_at);
  if (magicExpiresAt && magicExpiresAt.getTime() < Date.now()) {
    return errorResponse(
      410,
      "magic_token_expired",
      "Tier-selection link has expired."
    );
  }

  return null;
}

function issueCheckoutTokenPayload(lead) {
  const now = new Date();
  const version = Number(lead[LEAD_PAYMENT_FIELDS.checkoutTokenVersion] || 0) + 1;
  const issuedAt = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  return {
    checkoutToken: crypto.randomBytes(32).toString("hex"),
    checkoutTokenStatus: "active",
    checkoutTokenVersion: version,
    checkoutTokenIssuedAt: issuedAt,
    checkoutTokenExpiresAt: expiresAt,
    updatedAt: issuedAt,
  };
}

async function mintCheckoutToken(lead) {
  const payload = issueCheckoutTokenPayload(lead);

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        lead_id: lead.lead_id,
      },
      ConditionExpression:
        "magic_token = :magic_token AND review_status = :approved",
      UpdateExpression: [
        `SET ${LEAD_PAYMENT_FIELDS.checkoutToken} = :checkout_token`,
        `${LEAD_PAYMENT_FIELDS.checkoutTokenStatus} = :checkout_token_status`,
        `${LEAD_PAYMENT_FIELDS.checkoutTokenVersion} = :checkout_token_version`,
        `${LEAD_PAYMENT_FIELDS.checkoutTokenIssuedAt} = :checkout_token_issued_at`,
        `${LEAD_PAYMENT_FIELDS.checkoutTokenExpiresAt} = :checkout_token_expires_at`,
        "updated_at = :updated_at",
      ].join(", "),
      ExpressionAttributeValues: {
        ":magic_token": normalizeString(lead.magic_token),
        ":approved": "approved",
        ":checkout_token": payload.checkoutToken,
        ":checkout_token_status": payload.checkoutTokenStatus,
        ":checkout_token_version": payload.checkoutTokenVersion,
        ":checkout_token_issued_at": payload.checkoutTokenIssuedAt,
        ":checkout_token_expires_at": payload.checkoutTokenExpiresAt,
        ":updated_at": payload.updatedAt,
      },
    })
  );

  return payload;
}

function parseRequestBody(event) {
  if (!event?.body) {
    return {};
  }

  try {
    return JSON.parse(event.body);
  } catch (error) {
    throw new Error("Request body must be valid JSON");
  }
}

async function handleMintRequest(event) {
  const body = parseRequestBody(event);
  const leadId =
    normalizeString(body.leadId) ||
    normalizeString(body.lead_id) ||
    normalizeString(event.queryStringParameters?.lead_id);
  const magicToken =
    normalizeString(body.magicToken) ||
    normalizeString(body.magic_token) ||
    normalizeString(body.token);
  const contractKey =
    normalizeString(body.contractKey) ||
    normalizeString(body.contract_key);

  if (!leadId) {
    return errorResponse(400, "missing_lead_id", "Missing lead_id.");
  }

  if (!magicToken) {
    return errorResponse(400, "missing_token", "Missing token.");
  }

  if (!contractKey) {
    return errorResponse(400, "missing_contract_key", "Missing contract key.");
  }

  const lead = await findLeadByLeadId(leadId);
  if (!lead) {
    return errorResponse(404, "lead_not_found", "Lead not found.");
  }

  const reviewError = validateApprovedLead(lead);
  if (reviewError) {
    return reviewError;
  }

  const tokenError = validateMagicTokenState(lead, magicToken);
  if (tokenError) {
    return tokenError;
  }

  const allowedContracts = listAllowedContractKeys(lead);
  if (!allowedContracts.has(contractKey)) {
    return errorResponse(
      403,
      "contract_not_allowed",
      "This contract is not available on the current route.",
      {
        contractKey,
      }
    );
  }

  const payload = await mintCheckoutToken(lead);
  return response(200, {
    checkoutToken: payload.checkoutToken,
    checkoutTokenStatus: payload.checkoutTokenStatus,
    checkoutTokenVersion: payload.checkoutTokenVersion,
    checkoutTokenIssuedAt: payload.checkoutTokenIssuedAt,
    checkoutTokenExpiresAt: payload.checkoutTokenExpiresAt,
  });
}

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || "GET";
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  try {
    if (method === "POST") {
      return await handleMintRequest(event);
    }

    const token = normalizeString(event.queryStringParameters?.token);
    const leadId = normalizeString(event.queryStringParameters?.lead_id);
    if (!token) {
      return errorResponse(400, "missing_token", "Missing token.");
    }

    const lookup = await findLeadByRouteToken(token, leadId);
    if (!lookup) {
      return errorResponse(404, "token_not_found", "Token not found.");
    }

    const lead = lookup.lead;
    const reviewError = validateApprovedLead(lead);
    if (reviewError) {
      return reviewError;
    }

    if (lookup.tokenType === "magic") {
      const tokenError = validateMagicTokenState(lead, token);
      if (tokenError) {
        return tokenError;
      }
    }

    const checkoutExpiresAt = parseIsoDate(
      lead[LEAD_PAYMENT_FIELDS.checkoutTokenExpiresAt]
    );

    if (
      checkoutExpiresAt &&
      normalizeString(lead[LEAD_PAYMENT_FIELDS.checkoutTokenStatus]).toLowerCase() ===
        "active" &&
      checkoutExpiresAt.getTime() < Date.now()
    ) {
      return errorResponse(
        410,
        "checkout_token_expired",
        "Checkout token has expired."
      );
    }

    return response(200, buildResponseBody(lead, lookup.tokenType));
  } catch (error) {
    console.error("checkout-context error", error);
    return errorResponse(500, "internal_error", "Internal error.", {
      detail: error.message,
    });
  }
};
