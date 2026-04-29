# Stripe Integration Rebuild Plan — 29 April 2026

Status: planning only, no implementation in this document.

Inputs:
- Matriz Chapter 2 (`R1`–`R5`)
- Matriz Chapter 3–4 (`§Tier-Pricing`)
- Matriz Chapter 5.4 (held E3 cohort)
- Matriz Chapter 14.2 (pending technical decisions)
- Matriz Chapter 16 (`§Email-DNS-Infrastructure`)
- `docs/STRIPE-INTEGRATION-AUDIT-2026-04-28.md` (`Matriz §Stripe-Integration-Audit`)
- Repo commit reviewed for this plan: `fe29e19d75d2b436aa167a11ee783766a2024758`

## 1. Target architecture

### 1.1 End-state shape

The rebuild will converge the current split payment stack into one Presttige payment architecture:

1. `presttige-review-action` remains the approval gate and the only E3 schedule creator.
2. `presttige-account-create` remains the E3 target, but it stops marking `payment_status=pending` before checkout exists.
3. `presttige-send-tier-select-email` continues sending E3, but the paid CTA path moves from hosted Checkout redirects to embedded checkout on `presttige.net`.
4. `tier-select.html` remains the tier decision page.
5. `checkout.html` becomes the only paid checkout surface for Club, Premier, and Patron.
6. `presttige-create-checkout-session` is rewritten into a Stripe Payment Element bootstrap endpoint.
7. `presttige-stripe-webhook` is rewritten as the single Stripe mutation handler for payment and subscription lifecycle events.
8. `presttige-magic-link-verify` remains the activation/welcome gate, but it is updated to tolerate webhook lag and the new payment state machine.
9. `presttige-gateway` and the public `/gateway` route leave the live architecture entirely.

### 1.2 Frontend flow for B5 embedded checkout

Recommended end-state flow:

1. Committee approves candidate.
2. `presttige-account-create` issues a random checkout token and invokes `presttige-send-tier-select-email`.
3. Candidate lands on `/tier-select/{token}` and chooses Subscriber, Club, Premier, or Patron.
4. Subscriber stays on the free path.
5. Club, Premier, and Patron go to `/checkout/{tier}?token={token}`.
6. `checkout.html` calls the rewritten `presttige-create-checkout-session` endpoint.
7. The endpoint validates the token, resolves the tier contract, and returns:
   - publishable key
   - Stripe client secret
   - amount / currency
   - customer email / country / name
   - contract fields needed by the page
8. `checkout.html` mounts Stripe Payment Element and confirms the payment on `presttige.net`.
9. Stripe webhook is the authority that marks payment success, writes paid-tier fields, and triggers E5.
10. The browser returns to `/welcome/{token}` with Stripe identifiers in the query string; the welcome flow shows either:
   - paid / ready to activate
   - payment processing
   - payment failed / retry available

### 1.3 Stripe.js / Payment Element approach

Recommended approach for launch:

- Use Stripe.js v3 and the Payment Element.
- Use the official Stripe SDKs only. No raw REST `fetch()` calls to Stripe remain in active code.
- Club Y1, Premier Y1, Patron lifetime, Club→Patron, and Premier→Patron should all be modeled through a shared Payment Element bootstrap path.
- The bootstrap endpoint should support two intent kinds:
  - `payment` for immediate charges
  - `setup` for future card-on-file / recurring expansion
- Launch recommendation: implement `payment` first for the locked public entry products and upgrades, and keep `setup` as an internal extension point until Antonio approves the renewal UX.

This keeps B5 aligned with Matriz Chapter 14.2: embedded Elements is locked, while Payment Intent vs Setup Intent details are still a technical decision.

### 1.4 Single source of truth for secrets

To resolve audit finding `F5`, the rebuild should separate secrets from non-secret config and make each category single-source:

- Secrets Manager becomes the only source of truth for:
  - Stripe secret key
  - Stripe publishable key
  - Stripe webhook secret
- SSM Parameter Store remains the only source of truth for:
  - Stripe price IDs
  - non-secret Stripe lookup keys and feature flags
- Lambdas receive only:
  - an environment selector (`test` or `live`)
  - the Secrets Manager secret name / ARN
- `checkout.html` must not hardcode the live publishable key in repo code. It should receive the publishable key at runtime from the backend bootstrap response.

Recommended secret shape:

```json
{
  "secret_key": "...",
  "publishable_key": "...",
  "webhook_secret": "..."
}
```

One secret per environment is simpler than mixing env vars, Secrets Manager, and SSM for overlapping Stripe credentials.

### 1.5 Idempotency strategy

