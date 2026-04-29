# Stripe Integration Rebuild Plan v2 — 29 April 2026

Status: planning only, no implementation in this document.

Inputs:
- Matriz Chapter 2 (`R1`–`R5`)
- Matriz Chapter 5.4 (held E3 cohort)
- Matriz Chapter 8.2 (quality over speed, no fixed deadline)
- Matriz Chapter 14.2 (technical decisions)
- Matriz Chapter 16 (`§Email-DNS-Infrastructure`)
- `docs/STRIPE-INTEGRATION-AUDIT-2026-04-28.md` (`Matriz §Stripe-Integration-Audit`)
- `docs/STRIPE-REBUILD-PLAN-2026-04-29.md` (v1 baseline)
- Repo commit reviewed for this plan: `f0e5b7c8c9f21ed0ad383d9ed679c3c0c2b938ca`
- Antonio briefing dated 29 April 2026 locking the v2 tier, referral, and Founder requirements

## 1. Target architecture

### 1.1 v2 delta summary

This v2 plan preserves the M-R2 foundation but changes the commercial model enough that v1 is no longer current.

What M-R2 survives unchanged:

- `backend/lib/stripe-tier-contract.js` stays the shared contract module location and structure.
- DynamoDB GSI `checkout-token-index` on `presttige-db` stays.
- DynamoDB table `presttige-stripe-events` stays as the webhook idempotency ledger.
- `scripts/verify-stripe-mr2-foundation.js` stays as the verification entry point.
- Checkout token TTL remains 30 days with reissue support.
- Stripe webhook remains on the existing Lambda Function URL model.
- Embedded Stripe Elements on `presttige.net` remains the locked B5 architecture.
- Single `/welcome/{token}` state-machine success page remains locked.
- Inline retry on the same checkout page remains locked.
- Apple Pay remains in scope for the first public release.

What M-R2 needs adjustment:

- The active contract keys change. `club_y1`, `premier_y1`, and `patron_lifetime` leave the active contract. `patron_yearly` and `founder_lifetime` enter it.
- The contract semantics change from “entry one-time products plus future renewals” to “subscription-first for Club, Premier, Patron; one-time lifetime only for Founder.”
- TEST catalog work must replace `patron_lifetime` with `patron_yearly` and add `founder_lifetime`.
- Existing TEST `club_y1` and `premier_y1` products should be retired from the active contract and treated as historical sandbox artifacts unless Antonio later requests cleanup.
- The lead payment state machine must expand from entry-payment focus to full subscription lifecycle, downgrade, renewal, and commission states.

What is new in v2:

- New public tier model: Subscriber / Club / Premier / Patron / Founder.
- Patron changes from one-time lifetime to auto-renewing yearly.
- Founder becomes the only one-time lifetime product.
- Full subscription lifecycle handling becomes active at launch for Club, Premier, and Patron.
- Graceful downgrade-to-Subscriber behavior on cancellation or failed renewal.
- First-touch `ref` attribution captured on landing and persisted across the full funnel and renewals.
- Stripe Connect onboarding and payout orchestration for Ambassadors, Business Partners, and Agencies.
- Multi-level split relationships and transfer orchestration.
- Founder-only S2.5 referrer confirmation and 7-day timeout escalation.
- `/review` queue priority and source display for all referred candidates.
- Founder-only `/tier-select` rendering for eligible, confirmed, committee-approved Founder candidates.

What is removed from v1:

- Patron lifetime as an active product model.
- “Year-1 entry only” as the launch shape for Club, Premier, and Patron.
- `club_y1`, `premier_y1`, and `patron_lifetime` as active public checkout contract keys.
- The v1 assumption that subscription and invoice events could remain a future seam.
- Any plan that treats referral payout logic as a post-launch layer.

### 1.2 Revised effort estimate

Antonio's rough estimate of 95–140 focused hours is directionally correct.

My working estimate for v2 is **100–132 focused hours**, plus waiting time for reviews, Stripe Dashboard steps, deploys, and verification. In practice this still maps to roughly **3–5 calendar weeks** because several milestones depend on checkpoint review and end-to-end validation rather than pure coding time.

### 1.3 End-state shape

The rebuild should converge the Stripe stack into one architecture:

1. `presttige-review-action` remains the approval gate and the only E3 schedule creator.
2. `presttige-account-create` remains the E3 target and becomes the checkout-token issuer for paid paths without mutating paid state prematurely.
3. `presttige-send-tier-select-email` remains the E3 sender.
4. `tier-select.html` remains the entry decision page, but its rendering branches:
   - standard candidates: Subscriber / Club / Premier / Patron
   - Founder-eligible + S2.5-confirmed + committee-approved Founder candidates: Founder only
5. `checkout.html` becomes the only paid checkout surface on `presttige.net`.
6. `presttige-create-checkout-session` is rewritten into a Stripe Elements bootstrap endpoint for:
   - recurring subscriptions
   - one-time Founder lifetime payment
   - Patron upgrade flows
7. `presttige-stripe-webhook` becomes the single Stripe mutation authority for:
   - subscription lifecycle
   - invoice lifecycle
   - one-time payment completion
   - referral payouts
   - split payouts
8. `/welcome/{token}` remains the only post-payment page, showing a state-machine view for `processing`, `paid`, `failed`, and free activation states.
9. `presttige-gateway` and `ANY /gateway` leave the architecture entirely after the replacement flow passes cutover.

### 1.4 Tier and checkout model

Locked commercial model for v2:

- Subscriber: free, post-approval, no Stripe charge.
- Club:
  - `club_monthly` — $9.99/month recurring
  - `club_yearly` — $99/year recurring
  - cancellation or renewal failure downgrades to Subscriber
- Premier:
  - `premier_monthly` — $33/month recurring
  - `premier_yearly` — $222/year recurring
  - cancellation or renewal failure downgrades to Subscriber
- Patron:
  - `patron_yearly` — $999/year recurring
  - cancellation or renewal failure downgrades to Subscriber
- Founder:
  - `founder_lifetime` — $9,999 one-time lifetime
  - invitation-only, hidden from non-Founder candidates

Recommended active contract keys:

- `club_monthly`
- `club_yearly`
- `premier_monthly`
- `premier_yearly`
- `patron_yearly`
- `founder_lifetime`
- `club_to_patron_upgrade`
- `premier_to_patron_upgrade`

The shared contract file should additionally define:

- `checkoutMode` (`subscription` or `payment`)
- `tierVisibility` (`standard` or `founder_only`)
- `downgradeTargetTier`
- `commissionProfile`
- `requiresFounderReferral`

### 1.5 Stripe Elements approach

Recommended frontend approach:

- Stripe.js v3 with Payment Element only.
- No custom card fields.
- Wallets enabled through Payment Element with Apple Pay verification in TEST first, then LIVE.
- The checkout page calls the backend bootstrap endpoint and receives:
  - publishable key
  - Stripe client secret
  - contract metadata
  - candidate profile data needed for rendering
  - whether the flow is `subscription`, `payment`, or `upgrade`

Recommended backend intent model:

- Club / Premier / Patron:
  - create subscription-oriented checkout state through Payment Element
  - use subscription setup that results in immediate first invoice payment
- Founder:
  - one-time Payment Intent path
- Upgrades:
  - special upgrade flow; see 1.9

### 1.6 Single source of truth for secrets

To resolve audit `F5`, secrets must be normalized before any live cutover:

- Secrets Manager only for:
  - Stripe secret key
  - Stripe publishable key
  - Stripe webhook secret
- SSM Parameter Store only for:
  - price IDs
  - non-secret config flags
  - any environment-specific contract lookups
- Lambdas receive:
  - environment selector
  - secret name / ARN
  - non-secret parameter prefixes only

Recommended secret shape:

```json
{
  "secret_key": "...",
  "publishable_key": "...",
  "webhook_secret": "..."
}
```

### 1.7 Idempotency strategy

Both outbound Stripe creation and inbound webhook mutation need hard idempotency.

Checkout bootstrap idempotency:

- deterministic idempotency key:
  - `lead_id + contract_key + checkout_token_version + checkout_mode`
- lead stores the current open Stripe object IDs so retries return the existing client secret when safe
- a reissued checkout token invalidates the prior bootstrap lineage

Webhook idempotency:

- `presttige-stripe-events` remains the source of truth
- primary key: `event_id`
- fields required:
  - `event_type`
  - `object_id`
  - `lead_id`
  - `contract_key`
  - `stripe_customer_id`
  - `received_at`
  - `processed_at`
  - `status`
  - `last_error`
  - `side_effect_hash`
- first write is conditional on missing `event_id`
- duplicates return `200` without repeating side effects

Transfer idempotency:

