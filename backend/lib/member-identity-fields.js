"use strict";

const PRESTTIGE_MEMBER_COGNITO_POOL = Object.freeze({
  name: "presttige-members",
  id: "us-east-1_hpwdNFGss",
  region: "us-east-1",
});

const MEMBER_IDENTITY_FIELDS = Object.freeze({
  cognitoSub: "cognito_sub",
  cognitoPool: "cognito_pool",
  accountStatus: "account_status",
  passwordSetAt: "password_set_at",
  welcomeEmailSentAt: "welcome_email_sent_at",
  activationEmailSentAt: "activation_email_sent_at",
  validationStatus: "validation_status",
  signupPath: "signup_path",
});

const MEMBER_IDENTITY_RESERVED_FIELDS = Object.freeze({
  inviteCode: "invite_code",
  invitedByLeadId: "invited_by_lead_id",
  walletBalanceCredits: "wallet_balance_credits",
});

const MEMBER_ACCOUNT_STATUSES = Object.freeze({
  choiceCompleted: "choice_completed",
  accountCreated: "account_created",
  passwordPending: "password_pending",
  activePendingValidation: "active_pending_validation",
  active: "active",
  suspended: "suspended",
});

const MEMBER_VALIDATION_STATUSES = Object.freeze({
  notStarted: "not_started",
  pending: "pending",
  validated: "validated",
});

const MEMBER_SIGNUP_PATHS = Object.freeze({
  paid: "paid",
  free: "free",
});

const MEMBER_TIER_SOURCE = Object.freeze({
  canonicalField: "tier",
  selectedTierField: "selected_tier",
  effectiveTierField: "effective_tier",
  noSeparateMemberTierField: true,
});

const MEMBER_TIER_VALUES = Object.freeze([
  "founder",
  "patron",
  "premier",
  "club",
  "free",
]);

const MEMBER_TIER_ALIASES = Object.freeze({
  subscriber: "free",
});

const MEMBER_IDENTITY_INDEXES = Object.freeze({
  cognitoSub: "cognito_sub-index",
});

module.exports = Object.freeze({
  PRESTTIGE_MEMBER_COGNITO_POOL,
  MEMBER_IDENTITY_FIELDS,
  MEMBER_IDENTITY_RESERVED_FIELDS,
  MEMBER_ACCOUNT_STATUSES,
  MEMBER_VALIDATION_STATUSES,
  MEMBER_SIGNUP_PATHS,
  MEMBER_TIER_SOURCE,
  MEMBER_TIER_VALUES,
  MEMBER_TIER_ALIASES,
  MEMBER_IDENTITY_INDEXES,
});
