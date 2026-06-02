# ULTTRA CRM DASHBOARD v1

Status: built and live on `crm.ulttra.net`.

No secrets or token values are stored here.

## Purpose

The dashboard is the Ulttra CRM home surface for Presttige internal users.

For v1 it is available to Directus users with role `Administrator` or `Team`.
No Ambassador, Business Partner, or Influencer dashboard gating is implemented
yet. That belongs to the later permissions area.

## Live Components

- Directus module: `ulttra-dashboard`
- Directus endpoint: `GET /ulttra-dashboard`
- Founder invite endpoint: `POST /ulttra-dashboard/founder-invite`
- ECS service: `ulttra-crm-directus`
- ECS task definition: `ulttra-crm-directus:58`
- ECR repository: `ulttra-crm-directus`
- Dashboard image tag: `dashboard-finance-block3-20260602T161208Z`
- Metrics table: `ulttra-crm-dashboard-metrics`
- Metrics sync Lambda: `presttige-dashboard-metrics-sync`
- Metrics sync CodeSha256: `3SyVutz+wcq3QyIejynLVYpayBA8t7GZOxcPpZDJBVA=`
- Cache table: `ulttra-crm-dashboard-cache`
- Cache TTL: 300 seconds
- Runtime IAM policy: `ulttra-crm-dashboard-read-api` on
  `ulttra-crm-directus-task-role`

## Data Sources

The read API returns server-side dashboard numbers.

- DynamoDB `presttige-db`, through DynamoDB Streams into
  `ulttra-crm-dashboard-metrics`, for members, tiers, lead days, and active
  real Stripe linkage.
- Stripe live API, using the live secret from SSM
  `/presttige/stripe/secret-key`, read-only.
- GA4 Data API property `530348665`, using the installed-app OAuth refresh
  token in SSM.
- SSM `/presttige/founder-invite/global-cap`, read-only, for the Founder cap.
- AWS Cost Explorer, read-only `ce:GetCostAndUsage`, for the automatic AWS
  monthly cost line.

All subscriber metrics exclude `synthetic_test=true`.

All Ulttra people checks exclude `people.synthetic_test=true`.

## Panels

v1 returns and displays:

- Total active real members.
- Active members by tier: Club, Premier, Patron, Founder.
- Founders against the global cap.
- New leads and applications in the last 30 days.
- Revenue this month from Stripe paid invoices linked to real active members,
  scoped by the logged-in user's Standard.
- Active Stripe subscriptions linked to real active members, scoped by the
  logged-in user's Standard.
- Website visitors from GA4, active users in the last 7 days.
- Analytics block 1:
  - Total website users from GA4 `totalUsers`, last 30 days.
  - Website geography from GA4 `activeUsers` ranked by `country` and `city`,
    last 30 days.
  - Current calendar month vs last calendar month from GA4 `activeUsers`, UTC
    calendar boundaries.
  - Traffic sources from GA4 `activeUsers` ranked by
    `sessionDefaultChannelGroup`, last 30 days.
  - New vs returning users from GA4 `activeUsers` by `newVsReturning`, last 30
    days.
  - Member geography from `presttige-db` active real member `country` and
    `city`, through `ulttra-crm-dashboard-metrics`.
- Analytics block 2:
  - Combined Founders and Patrons list from `presttige-db`, through
    `ulttra-crm-dashboard-metrics` group `member_list_founder_patron`.
  - Includes only active paying real members where tier is `founder` or
    `patron`.
  - List fields are Country, City, Name, and a small tier indicator.
  - Rows open detail in place inside the dashboard.
- Financial block 3, Chairman view:
  - Manual finance is stored in Directus collections
    `ulttra_dashboard_cost_categories`,
    `ulttra_dashboard_cost_monthly_values`, and
    `ulttra_dashboard_revenue_goals`.
  - Automatic AWS cost line comes from AWS Cost Explorer
    `GetCostAndUsage`, metric `UnblendedCost`.
  - Manual cost categories are Antonio-managed in place: create, rename,
    remove, and set monthly values.
  - Revenue goals are Antonio-managed in place for the selected month and
    year.
  - Month profit is computed as existing dashboard current-month revenue,
    paid-date basis, minus AWS automatic cost and manual category costs.