- each commission operation should write a transfer ledger row keyed by:
  - `source_event_id + recipient_referrer_id + leg_number`
- no transfer is created twice for the same payment leg

### 1.8 Token model

The deterministic HMAC gateway-token model remains obsolete and should not return.

Recommended checkout token behavior:

- one active version per lead
- random token, 30-day TTL
- read + retry allowed while the candidate remains unpaid or the renewal/upgrade action is still unresolved
- token becomes consumed when the success path finishes and the account/welcome state is fully persisted
- explicit reissue path invalidates prior versions

Lead fields remain:

- `checkout_token`
- `checkout_token_status`
- `checkout_token_issued_at`
- `checkout_token_expires_at`
- `checkout_token_version`

### 1.9 Upgrade pricing model recommendation

Locked prices:

- `club_to_patron_upgrade` — $900 first charge
- `premier_to_patron_upgrade` — $777 first charge
- both flows must land the member on recurring `patron_yearly`

Recommended Stripe representation:

- **Primary recommendation:** create or update the customer onto the `patron_yearly` subscription and apply a one-time first-invoice adjustment so the first collected amount is $900 or $777, then renew at $999/year thereafter.

Why this is the cleanest model:

- one active subscription object represents Patron after the upgrade
- renewal lifecycle stays on the same subscription from day one
- webhook logic stays centered on subscription + invoice events instead of splitting the upgrade across unrelated object families
- the customer sees one billing narrative: upgrade now, Patron renews yearly afterward

Trade-offs:

- more Stripe invoice orchestration complexity up front
- proration, invoice-finalization timing, and retry behavior must be tested carefully

Fallback model if TEST proves the first-invoice adjustment too brittle:

- immediate one-time Payment Intent for $900 / $777
- then synchronous backend creation or mutation to `patron_yearly`

Fallback trade-offs:

- simpler charge amount handling
- but creates a two-object success path that is harder to make atomic and idempotent

I do **not** recommend subscription schedules as the primary v2 launch model unless the first-invoice approach proves impossible in TEST, because schedules add operational complexity that the team does not need for the first public release.

### 1.10 Referral attribution and partner economy

Recommended attribution model:

1. Landing on `presttige.net/?ref=<code>` captures the first-touch reference code.
2. System resolves the code to a referrer record.
3. Lead record persists:
   - `referrer_id`
   - `referrer_type`
   - `reference_code`
   - `referrer_display_name`
   - `attribution_first_touch_at`
   - `attribution_last_touch_at`
   - `founder_eligible`
   - `tier_intent`
4. Attribution persists across:
   - S1
   - S2
   - S2.5 when applicable
   - S3 review
   - tier selection
   - checkout
   - renewals
5. UTM capture remains parallel and separate from `ref`.

Recommended payout model:

- **Primary recommendation:** Presttige remains merchant of record on the platform account, and commissions are paid out after confirmed payment events using Stripe Connect transfers from the platform balance.

Why this is the cleanest model:

- one customer charge path for all products
- same model works for one-time Founder, recurring renewals, and upgrades
- multi-leg splits are easier because the platform can create more than one transfer per payment event
- refunds and chargebacks can reverse transfers from the same ledger model

Trade-offs:

- platform carries payout timing and balance management
- transfer reversals must be handled carefully on disputes and refunds

I do **not** recommend destination charges as the primary model for v2 because they are less natural for multi-recipient splits and would force the charge narrative toward connected accounts instead of Presttige as the merchant of record.

### 1.11 Multi-level split relationships

Recommended new data model:

- `presttige-referrers`
  - `referrer_id`
  - `reference_code`
  - `referrer_type`
  - `display_name`
  - `connect_account_id`
  - `connect_status`
  - `commission_profile`
  - `status`
- `presttige-referrer-splits`
  - `split_id`
  - `primary_referrer_id`
  - `sub_referrer_id`
  - `split_percent`
  - `status`
  - `effective_from`
  - `effective_to`
  - `updated_by`
  - `updated_at`
- `presttige-stripe-transfers`
  - `transfer_ledger_id`
  - `source_event_id`
  - `lead_id`
  - `stripe_charge_or_invoice_id`
  - `recipient_referrer_id`
  - `connect_account_id`
  - `gross_commission_amount`
  - `net_transfer_amount`
  - `transfer_id`
  - `transfer_status`
  - `reversal_id`

Webhook orchestration rule:

