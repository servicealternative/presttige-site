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

### 2026-06-02 Founder page and invite state

Founder page split is DONE and live:

- Step 1 is the Founder presentation page. It shows no price.
- Step 1 CTA is `Become a Founder`.
- Step 2 contains the Founder price, required consent, and payment entry.
- Payment logic is unchanged. Existing Founder checkout, consent, Stripe price,
  and activation rules still apply.

Presttige Invitation from the Ulttra dashboard is live:

- Chairman can send Presttige Invitation through `committee@presttige.net`.
- Founder invite end-to-end path is working.
- The synthetic test exception for `fq@freequenza.net` remains restricted to
  Antonio-controlled testing.

Open blocker:

- `presttige-checkout-context` still rejects Chairman-invited Founder checkout
  with `founder_gate_not_confirmed`.
- Cause: the checkout context requires `inviter_lead_id` in `presttige-db`.
- Chairman is an Ulttra/Directus identity, not a Presttige lead, so the
  Chairman invite path has `inviter_lead_id = NULL`.
- This is the fourth eligibility layer to align before a Chairman-invited
  Founder can pay.

Decided identity architecture, not built:

- Cognito becomes the single central identity for site, App, and CRM.
- One person has one login across the Presttige site, Presttige App, and
  Ulttra CRM.
- Login is created after payment.
- Ulttra CRM requires MFA for everyone, always.
- Presttige Club, Premier, and Patron members use email plus password plus
  SMS or email verification, without authenticator by default.
- Founders may add TOTP authenticator. The authenticator label is
  `Presttige . Founder`.

Decided Founder invite paths, not fully built:

- Path A: Chairman invites an already-registered person. The person goes
  directly to Founder Step 1, Step 2, and payment. No data is recollected.
- Path B: a new invitee receives a refined fill form plus double opt-in. There
  is no committee review. Login is created only after payment.

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

`ulttra-internal` is live in Amazon Cognito.

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
- Auth: Cognito SSO through `ulttra-internal`

### Ulttra CRM dashboard v1

The basic Ulttra CRM dashboard is DONE and live for Directus Administrator and
Team roles.

- Directus module: `ulttra-dashboard`
- Directus endpoint: `GET /ulttra-dashboard`
- Founder invite action endpoint:
  `POST /ulttra-dashboard/founder-invite`
- ECS task definition: `ulttra-crm-directus:58`
- ECR repository: `ulttra-crm-directus`
- Image tag: `dashboard-finance-block3-20260602T161208Z`
- Metrics table: `ulttra-crm-dashboard-metrics`
- Metrics sync Lambda: `presttige-dashboard-metrics-sync`
- Metrics sync CodeSha256: `3SyVutz+wcq3QyIejynLVYpayBA8t7GZOxcPpZDJBVA=`
- Cache table: `ulttra-crm-dashboard-cache`
- Cache TTL: 300 seconds
- Task role policy: `ulttra-crm-dashboard-read-api`
- Directus `module_bar`: `ulttra-dashboard` is first.
- Antonio Directus `last_page`: `/ulttra-dashboard`

Dashboard v1 data sources:

- `presttige-db`, through DynamoDB Streams into
  `ulttra-crm-dashboard-metrics`, for members, tiers, lead days, and active
  real Stripe linkage.
- Stripe live API, read-only, with the live secret from SSM.
- GA4 Data API property `530348665`, through the installed-app OAuth
  refresh-token path stored in SSM.
- SSM `/presttige/founder-invite/global-cap`, read-only.
- AWS Cost Explorer, read-only `ce:GetCostAndUsage`, for the automatic AWS
  monthly cost line in the Chairman financial block.

Analytics block 1:

- GA4 total website users, last 30 days, metric `totalUsers`.
- GA4 website geography, countries and cities ranked by `activeUsers`, last 30
  days, dimensions `country` and `city`.
- GA4 current calendar month vs last calendar month, metric `activeUsers`, UTC
  calendar boundaries.
- GA4 traffic sources ranked by `activeUsers`, dimension
  `sessionDefaultChannelGroup`, last 30 days.
