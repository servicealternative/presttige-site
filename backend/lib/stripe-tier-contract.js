"use strict";

const CHECKOUT_TOKEN_INDEX_NAME = "checkout-token-index";
const STRIPE_EVENTS_TABLE_NAME = "presttige-stripe-events";
const CHECKOUT_TOKEN_TTL_DAYS = 30;

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
  "renewal_active",
  "renewal_past_due",
  "renewal_cancelled",
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
  selectedTier: "selected_tier",
  selectedTierBilling: "selected_tier_billing",
  selectedPriceId: "selected_price_id",
  stripeCustomerId: "stripe_customer_id",
  stripePaymentIntentId: "stripe_payment_intent_id",
  stripeSetupIntentId: "stripe_setup_intent_id",
  stripeSubscriptionId: "stripe_subscription_id",
  stripeLatestInvoiceId: "stripe_latest_invoice_id",
  stripeLastEventId: "stripe_last_event_id",
  stripeCheckoutStartedAt: "stripe_checkout_started_at",
  stripeCheckoutCompletedAt: "stripe_checkout_completed_at",
  stripePaymentFailedAt: "stripe_payment_failed_at",
});

const STRIPE_TIER_CONTRACT = Object.freeze({
  club_y1: Object.freeze({
    contractKey: "club_y1",
    tier: "club",
    billing: "y1_prepay",
    chargeType: "entry",
    stripeIntentKind: "payment",
    priceParameter: "/presttige/stripe/club-y1-price-id",
    amountUsdCents: 9900,
    publicCheckoutEnabled: true,
    fromTier: null,
    welcomeVariant: "paid",
    grantsAccessStatus: "paid",
  }),
  club_monthly: Object.freeze({
    contractKey: "club_monthly",
    tier: "club",
    billing: "monthly",
    chargeType: "renewal",
    stripeIntentKind: "setup",
    priceParameter: "/presttige/stripe/club-monthly-price-id",
    amountUsdCents: 999,
    publicCheckoutEnabled: false,
    fromTier: null,
    welcomeVariant: "paid",
    grantsAccessStatus: "renewal_active",
  }),
  club_yearly: Object.freeze({
    contractKey: "club_yearly",
    tier: "club",
    billing: "yearly",
    chargeType: "renewal",
    stripeIntentKind: "setup",
    priceParameter: "/presttige/stripe/club-yearly-price-id",
    amountUsdCents: 9900,
    publicCheckoutEnabled: false,
    fromTier: null,
    welcomeVariant: "paid",
    grantsAccessStatus: "renewal_active",
  }),
  premier_y1: Object.freeze({
    contractKey: "premier_y1",
    tier: "premier",
    billing: "y1_prepay",
    chargeType: "entry",
    stripeIntentKind: "payment",
    priceParameter: "/presttige/stripe/premier-y1-price-id",
    amountUsdCents: 22200,
    publicCheckoutEnabled: true,
    fromTier: null,
    welcomeVariant: "paid",
    grantsAccessStatus: "paid",
  }),
  premier_monthly: Object.freeze({
    contractKey: "premier_monthly",
    tier: "premier",
    billing: "monthly",
    chargeType: "renewal",
    stripeIntentKind: "setup",
    priceParameter: "/presttige/stripe/premier-monthly-price-id",
    amountUsdCents: 3300,
    publicCheckoutEnabled: false,
    fromTier: null,
    welcomeVariant: "paid",
    grantsAccessStatus: "renewal_active",
  }),
  premier_yearly: Object.freeze({
    contractKey: "premier_yearly",
    tier: "premier",
    billing: "yearly",
    chargeType: "renewal",
    stripeIntentKind: "setup",
    priceParameter: "/presttige/stripe/premier-yearly-price-id",
    amountUsdCents: 22200,
    publicCheckoutEnabled: false,
    fromTier: null,
    welcomeVariant: "paid",
    grantsAccessStatus: "renewal_active",
  }),
  patron_lifetime: Object.freeze({
    contractKey: "patron_lifetime",
    tier: "patron",
    billing: "lifetime",
    chargeType: "entry",
    stripeIntentKind: "payment",
    priceParameter: "/presttige/stripe/patron-lifetime-price-id",
    amountUsdCents: 99900,
    publicCheckoutEnabled: true,
    fromTier: null,
    welcomeVariant: "paid",
    grantsAccessStatus: "paid",
  }),
  club_to_patron_upgrade: Object.freeze({
    contractKey: "club_to_patron_upgrade",
    tier: "patron",
    billing: "lifetime",
    chargeType: "upgrade",
    stripeIntentKind: "payment",
    priceParameter: "/presttige/stripe/club-to-patron-upgrade-price-id",
    amountUsdCents: 90000,
    publicCheckoutEnabled: true,
    fromTier: "club",
    welcomeVariant: "paid",
    grantsAccessStatus: "paid",
  }),
  premier_to_patron_upgrade: Object.freeze({
    contractKey: "premier_to_patron_upgrade",
    tier: "patron",
    billing: "lifetime",
    chargeType: "upgrade",
    stripeIntentKind: "payment",
    priceParameter: "/presttige/stripe/premier-to-patron-upgrade-price-id",
    amountUsdCents: 77700,
    publicCheckoutEnabled: true,
    fromTier: "premier",
    welcomeVariant: "paid",
    grantsAccessStatus: "paid",
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
