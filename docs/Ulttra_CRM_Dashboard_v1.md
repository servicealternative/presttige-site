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
- ECS task definition: `ulttra-crm-directus:15`
- ECR repository: `ulttra-crm-directus`
- Dashboard image tag: `dashboard-consultant-access-20260531T154939Z`
- Metrics table: `ulttra-crm-dashboard-metrics`
- Metrics sync Lambda: `presttige-dashboard-metrics-sync`
- Metrics sync CodeSha256: `5I6QlKayhLowpnX0VdZbc2e5ioKhvuVpvUHXeQ+cOs8=`
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
`presttige-db` DynamoDB Stream using `NEW_AND_OLD_IMAGES`.

The dashboard endpoint reads only the aggregate metrics table, Stripe, GA4,
SSM config, the inviter mirror, and the dashboard cache.
