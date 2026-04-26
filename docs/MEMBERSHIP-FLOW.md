# Presttige Membership Flow

## Overview

Round C closes the post-approval funnel:

1. Committee approves the lead in `presttige-review-action`
2. `presttige-account-create` initializes the membership token
3. `presttige-send-tier-select-email` sends the tier-selection email (candidate + BCC committee)
4. Candidate opens `/tier-select/{token}`
5. Candidate chooses `patron`, `tier2`, `tier3`, or `free`
6. Free path activates immediately
7. Paid path creates a hosted Stripe Checkout Session
8. Stripe webhook marks the lead as paid and triggers the welcome email
9. Candidate opens `/welcome/{magic_token}`
10. `presttige-magic-link-verify` marks the account active on first valid use

## Pricing status

Current membership pricing is stored as `TBD-PLACEHOLDER`:

- Patron: $5,000/month or $51,000/year
- Tier 2: $1,500/month or $15,300/year
- Tier 3: $500/month or $5,100/year
- Free: $0

These values are live in Stripe test mode and mirrored in SSM for the application layer.

## Token model

- Secret: `presttige-magic-link-secret`
- Format: `HMAC-SHA256(lead_id + "|tier-select|" + attempt_id, secret)`
- TTL: 7 days
- Statuses:
  - `active`
  - `used`
  - `expired`

The same token is used for:

- `/tier-select/{token}`
- `/welcome/{token}`

The welcome verifier blocks activation until payment is `paid` or `free`.

## Free path

If the candidate selects `free`:

- no Stripe checkout is created
- `selected_tier=free`
- `selected_periodicity=null`
- `payment_status=free`
- `account_active=true`
- `magic_token_status=used`
- redirect goes directly to `/welcome/{token}`

## Paid path

If the candidate selects `patron`, `tier2`, or `tier3`:

- `presttige-create-checkout-session` creates a hosted Stripe Checkout Session
- the lead stores `selected_tier`, `selected_periodicity`, and `stripe_session_id`
- Stripe sends `checkout.session.completed`
- `presttige-stripe-webhook` updates:
  - `payment_status=paid`
  - `stripe_customer_id`
  - `stripe_subscription_id`
- webhook asynchronously invokes `presttige-send-welcome-email`

## Welcome activation

`presttige-magic-link-verify`:

- finds the lead by `magic_token`
- rejects expired or unpaid first-use attempts
- marks first valid use as:
  - `magic_token_status=used`
  - `magic_token_used_at=now`
  - `account_active=true`
  - `onboarded_at=now`
- allows re-visits if the token is already used and the account is already active

## API routes

- `POST /send-tier-select-email`
- `GET /tier-select-fetch`
- `POST /create-checkout-session`
- `POST /send-welcome-email`
- `GET /magic-link-verify`

## Static pages

- `/tier-select/{token}` → `tier-select.html`
- `/welcome/{token}` → `welcome.html`