To resolve `F3` and `F4`, idempotency must exist in both outbound Stripe calls and inbound webhook handling.

Checkout bootstrap idempotency:

- Deterministic idempotency key:
  - `lead_id + contract_key + checkout_token_version`
- The backend stores the latest open Stripe object ID on the lead record.
- If the same request repeats while the object is still reusable, the backend returns the existing client secret instead of creating a new Stripe object.

Webhook idempotency:

- New DynamoDB table: `presttige-stripe-events`
- Primary key: `event_id`
- Required fields:
  - `event_type`
  - `object_id`
  - `lead_id`
  - `received_at`
  - `processed_at`
  - `status`
  - `last_error`
- Rule:
  - first conditional write on `event_id`
  - if write fails because the event already exists, return `200` and do not repeat side effects

This prevents duplicate E5 sends and repeat lead mutations on Stripe retries.

### 1.6 Webhook event matrix

| Event | Purpose | Side effects |
|---|---|---|
| `payment_intent.succeeded` | Primary success path for one-time payments | Mark paid, write `stripe_payment_intent_id`, amount, currency, tier fields, invoke E5 |
| `payment_intent.processing` | Payment accepted but not final | Set `payment_status=processing`, no E5 |
| `payment_intent.payment_failed` | Immediate failure | Set `payment_status=failed`, store failure code/message, keep token reusable |
| `payment_intent.canceled` | Abandoned or canceled payment intent | Set `payment_status=cancelled`, no activation |
| `checkout.session.completed` | Compatibility only during cutover | Map legacy hosted Checkout completion into the new lead contract, then retire after cutover |
| `setup_intent.succeeded` | Future recurring card-on-file path | Store payment method reference only; no member activation by itself |
| `customer.subscription.created` | Future recurring lifecycle | Persist subscription ID and status |
| `customer.subscription.updated` | Future recurring lifecycle | Persist status, current period, cancel flags |
| `customer.subscription.deleted` | Future recurring lifecycle | Persist cancellation / end-of-service state |
| `invoice.paid` | Future recurring renewal success | Mark renewal paid, update paid-through dates |
| `invoice.payment_failed` | Future recurring renewal failure | Mark past-due / failed renewal state for later recovery logic |

Rules:

- Unknown event types return `200` after an audit log / no-op persistence record.
- No webhook event writes directly to unrelated lead fields.
- E5 is triggered only by the success events defined in the tier contract.

### 1.7 Tier metadata contract

There should be one shared contract file for all Stripe-aware code paths, for example:

`backend/lib/stripe-tier-contract.js`

Each contract entry should define:

- `contract_key`
- `tier`
- `billing`
- `charge_type` (`entry`, `renewal`, `upgrade`)
- `stripe_intent_kind` (`payment` or `setup`)
- `price_parameter`
- `public_checkout_enabled`
- `from_tier` when relevant
- `welcome_variant`
- `grants_access_status`

Recommended initial contract keys:

- `club_y1`
- `club_monthly`
- `club_yearly`
- `premier_y1`
- `premier_monthly`
- `premier_yearly`
- `patron_lifetime`
- `club_to_patron_upgrade`
- `premier_to_patron_upgrade`

Every active code path must use this shared contract:

- checkout bootstrap
- webhook
- welcome email dispatch
- future renewal handling
- future admin tooling

This replaces the current split metadata world (`tier`, `billing`, `product`, `plan`, `term`, legacy gateway params).

### 1.8 Token model

The rebuild should remove the deterministic `HMAC(lead_id)` gateway token model from active use and replace it with random checkout tokens.

Recommended model:

- random 32-byte base64url checkout token
- stored on the lead record as:
  - `checkout_token`
  - `checkout_token_status`
  - `checkout_token_issued_at`
  - `checkout_token_expires_at`
  - `checkout_token_version`
- new GSI on `checkout_token`
- token states:
  - `active`
  - `consumed`
  - `reissued`
  - `expired`

Behavior:

- token is reusable for read + checkout retry while still unpaid
- token becomes consumed after successful activation
- a new token invalidates the prior version
- TTL is recommended but not yet locked; recommendation for implementation review: 30 days, with explicit reissue support

This resolves the legacy gateway weakness in `F7` without reintroducing the old “stranded forever” problem.

## 2. What gets deleted or archived

Deletion and archival must happen only after a confirm-deployed-or-not check in the implementation milestone.

### 2.1 Confirmed live today

