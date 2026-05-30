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
- Production commit: `cc2f7b2c5305d117b945dcac176cd281e4c47cba`
- Founder payment and activation deploy:
  - Amplify job: `299`
  - GitHub Actions Lambda deploy run: `26644684963`
- Page state: public-facing Founder gate plus full Founder detail page,
  technically approved only for now
- Initial source: neutral gate first, Founder detail revealed only after a
  successful gate
- Initial raw HTML: no Founder detail content before gate success
- Backend call: existing `/founder-gate` route on API Gateway `rwkz3d86u0`
- Failure behavior: neutral message with `founders@presttige.net`
- Visual state: cream design, dark ink text, gold accents
- `brand-fonts.css`: not loaded
- Payment path: live and deployed.
- Gate flow: `/founder` gate to full Founder detail page to required consent
  checkbox to live Founder checkout.
- Required consent:
  - Consent checkbox is required before proceeding to payment.
  - Proceeding records `checkbox_consent_at` on the Founder invite record.
- Founder checkout:
  - Existing proven live checkout path is reused.
  - Stripe product: `prod_URrwkKbbICL760`
  - Live Stripe price: `price_1TSyCjDmiQXcrE5NyKR5cb60`
  - Amount: USD 9,999 one-time.
- `presttige-create-checkout-session` rejects Founder checkout unless
  `checkbox_consent_at` is present.
- Activation: live and deployed through `presttige-stripe-webhook` on
  `payment_intent.succeeded`.
- Founder activation hardening:
  - Requires `livemode = true`.
  - Requires `stripe_product_id == prod_URrwkKbbICL760`.
  - Requires `stripe_price_id == price_1TSyCjDmiQXcrE5NyKR5cb60` or the
    lead's exact stored `selected_price_id`.
  - Missing or mismatched Founder product or price records
    `founder_activation_rejected` and makes no lead state change.
  - Successful activation flips `subscriber_type` from `founder_invited` to
    `founder`.
  - Successful activation sets the canonical paid Founder fields.
  - Audit is transactional and written before the lead update, if audit fails
    the activation fails.
  - Activation is idempotent.
  - Founder activation is never marked `synthetic_test`.
- Design and Founder copy/content: pending review and revision later
- Remaining Founder roadmap work:
  - Submission flow and Antonio approval panel.
  - The two automatic emails, dependent on SES deliverability.

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

Codex CRM access is restored:

- Dedicated Directus user: `Codex Service`
- Service email: `codex-service@ulttra.net`
- Directus role: Administrator
- Static token storage: encrypted SSM parameter `/ulttra/directus/codex-token`
- Current token authenticates as the service user, not Antonio's personal
  account.
- Antonio can rotate or remove his personal Directus token at will.

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

Live people schema findings:

- `people.type` holds the internal role.
- Current `people.type` choices: `Admin`, `Team`, `Ambassador`,
  `Business Partner`, `Influencer`.
- Current live role values: `Admin`, `Team`.
- `people_projects` exists as the people to projects many-to-many junction.
- `people_projects` structural base is DONE:
  - `status`, select, values `pending`, `active`, `standby`, `cancelled`,
    `removed`, default `pending`, required
  - `invite_permission`, boolean, default `false`, required
  - `added_by`, M2O to `people`, nullable, on delete `SET NULL`
  - `validated_by`, M2O to `people`, nullable, on delete `SET NULL`
  - `validated_at`, timestamp, nullable
- Existing Presttige rows:
  - Antonio, Admin, status `active`, validated by Antonio,
    `invite_permission=false`, `added_by=null`
  - Ana, Team, status `active`, validated by Antonio,
    `invite_permission=false`, `added_by=null`
- The per-project status now supports the frozen rule: a delegate creates a
  membership as `pending`; only Antonio validates it to `active`, recorded
  through `validated_by` and `validated_at`.
- Fine-grained permission, visibility, and dashboard fields are intentionally
  left dynamic for later in the permissions area. Add or remove those fields
  only when the model requires them.
- C1 mirror writer from Ulttra to `presttige-eligible-inviters` remains to be
  built.
- Gate eligibility fix for the Galina gap remains to be built after the C1
  mirror writer.

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
- Records with `synthetic_test = true`: 19, excluded from all statistics
- Real records used for analytics: 37
- Current real paid-member reality: 1 paid member
- Inspection was read-only. No `presttige-db` records were created, modified,
  or deleted.

Production cleanup completed on 2026-05-29:

- DB test-data cleanup done.
- Four records were flagged `synthetic_test = true`:
  - `rec_645a754b`
  - `rec_ada58156`
  - `rec_327ac78e`
  - `rec_4c21f980`
- Cleanup was backup-first, audit-logged in `presttige-review-audit`, and
  reversible by clearing the synthetic-test flag and related flag metadata.
- Real live paying member `rec_9e856c0f` was untouched.
- Real incomplete lead `rec_aaadbc4f` was untouched.
- Real-records-only count is now 37.
- Stripe TEST-mode cleanup done.
- Three TEST subscriptions were cancelled:
  - `sub_1TSsnADmiQXcrE5NNDfbFvrk`
  - `sub_1TSt2tDmiQXcrE5NIzAAjtai`
  - `sub_1TStPxDmiQXcrE5NyjwhhA8F`
- Active TEST subscriptions now count 0.
- No LIVE Stripe object was touched.
- Production checkout is confirmed LIVE by default:
  - `presttige-create-checkout-session` reads live SSM Stripe keys.
  - `presttige-checkout-status` reads live SSM Stripe keys.
  - `checkout.html` calls `/create-checkout-session` as the live checkout path.
- Note: legacy Secrets Manager secret `presttige-stripe-secret` still
  classifies as TEST, but it is not used by the deployed checkout code. This
  remains tracked under scheduled cleanup item 3.

Frozen analytics rule:

- No test record where `synthetic_test = true` may ever appear in any
  statistic, dashboard, count, or analytic, anywhere, including the Ulttra CRM.
- Only real data reaches CRM and analytics.

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

Founder inviter-eligibility enforcement is a known live gap:

- Live `/founder-gate` does not yet enforce the frozen inviter rule.
- The Galina case confirmed that a Club member could be accepted as inviter.
- This must be fixed through the C1 bridge build by checking the local
  `presttige-eligible-inviters` mirror and explicitly blocking Club, Premier,
  Patron, and plain subscribers.

## Open items

- Retire bootstrap admins after MFA is confirmed through clean logout/login.
- Build CRM Phase 2: Analytics command centre, connecting Stripe and Google
  Analytics first.
- Non-home pages still load `brand-fonts.css`; confirm and remove/align as required.
- Confirm DynamoDB encryption at rest for `presttige-db`.
- Retire `presttige-founder-validate`.
