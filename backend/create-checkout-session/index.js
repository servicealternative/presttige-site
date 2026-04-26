const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const secrets = new SecretsManagerClient({ region: "us-east-1" });
const ssm = new SSMClient({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const TIER_UPGRADE_MAP = {
  tier3: "tier2",
  tier2: "patron",
  patron: "patron",
  free: "free",
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

function computeEffectiveTier(tier, periodicity) {
  if (tier === "free") {
    return { effectiveTier: "free", effectiveTierUntil: null };
  }

  if (periodicity !== "annual") {
    return { effectiveTier: tier, effectiveTierUntil: null };
  }

  const until = new Date();
  until.setFullYear(until.getFullYear() + 1);

  return {
    effectiveTier: TIER_UPGRADE_MAP[tier] || tier,
    effectiveTierUntil: until.toISOString(),
  };
}

exports.handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const { token, tier, periodicity } = body;

  if (!token || !tier || !periodicity) {
    return response(400, { error: "Missing token, tier, or periodicity" });
  }

  if (!["patron", "tier2", "tier3", "free"].includes(tier)) {
    return response(400, { error: "Invalid tier" });
  }

  if (tier !== "free" && !["monthly", "annual"].includes(periodicity)) {
    return response(400, { error: "Invalid periodicity" });
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

    if (["paid", "free"].includes(lead.payment_status)) {
      return response(200, {
        redirect_url: welcomeUrl(token),
        already_paid: true,
      });
    }

    if (tier === "free") {
      const now = new Date().toISOString();
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { lead_id: lead.lead_id },
          UpdateExpression: [
            "SET selected_tier = :tier",
            "selected_periodicity = :periodicity",
            "payment_status = :payment_status",
            "account_active = :account_active",
            "magic_token_status = :magic_status",
            "magic_token_used_at = :used_at",
            "onboarded_at = :onboarded_at",
            "effective_tier = :effective_tier",
            "effective_tier_until = :effective_tier_until",
          ].join(", "),
          ExpressionAttributeValues: {
            ":tier": "free",
            ":periodicity": null,
            ":payment_status": "free",
            ":account_active": true,
            ":magic_status": "used",
            ":used_at": now,
            ":onboarded_at": now,
            ":effective_tier": "free",
            ":effective_tier_until": null,
          },
        })
      );

      return response(200, {
        redirect_url: welcomeUrl(token),
        free: true,
      });
    }

    const priceParameter = await ssm.send(
      new GetParameterCommand({
        Name: `/presttige/stripe/${tier}/${periodicity}_price_id`,
      })
    );
    const priceId = priceParameter.Parameter.Value;
    const stripeKey = await getStripeKey();
    const { effectiveTier, effectiveTierUntil } = computeEffectiveTier(tier, periodicity);

    const params = new URLSearchParams();
    params.append("mode", "subscription");
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("customer_email", lead.email || "");
    params.append("success_url", `${welcomeUrl(token)}?session_id={CHECKOUT_SESSION_ID}`);
    params.append("cancel_url", `https://presttige.net/tier-select/${token}?cancelled=1`);
    params.append("client_reference_id", lead.lead_id);
    params.append("metadata[lead_id]", lead.lead_id);
    params.append("metadata[product]", "membership");
    params.append("metadata[plan]", tier);
    params.append("metadata[term]", periodicity);
    params.append("metadata[tier]", tier);
    params.append("metadata[periodicity]", periodicity);

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
        UpdateExpression: [
          "SET selected_tier = :tier",
          "selected_periodicity = :periodicity",
          "stripe_session_id = :session_id",
          "payment_status = :payment_status",
          "effective_tier = :effective_tier",
          "effective_tier_until = :effective_tier_until",
        ].join(", "),
        ExpressionAttributeValues: {
          ":tier": tier,
          ":periodicity": periodicity,
          ":session_id": session.id,
          ":payment_status": "pending",
          ":effective_tier": effectiveTier,
          ":effective_tier_until": effectiveTierUntil,
        },
      })
    );

    return response(200, {
      redirect_url: session.url,
      session_id: session.id,
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