- one confirmed payment event computes the total commission from the contract
- if no split exists, send one transfer to the primary referrer
- if a split exists, compute multiple transfer legs and persist each leg separately
- split version is resolved at the time of payment event, not back-applied later

### 1.12 Founder-specific S2.5 and review priority

Founder-only S2.5 requires new funnel behavior:

1. Founder-eligible candidate completes S2.
2. System sends a secure confirmation email to the referring Ambassador / Partner / Agency.
3. Referrer confirms and provides written reasoning.
4. If confirmed within 7 days, candidate moves to S3 with the confirmation data attached.
5. If not confirmed within 7 days, system auto-escalates to S3 and sets:
   - `ambassador_confirmation_status = "timeout_no_response"`

Recommended lead-side fields:

- `ambassador_confirmation_status`
- `ambassador_confirmation_requested_at`
- `ambassador_confirmation_due_at`
- `ambassador_confirmation_completed_at`
- `ambassador_confirmation_reasoning`
- `ambassador_confirmation_referrer_id`
- `committee_priority_source`
- `committee_priority_rank`

For **all** referred candidates, `/review` should surface:

- referrer display name
- referrer type
- reference code
- partner-priority badge
- queue-priority signal over non-referred leads

## 2. What gets deleted or archived

Deletion and archival still happen only after confirm-deployed-or-not checks inside implementation milestones.

### 2.1 Items still leaving the architecture from v1

Planned live removals:

- `presttige-gateway`
- API route `ANY /gateway`

Planned repo archival or deletion:

- `backend/lambdas/gateway/lambda_function.py`
- `backend/lambdas/gateway/requirements.txt`
- `scripts/package-presttige-gateway.sh`
- `backend/stripe/webhook.py`
- stale docs that describe `/gateway` as active

### 2.2 Additional legacy items that v2 should retire

These items were already weak under v1 and are now structurally obsolete under the v2 tier model:

- `success.html`
- `cancel.html`
- `confirm.html`
- any repo copy that still models Patron as lifetime or Founder as a legacy side-flow rather than the main referral-governed tier
- archived Stripe webhook copies that still embed the old 15% / 12% commission logic

Reason:

- the new model routes all paid decisions through `tier-select.html`, `checkout.html`, `/welcome/{token}`, and the rewritten webhook
- legacy founder/payment continuation pages should not remain as parallel production narratives

### 2.3 Confirm-deployed-or-not rule

Before deleting or archiving any payment-facing file or Lambda, implementation must confirm:

- deployed now and being replaced
- repo-only and safe to archive
- unclear, requiring Antonio confirmation before deletion

## 3. What gets rewritten

### 3.1 Shared contract foundation (`M-R2v2`)

`backend/lib/stripe-tier-contract.js` keeps its module shape but its contents change to the v2 contract.

Required active keys:

- `club_monthly`
- `club_yearly`
- `premier_monthly`
- `premier_yearly`
- `patron_yearly`
- `founder_lifetime`
- `club_to_patron_upgrade`
- `premier_to_patron_upgrade`

Required shared definitions:

- commission profile per contract
- checkout mode per contract
- downgrade target tier
- whether referral is required
- whether Founder-only gating applies

TEST catalog changes:

- replace TEST `patron_lifetime` with `patron_yearly`
- create TEST `founder_lifetime`
- keep current TEST monthly/yearly and upgrade products if pricing remains correct
- remove `club_y1` and `premier_y1` from the active resolver while leaving sandbox artifacts untouched unless a later cleanup brief requests deletion

### 3.2 `presttige-create-checkout-session`

Rewrite this Lambda from “hosted Checkout creator” into “Payment Element bootstrap + subscription orchestration endpoint.”

Required behavior:

- resolve the shared contract
- validate checkout token via the GSI
- branch by mode:
  - subscription create/bootstrap
  - Founder one-time payment
  - Patron upgrade
- return publishable key + client secret + contract metadata
- apply deterministic idempotency keys
- stop full-table scans
- stop mutating payment status before Stripe object creation succeeds

### 3.3 `presttige-stripe-webhook`

Rewrite scope expands materially in v2.

Required active event matrix:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `payment_intent.succeeded`
- compatibility branch for `checkout.session.completed` during the transition window only

Required side effects:

- subscription creation / update persistence
- cancel-at-period-end persistence
- downgrade to Subscriber on definitive cancellation or failed-renewal exhaustion
- renewal extension
- commission transfer creation
- split transfer orchestration
- refund / chargeback-safe ledger recording

