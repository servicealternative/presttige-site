# Payment Backend Import Plan

## 1. Objective

Stripe metadata and partner commission logic cannot be added safely until the real checkout and session creation backend code is imported into the repository.

At the moment, the repository contains frontend references to live payment-related endpoints, but it does not yet contain the backend source that actually creates or controls the Stripe checkout flow. Because of that, any Stripe metadata patching done now would be speculative and unsafe.

## 2. Current limitation

The current repository does not yet contain the real Stripe checkout or session creation source code.

This means:
- Stripe metadata cannot yet be added safely
- partner attribution cannot yet be wired into the payment flow safely
- webhook-driven commission logic cannot yet be implemented against the real payment lifecycle

What is currently observable:
- frontend files reference payment-related backend endpoints
- founder/payment continuation appears to use a live Lambda Function URL
- shared checkout or gateway behavior is referenced from frontend JavaScript

What is not yet present:
- the actual backend code that creates Stripe checkout sessions
- the real webhook processing code
- the member/payment validation source tied to the payment flow

In short:
- the frontend points to payment infrastructure
- the payment backend source is still outside the repository

## 3. Candidate backend sources to import next

The following are the most likely next production backend sources to import from AWS.

### `presttige-stripe-gateway`
- Why it may be relevant:
  - The name strongly suggests it is the primary payment or checkout entry point
  - It is the most likely candidate to contain `stripe.checkout.Session.create(...)` or equivalent session creation logic
- Likely role:
  - checkout creation
  - payment session setup
  - Stripe metadata attachment point

### `presttige-founder-confirm`
- Why it may be relevant:
  - The current repository contains a live founder confirmation page that forwards users into a Lambda Function URL
  - This source is likely tied to founder payment continuation or checkout setup
- Likely role:
  - payment continuation
  - founder-specific checkout entry
  - pre-checkout confirmation flow

### `presttige-stripe-webhook`
- Why it may be relevant:
  - Webhook handling is required for payment confirmation, event processing, and any future commission logic
  - This source is likely where Stripe payment lifecycle events are currently processed
- Likely role:
  - webhook handling
  - payment success processing
  - post-payment automation
  - future commission trigger logic

### `presttige-gateway`
- Why it may be relevant:
  - The frontend references a gateway endpoint via the shared JavaScript file
  - This may be the generic product/payment routing Lambda behind founder, access, or membership flows
- Likely role:
  - general checkout routing
  - payment-related redirect logic
  - shared payment or product gateway behavior

### `presttige-member`
- Why it may be relevant:
  - The frontend shared JavaScript declares a member endpoint
  - Member access may depend on payment completion or post-checkout status
- Likely role:
  - member flow
  - post-payment member access handling
  - account or access state lookup

### `presttige-validate`
- Why it may be relevant:
  - The frontend shared JavaScript references a validation endpoint
  - This may confirm access state or token validity after payment or onboarding
- Likely role:
  - validation
  - token verification
  - member state checking

### `presttige-send-invite`
- Why it may be relevant:
  - Invite sending may be part of approved-member onboarding after payment or approval
  - While not directly part of checkout creation, it may sit downstream of successful payment or review state transitions
- Likely role:
  - invite sending
  - onboarding or member activation
  - downstream member flow

## 4. Most critical imports first

Recommended import order:

1. `presttige-stripe-gateway`
2. `presttige-founder-confirm`
3. `presttige-stripe-webhook`
4. `presttige-gateway`
5. `presttige-member`
6. `presttige-validate`
7. `presttige-send-invite`

## 5. Why this order matters

This order matters because Stripe referral work depends on understanding the real payment entry and event lifecycle before any patching is attempted.

Specifically:
- checkout creation must be imported before metadata can be added
- webhook processing must be imported before commission logic can be added
- payment continuation behavior must be understood before founder-specific changes are attempted
- validation and member logic can come after the payment flow is mapped end-to-end

If this order is ignored, there is a high risk of patching the wrong backend surface or duplicating logic that already exists in production.

## 6. Next execution step

The next real execution step is to import the full source code of:
- `presttige-stripe-gateway`
- `presttige-founder-confirm`
- `presttige-stripe-webhook`

into the repository before any Stripe referral patching begins.
