# Presttige Target Project Structure

## 1. Objective

This target structure is designed to:
- preserve production stability
- introduce backend source control
- support campaigns and referral systems
- support Stripe and partner earnings
- allow future scaling

The current repository already contains a functioning production-facing frontend funnel. The purpose of this structure is not to disrupt that system, but to formalize it into a maintainable project layout that supports revenue growth, backend ownership, and safe iteration.

## 2. Top-Level Structure

The future project should use the following root structure:

```text
/docs
/frontend
/backend
/infra
/legacy
```

### `/docs`
- Purpose:
  - Central operational documentation
  - System maps
  - Production boundaries
  - Architecture decisions
  - Migration planning
- Why it matters:
  - Presttige currently needs documentation as a control layer before structural changes are made

### `/frontend`
- Purpose:
  - All public-facing frontend code and static site assets
  - Main production funnel
  - Campaign landing pages
  - Shared frontend logic and configuration
- Why it matters:
  - The current repository already behaves as a frontend deployment layer
  - This area will formalize and separate frontend concerns cleanly

### `/backend`
- Purpose:
  - Version-controlled backend source
  - Lambda handlers
  - Shared business logic
  - Stripe integration
  - Referral tracking
  - Email logic
- Why it matters:
  - The highest current risk is that production backend behavior exists outside the repository source boundary

### `/infra`
- Purpose:
  - Infrastructure-as-code
  - Environment-level AWS configuration
  - Deployment definitions
  - Resource mapping for API, Lambda, DynamoDB, SES, and Stripe-related integrations
- Why it matters:
  - Presttige needs explicit infrastructure ownership to scale safely and avoid configuration drift

### `/legacy`
- Purpose:
  - Hold validated old pages and deprecated frontend flows
  - Preserve traceability without leaving old files mixed into the active structure
- Why it matters:
  - The repository currently contains more than one generation of funnel logic
  - Legacy material should be isolated, not deleted immediately

## 3. Frontend Structure

The future frontend should be organized as:

```text
/frontend/public-site
/frontend/campaigns
/frontend/shared
```

### `/frontend/public-site`
- Purpose:
  - Contains the current main funnel and public-facing Presttige website
- Scope:
  - landing page
  - check-email
  - verify-email
  - access-form
  - thank-you
  - legal pages
  - any confirmed live founder/payment-facing pages if they remain public
- Why it matters:
  - This is the protected production surface and should remain stable during migration

### `/frontend/campaigns`
- Purpose:
  - Dedicated landing pages for partner, referral, influencer, and campaign acquisition
- Scope:
  - campaign-specific entry pages
  - partner-specific funnels
  - custom landing experiences tied to attribution
- Why it matters:
  - Campaign execution should be isolated from the main site so that acquisition experiments do not destabilize the core funnel

### `/frontend/shared`
- Purpose:
  - Shared frontend resources across public-site and campaigns
- Scope:
  - assets
  - config
  - analytics
  - tracking helpers
  - reusable scripts
  - shared styles if needed
- Why it matters:
  - The current repo duplicates config and logic across pages
  - Shared frontend concerns must be centralized to reduce drift and simplify rollout

## 4. Backend Structure

The future backend should be organized as:

```text
/backend/lambdas
/backend/shared
/backend/referrals
/backend/stripe
/backend/email
```

### `/backend/lambdas`
- Purpose:
  - Holds each Lambda function in an isolated folder
- Structure principle:
  - one function per directory
  - clear handler ownership
  - clean deployment boundary per backend function
- Expected contents:
  - `create-lead`
  - `verify-email`
  - `submit-access`
  - `review-action`
  - checkout-related Lambdas
  - member validation if still relevant
- Why it matters:
  - Presttige needs backend source control at the function level
  - Isolated Lambda structure reduces coupling and improves deployment safety

### `/backend/shared`
- Purpose:
  - Common backend logic used by multiple functions
- Expected contents:
  - config loading
  - response helpers
  - DynamoDB access helpers
  - logging
  - auth/token utilities
  - validation
  - common models
