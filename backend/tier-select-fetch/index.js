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
    eyebrow: "ENTRY PATH",
    label: "Subscriber",
    price: "No payment required",
    price_short: "No payment required",
    billing: null,
    renewal: null,
    checkout_description:
      "ENTRY PATH — For approved candidates who choose to stay close to Presttige without committing to a tier today. Receive Presttige communications, follow Patron seat availability, and upgrade to Club, Premier, or Patron whenever you're ready.",
  },
  patron: {
    slug: "patron",
    eyebrow: "HIGHEST TIER · BY EXCEPTION",
    label: "Patron",
    price: "$999 · one-time · lifetime",
    price_short: "$999",
    billing: "lifetime",
    renewal: null,
    checkout_description:
      "HIGHEST TIER · BY EXCEPTION — The inner circle. A single payment of $999 — once, forever. The full Presttige network, direct access to founders, and the only tier with our curated add-on services.",
  },
  premier: {
    slug: "premier",
    eyebrow: "MEMBERSHIP TIER",
    label: "Premier",
    price: "$55.55 / month · $277.77 / 6 months · $388.88 / year",
    price_short: "$55.55 / month · $277.77 / 6 months · $388.88 / year",
    billing: "y1_prepay",
    renewal: "Renews at $55.55/month, $277.77/6 months, or $388.88/year.",
    checkout_description:
      "MEMBERSHIP TIER — Full access to the Presttige network, with the right to suggest new members. A founding rate locked for your first year.",
  },
  club: {
    slug: "club",
    eyebrow: "MEMBERSHIP TIER",
    label: "Club",
    price: "$22.22 / month · $99.99 / 6 months · $144.44 / year",
    price_short: "$22.22 / month · $99.99 / 6 months · $144.44 / year",
    billing: "y1_prepay",
    renewal: "Renews at $22.22/month, $99.99/6 months, or $144.44/year.",
    checkout_description:
      "MEMBERSHIP TIER — The entry to the Presttige network. Founding-rate access for your first year, and the option to upgrade to Patron at any time before 31 December 2026.",
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
