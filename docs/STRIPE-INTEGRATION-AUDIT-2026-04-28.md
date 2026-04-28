# Stripe Integration Audit — 2026-04-28

- Date: 28 April 2026
- Auditor: Codex CLI (read-only)
- Repo commit audited: `0c72d80d1ff3477cc02c31c29358fa884adb356a`
- Scope: Existing Stripe integration in test mode (LIVE not yet built)
- Status: PRE-B3 BLOCKING AUDIT
- Future citation label: `Matriz §Stripe-Integration-Audit`

This audit is read-only. No code, AWS configuration, Stripe configuration, or SSM parameter values were modified. No Stripe API calls were made during this audit turn.

## Section 1 — Lambda inventory

### 1.1 `presttige-create-checkout-session`

- Handler path: `backend/create-checkout-session/index.js`
- Stripe SDK version used: none. `backend/create-checkout-session/package.json:1-4` declares no `stripe` dependency; the handler uses raw `fetch()` against Stripe REST.
- Stripe API version pinned in code: default. No `Stripe-Version` header is set.
- Source of Stripe credentials:
  - primary: Secrets Manager secret `presttige-stripe-secret` at `backend/create-checkout-session/index.js:34-39`
  - fallback: env var `STRIPE_SECRET_KEY` at `backend/create-checkout-session/index.js:41-44`
- Stripe API calls made:
  - `POST https://api.stripe.com/v1/checkout/sessions` at `backend/create-checkout-session/index.js:157-164`
- Error handling pattern:
  - validates request and token state with `400`, `404`, `410`, or `200` shortcut responses at `backend/create-checkout-session/index.js:94-124`
  - logs Stripe REST failures with `console.error("Stripe checkout error", session)` at `backend/create-checkout-session/index.js:167-172`
  - wraps the handler in `try/catch` and returns `500` with `detail: error.message` at `backend/create-checkout-session/index.js:219-221`
- TODO/FIXME/HACK comments mentioning Stripe: none found

Relevant code:

`backend/create-checkout-session/index.js:34-45`
```js
  try {
    const response = await secrets.send(
      new GetSecretValueCommand({ SecretId: "presttige-stripe-secret" })
    );
    cachedStripeKey = response.SecretString;
    return cachedStripeKey;
  } catch (error) {
    if (process.env.STRIPE_SECRET_KEY) {
      cachedStripeKey = process.env.STRIPE_SECRET_KEY;
      return cachedStripeKey;
```

`backend/create-checkout-session/index.js:157-166`
```js
    const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await stripeResponse.json();
```

### 1.2 `presttige-stripe-webhook`

- Handler path: `backend/lambdas/stripe-webhook/lambda_function.py`
- Stripe SDK version used: `stripe>=8.0.0,<9.0.0` in `backend/lambdas/stripe-webhook/requirements.txt:1`
- Stripe API version pinned in code: default. No `stripe.api_version` assignment exists.
- Source of Stripe credentials:
  - env var `STRIPE_SECRET_KEY` at `backend/lambdas/stripe-webhook/lambda_function.py:43`
  - env var `STRIPE_WEBHOOK_SECRET` at `backend/lambdas/stripe-webhook/lambda_function.py:44`
- Stripe API calls made:
  - `stripe.Webhook.construct_event(...)` at `backend/lambdas/stripe-webhook/lambda_function.py:297-301`
  - no outbound `stripe.*.retrieve/create/update` calls were found in the active webhook
- Other AWS-side calls made by the handler:
  - `lambda_client.invoke(...)` to `presttige-send-welcome-email` at `backend/lambdas/stripe-webhook/lambda_function.py:241-258`
  - DynamoDB `get_item` and `update_item` at `backend/lambdas/stripe-webhook/lambda_function.py:337-428`
- Error handling pattern:
  - early `500` responses for missing Stripe import, missing secret key, or missing webhook secret at `backend/lambdas/stripe-webhook/lambda_function.py:262-279`
  - `400` on missing `Stripe-Signature` at `backend/lambdas/stripe-webhook/lambda_function.py:281-288`
  - `400` on signature verification failure at `backend/lambdas/stripe-webhook/lambda_function.py:450-454`
  - generic `500` with raw exception text at `backend/lambdas/stripe-webhook/lambda_function.py:456-459`
- TODO/FIXME/HACK comments mentioning Stripe: none found

Relevant code:

`backend/lambdas/stripe-webhook/lambda_function.py:281-301`
```python
        headers = event.get("headers") or {}
        sig_header = headers.get("Stripe-Signature") or headers.get("stripe-signature")

        if not sig_header:
            return response(400, {
                "error": "missing_signature",
                "message": "Missing Stripe-Signature header"
            })
        webhook_event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
```

`backend/lambdas/stripe-webhook/lambda_function.py:380-389`
```python
        LEADS_TABLE.update_item(
            Key={"lead_id": lead_id},
            UpdateExpression="""
                SET payment_status = :paid,
                    access_status = :active,
                    stripe_checkout_completed = :true,
                    stripe_session_id = :stripe_session_id,
                    stripe_customer_id = :customer_id,
                    #product = :product,
                    #plan = :plan,
```

### 1.3 `presttige-gateway`

- Handler path: `backend/lambdas/gateway/lambda_function.py`
- Stripe SDK version used: `stripe>=8.0.0,<9.0.0` in `backend/lambdas/gateway/requirements.txt:1`
- Stripe API version pinned in code: default. No `stripe.api_version` assignment exists.
- Source of Stripe credentials:
  - env var `STRIPE_SECRET_KEY` at `backend/lambdas/gateway/lambda_function.py:27`
  - all price IDs come from env vars (`FOUNDER_PRICE_ID`, `ACCESS_PRICE_ID`, `ENTRY_*`, `MID_*`, `PREMIUM_*`) at `backend/lambdas/gateway/lambda_function.py:30-43`
- Stripe API calls made:
  - `stripe.checkout.Session.create(**session_kwargs)` at `backend/lambdas/gateway/lambda_function.py:162`
- Error handling pattern:
  - validates missing params and invalid token with `400`/`403`/`404` at `backend/lambdas/gateway/lambda_function.py:95-106`
  - broad `except Exception` returns `500 {"error": str(e)}` at `backend/lambdas/gateway/lambda_function.py:169-170`
  - no explicit logging on error
- TODO/FIXME/HACK comments mentioning Stripe: none found

Relevant code:

`backend/lambdas/gateway/lambda_function.py:135-143`
```python
        elif product == "membership":
            price = get_membership_price(plan, term)
            mode = "subscription"
            metadata.update({
                "product": "membership",
                "plan": plan,
                "term": term
            })
```

`backend/lambdas/gateway/lambda_function.py:150-167`
```python
        session_kwargs = {
            "mode": mode,
            "line_items": [{"price": price, "quantity": 1}],
            "success_url": SUCCESS_URL + "?session_id={CHECKOUT_SESSION_ID}",
            "cancel_url": CANCEL_URL,
            "client_reference_id": lead_id,
            "metadata": metadata,
        }
        session = stripe.checkout.Session.create(**session_kwargs)
        return {
            "statusCode": 302,
```

### 1.4 Additional Stripe code discovered

- `backend/stripe/webhook.py` is a second webhook implementation in the repo.
- It uses the same `stripe>=8,<9` style and writes Stripe state into `presttige-db`, but it is **not** one of the currently named deployed Lambdas returned by the read-only AWS inventory during this audit.
- Deployment status is **UNCLEAR — needs Antonio confirmation**.
- It appears to be a legacy/parallel implementation, not the active `presttige-stripe-webhook` handler.

## Section 2 — Webhook handler deep-dive

### 2.1 Webhook URL

- `presttige-stripe-webhook` is exposed as a Lambda Function URL, not API Gateway.
- Read-only AWS result:
  - URL: `https://flryyvnmb5bwdaeknvs6xcbgmi0dedfe.lambda-url.us-east-1.on.aws/`
  - AuthType: `NONE`
  - InvokeMode: `BUFFERED`

### 2.2 Webhook signing secret source

- Source: env var `STRIPE_WEBHOOK_SECRET`
- File reference: `backend/lambdas/stripe-webhook/lambda_function.py:43-45`
- No SSM lookup or Secrets Manager lookup exists in the active handler.

### 2.3 Every event type the handler responds to

- Explicitly processed:
  - `checkout.session.completed` at `backend/lambdas/stripe-webhook/lambda_function.py:305-311`
- All other event types:
  - return `200` with `ignored_event_type`
  - file reference: `backend/lambdas/stripe-webhook/lambda_function.py:305-309`

Relevant code:

`backend/lambdas/stripe-webhook/lambda_function.py:303-309`
```python
        event_type = webhook_event["type"]

        if event_type != "checkout.session.completed":
            return response(200, {
                "received": True,
                "ignored_event_type": event_type
            })
```

### 2.4 What action each event triggers