- GA4 new vs returning users, dimension `newVsReturning`, last 30 days.
- Member geography from `presttige-db` active real member `country` and `city`,
  stored as aggregate counters in `ulttra-crm-dashboard-metrics`.
- Live verified on 2026-06-02:
  - total website users, last 30 days: 23
  - active users, last 7 days: 6
  - website countries: United Arab Emirates 12, Brazil 2, Portugal 2,
    Germany 1, India 1
  - website cities: Dubai 11, Sharjah 5, Abu Dhabi 4,
    Aparecida de Goiania 1, Colombo 1
  - current month vs last month: 2 vs 22, delta -20, -90.9%
  - traffic sources: Direct 12, Unassigned 8, Organic Social 2,
    Organic Search 1, Organic Shopping 1
  - new vs returning: returning 14, 51.9%, new 13, 48.1%
  - member geography: United Arab Emirates 1, Dubai 1

Analytics block 2:

- Founders and Patrons list, one combined panel inside the dashboard.
- Source: `presttige-db`, through `ulttra-crm-dashboard-metrics` group
  `member_list_founder_patron`.
- Include predicate: real member only, tier in `founder`, `patron`,
  `access_status = active`, and `payment_status` in `subscription_active`,
  `paid`.
- Tier source fields: `tier`, falling back to `selected_tier`, then
  `subscriber_type`.
- Display fields: Country from `country` or `member_country`, City from `city`
  or `member_city`, Name from `name` or `full_name`, plus tier indicator.
- Synthetic exclusion: `synthetic_test=true` is skipped before any metric or
  list contribution is written.
- Sort order: Founder before Patron, then name ascending.
- Live verified on 2026-06-02:
  - served assets: `index.ulttra-dashboard-20260602T113718Z.entry.js`,
    `v-form-ulttra-dashboard-20260602T113718Z.js`,
    `ulttra-dashboard-source-20260602T113718Z.js`
  - current result: `0` rows, expected because there are no active paying real
    Founders or Patrons today
  - empty state: `No Founders or Patrons yet`
  - WebKit render verified on the live `/admin/ulttra-dashboard` route

Financial block 3:

- Chairman-only section inside the same dashboard.
- Automatic AWS cost line:
  - Source: AWS Cost Explorer `GetCostAndUsage`, metric `UnblendedCost`.
  - Period: selected month. For the current month, the period is month-to-date.
  - Current month-to-date value checked before deploy: `$10.7637000546` USD
    for `2026-06-01` to `2026-06-03`, estimated.
  - Permission added to `ulttra-crm-directus-task-role` inline policy
    `ulttra-crm-dashboard-read-api`: `ce:GetCostAndUsage` on `*`.
- Manual costs and goals:
  - `ulttra_dashboard_cost_categories`, fields `id`, `project_key`, `name`,
    `active`, `sort_order`, `created_at`, `updated_at`.
  - `ulttra_dashboard_cost_monthly_values`, fields `id`, `category_id`,
    `project_key`, `month_key`, `amount_cents`, `currency`, `updated_at`.
  - `ulttra_dashboard_revenue_goals`, fields `id`, `project_key`,
    `period_type`, `period_key`, `amount_cents`, `currency`, `updated_at`.
- Antonio can create, rename, and remove manual cost categories, set monthly
  category values, and edit month and year revenue goals in place.
- Profit formula: existing current-month dashboard revenue, paid-date basis,
  minus automatic AWS cost and manual monthly costs.
- Scope: manual finance rows are keyed by the current dashboard project tab,
  currently `global` or `presttige`; Pets Lab remains not configured.
- Live served assets:
  - `index.ulttra-dashboard-20260602T161208Z.entry.js`
  - `v-form-ulttra-dashboard-20260602T161208Z.js`
  - `ulttra-dashboard-source-20260602T161208Z.js`
- WebKit note: Safari was at the login page during verification and
  AppleScript DOM access was disabled. Served live assets and ECS deployment
  were verified, but an authenticated Chairman Safari render still needs
  Antonio's active login session.