- Founder Invitation action.

## Permissions Standards v1

The first dashboard Standard layer is stored in the server-side dashboard
endpoint config:

`infra/ulttra-directus-dashboard/extensions/directus-extension-ulttra-dashboard-endpoint/dist/index.js`

Admin Standard:

- Type: `admin`
- Visibility: all v1 panels and all global metrics.
- Revenue scope: `global`
- Founder Invitation: present and active through the existing safe path.
- Dashboard permissions: read plus the gated Founder invite action. No other
  dashboard write action exists.

Team Standard:

- Type: `team`
- Visibility: active members, by tier, Founders against cap, leads, website
  visitors, revenue panel, and Founder Invitation.
- Revenue scope: `own_attributed`
- Current own attributed revenue: `$0.00`, because no Team attribution rows
  exist yet.
- Founder Invitation: present and submitted through the existing safe path.
  Eligibility is checked by the existing Founder inviter enforcement at submit
  time.
- Dashboard permissions: read plus the gated Founder invite action. No other
  dashboard write action exists.

Consultant Standard:

- Type: `consultant`
- Visibility: same dashboard panel set as Team.
- Revenue scope: `own_attributed`
- Current own attributed revenue: `$0.00`, until attribution exists.
- Founder Invitation: present and submitted through the existing safe path.
  If the consultant user is not an eligible inviter, no invite is created.
- Dashboard permissions: app access to the dashboard plus the gated Founder
  invite action only.

Ambassador, Business Partner, and Influencer Standards were not built in this
step. They remain `stub_only` in the endpoint config.

Access separation:

- `admin@ultrattek.com` is the Admin/developer identity.
- `apereira@presttige.net` is the Consultant/dashboard identity for now.

## Founder Invitation Action

The dashboard form asks only for invitee name and invitee email.

The inviter is always the logged-in Directus user.

The dashboard does not accept manual inviter email entry.

On submit, the dashboard endpoint invokes the existing
`presttige-founder-admin` create path. It reuses the existing
`isEligibleFounderInviter` enforcement and the existing founder-admin audit
and email flow.

If the logged-in user is not an eligible inviter, the response is neutral and
no invite is created.

## Home Screen Wiring

Directus `module_bar` now places `ulttra-dashboard` first.

Antonio's Directus `last_page` is set to `/ulttra-dashboard`, so his next CRM
login lands on the dashboard.

No Team user was created by Codex. The Team role is supported by the endpoint
and module, and any Antonio-created Team user can use the dashboard after
login.

## Verified Live Numbers

Verified on 2026-05-31 after the Standards v1 deploy:

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
- Synthetic Presttige records present but excluded: 19
- Synthetic Ulttra people present but excluded: 0

Verified analytics block 1 on 2026-06-02 after the dashboard analytics deploy:

- Served assets:
  - `index.ulttra-dashboard-20260602T105622Z.entry.js`
  - `v-form-ulttra-dashboard-20260602T105622Z.js`
  - `ulttra-dashboard-source-20260602T105622Z.js`
- Total website users, last 30 days: 23.
- Active users, last 7 days: 6.
- Website countries, last 30 days: United Arab Emirates 12, Brazil 2,
  Portugal 2, Germany 1, India 1.
- Website cities, last 30 days: Dubai 11, Sharjah 5, Abu Dhabi 4,
  Aparecida de Goiania 1, Colombo 1.
- Current month vs last month, GA4 `activeUsers`: 2 for 2026-06-01 to
  2026-06-02, 22 for 2026-05-01 to 2026-05-31, delta -20, -90.9%.
- Traffic sources, `sessionDefaultChannelGroup`: Direct 12, Unassigned 8,
  Organic Social 2, Organic Search 1, Organic Shopping 1.
