# Presttige Identity Data Model

Status: Identity Step 2, created 2026-06-06

This document defines the non-breaking identity fields that future account-creation and member-area steps will write on `presttige-db` records.

No migration is required. DynamoDB records that do not yet have these attributes are valid. Existing funnel, gate, checkout, and payment logic must not read these fields until the later identity steps explicitly wire them.

## Member Cognito pool

- Pool name: `presttige-members`
- Pool id: `us-east-1_hpwdNFGss`
- Region: `us-east-1`
- Lookup index on `presttige-db`: `cognito_sub-index`

## Identity fields

| Field | DynamoDB type | Required now | Meaning |
| --- | --- | --- | --- |
| `cognito_sub` | String | No | Cognito user `sub` from the `presttige-members` pool, written after the member account is created. |
| `cognito_pool` | String | No | Audit clarity field, expected value `presttige-members`. |
| `account_status` | String | No | Member account lifecycle status, value set below. |
| `password_set_at` | String, ISO 8601 UTC timestamp | No | Time the member completed password setup. Omit when unset. |
| `welcome_email_sent_at` | String, ISO 8601 UTC timestamp | No | Time the member welcome email was sent. Omit when unset. |
| `activation_email_sent_at` | String, ISO 8601 UTC timestamp | No | Time the activation email was sent when password setup was not completed on the success page. Omit when unset. |
| `validation_status` | String | No | Silent post-entry documentary validation status, distinct from `review_status`. |
| `signup_path` | String | No | Account creation path, `paid` or `free`. |

Nullable timestamp fields are represented by absence, not by writing empty strings.

## Account status values

| Value | Meaning |
| --- | --- |
| `choice_completed` | The member completed the paid or free choice, account creation has not yet completed. |
| `account_created` | The Cognito user exists and is linked through `cognito_sub`. |
| `password_pending` | The account exists, but the member has not completed password setup. |
| `active_pending_validation` | The member set a password and can enter the member area, but silent documentary validation is not complete, so actions remain disabled. |
| `active` | Silent documentary validation is complete and member functions can be enabled. |
| `suspended` | Member access is disabled. |

## Validation status values

| Value | Meaning |
| --- | --- |
| `not_started` | Silent post-entry validation has not started. |
| `pending` | Silent validation is in progress. |
| `validated` | Silent validation is complete. |

Do not overload `review_status`. Committee or Founder approval happens before payment. `validation_status` is only for the silent post-entry documentary validation described in the identity briefing.

## Tier source of truth

Do not add a separate `member_tier` field.

Canonical member tier remains `tier`. Future identity code maps `tier` to the Cognito group. `selected_tier` remains the choice and checkout field, and `effective_tier` remains a legacy or temporary effective-state field where existing flows already use it.

Identity tier values:

- `founder`
- `patron`
- `premier`
- `club`
- `free`

Existing `subscriber` values are treated as the Subscriber/free path alias until a later ordered normalization step decides otherwise.

## Reserved referral fields

These field names are reserved for the later referral and credit system. They are not wired in Identity Step 2.

| Field | DynamoDB type | Meaning |
| --- | --- | --- |
| `invite_code` | String | Future referral or invite code. |
| `invited_by_lead_id` | String | Future inviter link by `lead_id`. |
| `wallet_balance_credits` | Number | Future Presttige credits balance. |

## Non-breaking rule

Identity Step 2 defines the fields and adds `cognito_sub-index`. It does not create Cognito users, does not write identity fields onto existing records, does not wire any funnel, and does not contact anyone.
