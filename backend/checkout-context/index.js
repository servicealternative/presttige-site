"use strict";

const path = require("node:path");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
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
    "Access-Control-Allow-Methods": "GET,OPTIONS",
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

async function findLeadByMagicToken(token) {
  let ExclusiveStartKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "magic_token = :magic_token",
        ExpressionAttributeValues: {
          ":magic_token": token,
        },
        ExclusiveStartKey,
      })
    );

    if (result.Items?.length) {
      return result.Items[0];
    }

    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return null;
}

async function findLeadByAnyToken(token) {
  const byCheckoutToken = await findLeadByCheckoutToken(token);
  if (byCheckoutToken) {
    return {
      lead: byCheckoutToken,
      tokenType: "checkout",
    };
  }

  const byMagicToken = await findLeadByMagicToken(token);
  if (byMagicToken) {
    return {
      lead: byMagicToken,
      tokenType: "magic",
    };
  }

  return null;
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

  return {
    contractKey: contract.contractKey,
    billing: contract.billing,
    label:
      contract.billing === "monthly"
        ? `$${formatUsd(contract.amountUsdCents)} / month`
        : `$${formatUsd(contract.amountUsdCents)} / year`,
  };
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
      initialChargeUsdCents: contract.initialChargeUsdCents,
      renewalAmountUsdCents: contract.renewalAmountUsdCents,
    };
  }

  return {
    tier: "patron",
    contractKey: "patron_yearly",
    displayMode: "standard",
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
      billingChoices: ["club_monthly", "club_yearly"]
        .map(buildBillingChoice)
        .filter(Boolean),
    },
    premier: {
      tier: "premier",
      displayMode: "standard",
      billingChoices: ["premier_monthly", "premier_yearly"]
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

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  const token = normalizeString(event.queryStringParameters?.token);
  if (!token) {
    return errorResponse(400, "missing_token", "Missing token.");
  }

  try {
    const lookup = await findLeadByAnyToken(token);
    if (!lookup) {
      return errorResponse(404, "token_not_found", "Token not found.");
    }

    const lead = lookup.lead;
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

    if (lookup.tokenType === "magic") {
      const magicExpiresAt = parseIsoDate(lead.magic_token_expires_at);
      if (magicExpiresAt && magicExpiresAt.getTime() < Date.now()) {
        return errorResponse(
          410,
          "magic_token_expired",
          "Tier-selection link has expired."
        );
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