- New vs returning, `newVsReturning`: returning 14, 51.9%, new 13, 48.1%.
- Member geography: United Arab Emirates 1, Dubai 1.
- WebKit render verified on the live `/admin/ulttra-dashboard` route.

Verified analytics block 2 on 2026-06-02 after the Founders and Patrons list
deploy:

- Served assets:
  - `index.ulttra-dashboard-20260602T113718Z.entry.js`
  - `v-form-ulttra-dashboard-20260602T113718Z.js`
  - `ulttra-dashboard-source-20260602T113718Z.js`
- List source fields:
  - Tier: `tier`, falling back to `selected_tier`, then `subscriber_type`.
  - Paying active status: `access_status = active` and `payment_status` in
    `subscription_active`, `paid`.
  - Name: `name`, falling back to `full_name`.
  - Country: `country`, falling back to `member_country`.
  - City: `city`, falling back to `member_city`.
  - Synthetic exclusion: `synthetic_test=true` records are skipped before any
    contribution is written.
- Sort order: tier first, Founder before Patron, then name ascending.
- Live result: `0` rows, because there are currently no active paying real
  Founders or Patrons.
- Empty state: `No Founders or Patrons yet`.
- WebKit render verified on the live `/admin/ulttra-dashboard` route.

Verified financial block 3 on 2026-06-02 after the costs, goals, and profit
deploy:

- Served assets:
  - `index.ulttra-dashboard-20260602T161208Z.entry.js`
  - `v-form-ulttra-dashboard-20260602T161208Z.js`
  - `ulttra-dashboard-source-20260602T161208Z.js`
- Directus collections:
  - `ulttra_dashboard_cost_categories`: `id`, `project_key`, `name`,
    `active`, `sort_order`, `created_at`, `updated_at`.
  - `ulttra_dashboard_cost_monthly_values`: `id`, `category_id`,
    `project_key`, `month_key`, `amount_cents`, `currency`, `updated_at`.
  - `ulttra_dashboard_revenue_goals`: `id`, `project_key`, `period_type`,
    `period_key`, `amount_cents`, `currency`, `updated_at`.
- AWS automatic cost:
  - Permission added to `ulttra-crm-directus-task-role` inline policy
    `ulttra-crm-dashboard-read-api`: `ce:GetCostAndUsage` on `*`.
  - Current month-to-date Cost Explorer value checked before deploy:
    `$10.7637000546` USD for `2026-06-01` to `2026-06-03`, estimated.
- Scope:
  - Manual finance values are keyed by the current dashboard project tab,
    `global` or `presttige`.
  - Pets Lab remains a registered project with no configured data.
- Live served assets contain `Costs, goals, profit`, `manual_finance`,
  `AWS automatic plus manual categories`, `Founder Invitation`, and
  `Presttige Invitation`.
- WebKit note: Safari was available but not authenticated as Chairman during
  verification, and AppleScript DOM access was disabled. The served live bundle
  and ECS deployment were verified, but an authenticated Chairman Safari render
  still needs Antonio's active login session.

## Safety Notes

- No payment, activation, checkout, webhook, or subscriber mutation logic was
  changed.
- The neutral Founder Invitation safety check was verified with the Codex
  Service user, which has no real internal person record, and no invite record
  was created.
- The dashboard cache can be refreshed manually with
  `GET /ulttra-dashboard?refresh=true`.

## Scale Model

`presttige-db` is not scanned on dashboard load.

The one-time seed scanned the current table to create aggregate counters. From
there, `presttige-dashboard-metrics-sync` keeps the counters current from the
`presttige-db` DynamoDB Stream using `NEW_AND_OLD_IMAGES`, including active
real member country and city counters, plus the active paying Founder and
Patron list.

The dashboard endpoint reads only the aggregate metrics table, Stripe, GA4,
SSM config, the inviter mirror, and the dashboard cache.

Dashboard responses are cached in `ulttra-crm-dashboard-cache` for 300 seconds.
The analytics block uses the same cache, so GA4 and Stripe values can be up to
five minutes stale unless the dashboard is refreshed with `refresh=true`.
