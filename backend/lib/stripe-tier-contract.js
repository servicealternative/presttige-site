"use strict";

// Pricing migrated 2026-04-30 per matriz v0.3.x.
// Account: METTALIX Test mode (acct_1TJdzqDmiQXcrE5N).
// Old ULTRATTEK price IDs removed.
// Upgrades use patron_yearly price + first-invoice coupon rather than
// separate products, per Antonio's locked 4-product / 8-price architecture.
// Cleanup applied in M-R6.1.5 on 2026-04-30.

const CHECKOUT_TOKEN_INDEX_NAME = "checkout-token-index";
const STRIPE_EVENTS_TABLE_NAME = "presttige-stripe-events";
const CHECKOUT_TOKEN_TTL_DAYS = 30;
const COMMISSION_PROFILES = Object.freeze({
  club: 0.1,
  premier: 0.2,
  patron: 0.3,
  founder: 0.3,
});

const CHECKOUT_TOKEN_STATUSES = Object.freeze([
  "active",
  "consumed",
  "reissued",
  "expired",
]);

const PAYMENT_STATUSES = Object.freeze([
  "none",
  "checkout_ready",
  "checkout_started",
  "processing",
  "paid",
  "failed",
  "cancelled",
  "free",
  "refunded",
  "subscription_active",
  "subscription_past_due",
  "subscription_cancel_at_period_end",
  "renewal_failed_retrying",
  "renewal_cancelled",
  "downgraded_to_subscriber",
]);

const LEAD_PAYMENT_FIELDS = Object.freeze({
  checkoutToken: "checkout_token",
  checkoutTokenStatus: "checkout_token_status",
  checkoutTokenIssuedAt: "checkout_token_issued_at",
  checkoutTokenExpiresAt: "checkout_token_expires_at",
  checkoutTokenVersion: "checkout_token_version",
  paymentStatus: "payment_status",
  paymentStatusReason: "payment_status_reason",
  selectedContractKey: "selected_contract_key",
  selectedCheckoutMode: "selected_checkout_mode",
  selectedTier: "selected_tier",
  selectedTierBilling: "selected_tier_billing",
  selectedPriceId: "selected_price_id",
  selectedReferrerId: "selected_referrer_id",
  selectedReferrerType: "selected_referrer_type",
  selectedReferenceCode: "selected_reference_code",
  stripeCustomerId: "stripe_customer_id",
  stripePaymentIntentId: "stripe_payment_intent_id",
  stripeSetupIntentId: "stripe_setup_intent_id",
  stripeSubscriptionId: "stripe_subscription_id",
  stripeLatestInvoiceId: "stripe_latest_invoice_id",
  stripeLastEventId: "stripe_last_event_id",
  stripeCheckoutStartedAt: "stripe_checkout_started_at",
  stripeCheckoutCompletedAt: "stripe_checkout_completed_at",
  stripePaymentFailedAt: "stripe_payment_failed_at",
  subscriptionCurrentPeriodStart: "subscription_current_period_start",
  subscriptionCurrentPeriodEnd: "subscription_current_period_end",
  subscriptionCancelAtPeriodEnd: "subscription_cancel_at_period_end",
  subscriptionCancelledAt: "subscription_cancelled_at",
  renewalAttemptCount: "renewal_attempt_count",
  renewalLastFailedAt: "renewal_last_failed_at",
  downgradedToSubscriberAt: "downgraded_to_subscriber_at",
  founderEligible: "founder_eligible",
  founderGateStatus: "founder_gate_status",
  tierIntent: "tier_intent",
  ambassadorConfirmationStatus: "ambassador_confirmation_status",
  ambassadorConfirmationRequestedAt: "ambassador_confirmation_requested_at",
  ambassadorConfirmationDueAt: "ambassador_confirmation_due_at",
  ambassadorConfirmationCompletedAt: "ambassador_confirmation_completed_at",
  ambassadorConfirmationReasoning: "ambassador_confirmation_reasoning",
  committeePrioritySource: "committee_priority_source",
  committeePriorityRank: "committee_priority_rank",
});

