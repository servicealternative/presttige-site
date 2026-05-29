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

## Founder funnel

Founder stays entirely in Presttige.

Ulttra holds only the admin commands and real-time analytics for Antonio.

`/founder` is live on the Presttige site.

- Live URL: `https://presttige.net/founder/`
- Amplify app: `dh6banfgh3wmi`
- Production branch: `main`
- Production commit: `87b9a8bf1951aa1fef6a7ec463e51663a9caf8b0`
- Page state: public-facing Founder gate, technically approved only for now
- Initial source: neutral gate only
- Initial raw HTML: no Founder content
- Backend call: existing `/founder-gate` route on API Gateway `rwkz3d86u0`
- Failure behavior: neutral message with `founders@presttige.net`
- Visual state: cream design, dark ink text, gold accents
- `brand-fonts.css`: not loaded
- Payment: not yet wired
- Activation: not yet wired
- Design and Founder copy/content: pending review and revision later

Approved Founder funnel v4 is saved in
`docs/Presttige_Founder_Funnel_v4.md`.

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
- Propagation status: propagated.
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

CRM is a separate application on `crm.ulttra.net`.

Directus is live as the CRM application.

- Runtime: ECS Fargate
- Network: dedicated VPC with public and private subnets
- Public ingress: Application Load Balancer over HTTPS
- Private runtime: Directus ECS tasks in private subnets
- Private database: RDS PostgreSQL, encrypted at rest
- File storage: S3 bucket `ulttra-crm-files`
- Outbound access: NAT Gateway for private subnet egress
- Auth: Cognito SSO through `presttige-internal`

Cognito SSO is working for Antonio:

- Cognito user: `apereira@presttige.net`
- Directus provider: `cognito`
- Directus role: Administrator

Bootstrap admins are retained as fallback until clean logout/login with MFA is
confirmed and Antonio approves retirement.

CRM Phase 1 is built in Directus.

Collections:

- `people`
- `companies`
- `projects`
- `documents`
- `campaigns`
- `ledgers`
- `people_projects`
- `companies_projects`

Seed records:

- Antonio Pereira: Admin, active
- Ana: Team, active, `afernandez@presttige.net`
- Presttige: `members_network`, live
- petslab.net: `ecommerce`, `in_design`

Compliance state:

- Identity documents are view-and-validate only.
- Passport, Emirates ID, and trade license images are not stored permanently as
  CRM records.
- `documents.file_ref` is an S3 object reference only.
- IBAN and identity-validation fields are Admin-only in Directus permissions.

Ulttra repository state:

- Local repository: `/Users/antonio/Desktop/ulttra`
- Purpose: master operating unit repository, independent from `presttige-site`
- Current contents: README and Ulttra brand logos
- Remote: none configured yet

Directus branding state:

- Project name: `ULTTRA crm`
- Public background: silver
- Project logo: Ulttra transparent-background logo
- Login foreground: Ulttra transparent-background logo
- Favicon: Ulttra transparent-background logo
- No Presttige logo is used in the CRM branding.

`presttige-db` read-only inspection for CRM analytics:

- Total items inspected: 56
- Records with `synthetic_test = true`: 15, excluded from all statistics
- Real records used for analytics: 41
- Current real paid-member reality: 1 paid member
- Inspection was read-only. No `presttige-db` records were created, modified,
  or deleted.

Google Analytics progress:

- GA4 property: `530348665`
- GA4 property confirmed as: `presttige.net`
- GA account: `Presttige`
- GA account ID: `389155166`
- Google Cloud project: `ulttra-crm`
- Service account:
  `ulttra-ga-reader@ulttra-crm.iam.gserviceaccount.com`
- JSON key validation: valid service account key
- OAuth token minting: successful
- GA4 Data API: reachable
- Current GA4 Data API status for property `530348665`: `PERMISSION_DENIED`
- Meaning: the service account needs Viewer access in GA4 Property Access
  Management, likely propagation or access grant still pending
- No private key or JSON secret value is stored in this document

The interim `/admin` Founder tool retires into the CRM later.

The interim `/admin` implementation must not become a CRM foundation.

## Open items

- Retire bootstrap admins after MFA is confirmed through clean logout/login.
- Build CRM Phase 2: Analytics command centre, connecting Stripe and Google
  Analytics first.
- Non-home pages still load `brand-fonts.css`; confirm and remove/align as required.
- Confirm DynamoDB encryption at rest for `presttige-db`.
- Retire `presttige-founder-validate`.
