# presttige-members Cognito pool restore notes

Created: 2026-06-06
Region: us-east-1
Account: 343218208384

## Captured state

- User pool: `presttige-members`, `us-east-1_hpwdNFGss`
- Hosted UI domain: `presttige-members`
- App client: `presttige-member-web`, `3gdek6k48cm6oirccodgrub2k1`
- Groups: `founder`, `patron`, `premier`, `club`, `free`
- SES identity used for Cognito email: `presttige.net`
- SES configuration set: `presttige-deliverability-v1`
- SMS role: `presttige-members-cognito-sms-role`

## Restore approach

This backup records the production configuration that was created for the new Presttige member identity pool. If the pool is still present, prefer correcting it in place with the saved JSON files rather than recreating it.

1. Compare the live pool with `user-pool.json` and `mfa-config.json`.
2. If the hosted domain is missing, recreate it with `create-user-pool-domain` using `presttige-members`.
3. If the app client is missing, recreate it from `app-client-presttige-member-web.json`.
4. If groups are missing, recreate the five groups from `groups.json`.
5. If SES sending fails, compare `ses-presttige-net-identity.json`, `ses-cognito-email-policy.json`, and `ses-configuration-set.json`.
6. If SMS MFA fails, compare `iam-sms-role.json`, `iam-sms-role-policy.json`, and `sns-sms-attributes.json`.

## Non-exportable values

AWS does not export user passwords or TOTP secrets. No member users were created in this step, so no user credentials or TOTP secrets exist in this new pool yet.

## Isolation note

The existing Ulttra CRM pool, `ulttra-internal` / `us-east-1_s5PvTEeHv`, was not modified by this operation.
