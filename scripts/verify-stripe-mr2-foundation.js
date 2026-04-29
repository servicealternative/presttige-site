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
  if (keys.length !== 8) {
    throw new Error(
      `Expected 8 active Stripe tier contract keys, found ${keys.length}: ${keys.join(", ")}`
    );
  }

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
    const targetResponse =
      item.subscriptionTargetPriceParameter &&
      item.subscriptionTargetPriceParameter !== item.priceParameter
        ? awsJson([
            "ssm",
            "get-parameter",
            "--region",
            "us-east-1",
            "--name",
            item.subscriptionTargetPriceParameter,
          ])
        : null;

    return {
      contract_key: key,
      tier: item.tier,
      billing: item.billing,
      charge_type: item.chargeType,
      checkout_mode: item.checkoutMode,
      tier_visibility: item.tierVisibility,
      downgrade_target_tier: item.downgradeTargetTier,
      commission_profile: item.commissionProfile,
      requires_founder_referral: item.requiresFounderReferral,
      public_checkout_enabled: item.publicCheckoutEnabled,
      price_parameter: item.priceParameter,
      price_id: response.Parameter.Value,
      subscription_target_price_parameter:
        item.subscriptionTargetPriceParameter || null,
      subscription_target_price_id: targetResponse
        ? targetResponse.Parameter.Value
        : null,
      amount_usd_cents: item.amountUsdCents,
      initial_charge_usd_cents: item.initialChargeUsdCents,
      renewal_amount_usd_cents: item.renewalAmountUsdCents,
      stripe_price_type: item.stripePriceType,
      from_tier: item.fromTier,
      upgrade_strategy: item.upgradeStrategy,
    };
  });

  const output = {
    checkout_token_index_name: contract.CHECKOUT_TOKEN_INDEX_NAME,
    checkout_token_ttl_days: contract.CHECKOUT_TOKEN_TTL_DAYS,
    stripe_events_table_name: contract.STRIPE_EVENTS_TABLE_NAME,
    commission_profiles: contract.COMMISSION_PROFILES,
    checkout_token_statuses: contract.CHECKOUT_TOKEN_STATUSES,
    payment_statuses: contract.PAYMENT_STATUSES,
    lead_payment_fields: contract.LEAD_PAYMENT_FIELDS,
    contracts: resolved,
  };

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main();
