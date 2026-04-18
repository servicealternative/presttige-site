# ULTTRA Platform Model

## 1. Company vs Platform

- `ULTRATTEK` is the company and legal entity only
- `ULTTRA` is the operational platform
- `Presttige` is one client/project inside ULTTRA

This distinction is mandatory for architecture, naming, reporting, and future scaling.

`ULTRATTEK` should not be treated as the software platform.
`ULTTRA` is the system that operates campaigns, referrals, partner attribution, earnings, payouts, and reporting across multiple clients and projects.

`Presttige` is not the platform itself. It is one project running inside the platform.

## 2. Platform Scope

ULTTRA must support:
- internal projects
- external clients
- agency-style campaign operations
- affiliate and partner management
- campaign reporting
- payouts and earnings tracking

This means the platform must not be modeled around a single brand or a single revenue flow.

It must be able to operate:
- owned projects run internally
- client projects run as a service
- campaign-based acquisition across multiple brands
- partner ecosystems with attribution and commission tracking
- reporting and payout operations across different business relationships

## 3. Core Entities

The platform model must include the following core entities.

### Client
- The top-level business account inside the platform
- Can be an internal brand or an external customer

### Project
- A specific operational product, brand, or business initiative under a client
- Presttige is one project in this model

### Campaign
- A traffic, acquisition, or growth operation tied to a project
- Can be organic, paid, affiliate, influencer-driven, or agency-managed

### Partner
- A person or organization driving traffic, leads, or conversions
- Can be an affiliate, influencer, closer, media buyer, or strategic partner

### Lead
- A captured prospect associated with a client, project, campaign, and potentially a partner

### Conversion
- A lead outcome tied to a meaningful business event such as payment, approval, activation, or booking

### Earning
- A commission or revenue-share record generated from a validated conversion or payment event

### Payout
- A settlement record representing payment made or scheduled to a partner

### Reporting User
- A user with access to reporting data
- Can be internal admin, operator, or external partner depending on permission level

## 4. Dynamic Commission Principle

Commissions must be dynamic and configurable by:
1. campaign
2. partner
3. product default

This means commission logic cannot be hardcoded permanently at only one level.

The resolution model should follow this priority:
1. campaign-specific commission rule
2. partner-specific commission rule
3. product default commission rule

This gives ULTTRA the flexibility to:
- run custom commercial agreements
- vary commissions per campaign
- support premium partners
- apply default rules when no override exists

## 5. Partner Access Model

Partners are read-only and can only view their own:
- campaigns
- leads
- conversions
- earnings
- reporting

Partners must not have write access to operational entities outside their own scope.

The partner view should be limited to the records they are authorized to see, and should expose performance transparently without giving administrative control over platform configuration.

## 6. Internal Admin Model

ULTTRA internal admins can manage:
- clients
- projects
- campaigns
- partners
- commission rules
- payouts
- reporting

Internal admin users represent the operational team running the platform.

They require full management access across:
- structure
- attribution
- commission configuration
- payout operations
- cross-client reporting

## 7. Multi-Client Principle

All relevant records must support:
- `client_id`
- `client_name`
- `project_id`
- `project_name`
- `campaign_id`

This principle applies to records such as:
- leads
- conversions
- earnings
- payouts
- reports
- partner-linked activity

Presttige must be modeled only as one client/project inside the platform.

That means Presttige-specific logic should not become the implicit global model for ULTTRA. Any system design must remain reusable across multiple clients and projects.

## 8. Future Growth

The same platform must work for:
- group projects
- external clients
- agency campaigns
- future dashboard and app

The architecture should therefore be built to support:
- multiple brands under one operating layer
- external customer onboarding
- shared internal reporting
- partner dashboards
- campaign operations at scale
- a future application layer on top of the same backend model

ULTTRA should evolve as a reusable operating system for growth, attribution, commissions, and reporting, not as a single-project custom build.
