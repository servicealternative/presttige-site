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
- C1 inviter eligibility access: read-only `GetItem` on
  `presttige-eligible-inviters`
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
- Founder invite creation now requires eligible inviter authority through the
  C1 mirror.
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
  - Controlled Founder test run through the B6 test harness.
  - Real Founder welcome and invite copy plus design review.
  - Founder checkout pay button remains disabled until Stripe live is
    approved for that run.

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
- C1 step A1 mirror infrastructure is DONE:
  - Directus read-only identity: role `Presttige Sync (read-only)`, user
    `Presttige Sync`, email `presttige-sync@ulttra.net`
  - Static sync token storage: encrypted SSM parameter
    `/presttige/ulttra-sync/directus-token`
  - The sync token is separate from the Codex admin token, reads only
    `people`, `people_projects`, and `projects`, and was verified read-only
    with write denied as HTTP 403.
  - DynamoDB mirror table: `presttige-eligible-inviters`, account
    `343218208384`, region `us-east-1`, partition key `email`, on-demand
    billing
  - Sync Lambda: `presttige-eligible-inviters-sync`, Python 3.12
  - EventBridge rule: `presttige-eligible-inviters-sync-5min`, enabled,
    `rate(5 minutes)`
  - The Lambda reads active Presttige `people_projects` rows with
    `invite_permission=true`, keeps only internal types, normalizes email to
    lower-case and role to technical form, and reconciles the mirror by
    upserting eligible rows and deleting ineligible rows.
  - Least-privilege IAM is scoped to that one SSM parameter and the
    `presttige-eligible-inviters` table.
- The mirror is currently empty because no `people_projects` row has
  `invite_permission=true`; this is expected and safe.
- C1 step A2 gate eligibility fix is DONE and live:
  - The inviter eligibility gap from the Galina case is closed.
  - Shared inviter eligibility rule:
    `isEligibleFounderInviter(inviterEmail)`.
  - Implemented in `backend/lib/founder-inviter-eligibility.js` for Node
    Lambdas and `backend/lib/founder_inviter_eligibility.py` for the Python
    admin Lambda.
  - Used by live `presttige-founder-gate`, `presttige-checkout-context`,
    `presttige-create-checkout-session`, and `presttige-founder-admin`.
  - Internal inviter path: only an email present in
    `presttige-eligible-inviters` passes.
  - Club, Premier, Patron, and plain subscriber records are blocked as
    inviters, even when active or paid in `presttige-db`.
  - Founder inviter branch was fail-closed at A2 until branch B was built.
  - Live deployed CodeSha256:
    - `presttige-founder-gate`:
      `syIn2D16odCK/vWSZTDRiwbGgLKEHECdvDDMPwAug1s=`
    - `presttige-checkout-context`:
      `prwGNmUO3KSCJpqRxk9JX7eN6UFFvXZhpve7nopk3OU=`
    - `presttige-create-checkout-session`:
      `C0R/H/9YBuU1BrwLwd2cMKx/NLfNwpH1RE6hgXV6gxM=`
    - `presttige-founder-admin`:
      `4ItVwvngtua2DaILjSdbEn2JDEWL/EpWCOSSPAhzXuY=`
  - Verification: Galina's Club record was absent from the mirror and live
    `/founder-gate` returned neutral `{"valid":false}`.
  - Verification: Founder checkout rejected the ineligible inviter.
  - Verification: admin invite-create rejected an ineligible inviter and left
    no test record behind.
  - Verification: `presttige-eligible-inviters` remained empty, count `0`.
  - No public copy, payment logic, activation logic, webhook logic, or
    subscriber data changed.
  - Audit backup: `audits/c1-a2-gate-eligibility-20260530T101522Z/`.
- C1 branch B step B1, Founder-invite dynamic config and entitlement field
  contract, is DONE:
  - Dynamic config lives in SSM Parameter Store, account `343218208384`,
    region `us-east-1`, plain `String` parameters, not secrets.
  - `/presttige/founder-invite/initial-delay-hours = 24`
  - `/presttige/founder-invite/cycle = monthly`
  - `/presttige/founder-invite/validity-days = 30`
  - `/presttige/founder-invite/global-cap = 250`
  - These timings and caps must be read from config by later branch B code,
    never hardcoded, so Antonio can change them at runtime.
  - No scheduler was created or changed by B1.
  - No gate, checkout, activation, webhook, subscriber data, or
    `presttige-db` record was changed by B1.
