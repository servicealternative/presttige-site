# presttige-founder-admin

Interim protected Founder admin for `/admin`. This is intentionally lean and
self-contained; it is not the CRM foundation.

## Cognito integration point

Deploy this Lambda behind API Gateway HTTP API routes that use a Cognito JWT
authorizer. The Lambda rejects requests without Cognito authorizer claims.

Antonio must create and own:

- Cognito user pool.
- Cognito app client.
- His own admin user/account/credentials.
- API Gateway JWT authorizer using that user pool issuer and app client
  audience.
- Protected `/admin` frontend/session flow that sends the Cognito access token
  as `Authorization: Bearer <token>`.

Codex must not create Cognito accounts, users, passwords, or credentials.

## Required environment

- `TABLE_NAME=presttige-db`
- `AUDIT_TABLE_NAME=presttige-review-audit`
- `FOUNDER_TOKEN_SECRET_ID=presttige-founder-token-secret`
- `APP_ORIGIN=https://presttige.net`

## IAM

Use `iam-policy.json` for the Lambda execution role. It allows only:

- read/update/transaction writes on `presttige-db`
- append/query/transaction writes on `presttige-review-audit`
- read of `presttige-founder-token-secret`
- this Lambda's own CloudWatch Logs

## Actions

- `create_invite`
- `revoke_token`
- `regenerate_token`