Real-data-only enforcement:

- Subscriber records with `synthetic_test=true` are excluded from every
  dashboard count and Stripe linkage.
- Ulttra people with `people.synthetic_test=true` are excluded from internal
  user safety checks.
- Test data does not appear in dashboard metrics.

Scale model:

- The dashboard endpoint does not scan `presttige-db` on load.
- The current aggregate metrics were seeded once from the live table.
- Future `presttige-db` changes are reflected through DynamoDB Streams using
  `NEW_AND_OLD_IMAGES`, including active real member country and city.
- The runtime endpoint reads the aggregate metrics table, the dashboard cache,
  Stripe, GA4, SSM config, and the inviter mirror.

Founder Invitation action:

- The form accepts only invitee name and invitee email.
- The inviter is always the logged-in Directus user.
- There is no manual inviter email field.
- The endpoint invokes the existing `presttige-founder-admin` create path and
  reuses the existing `isEligibleFounderInviter` enforcement.
- Ineligible users receive a neutral response and no invite is created.

Dashboard Standards v1 for Admin, Team, and Consultant are DONE and live.

- Standard storage and enforcement:
  server-side config in
  `infra/ulttra-directus-dashboard/extensions/directus-extension-ulttra-dashboard-endpoint/dist/index.js`.
- Admin Standard:
  all v1 panels, global revenue, Founder Invitation present and active through
  the existing safe invite path, dashboard read plus the gated Founder invite
  action only.
- Team Standard:
  all v1 non-revenue global panels, revenue panel present but scoped to the
  user's own attributed revenue, Founder Invitation present and submitted
  through the existing safe invite path, dashboard read plus the gated Founder
  invite action only.
- Consultant Standard:
  same dashboard panel set as Team, revenue scoped to own attribution, app
  access to the dashboard, and no Admin/data model privileges.
- Revenue scoping:
  `admin` uses `global`; non-admin users use `own_attributed`.
- Current Team attributed revenue is `$0.00`, because no Team attribution rows
  exist yet.
- Current Consultant attributed revenue is `$0.00`, because no Consultant
  attribution rows exist yet.
- Ambassador, Business Partner, and Influencer Standards were not built in
  this step. They remain documented stubs.

Ulttra CRM access separation is DONE:

- `admin@ultrattek.com` is the Admin/developer identity in Cognito and
  Directus.
- `apereira@presttige.net` is the Consultant/dashboard identity for now.
- The internal Antonio Admin people record now uses `admin@ultrattek.com`.
- The eligible-inviters mirror now contains `admin@ultrattek.com` and no longer
  contains `apereira@presttige.net`.
- The Directus container `ADMIN_EMAIL` is `admin@ultrattek.com`.

Verified live dashboard numbers on 2026-05-31 after the Standards v1 deploy:

- Active real members: 1
- Club: 1
- Premier: 0
- Patron: 0
- Founder: 0
- Founders: 0 / 250
- New leads and applications, last 30 days: 5
- Admin revenue this month: $144.44
- Admin active Stripe subscriptions: 1
- Team own attributed revenue this month: $0.00
- Team own attributed active Stripe subscriptions: 0
- Website visitors, last 7 days: 6

No payment, activation, checkout, webhook, or subscriber mutation logic was
changed.

Detailed design and state are recorded in
`docs/Ulttra_CRM_Dashboard_v1.md`.

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

Bootstrap Fallback admin is retired:

- Directus user: `bootstrap-admin@ulttra.net`
- Status: `suspended`
- Static token: clear, no static token present before or after retirement
- Retirement date: 2026-05-30
- Audit backup:
  `audits/directus-bootstrap-retirement-20260530T164330Z/`
