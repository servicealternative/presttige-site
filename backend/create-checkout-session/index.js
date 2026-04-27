const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const secrets = new SecretsManagerClient({ region: "us-east-1" });
const ssm = new SSMClient({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const UPGRADE_ELIGIBLE_UNTIL = "2026-12-31T23:59:59Z";
const TIER_CONFIG = {
  club: {
    billing: "y1_prepay",
    priceParameter: "/presttige/stripe/club-y1-price-id",
  },
  premier: {
    billing: "y1_prepay",
    priceParameter: "/presttige/stripe/premier-y1-price-id",
  },
  patron: {
    billing: "lifetime",
    priceParameter: "/presttige/stripe/patron-lifetime-price-id",
  },
};

let cachedStripeKey = null;

async function getStripeKey() {
  if (cachedStripeKey) {
    return cachedStripeKey;
  }

  try {
    const response = await secrets.send(
      new GetSecretValueCommand({ SecretId: "presttige-stripe-secret" })
    );
    cachedStripeKey = response.SecretString;
    return cachedStripeKey;
  } catch (error) {
    if (process.env.STRIPE_SECRET_KEY) {
      cachedStripeKey = process.env.STRIPE_SECRET_KEY;
      return cachedStripeKey;
    }
    throw new Error("Stripe key not configured");
  }
}

async function findLeadByMagicToken(token) {
  let ExclusiveStartKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "magic_token = :token",
        ExpressionAttributeValues: { ":token": token },
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

function welcomeUrl(token) {
  return `https://presttige.net/welcome/${token}`;
}

function cancelUrl(token, tier) {
  return `https://presttige.net/tier-select/${token}/${tier}?cancelled=1`;
}

function computeFoundingRateExpiresAt(tier) {
  if (tier === "patron") {
    return null;
  }

  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 365);
  return expiresAt.toISOString();
}

exports.handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const { token, tier } = body;

  if (!token || !tier) {
    return response(400, { error: "Missing token or tier" });
  }

  if (!Object.prototype.hasOwnProperty.call(TIER_CONFIG, tier)) {
    return response(400, { error: "Invalid tier" });
  }

  try {
    const lead = await findLeadByMagicToken(token);
    if (!lead) {
      return response(404, { error: "Token not found" });
    }

    if (lead.magic_token_expires_at && new Date(lead.magic_token_expires_at) < new Date()) {
      return response(410, { error: "Token expired" });
    }

    if (lead.magic_token_status === "used" && lead.account_active) {
      return response(200, {
        redirect_url: welcomeUrl(token),
        already_active: true,
      });
    }

    if (lead.payment_status === "paid") {
      return response(200, {
        redirect_url: welcomeUrl(token),
        already_paid: true,
      });
    }

    const stripeKey = await getStripeKey();
    const config = TIER_CONFIG[tier];
    const foundingRateExpiresAt = computeFoundingRateExpiresAt(tier);
    const upgradeEligibleUntil = tier === "patron" ? null : UPGRADE_ELIGIBLE_UNTIL;
    const priceParameter = await ssm.send(
      new GetParameterCommand({
        Name: config.priceParameter,
      })
    );
    const priceId = priceParameter.Parameter.Value;

    const params = new URLSearchParams();
    params.append("mode", "payment");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("customer_email", lead.email || "");
    params.append("success_url", `${welcomeUrl(token)}?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", cancelUrl(token, tier));
    params.append("client_reference_id", lead.lead_id);
    params.append("metadata[lead_id]", lead.lead_id);
    params.append("metadata[product]", "membership");
    params.append("metadata[tier]", tier);
    params.append("metadata[billing]", config.billing);
    params.append("metadata[founding_rate_locked]", "true");
    if (foundingRateExpiresAt) {
      params.append("metadata[founding_rate_expires_at]", foundingRateExpiresAt);
    }
    if (upgradeEligibleUntil) {
      params.append("metadata[upgrade_eligible_until]", upgradeEligibleUntil);
    }

    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await stripeResponse.json();
    if (!stripeResponse.ok) {
      console.error("Stripe checkout error", session);
      return response(500, {
        error: "Stripe checkout failed",
        detail: session.error?.message || "Unknown Stripe error",
      });
    }

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id: lead.lead_id },
        UpdateExpression: `
          SET selected_tier = :tier,
              selected_tier_billing = :billing,
              stripe_session_id = :session_id,
              payment_status = :payment_status,
              founding_rate_locked = :founding_rate_locked,
              founding_rate_expires_at = :founding_rate_expires_at,
              upgrade_eligible_until = :upgrade_eligible_until,
              stripe_checkout_mode = :stripe_checkout_mode,
              selected_tier_selected_at = :selected_at,
              stripe_checkout_started_at = :started_at,
              selected_price_id = :price_id,
              currency = :currency,
              product_type = :product_type
          REMOVE selected_periodicity, effective_tier, effective_tier_until
        `,
        ExpressionAttributeValues: {
          ":tier": tier,
          ":billing": config.billing,
          ":session_id": session.id,
          ":payment_status": "pending",
          ":founding_rate_locked": true,
          ":founding_rate_expires_at": foundingRateExpiresAt,
          ":upgrade_eligible_until": upgradeEligibleUntil,
          ":stripe_checkout_mode": "payment",
          ":selected_at": new Date().toISOString(),
          ":started_at": new Date().toISOString(),
          ":price_id": priceId,
          ":currency": "USD",
          ":product_type": "membership",
        },
      })
    );

    return response(200, {
      redirect_url: session.url,
      session_id: session.id,
      selected_tier: tier,
      selected_tier_billing: config.billing,
    });
  } catch (error) {
    console.error("create-checkout-session error", error);
    return response(500, { error: "Internal", detail: error.message });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "https://presttige.net",
    },
    body: JSON.stringify(body),
  };
}
