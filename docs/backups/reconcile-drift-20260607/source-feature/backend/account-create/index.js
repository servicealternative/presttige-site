const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const crypto = require("crypto");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const lambda = new LambdaClient({ region: "us-east-1" });
const secrets = new SecretsManagerClient({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const MAGIC_LINK_SECRET_ID = "presttige-magic-link-secret";
const SEND_TIER_EMAIL_FUNCTION = "presttige-send-tier-select-email";

let cachedSecret = null;

async function getSecret() {
  if (cachedSecret) {
    return cachedSecret;
  }

  const response = await secrets.send(
    new GetSecretValueCommand({ SecretId: MAGIC_LINK_SECRET_ID })
  );
  cachedSecret = response.SecretString;
  return cachedSecret;
}

exports.handler = async (event) => {
  const { lead_id } = JSON.parse(event.body || "{}");
  if (!lead_id) {
    return response(400, { error: "Missing lead_id" });
  }

  try {
    const leadResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { lead_id },
      })
    );
    const lead = leadResult.Item;

    if (!lead) {
      return response(404, { error: "Lead not found" });
    }

    if (lead.review_status !== "approved") {
      return response(400, { error: "Lead not approved" });
    }

    if (lead.magic_token) {
      console.log("Magic token already exists for", lead_id);
      return response(200, { already_initialized: true });
    }

    const secret = await getSecret();
    const attemptId = crypto.randomBytes(8).toString("hex");
    const magicToken = crypto
      .createHmac("sha256", secret)
      .update(`${lead_id}|tier-select|${attemptId}`)
      .digest("hex");

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id },
        UpdateExpression: [
          "SET magic_token = :token",
          "magic_token_status = :status",
          "magic_token_issued_at = :issued_at",
          "magic_token_expires_at = :expires_at",
          "payment_status = :payment_status",
        ].join(", "),
        ExpressionAttributeValues: {
          ":token": magicToken,
          ":status": "active",
          ":issued_at": issuedAt,
          ":expires_at": expiresAt,
          ":payment_status": "pending",
        },
      })
    );

    await lambda.send(
      new InvokeCommand({
        FunctionName: SEND_TIER_EMAIL_FUNCTION,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ body: JSON.stringify({ lead_id }) })),
      })
    );

    return response(200, {
      initialized: true,
      token_first8: magicToken.substring(0, 8),
    });
  } catch (error) {
    console.error("account-create error", error);
    return response(500, { error: "Internal", detail: error.message });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