- Remaining admin access paths: Antonio's Cognito SSO admin and the dedicated
  Codex Service admin token in encrypted SSM.

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
    `hh47EN8YVHUjmnSln04iYJBKmYPmq9g+8yBC0LtuRyg=`.
  - Founder invite email sender:
    `founders@presttige.net`.
  - Scheduler SES send permission allows the Presttige domain identity plus
    `founders@presttige.net`.
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
    `0wu384dLDfO+xjkqVbqk6GREs1J3vNHBZ6DQPA0uwGY=`.
  - `presttige-stripe-webhook` kept `stripe-layer:1`.
  - Founder activation sends a dedicated Founder welcome email from
    `founders@presttige.net` after the hardened Founder activation
    transaction succeeds.
  - Idempotency flag: `founder_welcome_email_sent_at`.
  - Synthetic test safety is enforced: synthetic Founder welcome sends are
    allowed only for Antonio-controlled test addresses.
  - Later task, not actioned here: the remaining Founder email work is the
    inviter thank-you plus invitee invitation emails in `founder-admin`,
    which still send from `committee@presttige.net`; decide their sender
    during the email design pass, then replace all plain SES emails with the
    approved Presttige branded templates and design.
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
- C1 branch B step B4, controlled test run and cleanup, is DONE:
  - Test A, internal Ambassador branch, PASSED.
  - `people.synthetic_test`, boolean, default `false`, nullable, was added to
    Ulttra so CRM test people can be explicitly excluded from real counts and
    analytics.
  - Manuel Fonseca was created in Ulttra as a synthetic Ambassador test person
    with `antoniompereira@icloud.com`, added to Presttige as pending with
    `invite_permission=true`, then activated by Antonio authorization with
    `validated_by=Antonio`.
  - The `presttige-eligible-inviters-sync` run mirrored
    `antoniompereira@icloud.com` as `role=ambassador`,
    `project=presttige`, and `ulttra_person_id=3`.
  - `isEligibleFounderInviter("antoniompereira@icloud.com")` returned
    `eligible=true`, `source=ulttra`.
  - Galina's Club record remained rejected as an inviter.
  - Founder welcome Email 1 was delivered to `fq@freequenza.net` with the
    approved copy during the test run. The live Founder welcome sender was
    later changed to `founders@presttige.net`.
  - Test B step B3 PASSED: exactly one active synthetic Founder invite existed
    for `fdm_founder_test_fq`; re-running the test invite path returned
    `reason=active_invite_already_exists` and did not issue a second invite.
    Monthly-pure, one-at-a-time behavior is confirmed.
  - Test B step B4 did not pass by design: the shared eligibility function
    correctly blocks `synthetic_test=true` Founders from being treated as
    genuine Founder inviters, per test-data rules. The live
    Founder-inviter to checkout path therefore cannot be fully exercised with
    synthetic Founder data; it remains verified by code inspection and the
    production path requires a genuine paid active Founder with a bound active
    invite.
  - Cleanup is DONE: the synthetic Founder lead `fdm_founder_test_fq`, Manuel
    Fonseca `people.id=3`, Manuel's `people_projects.id=3`, the
    `presttige-eligible-inviters` mirror row for
    `antoniompereira@icloud.com`, and any one-off test schedules were removed.
  - Post-cleanup verification: mirror count `0`, test schedules `0`, target
    test records in `presttige-db` `0`, Ulttra people back to Antonio plus
    Ana only, real paid active Founders `0`, and real members `1`, Galina's
    Club record.
  - SES suppression was not touched.
  - Audit backups:
    `audits/c1-branch-b-b4-add-people-synthetic-test-20260530T135742Z/`,
    `audits/c1-branch-b-b4-authorized-manuel-activation-20260530T141241Z/`,
    `audits/c1-branch-b-b4-test-b-founder-tree-20260530T141900Z/`,
    `audits/c1-branch-b-b4-test-b-finish-20260530T143540Z/`, and
    `audits/c1-branch-b-b4-controlled-test-reset-20260530T143859Z/`.
