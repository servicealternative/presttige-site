const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { SSMClient, GetParametersByPathCommand } = require("@aws-sdk/client-ssm");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const ssm = new SSMClient({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";

let cachedTiers = null;

async function loadTiers() {
  if (cachedTiers) {
    return cachedTiers;
  }

  const response = await ssm.send(
    new GetParametersByPathCommand({
      Path: "/presttige/stripe/",
      Recursive: true,
    })
  );

  const tiers = {
    patron: {},
    tier2: {},
    tier3: {},
  };

  for (const parameter of response.Parameters || []) {
    const parts = parameter.Name.split("/");
    const tier = parts[3];
    const key = parts[4];
    if (tiers[tier]) {
      tiers[tier][key] = parameter.Value;
    }
  }

  cachedTiers = tiers;
  return cachedTiers;
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

    if (lead.magic_token_status === "used" || lead.account_active || ["paid", "free"].includes(lead.payment_status)) {
      return response(410, {
        error: "Membership already activated",
        payment_status: lead.payment_status || null,
      });
    }

    if (lead.magic_token_expires_at && new Date(lead.magic_token_expires_at) < new Date()) {
      return response(410, { error: "Token expired" });
    }

    const tiers = await loadTiers();

    return response(200, {
      profile: {
        name: lead.name || null,
        email: lead.email || null,
      },
      pricing_status: "TBD-PLACEHOLDER",
      tiers: {
        patron: {
          label: "Presttige Patron",
          monthly: 5000,
          annual: 51000,
          price_ids: tiers.patron,
        },
        tier2: {
          label: "Presttige Tier 2",
          monthly: 1500,
          annual: 15300,
          price_ids: tiers.tier2,
        },
        tier3: {
          label: "Presttige Tier 3",
          monthly: 500,
          annual: 5100,
          price_ids: tiers.tier3,
        },
        free: {
          label: "Free Membership",
          monthly: 0,
          annual: 0,
          price_ids: null,
        },
      },
    });
  } catch (error) {
    console.error("tier-select-fetch error", error);
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
