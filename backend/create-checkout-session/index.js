"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
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
  mustGetTierContract,
} = loadTierContractModule();

const REGION = "us-east-1";
const TABLE_NAME = "presttige-db";
const STRIPE_SECRET_KEY_PARAMETER = "/presttige/stripe/secret-key";
const STRIPE_PUBLISHABLE_KEY_PARAMETER = "/presttige/stripe/publishable-key";
const STRIPE_ACCOUNT_ID = "acct_1TJdzqDmiQXcrE5N";
const APP_ORIGIN = "https://presttige.net";
const STANDARD_CURRENCY = "usd";
const LEGACY_TIER_TO_CONTRACT = Object.freeze({
  club: "club_yearly",
  premier: "premier_yearly",
  patron: "patron_yearly",
  founder: "founder_lifetime",
});
const TERMINAL_PAYMENT_STATUSES = new Set([
  "paid",
  "subscription_active",
  "subscription_cancel_at_period_end",
  "renewal_cancelled",
  "downgraded_to_subscriber",
]);

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);
const ssm = new SSMClient({ region: REGION });

let cachedStripeCredentials = null;
const cachedPriceParameters = new Map();

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Methods": "OPTIONS,POST",
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

function emptyResponse(statusCode = 204) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: "",
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
  return normalizeString(value).toLowerCase() === "true";
}

function parseBody(event) {
  if (!event?.body) {
    return {};
  }

  try {
    return JSON.parse(event.body);
  } catch (error) {
    throw new Error("Request body must be valid JSON");
  }
}

function parseIsoDate(value) {
  const input = normalizeString(value);
  if (!input) {
    return null;
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function buildIdempotencyKey(lead, contract) {
  const raw = [
    lead.lead_id,
    contract.contractKey,
    String(lead[LEAD_PAYMENT_FIELDS.checkoutTokenVersion] || 1),
    contract.checkoutMode,
  ].join("|");

  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function getStripeCredentials() {
  if (cachedStripeCredentials) {
    return cachedStripeCredentials;
  }

  const [secretResult, publishableResult] = await Promise.all([
    ssm.send(
      new GetParameterCommand({
        Name: STRIPE_SECRET_KEY_PARAMETER,
        WithDecryption: true,
      })
    ),
    ssm.send(
      new GetParameterCommand({
        Name: STRIPE_PUBLISHABLE_KEY_PARAMETER,
      })
    ),
  ]);

  const credentials = {
    secretKey: normalizeString(secretResult.Parameter?.Value),
    publishableKey: normalizeString(publishableResult.Parameter?.Value),
  };

  if (!credentials.secretKey) {
    throw new Error("Stripe secret key missing from SSM");
  }

  if (!credentials.publishableKey) {
    throw new Error("Stripe publishable key missing from SSM");
  }

  cachedStripeCredentials = credentials;
  return credentials;
}

async function getPriceId(parameterName) {
  if (cachedPriceParameters.has(parameterName)) {
    return cachedPriceParameters.get(parameterName);
  }

  const result = await ssm.send(
    new GetParameterCommand({
      Name: parameterName,
    })
  );
  const priceId = result.Parameter?.Value || "";
  if (!priceId) {
    throw new Error(`Price parameter resolved empty: ${parameterName}`);
  }

  cachedPriceParameters.set(parameterName, priceId);
  return priceId;
}

function appendFormValue(params, prefix, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const childPrefix =
        item !== null && typeof item === "object"
          ? `${prefix}[${index}]`
          : `${prefix}[]`;
      appendFormValue(params, childPrefix, item);
    });
    return;
  }

  if (typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      appendFormValue(params, `${prefix}[${key}]`, nestedValue);
    }
    return;
  }

  params.append(prefix, String(value));
}

function toFormEncoded(data) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(data || {})) {
    appendFormValue(params, key, value);
  }
  return params.toString();
}

async function stripeRequest({
  method,
  path: requestPath,
  data = null,
  idempotencyKey = null,
  stripeSecretKey,
}) {
  const url = new URL(`https://api.stripe.com${requestPath}`);
  const headers = {
    Authorization: `Bearer ${stripeSecretKey}`,
  };

  const init = { method, headers };

  if (method !== "GET" && data) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = toFormEncoded(data);
  }

  if (idempotencyKey && method !== "GET") {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch (error) {
    payload = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      payload?.error?.message ||
        `Stripe request failed with status ${res.status}`
    );
    err.statusCode = res.status;
    err.type = payload?.error?.type || "stripe_error";
    err.code = payload?.error?.code || null;
    err.body = payload;
    throw err;
  }

  return payload;
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
    throw new Error("Checkout token lookup returned multiple lead records");
  }

  return result.Items[0];
}

