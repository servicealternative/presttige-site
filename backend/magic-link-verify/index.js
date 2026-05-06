const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const TABLE_NAME = "presttige-db";

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

exports.handler = async (event) => {
  const token = event.queryStringParameters?.token;
  if (!token) {
    return response(400, { error: "Missing token" });
  }

  try {
    const lead = await findLeadByMagicToken(token);
    if (!lead) {
      return response(404, { error: "Token not found" });
    }

    if (!lead.account_active && !["paid", "free", "preview_paid"].includes(lead.payment_status)) {
      return response(409, { error: "Membership not activated yet" });
    }

    if (lead.magic_token_status === "used" && lead.account_active) {
      return response(200, {
        lead_id: lead.lead_id,
        name: lead.name || null,
        tier: lead.selected_tier || null,
        payment_status: lead.payment_status || null,
        account_active: true,
      });
    }

    if (
      lead.magic_token_status === "active" &&
      lead.magic_token_expires_at &&
      new Date(lead.magic_token_expires_at) < new Date()
    ) {
      return response(410, { error: "Token expired" });
    }

    if (lead.magic_token_status !== "active") {
      return response(410, { error: "Token has already been used or expired" });
    }

    const now = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id: lead.lead_id },
        UpdateExpression: [
          "SET magic_token_status = :status",
          "magic_token_used_at = :used_at",
          "account_active = :account_active",
          "onboarded_at = if_not_exists(onboarded_at, :onboarded_at)",
        ].join(", "),
        ConditionExpression: "magic_token_status = :expected_status",
        ExpressionAttributeValues: {
          ":status": "used",
          ":expected_status": "active",
          ":used_at": now,
          ":account_active": true,
          ":onboarded_at": now,
        },
      })
    );

    return response(200, {
      lead_id: lead.lead_id,
      name: lead.name || null,
      tier: lead.selected_tier || null,
      payment_status: lead.payment_status || null,
      account_active: true,
    });
  } catch (error) {
    console.error("magic-link-verify error", error);
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
