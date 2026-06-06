PRESTTIGE_MEMBER_COGNITO_POOL = {
    "name": "presttige-members",
    "id": "us-east-1_hpwdNFGss",
    "region": "us-east-1",
}

MEMBER_IDENTITY_FIELDS = {
    "cognito_sub": "cognito_sub",
    "cognito_pool": "cognito_pool",
    "account_status": "account_status",
    "password_set_at": "password_set_at",
    "welcome_email_sent_at": "welcome_email_sent_at",
    "activation_email_sent_at": "activation_email_sent_at",
    "validation_status": "validation_status",
    "signup_path": "signup_path",
}

MEMBER_IDENTITY_RESERVED_FIELDS = {
    "invite_code": "invite_code",
    "invited_by_lead_id": "invited_by_lead_id",
    "wallet_balance_credits": "wallet_balance_credits",
}

MEMBER_ACCOUNT_STATUSES = {
    "choice_completed": "choice_completed",
    "account_created": "account_created",
    "password_pending": "password_pending",
    "active_pending_validation": "active_pending_validation",
    "active": "active",
    "suspended": "suspended",
}

MEMBER_VALIDATION_STATUSES = {
    "not_started": "not_started",
    "pending": "pending",
    "validated": "validated",
}

MEMBER_SIGNUP_PATHS = {
    "paid": "paid",
    "free": "free",
}

MEMBER_TIER_SOURCE = {
    "canonical_field": "tier",
    "selected_tier_field": "selected_tier",
    "effective_tier_field": "effective_tier",
    "no_separate_member_tier_field": True,
}

MEMBER_TIER_VALUES = (
    "founder",
    "patron",
    "premier",
    "club",
    "free",
)

MEMBER_TIER_ALIASES = {
    "subscriber": "free",
}

MEMBER_IDENTITY_INDEXES = {
    "cognito_sub": "cognito_sub-index",
}