- C1 branch B is COMPLETE in code:
  - B1 dynamic config and entitlement field contract, DONE.
  - B2 activation stamp and monthly invite scheduler, DONE.
  - B3 shared eligibility wiring and activation resolution, DONE.
  - B4 controlled test run and cleanup, DONE, with the synthetic Founder
    checkout limitation recorded above.
  - B5 Founder welcome email on activation, DONE.
  - B6 repeatable self-cleaning Founder test harness, DONE.
  - Remaining real work: the permissions area, then the post-permissions
    Ambassador test.
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
- Legacy Stripe test-key residue cleanup is DONE:
  - Pre-check confirmed `presttige-gateway` had 0 invocations in the prior
    30 days and no current site caller.
  - API Gateway route `ANY /gateway` was removed from `presttige-api`.
  - The public Function URL for `presttige-gateway` was removed.
  - `presttige-gateway` was archived in place, tagged archived, and reserved
    concurrency was set to `0`.
  - `STRIPE_SECRET_KEY` was removed from `presttige-gateway`.
  - Unused `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` environment
    variables were removed from `presttige-stripe-webhook`.
  - `presttige-stripe-webhook` logic was not redeployed or changed;
    CodeSha256 stayed `0wu384dLDfO+xjkqVbqk6GREs1J3vNHBZ6DQPA0uwGY=`,
    `stripe-layer:1` stayed preserved, and the webhook still reads signing
    secret metadata through SSM `/presttige/stripe/webhook-secret`.
  - `presttige-create-checkout-session`, `presttige-checkout-status`,
    SSM `/presttige/stripe/*`, and real member
    `fdm_c3e0dca496` were untouched.
  - Legacy Secrets Manager secret `presttige-stripe-secret` still exists and
    was not deleted. Recommendation: delete it only in a separate approved
    final-secret-removal task after one more no-live-dependency check.
  - Verification note: an invalid-token smoke against
    `presttige-checkout-status` exposed a pre-existing `dynamodb:Scan` IAM
    denial on the invalid-token path. It was not caused by this cleanup and no
    checkout IAM was changed in this run.
  - Audit backup:
    `audits/stripe-test-key-cleanup-20260530T163128Z/`.

Email test-address finding:

- `freequenza.net` is a verified SES sending identity. DKIM is successful, so
  it can send through SES.
- Earlier finding: `fq@freequenza.net` had bounced with
  `550 5.1.1 mailbox unavailable` and had been on the SES suppression list
  for `BOUNCE` since 2026-04-21.
- B4 update: Antonio confirmed Founder welcome Email 1 delivered to
  `fq@freequenza.net` during the controlled test, and the test state was later
  reset.
- Future tests must re-check receiving plus SES suppression status before
  using `fq@freequenza.net` again.

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
- GA account administrator: `alternativeservice@gmail.com`, personal Google
  account
- Service-account route: superseded for this personal-Gmail GA account. The
  service-account key was valid and could mint OAuth tokens, but GA4 access
  management rejected the service-account user path for this setup.
- Active CRM read credential: installed-app OAuth client `Ulttra GA`
  (`430778007708-uerfhfgt42k4qfbgcobb9f0cpqi6om9e.apps.googleusercontent.com`)
  with scope `https://www.googleapis.com/auth/analytics.readonly`
- OAuth client secret: stored encrypted in SSM at
  `/ulttra/ga/oauth-client-secret`
- OAuth refresh token: stored encrypted in SSM at
  `/ulttra/ga/oauth-refresh-token`
- GA4 Data API: reachable and returning data through the OAuth refresh-token
  path
- Verification on 2026-05-31: `runReport` for property `530348665`, last 7
  days, metric `activeUsers`, returned `6`
- The OAuth app is now in production.
- No client secret, refresh token, private key, or JSON secret value is stored
  in this document

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
- Future separate task, if a working `freequenza.net` mailbox is wanted:
  finish SES inbound receiving configuration plus a real mailbox, then remove
  `fq@freequenza.net` from SES suppression only after receive delivery is
  proven.
- Build CRM Phase 2: Analytics command centre, connecting Stripe and Google
  Analytics first.
- Non-home pages still load `brand-fonts.css`; confirm and remove/align as required.
- Confirm DynamoDB encryption at rest for `presttige-db`.
- Retire `presttige-founder-validate`.
