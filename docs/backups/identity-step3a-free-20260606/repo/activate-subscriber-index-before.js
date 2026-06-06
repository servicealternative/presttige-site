const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const lambda = new LambdaClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const TABLE_NAME = "presttige-db";
const UPGRADE_ELIGIBLE_UNTIL = "2026-12-31T23:59:59Z";
const SEND_SUBSCRIBER_WELCOME_FUNCTION_NAME =
  process.env.SEND_SUBSCRIBER_WELCOME_FUNCTION_NAME || "presttige-send-subscriber-welcome-email";

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

async function invokeSubscriberWelcomeEmail(leadId) {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: SEND_SUBSCRIBER_WELCOME_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({
            body: JSON.stringify({ lead_id: leadId }),
          })
        ),
      })
    );
    return true;
  } catch (error) {
    console.error("activate-subscriber invoke error", error);
    return false;
  }
}

function redirectUrl(token) {
  return `https://presttige.net/subscriber-activated/${token}`;
}

exports.handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const token = String(body.token || "").trim();

  if (!token) {
    return response(400, { error: "Missing token" });
  }

  try {
    const lead = await findLeadByMagicToken(token);
    if (!lead) {
      return response(404, { error: "Token not found" });
    }

    if (lead.magic_token_expires_at && new Date(lead.magic_token_expires_at) < new Date()) {
      return response(410, { error: "Token expired" });
    }

    if (lead.payment_status === "paid" || lead.account_active) {
      return response(409, { error: "Membership already activated" });
    }

    const now = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id: lead.lead_id },
        UpdateExpression: `
          SET selected_tier = :tier,
              selected_tier_billing = :billing,
              founding_rate_locked = :founding_rate_locked,
              founding_rate_expires_at = :founding_rate_expires_at,
              upgrade_eligible_until = :upgrade_eligible_until,
              subscriber_activated_at = if_not_exists(subscriber_activated_at, :subscriber_activated_at)
          REMOVE selected_periodicity, effective_tier, effective_tier_until, stripe_session_id, stripe_checkout_started_at, selected_price_id
        `,
        ExpressionAttributeValues: {
          ":tier": "subscriber",
          ":billing": null,
          ":founding_rate_locked": false,
          ":founding_rate_expires_at": null,
          ":upgrade_eligible_until": UPGRADE_ELIGIBLE_UNTIL,
          ":subscriber_activated_at": now,
        },
      })
    );

    const welcomeTriggered = await invokeSubscriberWelcomeEmail(lead.lead_id);

    return response(200, {
      activated: true,
      selected_tier: "subscriber",
      subscriber_welcome_triggered: welcomeTriggered,
      redirect_url: redirectUrl(token),
    });
  } catch (error) {
    console.error("activate-subscriber error", error);
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