function mapLegacyTierToContractKey(tier) {
  const normalized = normalizeString(tier).toLowerCase();
  return LEGACY_TIER_TO_CONTRACT[normalized] || "";
}

function resolveRequestedContractKey(body) {
  const contractKey =
    normalizeString(body.contractKey) ||
    normalizeString(body.contract_key) ||
    mapLegacyTierToContractKey(body.tier);

  return contractKey;
}

function buildStripeMetadata(lead, contract) {
  return {
    lead_id: lead.lead_id,
    contract_key: contract.contractKey,
    checkout_mode: contract.checkoutMode,
    checkout_token_version: String(
      lead[LEAD_PAYMENT_FIELDS.checkoutTokenVersion] || 1
    ),
    tier: contract.tier,
    billing: contract.billing,
    charge_type: contract.chargeType,
    tier_visibility: contract.tierVisibility,
    requires_founder_referral: String(
      Boolean(contract.requiresFounderReferral)
    ),
  };
}

function buildContractMetadata(contract) {
  const metadata = {
    tierVisibility: contract.tierVisibility,
    downgradeTargetTier: contract.downgradeTargetTier,
    commissionProfile: contract.commissionProfile,
    requiresFounderReferral: Boolean(contract.requiresFounderReferral),
  };

  if (contract.upgradeStrategy) {
    metadata.upgrade_strategy = contract.upgradeStrategy;
  }
  if (contract.firstInvoiceCoupon) {
    metadata.first_invoice_coupon = contract.firstInvoiceCoupon;
  }
  if (typeof contract.initialChargeUsdCents === "number") {
    metadata.initial_charge_usd_cents = contract.initialChargeUsdCents;
  }
  if (typeof contract.renewalAmountUsdCents === "number") {
    metadata.renewal_amount_usd_cents = contract.renewalAmountUsdCents;
  }

  return metadata;
}

function formatTierLabel(value) {
  return normalizeString(value)
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function extractIntentIdFromClientSecret(clientSecret) {
  const secret = normalizeString(clientSecret);
  if (!secret || !secret.includes("_secret_")) {
    return null;
  }
  return secret.split("_secret_")[0] || null;
}

function validateLeadForContract(lead, contract) {
  const tokenStatus = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.checkoutTokenStatus]
  ).toLowerCase();
  const tokenExpiresAt = parseIsoDate(
    lead[LEAD_PAYMENT_FIELDS.checkoutTokenExpiresAt]
  );
  const reviewStatus = normalizeString(lead.review_status).toLowerCase();
  const paymentStatus = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.paymentStatus]
  ).toLowerCase();
  const selectedContractKey = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.selectedContractKey]
  ).toLowerCase();

  if (!tokenStatus || tokenStatus !== "active") {
    return errorResponse(
      410,
      "checkout_token_inactive",
      "Checkout token is not active.",
      {
        tokenStatus: tokenStatus || null,
      }
    );
  }

  if (tokenExpiresAt && tokenExpiresAt.getTime() < Date.now()) {
    return errorResponse(
      410,
      "checkout_token_expired",
      "Checkout token has expired."
    );
  }

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

  if (contract.requiresFounderReferral && !isTruthy(lead.founder_eligible)) {
    return errorResponse(
      403,
      "founder_referral_required",
      "Founder checkout requires founder-eligible referral attribution."
    );
  }

  if (contract.chargeType === "upgrade") {
    if (
      selectedContractKey === contract.contractKey &&
      ["checkout_ready", "checkout_started", "failed", "processing"].includes(
        paymentStatus
      )
    ) {
      return null;
    }

    const currentTier = normalizeString(
      lead[LEAD_PAYMENT_FIELDS.selectedTier] ||
        lead.selected_tier ||
        lead.effective_tier
    ).toLowerCase();

    if (!currentTier || currentTier !== contract.fromTier) {
      return errorResponse(
        409,
        "upgrade_not_eligible",
        `Lead is not eligible for the ${contract.contractKey} upgrade.`,
        {
          requiredTier: contract.fromTier,
          currentTier: currentTier || null,
        }
      );
    }

    return null;
  }

  if (TERMINAL_PAYMENT_STATUSES.has(paymentStatus)) {
    return errorResponse(
      409,
      "checkout_already_completed",
      "This lead already has an active or completed payment state.",
      {
        paymentStatus,
      }
    );
  }

  return null;
}