| Item | Current status | Evidence | Planned action |
|---|---|---|---|
| `presttige-gateway` Lambda | Deployed | `aws lambda get-function presttige-gateway` | Remove from live after B5 cutover smoke passes |
| `ANY /gateway` route | Deployed | `aws apigatewayv2 get-routes`, route key `ANY /gateway` | Remove from API Gateway in same cutover |
| `presttige-stripe-webhook` Function URL | Deployed | `aws lambda get-function-url-config presttige-stripe-webhook` | Keep temporarily, then replace or retain intentionally after webhook architecture decision |
| `POST /create-checkout-session` route | Deployed | `aws apigatewayv2 get-routes`, route key `POST /create-checkout-session` | Keep route, rewrite handler |
| `success.html` / `cancel.html` | Repo-backed static pages used by hosted Checkout flow | active code references in `backend/create-checkout-session/index.js` and `backend/lambdas/gateway/lambda_function.py` | Archive after Elements cutover if no remaining references |

### 2.2 Confirmed not deployed or unclear

| Item | Current status | Evidence | Planned action |
|---|---|---|---|
| `backend/stripe/webhook.py` | Repo-only duplicate, not confirmed deployed | no matching live Lambda discovered in current inventory | Archive or delete after one final deployment check during implementation |
| `presttige-stripe-gateway` Lambda | Not deployed | `aws lambda get-function presttige-stripe-gateway` returned not found | Leave out of live scope; archive repo references if any remain |
| `backend/lambdas/gateway/archived-local-2026-04-22/` | Local archive only | repo inventory | Leave as archive or move to `archive/legacy-payment/` if Antonio wants a cleaner tree |

### 2.3 Planned removal / archival list

Planned live removals:

- `presttige-gateway`
- API route `ANY /gateway`

Planned repo archival or deletion:

- `backend/lambdas/gateway/lambda_function.py`
- `backend/lambdas/gateway/requirements.txt`
- `scripts/package-presttige-gateway.sh`
- `backend/stripe/webhook.py`
- stale docs that still describe `/gateway` as active, after the cutover is complete
- `success.html`
- `cancel.html`

Rule:

- no live deletion happens until the replacement flow is passing in TEST
- repo deletion happens only after the deployed-or-not confirmation is re-run inside the implementation milestone

## 3. What gets rewritten

### 3.1 `presttige-create-checkout-session`

Rewrite this Lambda from “hosted Checkout session creator” into “embedded checkout bootstrap.”

Required changes:

- move from raw Stripe REST `fetch()` to official Stripe SDK
- use the shared tier contract
- use one secret source only
- add idempotency key support
- stop full-table scans once the token GSI exists
- stop marking `payment_status=pending` before a Stripe object exists
- return structured bootstrap data instead of `session.url`
- support `payment` now and `setup` as an extension path

Recommended response shape:

```json
{
  "publishableKey": "...",
  "clientSecret": "...",
  "intentKind": "payment",
  "contractKey": "patron_lifetime",
  "amount": 99900,
  "currency": "usd",
  "customerEmail": "..."
}
```

### 3.2 `presttige-stripe-webhook`

Rewrite scope:

- move from single-event logic to the full event matrix
- add `event.id` idempotency table
- persist `stripe_payment_intent_id`
- stop removing `stripe_subscription_id`
- keep a compatibility branch for `checkout.session.completed` during cutover only
- centralize tier-contract mapping so webhook never guesses based on mismatched metadata
- make tester vs non-tester welcome-email invocation behavior explicit and documented

### 3.3 Lead data model / DynamoDB

Schema changes required:

- add GSI for checkout token lookup
- add clear payment lifecycle fields
- add explicit Stripe object fields
- preserve existing lead identity fields and committee-review state

Recommended lead-side fields:

- `checkout_token`
- `checkout_token_status`
- `checkout_token_issued_at`
- `checkout_token_expires_at`
- `checkout_token_version`
- `payment_status`
- `payment_status_reason`
- `selected_contract_key`
- `selected_tier`
- `selected_tier_billing`
- `selected_price_id`
- `stripe_customer_id`
- `stripe_payment_intent_id`
- `stripe_setup_intent_id`
- `stripe_subscription_id`
- `stripe_latest_invoice_id`
- `stripe_last_event_id`
- `stripe_checkout_started_at`
- `stripe_checkout_completed_at`
- `stripe_payment_failed_at`

Recommended `payment_status` state machine:

- `none`
- `checkout_ready`
- `checkout_started`
- `processing`
- `paid`
- `failed`
- `cancelled`
- `free`
- `refunded`
- `renewal_active`
- `renewal_past_due`
- `renewal_cancelled`

### 3.4 Supporting rewrites around the checkout path

These files should be treated as part of the rebuild, not as side effects:

- `tier-select.html`
  - paid CTAs go to `/checkout/{tier}?token=...`
  - no redirect to hosted Checkout
- `backend/tier-select-fetch/index.js`
  - move to GSI lookup
  - return only token-safe candidate and tier data
- `backend/account-create/index.js`
  - issue checkout token without marking payment as pending
- `backend/send-tier-select-email/index.js`
  - E3 copy remains intact, but the downstream path changes to the new checkout surface
- `backend/magic-link-verify/index.js`
  - add processing-state tolerance after `confirmPayment`
- `welcome.html`
  - handle “payment still processing” and “payment failed / retry” states cleanly

## 4. Migration safety

- All rebuild work stays in TEST mode until the full flow passes end-to-end.
- No live Stripe keys are pasted into chat, repo files, screenshots, or commit history.
- Tester whitelist remains active:
  - `antoniompereira@me.com`
  - `alternativeservice@gmail.com`
- Matriz `R4` remains in force for all resend / backfill code.
- The 14 held candidates remain untouched until Antonio explicitly authorizes release.
- Route 53 / DNS stays untouched unless Antonio explicitly opens a DNS task, per Matriz §Email-DNS-Infrastructure.
- The old hosted Checkout surfaces should not be deleted until:
  1. embedded checkout passes in TEST
  2. webhook compatibility is proven
  3. Antonio approves the cutover milestone

## 5. Milestones + time estimate

| Milestone | Scope | Estimate | Exit criterion |
|---|---|---:|---|
| `M-R1` | Freeze contract + inventory + cutover checklist | 3–4 hours | final contract, delete/archive list, cutover checklist approved |
| `M-R2` | Data-model foundation: token GSI, webhook-event table, payment state machine, shared contract module | 5–7 hours | schema and shared contract implemented in TEST |
| `M-R3` | Rewrite `presttige-create-checkout-session` into Payment Element bootstrap | 6–8 hours | backend returns reusable client secret flow in TEST |
| `M-R4` | Build `checkout.html` and wire `tier-select.html` paid path to it | 6–8 hours | embedded checkout page renders and initializes correctly in TEST |
| `M-R5` | Rewrite `presttige-stripe-webhook` with event matrix + idempotency | 6–8 hours | webhook processes success / failure / duplicate delivery correctly in TEST |
| `M-R6` | Welcome / activation resilience, legacy-path retirement, TEST end-to-end verification | 5–7 hours | TEST end-to-end passes for success, decline, duplicate webhook, retry, and held-cohort safety |
| `M-R7` | Live-readiness pass (B3 gate): create live products, swap live secret source, configure live webhook, smoke verify | 3–5 hours plus Stripe/Dashboard waiting time | ready for Antonio’s explicit “system complete” approval |

Key gates:

- **TEST end-to-end pass happens at `M-R6`.**
- **Ready to swap to LIVE keys (B3) begins only after `M-R6` passes and Antonio approves the cutover.**

Practical total:

- engineering time: roughly 29–39 hours of focused implementation and verification
- plus waiting time for Stripe dashboard operations, Amplify deploys, and Antonio review checkpoints

## 6. Risks + unknowns

### 6.1 Antonio decisions still needed

- Whether launch uses `payment` only for Club/Premier year-1 entry, or whether automatic renewal onboarding must be included in the first rebuild cut
- Final checkout token TTL
- Final live webhook public URL:
  - keep Lambda Function URL intentionally
  - or move to API Gateway / `api.presttige.net`
- Exact success-page UX:
  - direct `/welcome/{token}`
  - or an intermediate “payment processing” shell before activation
- Error-recovery UX:
  - retry inline on the same checkout page
  - or return to tier-select first
- Apple Pay scope for V1:
  - card-only first
  - or Apple Pay in the first public release after domain verification completes

### 6.2 Codebase risks likely to surprise implementation

- `presttige-db` is heterogeneous and has legacy fields still in active write paths.
- Current paid-flow entry points still scan the full table for token lookups.
- The repo contains multiple historical payment architectures and archived copies.
- Hosted Checkout assumptions are baked into:
  - backend Stripe code
  - frontend `tier-select.html`
  - static `success.html` / `cancel.html`
  - documentation
- `presttige-gateway` still contains a hardcoded-style legacy token secret pattern and obsolete price env vars, which increases the chance of accidental reuse if it is not removed early in the rebuild.

### 6.3 Recommendation

Proceed with the rebuild in milestone order and do not start B3 live-product creation until `M-R6` is complete.

The safest first implementation milestone is `M-R2`, because it lays the shared contract, token lookup, and webhook idempotency foundation that the rest of the rebuild depends on.
