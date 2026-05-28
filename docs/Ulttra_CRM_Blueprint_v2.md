# ULTTRA CRM BLUEPRINT (v2)

Status: Approved. Master CRM architecture for Ulttra and its projects.

## 1. Operating Hierarchy

Ulttra is the master operating layer.

The hierarchy is:

`CRM` -> `projects` -> `programmes`

- The CRM runs on `crm.ulttra.net`.
- Projects live inside the CRM.
- Programmes are operating modules or control sets inside projects.
- Presttige is one project inside the CRM.
- Founder is one programme/control set inside Presttige.
- `petslab.net` is one project inside the CRM.

## 2. Platform Decision

The CRM platform is Directus, self-hosted on AWS.

Directus is the base operating system for Antonio's internal CRM because it
provides a mature data studio, permissions model, API layer, and admin
experience without forcing a full custom CRM build from zero.

Target domain:

- `crm.ulttra.net`

Target infrastructure:

- ECS Fargate
- Dedicated VPC
- Public subnets for the Application Load Balancer and NAT Gateway
- Private subnets for ECS tasks and RDS
- RDS PostgreSQL for Directus data
- S3 for files
- HTTPS through ACM and ALB
- Cognito SSO for internal access

## 3. Projects

Initial projects:

- Presttige
  - Type: `members_network`
  - Status: `live`
  - Founder controls live inside this project as a programme/control set.
- petslab.net
  - Type: `ecommerce`
  - Status: `in_design`

Future projects can be added without changing the core CRM model.

## 4. Shared Core

The CRM shared core is used across all projects.

Core areas:

- Analytics
- Campaigns
- Finance
- People
- Companies
- Documents
- Permissions

These are shared operating modules. Project-specific workflows use the shared
core instead of creating isolated systems.

## 5. People

People represent individual operators, internal users, ambassadors, business
partners, and influencers.

Initial people types:

- Admin
- Team
- Ambassador
- Business Partner
- Influencer

People can be linked to companies and projects.

Identity documents are view-and-validate only. The CRM stores validation result
and key fields, not permanent document images.

Sensitive financial fields, including IBAN alternatives, are Admin-only.

## 6. Companies

Companies represent agencies and partnerships.

Initial company types:

- Agency
- Partnership

Companies can be linked to people and projects.

Trade license and legal representative identity documents are view-and-validate
only. The CRM stores validation result and key fields, not permanent document
images.

Sensitive financial fields, including IBAN alternatives, are Admin-only.

## 7. Documents

Documents store operational document references and signing status.

Document records may reference an S3 object through `file_ref`, but identity
document images are not permanent CRM records.

Visibility model:

- Users see only their own documents.
- Global documents are Admin-only.
- Audit documents are Admin-only.

DocuSign is the target signing integration, but external integration is wired in
a later phase.

## 8. Campaigns

Campaigns provide the structure for agent or company campaign tracking.

Campaign records include:

- Source
- Unique token
- Agent person
- Agent company
- Project
- Views
- Conversions
- Payments
- Status

Live tracking is wired in a later phase.

## 9. Finance

Finance starts with ledger structure.

Ledger records support:

- Agent person
- Agent company
- Converted amount
- Earned amount
- Received amount
- Balance
- Currency
- Cross-reference to subscriber data later

Stripe wiring is a later phase.

## 10. Member Cards

Member Cards are the heart of the subscriber/member layer.

Member Cards are the CRM view that should bring together:

- Subscriber/member identity
- Project relationship
- Membership tier
- Status
- Payment state
- Founder state where relevant
- Campaign attribution
- Documents
- Finance/ledger links
- Operational notes

Presttige subscriber data remains in `presttige-db` until explicitly integrated.
Directus CRM records should cross-reference subscriber data without copying more
personal data than required.

## 11. Permissions

Standard role model:

- Admin: full access.
- Team: broad operational access, excluding sensitive financial and identity
  validation fields.
- Ambassador: own data only.
- Influencer: own data only.
- Agency: own data/company scope only.
- Partnership: own data/company scope only.

Antonio is the only person who changes permissions.

IBAN and identity-validation fields are Admin-only.

## 12. External Integrations

External integrations are not part of Phase 1 structure.

Planned integrations:

- Google Analytics
- Stripe
- DocuSign
- Wallet / member card layer
- Presttige subscriber/member data through controlled cross-reference

Integrations are wired only in their approved phase.

## 13. Architecture Rules