### 3.4 Lead data model and DynamoDB

Existing M-R2 structures stay, but the lead-side payment model needs expansion.

Recommended lead fields beyond the current M-R2 set:

- `selected_checkout_mode`
- `selected_referrer_id`
- `selected_referrer_type`
- `selected_reference_code`
- `subscription_current_period_start`
- `subscription_current_period_end`
- `subscription_cancel_at_period_end`
- `subscription_cancelled_at`
- `renewal_attempt_count`
- `renewal_last_failed_at`
- `downgraded_to_subscriber_at`
- `founder_eligible`
- `founder_gate_status`
- `tier_intent`
- `ambassador_confirmation_status`
- `ambassador_confirmation_requested_at`
- `ambassador_confirmation_due_at`
- `ambassador_confirmation_completed_at`
- `ambassador_confirmation_reasoning`
- `committee_priority_source`
- `committee_priority_rank`

Recommended payment-status states:

- `none`
- `checkout_ready`
- `checkout_started`
- `processing`
- `paid`
- `failed`
- `cancelled`
- `free`
- `refunded`
- `subscription_active`
- `subscription_past_due`
- `subscription_cancel_at_period_end`
- `renewal_failed_retrying`
- `renewal_cancelled`
- `downgraded_to_subscriber`

### 3.5 Referral, Connect, and transfer data model

New persistence surfaces are required:

- `presttige-referrers`
- `presttige-referrer-splits`
- `presttige-stripe-transfers`
- optional `presttige-connect-onboarding-sessions` if the onboarding UX needs resumable state

These are new in v2 and do not exist in the v1 plan.

### 3.6 Supporting funnel rewrites

Files and flows that become part of the rebuild:

- `index.html`
  - capture and persist `ref`
- S1/S2 submit flow
  - persist attribution and tier intent
- new S2.5 confirmation send + confirm handlers
- timeout scheduler for S2.5 auto-escalation
- `review.html`
  - show referrer source, reference code, and priority badge
- committee queue fetch / sort logic
  - prioritize referred candidates over non-referred candidates
- `tier-select.html`
  - standard four-tier view for non-Founder candidates
  - Founder-only rendering path when applicable
- `backend/tier-select-fetch/index.js`
  - return Founder-only or standard payload shape
- `backend/account-create/index.js`
  - issue checkout token only, without premature paid-state mutation
- `backend/send-tier-select-email/index.js`
  - preserve E3 copy while routing to the new checkout path
- `backend/magic-link-verify/index.js`
  - tolerate webhook lag and the expanded subscription/payment state machine
- `welcome.html`
  - show processing, paid, failed, renewal, and downgrade-aware states

## 4. Migration safety

- All rebuild work remains in TEST mode until the full v2 flow passes end-to-end.
- LIVE Stripe keys must never appear in chat, repo files, screenshots, or commit history.
- The tester whitelist remains:
  - `antoniompereira@me.com`
  - `alternativeservice@gmail.com`
- The 14 held candidates remain untouched until the rebuild is complete and Antonio explicitly authorizes the release procedure.
- Matriz `R4` remains in force for all resend and backfill logic.
- Route 53 / DNS remains untouched per Matriz §Email-DNS-Infrastructure.
- The Stripe webhook remains on the current Lambda Function URL; no new DNS work is introduced.
- Legacy `/gateway` stays live until the replacement path passes TEST end-to-end and Antonio approves the cutover milestone.
- `checkout.session.completed` compatibility remains only as a temporary bridge and should be retired after clean LIVE operation, per the separate post-launch follow-up already logged.
- TEST-first also applies to:
  - Apple Pay domain verification
  - Stripe Connect onboarding flow
  - transfer orchestration
  - upgrade billing behavior

## 5. Milestones + time estimate

