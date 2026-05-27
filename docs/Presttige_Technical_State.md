# PRESTTIGE - TECHNICAL STATE

Status: as-built technical record. No secrets or token values.

## Founder backend

### DEPLOYED

`presttige-founder-gate` is deployed in AWS Lambda.

- API Gateway HTTP API: `rwkz3d86u0`
- Routes:
  - `POST /founder-gate`
  - `OPTIONS /founder-gate`
- DynamoDB access: read-only `Scan` on `presttige-db`
- Throttle:
  - rate: `5 rps`
  - burst: `10`
- Public failure response remains neutral: `{"valid":false}`
- Public success response returns only Founder gate success, not profile/payment data.
- Kill switch is live and verified: `founder_token_status` must be `active`.
- Revoked or missing `founder_token_status` fails the gate.
- Verified behavior:
  - active throwaway invite passed
  - revoked throwaway invite failed
  - mismatched inviter failed
  - malformed/unknown email failed
  - throwaway records deleted after test

`presttige-founder-admin` is deployed in AWS Lambda.

- API Gateway HTTP API: `rwkz3d86u0`
- JWT authorizer: `presttige-admin-cognito`
- Protected routes:
  - `POST /admin/founder-invite`
  - `POST /admin/founder-token`
- CORS preflight routes:
  - `OPTIONS /admin/founder-invite`
  - `OPTIONS /admin/founder-token`
- Admins group enforcement: inside the Lambda, using the Cognito token claims.
- Purpose:
  - create Founder invite
  - revoke Founder token
  - regenerate Founder token
- This is the first Founder component with write access to `presttige-db`.
- It writes audit rows to `presttige-review-audit` before mutating Founder invite state.

Permanent secret:

- Secrets Manager secret: `presttige-founder-token-secret`
- Used by `presttige-founder-admin` for Founder token HMAC generation.
- No secret values are stored in the repo or in this document.

### REDUNDANT

`presttige-founder-validate` is the older token-only validator.

- Current status: redundant.
- Retirement target: remove live Lambda/route after all callers use `/founder-gate`.
- Do not extend this function.

## Cognito

`presttige-internal` is live in Amazon Cognito.

- Region: `us-east-1`
- User pool ID: `us-east-1_s5PvTEeHv`
- MFA: required
- MFA method: TOTP authenticator app
- Group: `Admins`
- Antonio user: `apereira@presttige.net`
- Antonio user status: active

`presttige-admin-cognito` is live as a JWT authorizer on HTTP API `rwkz3d86u0`.

- Issuer: `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_s5PvTEeHv`
- Audience: Cognito app client for the admin SPA
- Attached only to admin routes.
- Public routes remain public.

## Route 53

Route 53 hosted zone for `ulttra.net` is created.

- Hosted zone ID: `Z09939161TKOTM6MZBKCG`
- Type: public hosted zone
- GoDaddy nameservers: flipped to the AWS Route 53 nameservers.
- Propagation status: in progress.
- Default records only at creation: `NS` and `SOA`.

AWS name servers:

- `ns-140.awsdns-17.com`
- `ns-1118.awsdns-11.org`
- `ns-691.awsdns-22.net`
- `ns-1904.awsdns-46.co.uk`

## Data model

Founder data model additions on `presttige-db` are non-destructive DynamoDB attributes.

Locked Founder fields:

- `subscriber_type`
- `founder_token`
- `founder_token_status`
- `founder_token_version`
- `founder_token_nonce`
- `founder_token_generated_at`
- `founder_token_revoked_at`
- `inviter_email`
- `inviter_lead_id`
- `founder_eligible`
- `founder_gate_status`
- `tier_intent`
- `consent_basis`
- `consent_timestamp`
- `checkbox_consent_at`
- `created_by_admin`
- `created_at`

Canonical tier remains in `tier` / `selected_tier`.

`founder_eligible` is already consumed by checkout. Write it only during a real
Founder invite creation, when the record is intentionally Founder-eligible.

## Audit

`presttige-review-audit` is reused for Founder admin actions.

- Append-only.
- Existing audit rows must not be updated or deleted.
- Founder admin action names:
  - `founder_invite_create`
  - `founder_token_revoke`
  - `founder_token_regenerate`
- No secrets or token values in audit rows.

## CRM architecture decision

CRM is a separate application on the same shared `presttige-db`.

The interim `/admin` Founder tool retires into the CRM later.

The interim `/admin` implementation must not become a CRM foundation.

## Open items

- Check Route 53 DNS propagation for `ulttra.net`.
- Deploy Directus on AWS after DNS propagation is confirmed.
- Non-home pages still load `brand-fonts.css`; confirm and remove/align as required.
- Confirm DynamoDB encryption at rest for `presttige-db`.
- Retire `presttige-founder-validate`.
