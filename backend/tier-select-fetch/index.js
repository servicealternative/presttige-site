const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const ssm = new SSMClient({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const UPGRADE_ELIGIBLE_UNTIL = "2026-12-31T23:59:59Z";
const PRICE_PARAMETER_NAMES = {
  club: "/presttige/stripe/club-y1-price-id",
  premier: "/presttige/stripe/premier-y1-price-id",
  patron: "/presttige/stripe/patron-lifetime-price-id",
};
const TIER_DEFINITIONS = {
  subscriber: {
    slug: "subscriber",
    eyebrow: "ACCESS POINT",
    label: "Subscriber",
    price: "No payment required",
    price_short: "No payment required",
    billing: null,
    renewal: null,
    checkout_description:
      "ACCESS POINT — You have been approved. No payment required at this stage. Your place is recognised. Your tier — Club, Premier, or Patron — is yours to choose, when you choose.",
  },
  patron: {
    slug: "patron",
    eyebrow: "BY EXCEPTION",
    label: "Patron",
    price: "$999 / year",
    price_short: "$999 / year",
    billing: "yearly",
    renewal: "By annual conversation.",
    checkout_description:
      "BY EXCEPTION — The closest position to Presttige. A direct line into the network and its founders.",
  },
  premier: {
    slug: "premier",
    eyebrow: "PRESENCE",
    label: "Premier",
    price: "$388.88 / year",
    price_short: "$388.88 / year",
    billing: "yearly",
    renewal: "Annual. At your discretion.",
    checkout_description:
      "PRESENCE — A central position within the network, with the right to introduce proposals to the committee.",
  },
  club: {
    slug: "club",
    eyebrow: "ENTRY",
    label: "Club",
    price: "$144.44 / year",
    price_short: "$144.44 / year",
    billing: "yearly",
    renewal: "Annual. At your discretion.",
    checkout_description:
      "ENTRY — Your entry into the network.",
  },
};

let cachedPriceIds = null;

async function loadPriceIds() {
  if (cachedPriceIds) {
    return cachedPriceIds;
  }

  const response = await ssm.send(
    new GetParametersCommand({
      Names: Object.values(PRICE_PARAMETER_NAMES),
    })
  );

  const byName = new Map((response.Parameters || []).map((parameter) => [parameter.Name, parameter.Value]));
  cachedPriceIds = {
    club: byName.get(PRICE_PARAMETER_NAMES.club) || null,
    premier: byName.get(PRICE_PARAMETER_NAMES.premier) || null,
    patron: byName.get(PRICE_PARAMETER_NAMES.patron) || null,
  };
  return cachedPriceIds;
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

    if (lead.magic_token_status === "used" || lead.account_active || lead.payment_status === "paid") {
      return response(410, {
        error: "Membership already activated",
        payment_status: lead.payment_status || null,
      });
    }

    if (lead.magic_token_expires_at && new Date(lead.magic_token_expires_at) < new Date()) {
      return response(410, { error: "Token expired" });
    }

    const priceIds = await loadPriceIds();

    return response(200, {
      profile: {
        name: lead.name || null,
        email: lead.email || null,
      },
      upgrade_eligible_until: UPGRADE_ELIGIBLE_UNTIL,
      tiers: {
        subscriber: {
          ...TIER_DEFINITIONS.subscriber,
          price_id: null,
        },
        patron: {
          ...TIER_DEFINITIONS.patron,
          price_id: priceIds.patron,
        },
        premier: {
          ...TIER_DEFINITIONS.premier,
          price_id: priceIds.premier,
        },
        club: {
          ...TIER_DEFINITIONS.club,
          price_id: priceIds.club,
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