- Founder-invite entitlement field contract for a Founder's `presttige-db`
  record:
  - `founder_activated_at`, timestamp, set at activation by B2 wiring
  - `founder_invite_status`, enum string, `none`, `active`, or `expired`
  - `founder_invite_token`, current monthly invite id, one at a time
  - `founder_invite_issued_at`, timestamp
  - `founder_invite_expires_at`, timestamp, `issued_at` plus
    `validity-days`
  - `founder_invite_invitee_lead_id`, lead invited with the current token,
    null until used
  - `founder_invites_issued_count`, integer, Founder's own dashboard
  - `founder_invites_converted_count`, integer, Founder's own dashboard
  - `presttige-db` is DynamoDB with primary key `lead_id`, so no schema
    migration or backfill is needed. These fields appear only when later
    branch B steps write them.
- C1 branch B step B2, Founder monthly invite scheduler and activation stamp,
  is DONE and live:
  - Live activation webhook: `presttige-stripe-webhook`.
  - Live webhook CodeSha256:
    `upC18iLtrCQMbWR8ZwWoliDw6mfAlwvAr8JAv+wxOJU=`.
  - Webhook change was surgical: Founder activation stamps
    `founder_activated_at` from `confirmed_payment_at` using
    `if_not_exists`, so an existing value is never overwritten.
  - Payment logic, activation guards, and idempotency logic were not changed.
  - Audit backup:
    `audits/c1-branch-b-b2-founder-invite-scheduler-20260530T110559Z/`.
  - New scheduler Lambda: `presttige-founder-invite-scheduler`, Python 3.12.
  - Scheduler CodeSha256:
    `UnbmHIZEbC9CALM2PUzrSGX6AqM49sMWHIlHnpJcJLE=`.
  - EventBridge rule: `presttige-founder-invite-scheduler-daily`, enabled,
    `rate(1 day)`.
  - The scheduler reads `/presttige/founder-invite/*` SSM config at runtime.
  - Invitation cycle is monthly pure: one active invite at a time, first due
    at activation plus `initial-delay-hours`, later issues on the monthly
    anchor, with the anchor day clamped to the target month length.
  - Scheduler is global-cap aware and excludes `synthetic_test` records.
  - Scheduler IAM is least privilege for the Founder-invite config
    parameters, required `presttige-db` scan/update access, SES send from the
    Presttige identity, and its own CloudWatch logs.
  - Dry-run verification returned `real_founder_count=0`,
    `eligible_count=0`, `issued_count=0`, and `email_count=0`.
  - No email was sent and no test data was left behind.
  - Gate and checkout were not changed by B2. The Founder branch in
    `isEligibleFounderInviter()` remained fail-closed until B3.
- C1 branch B step B3, Founder branch eligibility wiring and resolution, is
  DONE and live:
  - Shared Founder inviter eligibility is implemented in
    `backend/lib/founder-inviter-eligibility.js` and
    `backend/lib/founder_inviter_eligibility.py`.
  - Internal inviter branch remains unchanged and is checked first through
    the `presttige-eligible-inviters` mirror.
  - Club, Premier, Patron, and plain subscriber records remain blocked as
    inviters.
  - Founder inviter branch now allows only a genuine paid active Founder with
    `founder_invite_status=active`, a present `founder_invite_token`, a
    non-expired `founder_invite_expires_at`, and a presented invitee that
    matches `founder_invite_invitee_lead_id`.
  - Admin invite-create now binds `founder_invite_invitee_lead_id` to the
    Founder inviter's active invite transactionally.
  - Activation resolution is live: when the invitee becomes a paid Founder,
    the inviter invite is marked `consumed`,
    `founder_invites_converted_count` is incremented, and no extra invite is
    granted. The next invite remains on the normal monthly cycle.
  - Live deployed CodeSha256:
    - `presttige-founder-gate`:
      `SNFWkqz5LF7XlMscSvO5xUZ3A7JfdtyV0w7lZdYWSD8=`
    - `presttige-checkout-context`:
      `lfnjraoX72Iv811dphDlIMjjvLcfE55kfC61UBIy2tY=`
    - `presttige-create-checkout-session`:
      `XvCLCloAm35qU051MV7Af5mWOC90n4Ok9U4GS0xvKJY=`
    - `presttige-founder-admin`:
      `L7Zfkh0P4gQttlqVf+MXo59DDc01kPoggpbA+JwcJ/s=`
    - `presttige-stripe-webhook`:
      `8oYWC0FmSp4d6dpYLViersMDYRDh5mgjAjQRTj5/WPI=`
  - `presttige-stripe-webhook` kept `stripe-layer:1`.
  - Verification: Galina's Club record returned `eligible=false`.
  - Verification: live `/founder-gate` returned neutral `{"valid":false}`.
  - Verification: Founder with no active invite is rejected.
  - Verification: internal mirror branch still works.
  - Verification: real paid active Founders count `0`, active Founder invites
    count `0`, and mirror count `0`.
  - No emails were sent and no test data was left behind.
  - Audit backup:
    `audits/c1-branch-b-b3-founder-eligibility-20260530T112415Z/`.