- Why it matters:
  - Shared business logic should not be duplicated across Lambdas
  - This creates consistency and makes the backend maintainable

### `/backend/referrals`
- Purpose:
  - Backend-driven referral and attribution logic
- Expected contents:
  - referral code validation
  - partner attribution logic
  - click/conversion recording
  - commission calculation support inputs
- Why it matters:
  - Referral tracking should be backend-owned, not dependent only on frontend query parameters
  - Attribution must survive redirects, email flows, and checkout events

### `/backend/stripe`
- Purpose:
  - Payment and Stripe event handling
- Expected contents:
  - checkout session creation logic
  - payment mapping
  - webhook processing
  - commission-triggering logic
- Why it matters:
  - Stripe should be treated as a core backend subsystem
  - Payment confirmation, revenue attribution, and commissions must be processed from trusted backend events

### `/backend/email`
- Purpose:
  - SES-related email logic and templates
- Expected contents:
  - verification email logic
  - internal review email logic
  - approval / rejection / standby email logic
  - template source files
- Why it matters:
  - Email is part of the production funnel, not a side concern
  - Operational emails must be versioned and traceable

## 5. Legacy Structure

The future legacy area should be:

```text
/legacy
```

### `/legacy`
- Purpose:
  - Store validated old pages after they are explicitly classified as non-production
- Rules:
  - old pages are moved here only after validation
  - they are not deleted immediately
  - they are kept for traceability and historical reference
- Why it matters:
  - Presttige already contains old funnel variants
  - Moving legacy material out of the active root reduces mental load without losing project history

## 6. Campaigns System

The campaigns system should work as follows:
- Each campaign has dedicated landing pages under `/frontend/campaigns`
- Campaign pages are separated from the main funnel implementation
- Campaigns pass referral and attribution data into the backend
- Each campaign can carry partner identifiers, referral codes, source labels, and campaign IDs
- The main funnel remains the core intake path, while campaign pages act as controlled acquisition layers

This model allows Presttige to:
- run targeted partner and influencer campaigns
- launch custom landing pages without cluttering the main public site
- track source quality and performance cleanly
- connect acquisition directly to backend attribution and payments

## 7. Referral & Partner System

The referral and partner system should follow these rules:
- referral tracking is backend-driven
- partner earnings are calculated from Stripe events
- data is stored in dedicated tables

Operationally, this means:
- attribution should be written by backend logic, not trusted only from the browser
- partner identity, referral codes, and campaign IDs should be persisted centrally
- payment success events should trigger commission calculations
- partner earnings should be based on validated payment outcomes, not page visits or unverified client-side actions

This creates a revenue system that is auditable, durable, and safe for scaling.

## 8. Stripe Integration

Stripe should be handled as a backend-controlled subsystem.

Core rules:
- checkout is handled via backend
- webhook is the central event processor
- commissions are calculated on payment success

Operational model:
- frontend requests checkout through backend endpoints
- backend creates and controls Stripe sessions
- Stripe sends trusted lifecycle events to the webhook processor
- the webhook updates payment state, partner attribution, and earnings
- commission logic runs only from confirmed backend payment events

This ensures that revenue, access, and partner compensation are based on real payment outcomes.

## 9. Migration Strategy (CRITICAL)

Safe migration rules are:

- Step 1: document everything
- Step 2: create structure
- Step 3: move legacy files only
- Step 4: bring backend into repo
- Step 5: only then refactor

Additional rules:
- No direct changes to the production flow before backend is inside the repo
- No endpoint replacement before backend ownership is established
- No visual cleanup before production and legacy boundaries are locked
- No funnel refactor while live behavior still depends on external backend code not yet versioned here

This migration strategy preserves control and prevents breaking a currently functioning production system.

## 10. Next Step

After defining this structure, the next step is:
- physically creating folders
- moving only legacy files
- preparing backend import

Execution order should be:
- create the approved top-level folders
- move only validated legacy pages into `/legacy`
- leave production pages untouched
- prepare `/backend` for incoming Lambda and shared backend source
- only after backend import, begin safe structural refactoring