function defineContract(definition) {
  return Object.freeze({
    checkoutMode: "subscription",
    tierVisibility: "standard",
    downgradeTargetTier: "subscriber",
    commissionProfile: COMMISSION_PROFILES.club,
    requiresFounderReferral: false,
    publicCheckoutEnabled: true,
    fromTier: null,
    welcomeVariant: "paid",
    grantsAccessStatus: "subscription_active",
    stripePriceType: "recurring",
    renewalAmountUsdCents: definition.amountUsdCents,
    initialChargeUsdCents: definition.amountUsdCents,
    basePriceParameter: definition.priceParameter,
    subscriptionTargetPriceParameter: definition.priceParameter,
    firstInvoiceCoupon: null,
    upgradeStrategy: null,
    display: null,
    metadata: null,
    ...definition,
  });
}

const STRIPE_TIER_CONTRACT = Object.freeze({
  // TODO M-R6.2.M: Replace club_monthly Price ID with v4.0 amount ($22.22)
  club_monthly: defineContract({
    contractKey: "club_monthly",
    tier: "club",
    billing: "monthly",
    chargeType: "membership",
    priceParameter: "/presttige/stripe/club-monthly-price-id",
    amountUsdCents: 2200,
    commissionProfile: COMMISSION_PROFILES.club,
    renewalAmountUsdCents: 2200,
    availability: "after_first_year_only",
  }),
  // TODO M-R6.2.M: Replace club_yearly Price ID with v4.0 amount ($144.44)
  club_yearly: defineContract({
    contractKey: "club_yearly",
    tier: "club",
    billing: "yearly",
    chargeType: "membership",
    priceParameter: "/presttige/stripe/club-yearly-price-id",
    amountUsdCents: 22200,
    commissionProfile: COMMISSION_PROFILES.club,
    renewalAmountUsdCents: 22200,
    displayPerMonth: "$18.50/mo on annual plan",
  }),
  // RETAINED M-R6.2.M: Quarterly removed from UI but kept for legacy
  // active subscriptions. Do not remove backend support.
  // TODO M-R6.2.M: Wire new Stripe Price ID for club_semi_annual ($99.99)
  club_quarterly: defineContract({
    contractKey: "club_quarterly",
    tier: "club",
    billing: "quarterly",
    chargeType: "membership",
    priceParameter: "/presttige/stripe/club-quarterly-price-id",
    amountUsdCents: 7700,
    commissionProfile: COMMISSION_PROFILES.club,
    renewalAmountUsdCents: 7700,
    recurringInterval: "month",
    recurringIntervalCount: 4,
    availability: "after_first_year_only",
    displayPerMonth: "$19.25/mo on 4-month plan",
  }),
  // TODO M-R6.2.M: Replace premier_monthly Price ID with v4.0 amount ($55.55)
  premier_monthly: defineContract({
    contractKey: "premier_monthly",
    tier: "premier",
    billing: "monthly",
    chargeType: "membership",
    priceParameter: "/presttige/stripe/premier-monthly-price-id",
    amountUsdCents: 3300,
    commissionProfile: COMMISSION_PROFILES.premier,
    renewalAmountUsdCents: 3300,
    availability: "after_first_year_only",
  }),
  // TODO M-R6.2.M: Replace premier_yearly Price ID with v4.0 amount ($388.88)
  premier_yearly: defineContract({
    contractKey: "premier_yearly",
    tier: "premier",
    billing: "yearly",
    chargeType: "membership",
    priceParameter: "/presttige/stripe/premier-yearly-price-id",
    amountUsdCents: 33300,
    commissionProfile: COMMISSION_PROFILES.premier,
    renewalAmountUsdCents: 33300,
    displayPerMonth: "$27.75/mo on annual plan",
  }),
  // RETAINED M-R6.2.M: Quarterly removed from UI but kept for legacy
  // active subscriptions. Do not remove backend support.
  // TODO M-R6.2.M: Wire new Stripe Price ID for premier_semi_annual ($277.77)
  premier_quarterly: defineContract({
    contractKey: "premier_quarterly",
    tier: "premier",
    billing: "quarterly",
    chargeType: "membership",
    priceParameter: "/presttige/stripe/premier-quarterly-price-id",
    amountUsdCents: 11100,
    commissionProfile: COMMISSION_PROFILES.premier,
    renewalAmountUsdCents: 11100,
    recurringInterval: "month",
    recurringIntervalCount: 4,
    availability: "after_first_year_only",
    displayPerMonth: "$27.75/mo on 4-month plan",
  }),
  patron_yearly: defineContract({
    contractKey: "patron_yearly",
    tier: "patron",
    billing: "yearly",
    chargeType: "membership",
    priceParameter: "/presttige/stripe/patron-yearly-price-id",
    amountUsdCents: 99900,
    commissionProfile: COMMISSION_PROFILES.patron,
    renewalAmountUsdCents: 99900,
    displayPerMonth: "$83.25/mo on annual plan",
    note: "Patron is annual-only, no monthly or quarterly options",
  }),
  founder_lifetime: defineContract({
    contractKey: "founder_lifetime",
    tier: "founder",
    billing: "lifetime",
    chargeType: "entry",
    priceParameter: "/presttige/stripe/founder-lifetime-price-id",
    amountUsdCents: 999900,
    checkoutMode: "payment",
    tierVisibility: "founder_only",
    downgradeTargetTier: "none",
    commissionProfile: COMMISSION_PROFILES.founder,
    requiresFounderReferral: true,
    welcomeVariant: "founder",
    grantsAccessStatus: "paid",
    stripePriceType: "one_time",
    renewalAmountUsdCents: null,
    initialChargeUsdCents: 999900,
  }),
  club_to_patron_upgrade: defineContract({
    contractKey: "club_to_patron_upgrade",
    tier: "patron",
    billing: "yearly",
    chargeType: "upgrade",
    priceParameter: "/presttige/stripe/patron-yearly-price-id",
    basePriceParameter: "/presttige/stripe/patron-yearly-price-id",
    amountUsdCents: 90000,
    commissionProfile: COMMISSION_PROFILES.patron,
    fromTier: "club",
    renewalAmountUsdCents: 99900,
    initialChargeUsdCents: 90000,
    subscriptionTargetPriceParameter: "/presttige/stripe/patron-yearly-price-id",
    firstInvoiceCoupon: "upgrade_club_to_patron_first_invoice",
    upgradeStrategy: "first_invoice_coupon",
    display: {
      firstInvoice: "$900 today",
      recurring: "then $999/year",
    },
    metadata: {
      fromTier: "club",
      toTier: "patron",
    },
  }),
  premier_to_patron_upgrade: defineContract({
    contractKey: "premier_to_patron_upgrade",
    tier: "patron",
    billing: "yearly",
    chargeType: "upgrade",
    priceParameter: "/presttige/stripe/patron-yearly-price-id",
    basePriceParameter: "/presttige/stripe/patron-yearly-price-id",
    amountUsdCents: 77700,
    commissionProfile: COMMISSION_PROFILES.patron,
    fromTier: "premier",
    renewalAmountUsdCents: 99900,
    initialChargeUsdCents: 77700,
    subscriptionTargetPriceParameter: "/presttige/stripe/patron-yearly-price-id",
    firstInvoiceCoupon: "upgrade_premier_to_patron_first_invoice",
    upgradeStrategy: "first_invoice_coupon",
    display: {
      firstInvoice: "$777 today",
      recurring: "then $999/year",
    },
    metadata: {
      fromTier: "premier",
      toTier: "patron",
    },
  }),
});

function listTierContractKeys() {
  return Object.keys(STRIPE_TIER_CONTRACT);
}

function getTierContract(contractKey) {
  return STRIPE_TIER_CONTRACT[contractKey] || null;
}

function mustGetTierContract(contractKey) {
  const contract = getTierContract(contractKey);
  if (!contract) {
    throw new Error(`Unknown Stripe tier contract: ${contractKey}`);
  }
  return contract;
}

function isValidPaymentStatus(status) {
  return PAYMENT_STATUSES.includes(String(status || "").trim());
}

function isValidCheckoutTokenStatus(status) {
  return CHECKOUT_TOKEN_STATUSES.includes(String(status || "").trim());
}

module.exports = {
  CHECKOUT_TOKEN_INDEX_NAME,
  STRIPE_EVENTS_TABLE_NAME,
  CHECKOUT_TOKEN_TTL_DAYS,
  COMMISSION_PROFILES,
  CHECKOUT_TOKEN_STATUSES,
  PAYMENT_STATUSES,
  LEAD_PAYMENT_FIELDS,
  STRIPE_TIER_CONTRACT,
  listTierContractKeys,
  getTierContract,
  mustGetTierContract,
  isValidPaymentStatus,
  isValidCheckoutTokenStatus,
};
