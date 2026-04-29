"use strict";

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const contract = require(path.join(
  __dirname,
  "..",
  "backend",
  "lib",
  "stripe-tier-contract.js"
));

function awsJson(args) {
  const output = execFileSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
  });
  return JSON.parse(output);
}

function main() {
  const keys = contract.listTierContractKeys();
  const resolved = keys.map((key) => {
    const item = contract.mustGetTierContract(key);
    const response = awsJson([
      "ssm",
      "get-parameter",
      "--region",
      "us-east-1",
      "--name",
      item.priceParameter,
    ]);

    return {
      contract_key: key,
      tier: item.tier,
      billing: item.billing,
      charge_type: item.chargeType,
      stripe_intent_kind: item.stripeIntentKind,
      public_checkout_enabled: item.publicCheckoutEnabled,
      price_parameter: item.priceParameter,
      price_id: response.Parameter.Value,
      amount_usd_cents: item.amountUsdCents,
    };
  });

  const output = {
    checkout_token_index_name: contract.CHECKOUT_TOKEN_INDEX_NAME,
    checkout_token_ttl_days: contract.CHECKOUT_TOKEN_TTL_DAYS,
    stripe_events_table_name: contract.STRIPE_EVENTS_TABLE_NAME,
    checkout_token_statuses: contract.CHECKOUT_TOKEN_STATUSES,
    payment_statuses: contract.PAYMENT_STATUSES,
    lead_payment_fields: contract.LEAD_PAYMENT_FIELDS,
    contracts: resolved,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