| Milestone | Scope | Estimate | Exit criterion |
|---|---|---:|---|
| `M-R2v2` | Update shared contract contents, TEST catalog alignment, verification script outputs | 4–6 hours | new contract keys resolve in TEST; `patron_yearly` and `founder_lifetime` exist; no active resolver uses retired keys |
| `M-R3` | Rewrite checkout bootstrap backend for subscription, Founder, and upgrade modes | 10–14 hours | backend returns correct client-secret bootstrap payloads for all active contract keys in TEST |
| `M-R4` | Build `checkout.html`, wire `tier-select.html`, add Apple Pay-ready Payment Element configuration, preserve inline retry UX | 10–14 hours | checkout page renders and retries correctly across Club, Premier, Patron, Founder in TEST |
| `M-R5` | Rewrite `presttige-stripe-webhook` for active subscription + invoice + payment-intent lifecycle with idempotency | 12–16 hours | duplicate-safe webhook processes success, failure, renewal, cancellation, and downgrade transitions in TEST |
| `M-R6` | Referral capture and persistence across the funnel, including lead attribution contract | 10–14 hours | `ref` first-touch attribution persists from landing through checkout and renewals in TEST |
| `M-R7` | Stripe Connect onboarding and payout ledger foundation for referrers | 12–18 hours | referrer onboarding flow works in TEST and payout ledger writes are deterministic |
| `M-R8` | Multi-level split relationships and transfer orchestration | 10–14 hours | one payment event can generate one-leg and two-leg transfers safely in TEST |
| `M-R9` | Founder S2.5 confirmation flow, timeout escalation, and reasoning capture | 10–14 hours | Founder candidates can confirm, timeout, and advance to S3 correctly in TEST |
| `M-R10` | `/review` priority surfacing and Founder-only `/tier-select` branch | 6–10 hours | referred candidates surface correctly to committee; Founder candidates see only Founder |
| `M-R11` | TEST end-to-end matrix, cutover checklist, and B3 readiness gate | 8–12 hours | full v2 TEST funnel passes, held cohort remains untouched, ready for Antonio review before LIVE key swap |

Practical total:

- focused engineering and verification: **100–132 hours**
- calendar time with reviews, waiting, and Stripe dashboard dependencies: **3–5 weeks**

Key gates:

- **TEST end-to-end pass happens at `M-R11`.**
- **Ready to swap to LIVE keys (B3) begins only after `M-R11` passes and Antonio explicitly authorizes live cutover.**

## 6. Risks + unknowns

### 6.1 Matriz alignment risk

The current in-repo Matriz still describes:

- four tiers only
- Patron as true lifetime
- Founder as a Patron-adjacent concept rather than a standalone purchase tier
- Year-1 pricing language for Club and Premier

That means the v2 plan is aligned to Antonio's 29 April 2026 locked briefing, but the Matriz text itself will need a follow-up revision before implementation is treated as “matching the source of truth exactly.”

### 6.2 Antonio input still needed beyond this briefing

- Whether monthly and yearly plan choice for Club and Premier appears directly on `/tier-select` or only inside `/checkout`.
- Exact UX copy for downgrade-to-Subscriber messaging on:
  - `/welcome/{token}`
  - member-facing email flows
  - any future account surface
- Which Stripe retry policy configuration should be treated as canonical before a failed renewal becomes a downgrade.
- Whether Founder can ever be voluntarily downgraded or converted after purchase, or whether Founder is truly permanent with no downgrade path.
- Whether Business Partners and Agencies can originate Founder candidates exactly like Ambassadors, or whether Founder remains Ambassador-led with the other partner types using equivalent operational plumbing only.
- Scope of the minimal admin tool for split relationship editing in V1:
  - direct DynamoDB edits by Antonio only
  - or a minimal internal UI
- Whether the referral code should be editable after first touch in any manual exception flow, or whether first-touch attribution is immutable.

### 6.3 Technical risks likely to surprise implementation

- Current repo and live infrastructure still contain several historical founder/payment paths that were never fully retired.
- The M-R2 foundation was added to the shared `presttige-db`, not to a separate isolated test-only table, so schema evolution must stay disciplined.
- Old commission logic exists in legacy webhook code with rates that no longer match the locked v2 rates.
- Upgrade billing is the most likely Stripe-behavior hotspot because it combines immediate delta pricing with future recurring Patron renewal.
- Transfer reversals for refunds and chargebacks will require careful ledger design even if the actual refund policy remains outside this rebuild.
- Apple Pay domain verification is locked in, but its Stripe Dashboard steps add operational dependency even though DNS changes are out of scope.

### 6.4 Recommendation

Do not resume implementation at the old `M-R3`.

The correct next step after Antonio reviews this document is `M-R2v2`: update the shared contract contents, align the TEST Stripe catalog to the new tier model, and re-run the foundation verification against the new active keys. That keeps the existing M-R2 infrastructure investment while preventing the rest of the rebuild from being built on outdated contract assumptions.