- C1 branch B step B5, Founder welcome email on activation, is DONE and live:
  - Live activation webhook: `presttige-stripe-webhook`.
  - Webhook CodeSha256:
    `yEttzS+lpDt04KiAvT3jKEwxeJfEFeUUss25Gv8zm9E=`.
  - `presttige-stripe-webhook` kept `stripe-layer:1`.
  - Founder activation sends a dedicated Founder welcome email from
    `committee@presttige.net` after the hardened Founder activation
    transaction succeeds.
  - Idempotency flag: `founder_welcome_email_sent_at`.
  - Synthetic test safety is enforced: synthetic Founder welcome sends are
    allowed only for Antonio-controlled test addresses.
  - No payment logic, activation guards, idempotency logic, or other email
    path was changed by B5.
  - Audit backup:
    `audits/c1-branch-b-b5-founder-welcome-20260530T131715Z/`.
- C1 branch B step B6, repeatable self-cleaning Founder test harness, is DONE
  and live:
  - Test-only Lambda: `presttige-founder-test-harness`, Python 3.12.
  - Harness CodeSha256:
    `qwgEPRx2pYN2X7KkXIocE4Q5W/0C5Anhj42w69I2yWI=`.
  - Test commands:
    - `welcome`, simulates synthetic Founder activation and fires the B5
      welcome path for Antonio-controlled addresses only
    - `schedule_invite`, creates a one-off test schedule for the Founder
      invite email
    - `reset`, clears synthetic Founder test state, test schedules, mirror
      rows, and matching Ulttra test people plus `people_projects` rows
  - Internal scheduled action: `send_invite`.
  - Test delay config: SSM
    `/presttige/founder-invite/test-delay-minutes = 5`.
  - Reset requires `confirm=RESET_FOUNDER_TEST`.
  - Harness refuses non-Antonio addresses and non-`synthetic_test` Founder
    records.
  - SES suppression is not touched by the harness.
  - Production webhook and production scheduler were unchanged by B6.
  - Production scheduler still excludes `synthetic_test` records.
  - Dry checks verified no send and no write for `dry_check`, rejection of a
    non-Antonio address, rejection of reset without confirmation, and reset
    dry-run counts of zero matching test state.
  - Audit backup:
    `audits/c1-branch-b-b6-founder-test-harness-20260530T133204Z/`.
- C1 branch B is COMPLETE in code:
  - B1 dynamic config and entitlement field contract, DONE.
  - B2 activation stamp and monthly invite scheduler, DONE.
  - B3 shared eligibility wiring and activation resolution, DONE.
  - B5 Founder welcome email on activation, DONE.
  - B6 repeatable self-cleaning Founder test harness, DONE.
  - Remaining real work: run the controlled test through the harness, then
    the permissions area, then the controlled Ambassador test.
  - Open review items: real Founder welcome and invite copy plus design
    review, and the Founder checkout pay button, disabled until Stripe live.

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

Email test-address finding:

- `freequenza.net` is a verified SES sending identity. DKIM is successful, so
  it can send through SES.
- `freequenza.net` does not currently receive mail. Its MX points to
  `inbound-smtp.eu-west-1.amazonaws.com`, SES inbound, but no working
  receiving rule or mailbox exists.
- Delivery to `fq@freequenza.net` fails with `550 5.1.1 mailbox unavailable`.
- `fq@freequenza.net` is on the SES suppression list for `BOUNCE` since
  2026-04-21.
- Do not use `fq@freequenza.net` as a test recipient or notification
  recipient.
- B4 controlled testing will instead use Antonio-controlled iCloud addresses:
  `antoniompereira@icloud.com` and an `antoniompereira+...@icloud.com` alias,
  which receive reliably.

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

Founder inviter-eligibility enforcement is now live:

- Live `/founder-gate`, Founder checkout, and admin invite-create enforce the
  frozen inviter rule through `isEligibleFounderInviter()`.
- The Galina case is closed in live code: a Club member cannot pass as a
  Founder inviter.
- Internal inviters must be present in the local
  `presttige-eligible-inviters` mirror.
- Club, Premier, Patron, and plain subscribers are blocked.
- Founder inviters are eligible only through the completed branch B conditions:
  genuine paid active Founder, active non-expired invite, token present, and
  matching bound invitee.

## Open items

- Galina personal note from Antonio, to disregard the earlier erroneous email,
  remains an open human task.
- Retire bootstrap admins after MFA is confirmed through clean logout/login.
- Future separate task, if a working `freequenza.net` mailbox is wanted:
  finish SES inbound receiving configuration plus a real mailbox, then remove
  `fq@freequenza.net` from SES suppression only after receive delivery is
  proven.
- Build CRM Phase 2: Analytics command centre, connecting Stripe and Google
  Analytics first.
- Non-home pages still load `brand-fonts.css`; confirm and remove/align as required.
- Confirm DynamoDB encryption at rest for `presttige-db`.
- Retire `presttige-founder-validate`.
