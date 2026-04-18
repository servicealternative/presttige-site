# Presttige System Map

## 1. Current repository role

This repository currently functions mainly as the static frontend and deployment layer of Presttige.

What is present here:
- Static HTML pages at the repository root
- Shared frontend assets under `assets/`
- A small shared JavaScript file at `assets/js/app.js`
- Legal and informational site pages

What is not present here:
- The full backend source of truth
- Lambda source folders
- Infrastructure-as-code
- Stripe webhook source
- SES backend source or templates
- DynamoDB data access code
- Internal review handlers

Based on the repository contents, this is not yet a full-stack production source repository. It is primarily the frontend surface that connects to already deployed AWS backend endpoints.

## 2. Active production pages

The following pages appear to be the currently active or likely active production pages.

### `index.html`
- Current role in the system: Main landing page and entry point for the access request flow
- Status: active
- Notes:
  - Contains the frontend submission for the first funnel step
  - Sends a request to the `create-lead` backend endpoint
  - Redirects the user to `check-email.html`

### `check-email.html`
- Current role in the system: Interim page shown after lead creation, instructing the user to check email
- Status: active
- Notes:
  - Reads the submitted email from query parameters
  - Appears directly connected to the current request-access flow

### `verify-email.html`
- Current role in the system: Email verification page that forwards the browser to the backend verification endpoint
- Status: active
- Notes:
  - Reads `token` from the query string
  - Redirects the browser directly to a deployed backend endpoint
  - The page comments indicate the backend then redirects to `access-form.html`

### `access-form.html`
- Current role in the system: Application form for the second step of the private access funnel
- Status: active
- Notes:
  - Reads `lead_id` from the query string
  - Posts application details to the `submit-access` backend endpoint
  - Redirects to `thank-you.html` on success

### `thank-you.html`
- Current role in the system: Confirmation page shown after successful access-form submission
- Status: active
- Notes:
  - Appears to be the success page for the current access application flow

### `confirm.html`
- Current role in the system: Founder payment confirmation page
- Status: likely active
- Notes:
  - Displays name and email from query parameters
  - Sends the user to a deployed Lambda Function URL for the payment continuation flow
  - Appears production-ready and connected to a live backend URL

### `cancel.html`
- Current role in the system: Payment cancellation page for the founder/payment flow
- Status: likely active
- Notes:
  - Provides a way back to the site
  - Includes a "Try Again" link pointing to the same deployed Lambda Function URL family used by `confirm.html`

## 3. Legacy / partial / unclear pages

The following pages appear legacy, partial, duplicated, incomplete, or operationally unclear.

### `apply.html`
- Reason it appears legacy or partial:
  - Uses an embedded Tally form in an iframe
  - Does not match the current direct `create-lead -> check-email -> verify-email -> access-form` flow
  - Suggests an earlier or alternate implementation of the application flow

### `access.html`
- Reason it appears legacy or partial:
  - Immediately redirects to a Tally URL using a meta refresh
  - This is inconsistent with the current in-repo access flow based on `index.html`, `check-email.html`, `verify-email.html`, and `access-form.html`
  - Likely a previous access entry point kept in the repo

### `pricing.html`
- Reason it appears legacy or partial:
  - Contains frontend payment/access selection logic
  - Uses the placeholder `https://YOUR_API_GATEWAY_URL`
  - Duplicates product-selection behavior that also exists in `assets/js/app.js`
  - Does not appear wired to the current production endpoint configuration

### `member.html`
- Reason it appears legacy or partial:
  - Uses the placeholder `https://YOUR_API_GATEWAY_URL`
  - Appears to be an unfinished or old member validation page
  - Does not match the production endpoint configuration used elsewhere in the repo

### `founders.html`
- Reason it appears unclear:
  - Appears to be a substantial standalone marketing or offer page for founding members
  - No direct production endpoint usage was observed in the scanned portions
  - It may be a valid public marketing page, but its operational role in the current main funnel is not clear from this repository alone

## 4. Current observed frontend funnel

The currently observed frontend flow, based on repository contents, is:

1. Landing / Request Access
- The user lands on `index.html`
- The main page includes a request-access form/modal flow
- The form collects name, email, country, application type, source, and campaign information

2. `create-lead` submission
- `index.html` sends a `POST` request to:
  - `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/prod/create-lead`
- The payload contains a `data.fields` array with keys such as:
  - `name`
  - `email`
  - `country`
  - `application_type`
  - `source`
  - `campaign_id`

3. `check-email`
- On success, `index.html` redirects the browser to:
  - `https://presttige.net/check-email.html?email=...`
- `check-email.html` displays the email address and instructs the user to confirm the email

4. `verify-email`
- The user receives a verification link and lands on `verify-email.html?token=...`
- `verify-email.html` reads the token and redirects the browser to:
  - `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/prod/verify-email?token=...`
- The inline comment indicates the backend then redirects to `access-form.html?lead_id=...`

5. `access-form`
- `access-form.html` loads with a `lead_id` in the query string
- It validates the `lead_id` format client-side
- The page collects the second-stage application fields:
  - phone
  - age
  - city
  - instagram
  - linkedin
  - occupation
  - company
  - website
  - tiktok
  - bio
  - why

6. `submit-access`
- `access-form.html` sends a `POST` request to:
  - `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/prod/submit-access`
- The payload includes `lead_id` and the submitted application details

7. `thank-you`
- On success, `access-form.html` redirects to:
  - `https://presttige.net/thank-you.html`
