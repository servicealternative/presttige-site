const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { SSMClient, GetParametersCommand } = require("@aws-sdk/client-ssm");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const ssm = new SSMClient({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const UPGRADE_ELIGIBLE_UNTIL = "2026-12-31T23:59:59Z";
const PRICE_PARAMETER_NAMES = {
  club_monthly: "/presttige/stripe/club-monthly-price-id",
  club_semi_annual: "/presttige/stripe/club-semi-annual-price-id",
  club_yearly: "/presttige/stripe/club-yearly-price-id",
  premier_monthly: "/presttige/stripe/premier-monthly-price-id",
  premier_semi_annual: "/presttige/stripe/premier-semi-annual-price-id",
  premier_yearly: "/presttige/stripe/premier-yearly-price-id",
  patron_yearly: "/presttige/stripe/patron-yearly-price-id",
  founder_lifetime: "/presttige/stripe/founder-lifetime-price-id",
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
    price: "$999 / year",
    price_short: "$999",
    billing: "yearly",
    renewal: "Renews at $999/year.",
    checkout_description:
      "HIGHEST TIER · BY EXCEPTION — The inner circle. Full Presttige network access, direct access to founders, and the curated add-on services that sit above the wider member program.",
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
  founder: {
    slug: "founder",
    eyebrow: "FOUNDING TIER",
    label: "Founder",
    price: "$9,999 lifetime",
    price_short: "$9,999 lifetime",
    billing: "lifetime",
    renewal: null,
    checkout_description:
      "FOUNDING TIER — Reserved founder access with a single lifetime payment and the deepest Presttige relationship.",
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
  cachedPriceIds = Object.fromEntries(
    Object.entries(PRICE_PARAMETER_NAMES).map(([key, parameterName]) => [
      key,
      byName.get(parameterName) || null,
    ])
  );
  return cachedPriceIds;
}

function buildBillingChoice(contractKey, billing, label, priceId) {
  return {
    contract_key: contractKey,
    billing,
    label,
    price_id: priceId,
  };
}

function buildTierPayload(priceIds) {
  return {
    subscriber: {
      ...TIER_DEFINITIONS.subscriber,
      price_id: null,
      price_ids: {},
      billing_choices: [],
    },
    patron: {
      ...TIER_DEFINITIONS.patron,
      price_id: priceIds.patron_yearly,
      price_ids: {
        yearly: priceIds.patron_yearly,
      },
      billing_choices: [
        buildBillingChoice(
          "patron_yearly",
          "yearly",
          "$999 / year",
          priceIds.patron_yearly
        ),
      ],
    },
    premier: {
      ...TIER_DEFINITIONS.premier,
      price_id: priceIds.premier_yearly,
      price_ids: {
        monthly: priceIds.premier_monthly,
        semi_annual: priceIds.premier_semi_annual,
        yearly: priceIds.premier_yearly,
      },
      billing_choices: [
        buildBillingChoice(
          "premier_monthly",
          "monthly",
          "$55.55 / month",
          priceIds.premier_monthly
        ),
        buildBillingChoice(
          "premier_semi_annual",
          "semi_annual",
          "$277.77 / 6 months",
          priceIds.premier_semi_annual
        ),
        buildBillingChoice(
          "premier_yearly",
          "yearly",
          "$388.88 / year",
          priceIds.premier_yearly
        ),
      ],
    },
    club: {
      ...TIER_DEFINITIONS.club,
      price_id: priceIds.club_yearly,
      price_ids: {
        monthly: priceIds.club_monthly,
        semi_annual: priceIds.club_semi_annual,
        yearly: priceIds.club_yearly,
      },
      billing_choices: [
        buildBillingChoice(
          "club_monthly",
          "monthly",
          "$22.22 / month",
          priceIds.club_monthly
        ),
        buildBillingChoice(
          "club_semi_annual",
          "semi_annual",
          "$99.99 / 6 months",
          priceIds.club_semi_annual
        ),
        buildBillingChoice(
          "club_yearly",
          "yearly",
          "$144.44 / year",
          priceIds.club_yearly
        ),
      ],
    },
    founder: {
      ...TIER_DEFINITIONS.founder,
      price_id: priceIds.founder_lifetime,
      price_ids: {
        lifetime: priceIds.founder_lifetime,
      },
      billing_choices: [
        buildBillingChoice(
          "founder_lifetime",
          "lifetime",
          "$9,999 lifetime",
          priceIds.founder_lifetime
        ),
      ],
    },
  };
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
      tiers: buildTierPayload(priceIds),
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
