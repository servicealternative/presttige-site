# PRESTTIGE Master Context

## 1. Project Identity

PRESTTIGE is a fully independent brand and system.

It has its own:
- frontend
- funnel
- tracking
- cookies
- metrics
- Stripe flow
- reporting

PRESTTIGE must not be treated as a section, client, module, or sub-system of any other platform.

## 2. Non-Negotiable Rules

The following rules are frozen:

- Do not merge PRESTTIGE with ULTTRA
- Do not treat PRESTTIGE as part of ULTTRA
- Do not share frontend with ULTTRA
- Do not share cookies with ULTTRA
- Do not share tracking logic with ULTTRA
- Do not share attribution logic with ULTTRA
- Do not share reporting logic with ULTTRA
- Do not redesign unless explicitly requested
- Do not replace serious backend architecture with lightweight tools such as Google Sheets or similar shortcuts
- Build for real scale, whether there are 1 or 100,000 users

## 3. Operational Goal

The goal is to make PRESTTIGE operational as a production-ready private access system with:
- structured frontend flow
- approval and invitation control
- private offer flow
- Stripe checkout
- 72-hour invitation window
- referral-ready backend
- reporting-ready architecture

## 4. Identity Continuity Rule

Identity continuity is a frozen architectural invariant.

The registered user is not a separate identity disconnected from the lead.
It is the evolution of the same identity across the full Presttige lifecycle.

There must be no broken transition between:
- lead
- approved lead
- invited lead
- paid member
- registered user

This continuity must remain anchored in:
- `lead_id`
- token logic
- double opt-in trust chain
- review history
- approval state
- invitation state
- payment state

The platform must not create a second unrelated identity layer later.
The registered user must emerge from the same identity chain.

This rule must not be reinterpreted, simplified, or bypassed in future work.

### Editable vs Locked Data

Allowed to change only with verification:
- phone
- email
- payment method / card-related account data
- other operational profile/account fields where appropriate

Examples:
- phone change requires new OTP validation first
- email change requires new double opt-in first
- payment method must be updated through the payment layer, not through informal manual logic

Locked or highly restricted fields:
- username
- internal identifiers
- review history
- lead/user identity linking fields
- trust or audit-sensitive fields
- core curated identity fields that should not be freely altered

The platform must support three categories only:
- editable fields
- editable fields with verification
- locked or highly restricted fields

### No Loss of History

When a lead becomes a user, the system must not lose:
- origin
- review data
- approval decision
- invitation state
- offer state
- validation history
- payment relationship

Presttige must be able to evolve:
- lead
- approved lead
- invited lead
- paid member
- registered user

without creating fragmentation or identity duplication.

## 5. Current Production Funnel

The current PRESTTIGE flow is:

1. `index.html`
2. `create-lead`
3. `check-email.html`
4. `verify-email.html`
5. `access-form.html`
6. `submit-access`
7. internal review
8. approval / invitation send
9. `offer.html`
10. Stripe checkout
11. Stripe webhook activation

## 6. Current Backend State

The following backend source is already imported into the repository:

- `backend/lambdas/create-lead/lambda.py`
- `backend/lambdas/gateway/lambda.py`
- `backend/lambdas/stripe-gateway/lambda.py`
- `backend/lambdas/review-action/lambda.py`
- `backend/stripe/webhook.py`

Other backend files may still be incomplete or placeholders, but the Founder + Access campaign flow is now operational.

## 7. Offer Flow Rules

The PRESTTIGE private offer flow is governed by these final rules:

- `offer.html` is the private decision page
- it remains premium and decision-focused
- it reads `lead_id` or `id` plus `token`
- it validates through backend before enabling checkout
- it supports:
  - Founder
  - Access
  - Membership

Existing Stripe products and prices must remain unchanged.

## 8. 72-Hour Invitation Rule

The 72-hour offer window must follow these exact rules:

- it depends only on `offer_sent_at`
- it must not depend on `created_at`
- it must not depend on application submission time
- it must not start on page load
- it must not start on first page open

`offer_sent_at` is the sole source of truth for offer expiry.

## 9. Exact Rule for Writing offer_sent_at

`offer_sent_at` must be written:
- only in the approval / invitation-send backend
- at the exact moment the private invitation is issued or sent after approval
- using current UTC ISO timestamp
- once per invitation cycle

It must not be written in:
- `create-lead`
- `gateway`
- `stripe-gateway`
- page load
- validation calls
- first open of `offer.html`

It must not be overwritten unless a new invitation cycle is intentionally created.

## 10. Current Accepted Implementation

The PRESTTIGE Founder + Access campaign flow is currently considered operational.

Accepted implementation state:
- `gateway` reads `offer_sent_at`
- `stripe-gateway` reads `offer_sent_at`
- `review-action` writes `offer_sent_at`
- `offer.html` depends on that validation
- Stripe metadata is preserved and extended safely
- no changes were made to product/pricing structure
- identity continuity is now a frozen architectural invariant

## 11. Frozen Files

The following files should not be casually changed without explicit intent:

- `backend/lambdas/create-lead/lambda.py`
- `backend/lambdas/gateway/lambda.py`
- `backend/lambdas/stripe-gateway/lambda.py`
- `backend/lambdas/review-action/lambda.py`
- `backend/stripe/webhook.py`
- `offer.html`
- active production frontend files

## 12. Current Phase

Current phase:
- PRESTTIGE operational stabilization
- maintain continuity
- avoid architectural drift
- avoid generic suggestions that ignore the accepted system design

## 13. How Any New Chat Must Start

Before proposing changes, restate:

1. PRESTTIGE is fully independent
2. no merging with ULTTRA is allowed
3. the system is already structured and partially imported
4. the private offer flow is already defined
5. the 72-hour rule depends only on `offer_sent_at`
6. identity continuity from lead to user is frozen
7. no shortcuts or ad-hoc tools should replace backend architecture

If any suggestion conflicts with these rules, reject it and stay inside this document.
