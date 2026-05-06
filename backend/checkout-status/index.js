"use strict";

const path = require("node:path");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  SSMClient,
  GetParameterCommand,
} = require("@aws-sdk/client-ssm");

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
const STRIPE_SECRET_KEY_PARAMETER = "/presttige/stripe/secret-key";

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);
const ssm = new SSMClient({ region: REGION });
let cachedStripeCredentials = null;

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

async function getStripeCredentials() {
  if (cachedStripeCredentials) {
    return cachedStripeCredentials;
  }

  const result = await ssm.send(
    new GetParameterCommand({
      Name: STRIPE_SECRET_KEY_PARAMETER,
      WithDecryption: true,
    })
  );

  const credentials = {
    secretKey: normalizeString(result.Parameter?.Value),
  };
  if (!credentials.secretKey) {
    throw new Error("Stripe secret key missing from SSM");
  }

  cachedStripeCredentials = credentials;
  return credentials;
}

async function stripeRequest(pathname) {
  const credentials = await getStripeCredentials();
  const responseValue = await fetch(`https://api.stripe.com${pathname}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${credentials.secretKey}`,
    },
  });

  const text = await responseValue.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    payload = { raw: text };
  }

  if (!responseValue.ok) {
    const error = new Error(
      payload?.error?.message ||
        `Stripe request failed with status ${responseValue.status}`
    );
    error.body = payload;
    throw error;
  }

  return payload;
}

async function inspectStripePaymentIntent(lead) {
  const paymentIntentId = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.stripePaymentIntentId]
  );
  if (!paymentIntentId) {
    return null;
  }

  const paymentIntent = await stripeRequest(`/v1/payment_intents/${paymentIntentId}`);
  const mode = normalizeString(lead[LEAD_PAYMENT_FIELDS.selectedCheckoutMode]).toLowerCase();

  if (paymentIntent.status === "succeeded") {
    return {
      derivedPaymentStatus:
        mode === "subscription" ? "subscription_active" : "paid",
      stripePaymentIntentStatus: paymentIntent.status,
    };
  }

  if (paymentIntent.status === "processing" || paymentIntent.status === "requires_action") {
    return {
      derivedPaymentStatus: "processing",
      stripePaymentIntentStatus: paymentIntent.status,
    };
  }

  if (
    paymentIntent.status === "requires_payment_method" ||
    paymentIntent.status === "canceled"
  ) {
    return {
      derivedPaymentStatus: "failed",
      stripePaymentIntentStatus: paymentIntent.status,
    };
  }

  return {
    derivedPaymentStatus: null,
    stripePaymentIntentStatus: paymentIntent.status,
  };
}

function mapDisplayState(paymentStatus) {
  const normalized = normalizeString(paymentStatus).toLowerCase();

  if (
    normalized === "paid" ||
    normalized === "preview_paid" ||
    normalized === "free" ||
    normalized === "subscription_active" ||
    normalized === "subscription_cancel_at_period_end"
  ) {
    return "paid";
  }

  if (
    normalized === "failed" ||
    normalized === "cancelled" ||
    normalized === "refunded" ||
    normalized === "renewal_failed_retrying" ||
    normalized === "renewal_cancelled" ||
    normalized === "downgraded_to_subscriber"
  ) {
    return "failed";
  }

  return "processing";
}

function buildRetryUrl(lead) {
  const contractKey = normalizeString(lead[LEAD_PAYMENT_FIELDS.selectedContractKey]);
  const checkoutToken = normalizeString(lead[LEAD_PAYMENT_FIELDS.checkoutToken]);
  const selectedTier = normalizeString(lead[LEAD_PAYMENT_FIELDS.selectedTier]).toLowerCase();

  if (!contractKey || !checkoutToken || !selectedTier) {
    return null;
  }

  return `/checkout/${encodeURIComponent(selectedTier)}/${encodeURIComponent(contractKey)}?token=${encodeURIComponent(checkoutToken)}`;
}

function formatRecordedAt(value) {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function buildBody(lead, tokenType, stripeInsight) {
  const currentPaymentStatus = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.paymentStatus] || lead.payment_status
  ).toLowerCase();
  const effectivePaymentStatus =
    normalizeString(stripeInsight?.derivedPaymentStatus).toLowerCase() ||
    currentPaymentStatus ||
    "processing";
  const contractKey = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.selectedContractKey]
  ).toLowerCase();
  const contract = contractKey ? getTierContract(contractKey) : null;

  return {
    tokenType,
    displayState: mapDisplayState(effectivePaymentStatus),
    paymentStatus: effectivePaymentStatus,
    previewMode: Boolean(lead.preview_mode),
    previewBannerText: Boolean(lead.preview_mode)
      ? "PREVIEW MODE · No payment was processed · This journey will not appear in member records"
      : null,
    recordedAt:
      formatRecordedAt(lead.preview_mode_completed_at) ||
      formatRecordedAt(lead[LEAD_PAYMENT_FIELDS.stripeCheckoutCompletedAt]) ||
      formatRecordedAt(lead.updated_at),
    tier:
      normalizeString(
        lead[LEAD_PAYMENT_FIELDS.selectedTier] || lead.selected_tier
      ).toLowerCase() || null,
    contractKey: contractKey || null,
    retryUrl: buildRetryUrl(lead),
    pollAfterMs: 4000,
    welcomeVariant: contract?.welcomeVariant || null,
    stripePaymentIntentStatus:
      stripeInsight?.stripePaymentIntentStatus || null,
    profile: {
      name: lead.name || null,
      email: lead.email || null,
    },
  };
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
    const currentPaymentStatus = normalizeString(
      lead[LEAD_PAYMENT_FIELDS.paymentStatus] || lead.payment_status
    ).toLowerCase();

    let stripeInsight = null;
    if (!lead.preview_mode && mapDisplayState(currentPaymentStatus) === "processing") {
      try {
        stripeInsight = await inspectStripePaymentIntent(lead);
      } catch (error) {
        console.error("checkout-status stripe inspect error", error);
      }
    }

    return response(200, buildBody(lead, lookup.tokenType, stripeInsight));
  } catch (error) {
    console.error("checkout-status error", error);
    return errorResponse(500, "internal_error", "Internal error.", {
      detail: error.message,
    });
  }
};
