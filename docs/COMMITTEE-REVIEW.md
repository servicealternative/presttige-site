# Presttige Committee Review Flow

## Overview

Round B3 closes the application loop for committee review:

1. `presttige-submit-access` persists the Step 2 profile and asynchronously invokes `presttige-send-committee-email`.
2. If the profile is already submitted but photos are not ready yet, `presttige-send-committee-email` returns `425 Photos not ready`.
3. `presttige-thumbnail-generator` updates `photo_uploads` to `ready` and, once at least two photos are ready, can invoke `presttige-send-committee-email` as a fallback trigger.
4. `presttige-send-committee-email` generates a review token, signs thumbnail URLs, sends the committee email, and stores:
   - `e2_sent_at`
   - `review_attempt_id`
   - `review_token`
   - `review_token_status=active`
5. The committee opens `https://presttige.net/review/{token}`.
6. `review.html` calls `GET /review-fetch?token=...` to render the profile and signed thumbnails.
7. The committee submits `POST /review-action` with `approve`, `reject`, or `standby`, plus an optional note.
8. `presttige-review-action` writes an audit row and updates the lead state atomically.

## Components

### Lambdas

- `presttige-send-committee-email`
- `presttige-review-fetch`
- `presttige-review-action` (extended)
- `presttige-submit-access` (extended)
- `presttige-thumbnail-generator` (extended fallback trigger)

### Static review page

- `review.html`
- Amplify live rewrite rule:
  - `/review/<*> -> /review.html` (`200`)

### API routes

- `POST /send-committee-email`
- `GET /review-fetch`
- `POST /review-action`
- Existing legacy route kept:
  - `GET /review`

## Token model

- Secret source: Secrets Manager secret `presttige-review-token-secret`
- Formula:
  - `HMAC-SHA256(lead_id + "|" + review_attempt_id, secret)`
- Stored on the lead item:
  - `review_token`
  - `review_attempt_id`
  - `review_token_status`
- No expiry is enforced.
- First successful review action flips `review_token_status` to `used`.
- Reuse returns `410 Gone`.

## Single-use enforcement

`presttige-review-action` now uses a DynamoDB transaction:

1. `Put` append-only audit row into `presttige-review-audit`
2. `Update` the lead in `presttige-db` with condition:
   - `review_token_status = active`

This guarantees:

- no state mutation if the audit write fails
- no second successful review with the same token
- no mutation after a consumed token

## Audit table schema

Each committee action writes one immutable row to `presttige-review-audit` with:

- `audit_id`
- `lead_id`
- `timestamp`
- `decision`
- `action`
- `note`
- `reviewer_id`
- `token_used`
- `review_attempt_id`
- `source_ip`
- `user_agent`
- `metadata`
- `previous_state`
- `new_state`
- `is_test`

## Signed URL strategy

Committee email thumbnails and review-page thumbnails use CloudFront URLs signed with:

- CloudFront public key id: `KAEPT89GNYTHK`
- CloudFront key group id: `358cdc9f-44fb-4a2b-9cc2-ee2dc0bc581a`
- Private key secret: `presttige-cloudfront-signing-key`

The distribution remains publicly readable by default for the existing applicant-side photo flow. B3 generates signed URLs for committee-facing contexts without changing the default cache behavior.

## Email sending behavior

- Sender Lambda reads the lead by `lead_id`
- Requires at least 2 ready photos
- Uses 400px thumbnail variants in the email
- Sends to `committee@presttige.net`
- Stores send metadata only after SES send succeeds

## Review UI behavior

`review.html`:

- parses the token from `window.location.pathname`
- reads optional `?action=approve|reject|standby`
- fetches profile + signed thumbnails from `review-fetch`
- submits the final decision and note to `review-action`
- shows used-token and recorded-decision states inline

## Smoke-test result

Live smoke test validated:

- 2 photo uploads
- thumbnail generation
- committee email send Lambda
- token fetch
- signed thumbnail URLs returned
- approve action recorded
- second approve attempt rejected with `410`
- exactly 1 audit row written