async function createOrReuseStripeCustomer(lead, credentials, idempotencyKey) {
  const existingCustomerId = normalizeString(
    lead[LEAD_PAYMENT_FIELDS.stripeCustomerId]
  );
  if (existingCustomerId) {
    return { id: existingCustomerId };
  }

  return stripeRequest({
    method: "POST",
    path: "/v1/customers",
    stripeSecretKey: credentials.secretKey,
    idempotencyKey: `${idempotencyKey}:customer`,
    data: {
      email: normalizeString(lead.email) || undefined,
      name: normalizeString(lead.name) || undefined,
      phone:
        normalizeString(lead.phone) ||
        normalizeString(lead.phone_full) ||
        undefined,
      metadata: {
        lead_id: lead.lead_id,
        source: "presttige_mr3",
      },
    },
  });
}

async function createPaymentModeBootstrap({
  lead,
  contract,
  priceId,
  customerId,
  credentials,
  idempotencyKey,
}) {
  const paymentIntent = await stripeRequest({
    method: "POST",
    path: "/v1/payment_intents",
    stripeSecretKey: credentials.secretKey,
    idempotencyKey: `${idempotencyKey}:payment_intent`,
    data: {
      amount: contract.initialChargeUsdCents,
      currency: STANDARD_CURRENCY,
      customer: customerId,
      receipt_email: normalizeString(lead.email) || undefined,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: buildStripeMetadata(lead, contract),
      description: `Presttige ${formatTierLabel(contract.tier)} checkout`,
    },
  });

  if (!paymentIntent.client_secret) {
    throw new Error("Stripe PaymentIntent did not return a client secret");
  }

  return {
    clientSecret: paymentIntent.client_secret,
    amount: paymentIntent.amount,
    currency: normalizeString(paymentIntent.currency).toUpperCase(),
    intentKind: "payment",
    stripeObjectIds: {
      customerId,
      paymentIntentId: paymentIntent.id,
      subscriptionId: null,
      latestInvoiceId: null,
    },
  };
}

async function createSubscriptionModeBootstrap({
  lead,
  contract,
  subscriptionPriceId,
  customerId,
  credentials,
  idempotencyKey,
}) {
  const subscriptionPayload = {
    customer: customerId,
    items: [{ price: subscriptionPriceId }],
    collection_method: "charge_automatically",
    payment_behavior: "default_incomplete",
    payment_settings: {
      save_default_payment_method: "on_subscription",
    },
    expand: [
      "latest_invoice.payment_intent",
      "latest_invoice.confirmation_secret",
    ],
    metadata: buildStripeMetadata(lead, contract),
  };

  if (contract.firstInvoiceCoupon) {
    subscriptionPayload.discounts = [{ coupon: contract.firstInvoiceCoupon }];
  }

  const subscription = await stripeRequest({
    method: "POST",
    path: "/v1/subscriptions",
    stripeSecretKey: credentials.secretKey,
    idempotencyKey: `${idempotencyKey}:subscription`,
    data: subscriptionPayload,
  });

  const latestInvoice = subscription.latest_invoice || null;
  const paymentIntent = latestInvoice?.payment_intent || null;
  const invoiceConfirmationSecret = latestInvoice?.confirmation_secret || null;
  const clientSecret =
    paymentIntent?.client_secret ||
    invoiceConfirmationSecret?.client_secret ||
    null;

  if (!clientSecret) {
    throw new Error(
      "Stripe subscription bootstrap did not return a first-invoice client secret"
    );
  }

  return {
    clientSecret,
    amount: contract.initialChargeUsdCents,
    currency: STANDARD_CURRENCY.toUpperCase(),
    intentKind: "payment",
    stripeObjectIds: {
      customerId,
      paymentIntentId:
        paymentIntent?.id || extractIntentIdFromClientSecret(clientSecret),
      subscriptionId: subscription.id,
      latestInvoiceId: latestInvoice?.id || null,
    },
  };
}