- `checkout.session.completed`
  - extracts `client_reference_id`, `customer`, `subscription`, and metadata at `backend/lambdas/stripe-webhook/lambda_function.py:313-330`
  - loads the lead from `presttige-db` at `backend/lambdas/stripe-webhook/lambda_function.py:337-339`
  - updates payment and tier fields in DynamoDB at `backend/lambdas/stripe-webhook/lambda_function.py:380-428`
  - invokes `presttige-send-welcome-email`
    - `RequestResponse` for testers at `backend/lambdas/stripe-webhook/lambda_function.py:430-436`
    - async `Event` for non-testers at `backend/lambdas/stripe-webhook/lambda_function.py:437-438`
- Any non-`checkout.session.completed` event
  - no DB writes
  - no email trigger
  - returns `200` ignored

### 2.5 Idempotency handling

- None found.
- The active webhook never reads `event.id`, never writes a processed-events record, and never conditionally rejects a duplicate webhook.
- Result: Stripe retries can repeat the same DB update and welcome-email invocation path.

### 2.6 What happens on signature verification failure

- Returns `400`
- Body:
  - `error = "signature_verification_failed"`
  - `message = str(e)`
- File reference: `backend/lambdas/stripe-webhook/lambda_function.py:450-454`

### 2.7 What happens on unrecognized event type

- Returns `200`
- Body:
  - `received = true`
  - `ignored_event_type = <event.type>`
- File reference: `backend/lambdas/stripe-webhook/lambda_function.py:305-309`

### 2.8 Whether the handler returns 200 quickly or processes synchronously

- It processes synchronously before returning `200`.
- The `checkout.session.completed` path:
  - verifies signature
  - reads the lead
  - updates DynamoDB
  - invokes `presttige-send-welcome-email`
- The tester path is slower because it waits for `InvocationType="RequestResponse"` at `backend/lambdas/stripe-webhook/lambda_function.py:430-432`.

## Section 3 — Frontend Stripe usage

### 3.1 Which pages/components use Stripe

- Current customer-facing paid signup page:
  - `tier-select.html`
- Direct frontend Stripe SDK usage found:
  - none
- Search results found **no** occurrences of:
  - `@stripe/stripe-js`
  - `@stripe/react-stripe-js`
  - `loadStripe(`
  - `PaymentElement`
  - `CardElement`
  - `stripe.confirmPayment`
  - `stripe.confirmCardPayment`

### 3.2 Publishable key source

- None found in the frontend codebase.
- There is no publishable-key config path in the current customer-facing frontend because the frontend never initializes Stripe.js.

### 3.3 Whether the current flow uses Stripe Checkout or embedded Elements

- Current flow uses **hosted Stripe Checkout**.
- Evidence:
  - `tier-select.html` posts to `/create-checkout-session`
  - the Lambda returns `redirect_url`
  - the browser performs `window.location.assign(data.redirect_url)`
  - `backend/create-checkout-session/index.js` returns `session.url` from Stripe Checkout

Relevant code:

`tier-select.html:921-941`
```js
          const response = await fetch(`${API_BASE}/create-checkout-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token: route.token,
              tier,
            }),
          });
          const data = await response.json();
          if (!data.redirect_url) {
```

### 3.4 The full user journey for paid signup

1. `presttige-account-create` initializes the membership token for an approved lead.
   - `backend/account-create/index.js:57-85`
   - writes `magic_token`, `magic_token_status=active`, `magic_token_expires_at`, and `payment_status=pending`
2. `presttige-send-tier-select-email` emails the candidate a `/tier-select/{magic_token}` link.
   - `backend/send-tier-select-email/index.js:56-67`
3. `tier-select.html` loads and fetches `GET /tier-select-fetch?token=...`.
   - `tier-select.html:738-757`
4. Clicking a paid CTA posts `POST /create-checkout-session` with `{token, tier}`.
   - `tier-select.html:916-941`
5. `presttige-create-checkout-session` validates the token, reads a Stripe price ID from SSM, creates a hosted Checkout Session, stores lead-side Stripe fields, and returns `redirect_url = session.url`.
   - `backend/create-checkout-session/index.js:102-218`
6. The browser redirects to Stripe-hosted checkout (`session.url`).
7. On success, Stripe redirects the browser to `/welcome/{token}?session_id={CHECKOUT_SESSION_ID}`.
   - `backend/create-checkout-session/index.js:142`
8. Separately, Stripe sends `checkout.session.completed` to `presttige-stripe-webhook`, which marks the lead as paid and invokes `presttige-send-welcome-email`.
   - `backend/lambdas/stripe-webhook/lambda_function.py:380-448`
9. On the welcome flow, `presttige-magic-link-verify` flips `magic_token_status` to `used` and `account_active=true` on first valid activation.
   - `backend/magic-link-verify/index.js:69-97`

## Section 4 — Data model

### 4.1 What tables exist for Stripe data

- Active Stripe code writes to a single DynamoDB table:
  - `presttige-db`
- No RDS tables or separate payment tables were found in the active Stripe code paths.

### 4.2 Schema of each

#### Active lead/member record pattern

- Primary key used by active Stripe flows:
  - `lead_id`
  - file references:
    - `backend/create-checkout-session/index.js:177-178`
    - `backend/lambdas/stripe-webhook/lambda_function.py:381`
    - `backend/account-create/index.js:39`
- Secondary lookups:
  - `magic_token` is looked up by full table `Scan`, not by key or GSI
  - file references:
    - `backend/create-checkout-session/index.js:49-70`
    - `backend/tier-select-fetch/index.js:84-105`
    - `backend/magic-link-verify/index.js:8-29`
- No `IndexName` references were found in the active Stripe-related code. No GSI usage is visible from the code path.

#### Stripe-related attributes on active lead records

Observed writes in current active code:

- `payment_status`
- `selected_tier`
- `selected_tier_billing`
- `selected_price_id`
- `stripe_session_id`
- `stripe_customer_id`
- `stripe_checkout_mode`
- `stripe_checkout_started_at`
- `stripe_checkout_completed`
- `stripe_event_type`
- `amount_paid`
- `currency`
- `founding_rate_locked`
- `founding_rate_expires_at`
- `upgrade_eligible_until`
- legacy compatibility fields:
  - `product`
  - `plan`
  - `term`

Relevant code:

`backend/create-checkout-session/index.js:179-193`
```js
          SET selected_tier = :tier,
              selected_tier_billing = :billing,
              stripe_session_id = :session_id,
              payment_status = :payment_status,
              founding_rate_locked = :founding_rate_locked,
              founding_rate_expires_at = :founding_rate_expires_at,
              upgrade_eligible_until = :upgrade_eligible_until,
              stripe_checkout_mode = :stripe_checkout_mode,
              selected_tier_selected_at = :selected_at,
```

`backend/lambdas/stripe-webhook/lambda_function.py:383-401`
```python
                SET payment_status = :paid,
                    access_status = :active,
                    stripe_checkout_completed = :true,
                    stripe_session_id = :stripe_session_id,
                    stripe_customer_id = :customer_id,
                    #product = :product,
                    #plan = :plan,
                    #term = :term,
                    selected_tier = :selected_tier,
                    selected_tier_billing = :selected_tier_billing,
```

#### Legacy/parallel entity pattern

- `backend/stripe/webhook.py:142-156` writes partner-earning records with `pk` / `sk` into the same `presttige-db` table.
- This indicates the table is heterogeneous and contains more than lead/member rows.
- Deployment status of that code path is **UNCLEAR — needs Antonio confirmation**.

### 4.3 Foreign key relationships to user/lead tables

- Stripe → lead relationship is `client_reference_id = lead_id`
  - `backend/create-checkout-session/index.js:144`
  - `backend/lambdas/stripe-webhook/lambda_function.py:313`
- Stripe metadata also duplicates `lead_id`
  - `backend/create-checkout-session/index.js:145`
- `magic_token` ties the tier-select page and welcome page back to the same lead record.

### 4.4 Where `stripe_customer_id`, `stripe_subscription_id`, `stripe_payment_intent_id` are stored

- `stripe_customer_id`
  - active webhook stores it on the lead record
  - `backend/lambdas/stripe-webhook/lambda_function.py:387, 413`
- `stripe_subscription_id`
  - legacy webhook module stores it on the lead record
    - `backend/stripe/webhook.py:117, 133`
  - current active webhook reads `subscription` from the session at `backend/lambdas/stripe-webhook/lambda_function.py:314` but then **removes** `stripe_subscription_id` in the update expression at `backend/lambdas/stripe-webhook/lambda_function.py:401`
- `stripe_payment_intent_id`
  - not found anywhere in the repo search

## Section 5 — SSM parameters (read names only, NOT values)

Name-only audit note:

- The parameter names under `/presttige/stripe/` are **mode-agnostic**.
- Based on names alone, none are explicitly marked `test` or `live`.
- This is itself a naming inconsistency because the repo and AWS runtime need to distinguish environments operationally, but the SSM path names do not.

### Test mode parameters

- None explicitly identifiable by **name** as test-mode.

### Live mode parameters

- None explicitly identifiable by **name** as live-mode.

### Webhook secrets

- No webhook-secret parameter exists under `/presttige/stripe/` in the current name-only audit.
- Specifically, neither of these names exists in the current path inventory:
  - `/presttige/stripe/webhook-secret`
  - `/presttige/stripe/webhook-secret-live`

### Other

- `/presttige/stripe/club-y1-price-id`
- `/presttige/stripe/patron-lifetime-price-id`
- `/presttige/stripe/patron/annual_price_id`
- `/presttige/stripe/patron/monthly_price_id`
- `/presttige/stripe/patron/product_id`
- `/presttige/stripe/premier-y1-price-id`
- `/presttige/stripe/tier2/annual_price_id`
- `/presttige/stripe/tier2/monthly_price_id`
- `/presttige/stripe/tier2/product_id`
- `/presttige/stripe/tier3/annual_price_id`
- `/presttige/stripe/tier3/monthly_price_id`
- `/presttige/stripe/tier3/product_id`

Naming inconsistencies:

- mixed flat hyphenated names:
  - `club-y1-price-id`
  - `premier-y1-price-id`
  - `patron-lifetime-price-id`
- mixed nested legacy names:
  - `tier2/*`
  - `tier3/*`
  - `patron/*`
- no parallel flat names exist for:
  - `club-monthly-price-id`
  - `club-yearly-price-id`
  - `premier-monthly-price-id`
  - `premier-yearly-price-id`

## Section 6 — Identified bugs and concerns

### F1 — Public legacy gateway can still create subscription-mode Checkout Sessions that the active webhook does not reconcile correctly

- Severity: P0
- Files:
  - `backend/lambdas/gateway/lambda_function.py:135-162`
  - `backend/lambdas/stripe-webhook/lambda_function.py:314-327`
  - `backend/lambdas/stripe-webhook/lambda_function.py:380-401`
- Explanation:
  - `presttige-gateway` still creates `mode = "subscription"` sessions for `product == "membership"`, using legacy `plan` / `term` metadata.
  - The active webhook only understands `checkout.session.completed` and derives the new tier model from `metadata.tier` / `metadata.billing`.
  - For a legacy subscription session, the active webhook will read `subscription_id` but remove `stripe_subscription_id`, and it will not populate `selected_tier` / `selected_tier_billing` correctly because the metadata keys do not match.
- Suggested fix direction:
  - Disable or remove `/gateway` from public use before B3, or fully align it to the current tier metadata contract and event model.

### F2 — The active webhook ignores every Stripe lifecycle event except `checkout.session.completed`

- Severity: P0
- Files:
  - `backend/lambdas/stripe-webhook/lambda_function.py:303-309`
  - `backend/lambdas/gateway/lambda_function.py:137`
- Explanation:
  - The public legacy gateway still creates subscription-mode sessions, but the active webhook ignores subscription and invoice lifecycle events entirely.
  - This means renewals, cancellations, subscription updates, and failed recurring payments have no active handling path in the current production webhook.
- Suggested fix direction:
  - Either remove all subscription-mode checkout paths before live go-live, or implement a full recurring-billing event matrix with tested handlers.

### F3 — No webhook idempotency or deduplication exists

- Severity: P1
- Files:
  - `backend/lambdas/stripe-webhook/lambda_function.py:303-448`
- Explanation:
  - The active webhook never checks `event.id`, never writes a processed-events record, and never conditionally rejects duplicate delivery.
  - Stripe retries can repeat the same lead update and welcome-email invocation path.
- Suggested fix direction:
  - Add a processed-event store keyed by `event.id` with a conditional first-write before mutating the lead.

### F4 — `presttige-create-checkout-session` creates hosted sessions without an idempotency key

- Severity: P1
- Files:
  - `backend/create-checkout-session/index.js:137-164`
  - `tier-select.html:916-941`
- Explanation:
  - The frontend can submit the checkout request more than once, and the backend makes a raw REST call to Stripe without an `Idempotency-Key` header.
  - Duplicate clicks or retries can create multiple Checkout Sessions for the same lead.
- Suggested fix direction:
  - Use the official Stripe SDK or at minimum send a deterministic idempotency key per `lead_id + tier + checkout_attempt`.

### F5 — Stripe secret management is split across incompatible sources

- Severity: P1
- Files:
  - `backend/create-checkout-session/index.js:29-46`
  - `backend/lambdas/stripe-webhook/lambda_function.py:43-45`
  - `docs/STRIPE-REBRAND.md:30-35`
- Explanation:
  - `presttige-create-checkout-session` expects a Secrets Manager secret named `presttige-stripe-secret` and silently falls back to env `STRIPE_SECRET_KEY`.
  - The active webhook uses env vars only.
  - The repo docs point to env-var updates rather than the secret path.
- Suggested fix direction:
  - Pick one credential source of truth for all active Stripe Lambdas and remove silent fallback behavior.

### F6 — Paid-flow token lookups use full table scans on `presttige-db`

- Severity: P1
- Files:
  - `backend/create-checkout-session/index.js:49-70`
  - `backend/tier-select-fetch/index.js:84-105`
  - `backend/magic-link-verify/index.js:8-29`
- Explanation:
  - All three paid-flow entry points scan the full table to find `magic_token`.
  - This is a scaling and latency risk on every tier-select load, checkout initiation, and welcome activation.
- Suggested fix direction:
  - Add a dedicated GSI on `magic_token` or a separate token lookup table.

### F7 — The gateway token model is deterministic and reusable

- Severity: P1
- Files:
  - `backend/lambdas/gateway/lambda_function.py:60-66`
  - `backend/lambdas/gateway/lambda_function.py:95-100`
  - AWS route inventory: `ANY /gateway` is publicly exposed
- Explanation:
  - The legacy gateway token is `HMAC(lead_id)` with no expiry and no one-time-use state.
  - If a legacy link leaks, the token can be reused indefinitely as long as the `lead_id` remains valid.
- Suggested fix direction:
  - Remove the legacy route from public access, or move it to the current `magic_token` model with TTL and state checks.

### F8 — Current account creation marks leads `payment_status=pending` before checkout exists and attaches a 7-day token TTL

- Severity: P1
- Files:
  - `backend/account-create/index.js:64-84`
  - `backend/magic-link-verify/index.js:57-67`
  - `backend/send-tier-select-email/index.js:66`
- Explanation:
  - A lead becomes `payment_status=pending` as soon as the tier-select token is created, before any Stripe session exists.
  - The token emailed to the candidate is explicitly described as expiring in 7 days.
  - Abandoned or delayed payments can therefore look “in progress” while the activation token ages out.
- Suggested fix direction:
  - Split “not started” from “checkout started,” and revisit whether the checkout token TTL should be enforced at all.

### F9 — Repo contains a second webhook implementation with a conflicting schema and behavior

- Severity: P2
- Files:
  - `backend/stripe/webhook.py:79-168`
  - `backend/lambdas/stripe-webhook/lambda_function.py:303-448`
- Explanation:
  - `backend/stripe/webhook.py` stores `stripe_subscription_id` and partner-earning items (`pk` / `sk`) into `presttige-db`.
  - The active webhook uses a different update expression, a different field contract, and does not maintain `stripe_subscription_id`.
  - This looks like a partial migration that was never fully removed.
- Suggested fix direction:
  - Confirm whether `backend/stripe/webhook.py` is still deployed anywhere. If not, archive or delete it after documenting the migration boundary.

### F10 — No frontend publishable-key path or Stripe.js integration exists

- Severity: P2
- Files:
  - `tier-select.html:916-941`
  - repo-wide search: no `loadStripe`, `PaymentElement`, `CardElement`, `confirmPayment`, or `confirmCardPayment`
- Explanation:
  - The current frontend has no Stripe.js integration at all. It can only redirect to hosted Checkout.
  - This is not a bug in the existing hosted flow, but it means B5 cannot be layered on without new frontend architecture.
- Suggested fix direction:
  - Treat embedded checkout as a new implementation, not an incremental toggle.

## Section 7 — Pre-B3 readiness assessment

**Recommendation: REBUILD**

The current Stripe integration is not solid enough to add LIVE products on top safely. The repo contains two overlapping payment architectures: the current `tier-select -> create-checkout-session` path for one-time hosted Checkout, and a still-public legacy `/gateway` path that creates subscriptions with a metadata contract the active webhook no longer understands. The active webhook only handles `checkout.session.completed`, has no idempotency, and removes `stripe_subscription_id`, which makes the recurring half of B3 (monthly/yearly products per Matriz Chapter 3–4) unsafe to launch. The cleanest path is a B5-style rewrite that unifies checkout creation, webhook handling, Stripe field storage, and environment/secret management before any LIVE product rollout.