- `thank-you.html` serves as the application received / submission complete page

8. Internal review flow
- No source code for the internal review step exists in this repository
- Based on the known system description and the frontend flow, the likely backend behavior is:
  - the completed application triggers an internal review email
  - the review email contains approve / reject / standby actions
- This flow is not directly implemented in the repository as source code, so it can only be inferred from system behavior and the known architecture description

## 5. Observed backend endpoints referenced in frontend

The following real backend URLs are referenced in the frontend files.

### `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/prod/create-lead`
- File where it appears: `index.html`
- What it appears to do:
  - Receives the first-stage access request submission
  - Creates or registers a lead record
  - Starts the email verification process
- Backend type: API Gateway

### `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/prod/verify-email`
- File where it appears: `verify-email.html`
- What it appears to do:
  - Verifies the email token
  - Redirects the user into the next funnel step
- Backend type: API Gateway

### `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/prod/submit-access`
- File where it appears: `access-form.html`
- What it appears to do:
  - Receives the second-stage application form
  - Likely stores the full application and triggers internal review
- Backend type: API Gateway

### `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/gateway`
- File where it appears: `assets/js/app.js`
- What it appears to do:
  - Appears to initiate checkout or product gateway behavior for founder/access/membership flows
- Backend type: API Gateway

### `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/validate`
- File where it appears: `assets/js/app.js`
- What it appears to do:
  - Validates stored member token and lead information
- Backend type: API Gateway

### `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/member`
- File where it appears: `assets/js/app.js`
- What it appears to do:
  - Declared as a member-related endpoint, though no active call path was observed in the scanned file
- Backend type: API Gateway

### `https://mir2fwbwicxfqfed32425zx4he0bmguu.lambda-url.us-east-1.on.aws/`
- File where it appears: `confirm.html`
- What it appears to do:
  - Receives founder payment continuation requests with `name` and `email` query parameters
  - Appears to start or continue a payment/checkout flow
- Backend type: Lambda Function URL

### `https://mir2fwbwicxfqfed32425zx4he0bmguu.lambda-url.us-east-1.on.aws/`
- File where it appears: `cancel.html`
- What it appears to do:
  - Provides a retry entry point after payment cancellation
  - Likely reconnects the user to the founder payment flow
- Backend type: Lambda Function URL

## 6. Shared frontend assets and logic

### `assets/js/app.js`
- This is the main shared JavaScript file currently present in the repository
- It defines:
  - a shared API base
  - checkout helper functions
  - token and lead-id query parsing
  - localStorage handling for member access
  - member validation logic

### Logic centralization
- Frontend logic is only partially centralized
- Some logic exists in `assets/js/app.js`
- A large amount of important logic still lives inline inside individual HTML files, including:
  - `index.html`
  - `verify-email.html`
  - `access-form.html`
  - `confirm.html`

### Config centralization
- Config is not centralized cleanly
- Production URLs are duplicated directly across multiple files
- Analytics and endpoint configuration are embedded inline in page files
- There is no shared environment/config management layer visible in the repository

### Multiple generations of flow logic
- Yes, multiple generations or parallel versions of flow logic appear to exist
- Evidence includes:
  - Tally-based pages (`apply.html`, `access.html`)
  - placeholder API pages (`pricing.html`, `member.html`)
  - shared gateway logic in `assets/js/app.js`
  - current direct production funnel logic embedded inline in `index.html`, `verify-email.html`, and `access-form.html`

## 7. Missing backend source from repository

The following production-critical areas are not currently present in the repository as source code.

### Backend application source
- Lambda source folders
- Shared backend utility modules
- Request validation code on the backend side
- Backend routing structure

### Data layer
- DynamoDB access layer
- Data model definitions
- Table configuration or migration definition

### Email layer
- SES email backend source
- SES template source files
- Internal review email generation source
- Verification email generation source

### Payments
- Stripe checkout backend source
- Stripe webhook handlers
- Stripe event processing logic
- Payment reconciliation or idempotency handling

### Review and decision flow
- Internal review handlers
- Approve / reject / standby action handlers
- Admin or moderation backend source

### Infrastructure and operations
- Infrastructure-as-code
- Deployment definitions for backend services
- Environment/config management
- Secrets management definitions
- Monitoring/alerting definitions

### Quality and safety
- Automated tests
- Backend contract tests
- End-to-end funnel tests
- Staging environment definitions in-repo

## 8. Production safety boundary

The following files should currently be treated as do-not-touch until they are fully mapped and can be safely replaced.

### Active production pages
- `index.html`
- `check-email.html`
- `verify-email.html`
- `access-form.html`
- `thank-you.html`
- `confirm.html`
- `cancel.html`

### Files with hardcoded production endpoints
- `index.html`
- `verify-email.html`
- `access-form.html`
- `confirm.html`
- `cancel.html`
- `assets/js/app.js`

### Files directly tied to the current live funnel
- `index.html`
- `check-email.html`
- `verify-email.html`
- `access-form.html`
- `thank-you.html`

### Why these files are inside the safety boundary
- They are directly connected to live AWS backend URLs
- They represent the currently functioning user path
- They may depend on backend behavior that is not yet present in this repository
- Changing them before the system is fully mapped would create unnecessary production risk

## 9. Immediate follow-up docs

The next documentation files that should be created are:
- `docs/production-vs-legacy.md`
- `docs/target-structure.md`

These should be used to:
- separate live production pages from old or partial pages
- define the intended future repository structure before any structural migration begins