async function persistBootstrapState({
  lead,
  contract,
  selectedPriceId,
  stripeObjectIds,
}) {
  const now = new Date().toISOString();
  const setExpressions = [
    `${LEAD_PAYMENT_FIELDS.paymentStatus} = :payment_status`,
    `${LEAD_PAYMENT_FIELDS.paymentStatusReason} = :payment_status_reason`,
    `${LEAD_PAYMENT_FIELDS.selectedContractKey} = :selected_contract_key`,
    `${LEAD_PAYMENT_FIELDS.selectedCheckoutMode} = :selected_checkout_mode`,
    `${LEAD_PAYMENT_FIELDS.selectedTier} = :selected_tier`,
    `${LEAD_PAYMENT_FIELDS.selectedTierBilling} = :selected_tier_billing`,
    `${LEAD_PAYMENT_FIELDS.selectedPriceId} = :selected_price_id`,
    `${LEAD_PAYMENT_FIELDS.stripeCustomerId} = :stripe_customer_id`,
    `${LEAD_PAYMENT_FIELDS.stripeCheckoutStartedAt} = if_not_exists(${LEAD_PAYMENT_FIELDS.stripeCheckoutStartedAt}, :stripe_checkout_started_at)`,
    "currency = :currency",
    "product_type = :product_type",
  ];
  const removeExpressions = [];
  const values = {
    ":payment_status": "checkout_ready",
    ":payment_status_reason": "bootstrap_created",
    ":selected_contract_key": contract.contractKey,
    ":selected_checkout_mode": contract.checkoutMode,
    ":selected_tier": contract.tier,
    ":selected_tier_billing": contract.billing,
    ":selected_price_id": selectedPriceId,
    ":stripe_customer_id": stripeObjectIds.customerId,
    ":stripe_checkout_started_at": now,
    ":currency": STANDARD_CURRENCY.toUpperCase(),
    ":product_type": contract.chargeType,
  };

  if (stripeObjectIds.paymentIntentId) {
    setExpressions.push(
      `${LEAD_PAYMENT_FIELDS.stripePaymentIntentId} = :stripe_payment_intent_id`
    );
    values[":stripe_payment_intent_id"] = stripeObjectIds.paymentIntentId;
  } else {
    removeExpressions.push(LEAD_PAYMENT_FIELDS.stripePaymentIntentId);
  }

  if (stripeObjectIds.subscriptionId) {
    setExpressions.push(
      `${LEAD_PAYMENT_FIELDS.stripeSubscriptionId} = :stripe_subscription_id`
    );
    values[":stripe_subscription_id"] = stripeObjectIds.subscriptionId;
  } else {
    removeExpressions.push(LEAD_PAYMENT_FIELDS.stripeSubscriptionId);
  }

  if (stripeObjectIds.latestInvoiceId) {
    setExpressions.push(
      `${LEAD_PAYMENT_FIELDS.stripeLatestInvoiceId} = :stripe_latest_invoice_id`
    );
    values[":stripe_latest_invoice_id"] = stripeObjectIds.latestInvoiceId;
  } else {
    removeExpressions.push(LEAD_PAYMENT_FIELDS.stripeLatestInvoiceId);
  }

  removeExpressions.push(LEAD_PAYMENT_FIELDS.stripeSetupIntentId);

  const updateExpression = [
    `SET ${setExpressions.join(", ")}`,
    removeExpressions.length ? `REMOVE ${removeExpressions.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { lead_id: lead.lead_id },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: values,
    })
  );
}

async function resolveContractPriceIds(contract) {
  const primaryPriceId = await getPriceId(
    contract.basePriceParameter || contract.priceParameter
  );
  const subscriptionTargetPriceId =
    contract.subscriptionTargetPriceParameter &&
    contract.subscriptionTargetPriceParameter !==
      (contract.basePriceParameter || contract.priceParameter)
      ? await getPriceId(contract.subscriptionTargetPriceParameter)
      : primaryPriceId;

  return {
    primaryPriceId,
    subscriptionTargetPriceId,
  };
}

function buildBootstrapResponse({
  credentials,
  contract,
  lead,
  contractMetadata,
  amount,
  currency,
  clientSecret,
  intentKind,
}) {
  return {
    publishableKey: credentials.publishableKey,
    clientSecret,
    contractKey: contract.contractKey,
    checkoutMode: contract.checkoutMode,
    contractMetadata,
    amount,
    currency,
    customerEmail: normalizeString(lead.email) || null,
    intentKind,
  };
}

function isOptionsRequest(event) {
  const method =
    event?.requestContext?.http?.method || event?.httpMethod || event?.requestContext?.httpMethod;
  return normalizeString(method).toUpperCase() === "OPTIONS";
}

exports.handler = async (event) => {
  if (isOptionsRequest(event)) {
    return emptyResponse();
  }

  let body;
  try {
    body = parseBody(event);
  } catch (error) {
    return errorResponse(400, "invalid_json", error.message);
  }

  const checkoutToken =
    normalizeString(body.checkoutToken) ||
    normalizeString(body.checkout_token) ||
    normalizeString(body.token);
  const requestedContractKey = resolveRequestedContractKey(body);

  if (!checkoutToken) {
    return errorResponse(
      400,
      "missing_checkout_token",
      "Checkout token is required."
    );
  }

  if (!requestedContractKey) {
    return errorResponse(
      400,
      "missing_contract_key",
      "Contract key is required."
    );
  }

  let contract;
  try {
    contract = mustGetTierContract(requestedContractKey);
  } catch (error) {
    return errorResponse(
      400,
      "invalid_contract_key",
      "Contract key is not recognized.",
      { contractKey: requestedContractKey }
    );
  }

  try {
    const lead = await findLeadByCheckoutToken(checkoutToken);
    if (!lead) {
      return errorResponse(
        404,
        "checkout_token_not_found",
        "Checkout token was not found."
      );
    }

    const validationError = validateLeadForContract(lead, contract);
    if (validationError) {
      return validationError;
    }

    const credentials = await getStripeCredentials();
    const priceIds = await resolveContractPriceIds(contract);
    const idempotencyKey = buildIdempotencyKey(lead, contract);
    const customer = await createOrReuseStripeCustomer(
      lead,
      credentials,
      idempotencyKey
    );

    let bootstrap;
    if (contract.checkoutMode === "payment") {
      bootstrap = await createPaymentModeBootstrap({
        lead,
        contract,
        priceId: priceIds.primaryPriceId,
        customerId: customer.id,
        credentials,
        idempotencyKey,
      });
    } else {
      bootstrap = await createSubscriptionModeBootstrap({
        lead,
        contract,
        subscriptionPriceId: priceIds.subscriptionTargetPriceId,
        customerId: customer.id,
        credentials,
        idempotencyKey,
      });
    }

    await persistBootstrapState({
      lead,
      contract,
      selectedPriceId:
        contract.checkoutMode === "payment"
          ? priceIds.primaryPriceId
          : priceIds.subscriptionTargetPriceId,
      stripeObjectIds: bootstrap.stripeObjectIds,
    });

    console.log("stripe_bootstrap_created", {
      stripe_account_id: STRIPE_ACCOUNT_ID,
      lead_id: lead.lead_id,
      contract_key: contract.contractKey,
      checkout_mode: contract.checkoutMode,
      stripe_customer_id: customer.id,
      stripe_object_ids: bootstrap.stripeObjectIds,
    });

    return response(
      200,
      buildBootstrapResponse({
        credentials,
        contract,
        lead,
        contractMetadata: buildContractMetadata(contract),
        amount: bootstrap.amount,
        currency: bootstrap.currency,
        clientSecret: bootstrap.clientSecret,
        intentKind: bootstrap.intentKind,
      })
    );
  } catch (error) {
    console.error("create-checkout-session bootstrap error", {
      message: error.message,
      statusCode: error.statusCode || null,
      type: error.type || null,
      code: error.code || null,
      body: error.body || null,
    });

    if (error.message === "Stripe publishable key missing from SSM") {
      return errorResponse(
        500,
        "stripe_publishable_key_missing",
        "Stripe publishable key is not configured in SSM."
      );
    }

    if (error.message === "Stripe secret key missing from SSM") {
      return errorResponse(
        500,
        "stripe_secret_key_missing",
        "Stripe secret key is not configured in SSM."
      );
    }

    if (error.name === "ResourceNotFoundException") {
      return errorResponse(
        500,
        "stripe_secret_not_found",
        "Stripe credentials parameter is not configured."
      );
    }

    if (error.statusCode) {
      return errorResponse(
        502,
        "stripe_bootstrap_failed",
        error.message,
        {
          stripeStatusCode: error.statusCode,
          stripeCode: error.code || null,
          stripeType: error.type || null,
        }
      );
    }

    return errorResponse(500, "internal_error", error.message);
  }
};