### Synthetic Test Records

Records where `synthetic_test = true` are excluded from all statistics and
dashboards, no exceptions, ever.

This exclusion is an absolute rule for CRM analytics, command panels, funnel
counts, exports, and future dashboard views.

### Data Velocity

The CRM has three approved data speeds.

Management analytics:

- Scope: Google Analytics and subscriber management analytics.
- Refresh model: periodic refresh.
- Frequency: hourly is acceptable.
- Data model: pull model.
- Google Analytics has no webhook model for this purpose.
- The CRM queries the GA4 API periodically.
- This is not real-time.
- This is sufficient for Antonio's management view.

Active campaigns:

- Scope: campaign tokens and Stripe payment events.
- Refresh model: real-time.
- Click, conversion, and payment events are recorded at the moment they happen.
- Events are attributed to the agent and campaign at capture time.
- Active campaign attribution does not depend on Google Analytics.
- Stripe sends payment events through webhooks.

Member Cards, concierge, and validation:

- Scope: partner card validation, member privilege checks, and concierge
  requests.
- Refresh model: absolute real-time.
- When a partner validates a card or a member requests concierge, the system
  reads the current source-of-truth state at that moment.
- Subscriber and membership state is read from `presttige-db`.
- Privilege and CRM state is read from the CRM.
- The read path is a fast API.
- Cards and validation never depend on periodically synced copies.

### Subscriber Data Source

`presttige-db` remains the subscriber source of truth.

For management analytics, subscriber data is synced into the CRM read-only and
periodically. This is Option B.

The CRM never writes to `presttige-db`.

For card validation and concierge, the CRM reads the current subscriber and
privilege state at request time. This does not use the periodic analytics copy.

### Antonio's Command Panel

The command panel must stay minimal, only what matters, and remain extensible
for more metrics later.

At this stage, the command panel is a funnel view because the business has not
launched and live paid-member counts are intentionally tiny.

Current funnel panel metrics:

- Total real leads, excluding `synthetic_test = true`
- Leads by `review_status`, pending and approved
- Leads by `payment_status`
- Real paying members and tier
- Leads by country

Paid-member counts are tiny by design at this stage. The current Stripe-backed
paid-member reality is one real paid member.

Initial command panel metrics:

- Visitors, today, week, and month
- Traffic sources and channels
- Subscribers, global and by tier
- Paid users and revenue
- Conversion, visitors to members
- Trend versus previous period
- Top 3 cities and countries, extensible
- Gender, M/F
- Average age, global and latest

Future note:

- Prepare a catalogue of everything GA4 can provide so Antonio can choose what
  to bring into the CRM.
- This is a later task, not part of Phase 1.

### Data Gaps To Close

Known gaps before fuller management analytics:

- Gender is not captured anywhere yet. Decide where to capture it, likely at
  registration.
- Age is present on only about 18 records. Decide whether to make it required
  later.
- Visitors, traffic sources, traffic demographics, and visitor conversion
  require Google Analytics.

### Email Management Direction

Now that Ulttra exists as the master CRM, email management must be revisited
with the CRM underneath it.

Founder emails, Founder invites, and future project emails should move into a
unified CRM-backed email management model. This closes the loop back to the
original email-management problem that started the project.

## 14. Build Order

Phase 1: Base CRM collections.

- People
- Companies
- Projects
- Documents
- Campaigns
- Ledgers
- Junctions and permissions

Phase 2: Analytics command centre.

- Connect Stripe and Google Analytics first.

Phase 3: Campaign tracking.

- Campaign token tracking.
- Views and conversion tracking.

Phase 4: Finance and Stripe ledgers.

- Stripe payout and ledger reconciliation.

Phase 5: Member Cards.

- Subscriber/member operating view.
- Presttige member state and Founder state surfaced through the CRM.

Phase 6: DocuSign.

- Document signing workflow.

Phase 7: petslab.net.

- Build project-specific ecommerce CRM workflows.

## 15. Compliance Principle

Identity documents are view-and-validate only.

The CRM does not permanently store passport, Emirates ID, trade license, or
similar identity document images as records.

If a temporary upload is used during validation, it must be:

- In encrypted S3
- Admin-only
- Removed from permanent CRM record-keeping after validation

The CRM stores:

- Validation result
- Key extracted fields needed for operations/compliance
- Validator
- Validation timestamp
- Legal basis

The CRM does not store secrets, passwords, token values, or unnecessary copies
of sensitive documents.
