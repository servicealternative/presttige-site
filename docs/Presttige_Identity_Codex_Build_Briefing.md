# Presttige Identity, Codex Build Briefing

**Audience: Codex.** Operational reference for building Presttige member identity. This is the technical contract: infrastructure facts, fixed rules, and boundaries. Build order and per-step scope come from Antonio's individual Codex orders, which reference this document. Do NOT build the whole system at once; execute one ordered step at a time and report.

Companion: `Presttige_Identity_Architecture.md` (Antonio's decision-level architecture, the "what and why"). This briefing is the "how and within which limits".

---

## 0. Operating rules (always)

- English only, in code, comments, and reports.
- No em dashes anywhere; use commas.
- Every Codex order ends by playing the completion sound: `afplay /System/Library/Sounds/Glass.aiff`.
- Follow the Testing Doctrine: never create test records on the fly; use only `fq@freequenza.net`, `antoniompereira@me.com`, `alternativeservice@gmail.com`, or `codex.subscriber.tester@presttige.net`. No test record (`synthetic_test=true`) ever appears in any metric, count, dashboard, or analytic. Never contact a real member in a test.
- Build for 1 to 10 million from the start. No quick-start wizards, no throwaway setups for foundational pieces (auth, DB). Foundational, deterministic, scalable.
- Do not change payment amounts, Stripe charge logic, or webhooks unless an order explicitly scopes it. Verify the existing funnels still work after any identity change.
- Report after each step: exact files, what was applied, verification, deploy details (CodeSha256 / task def / Amplify job), commit hash, and blockers.

---

## 1. Confirmed infrastructure (do not re-derive, this is the current state)

AWS account `343218208384`, region `us-east-1`.

**Cognito (exists):**
- User Pool `ulttra-internal`, id `us-east-1_s5PvTEeHv`. Sign-in email, MFA ON, password policy 14+ chars with all classes, email verification, hosted domain `ulttra-internal`, group `Admins`. App clients: `ulttra-crm-directus-oidc`, `presttige-admin-spa`. This pool is for the Ulttra CRM. DO NOT repurpose it for members. DO NOT relax its MFA.

**Ulttra CRM (Directus):**
- ECS service `ulttra-crm-directus`, RDS PostgreSQL `ulttra-crm-directus-postgres` (db `directus`). Auth via Cognito OIDC providers `chairman` and `technical` (both backed by the internal pool). This is the internal world; leave its auth intact.

**Members data:**
- DynamoDB `presttige-db`, primary key `lead_id`. GSIs: `email-index`, `phone-index`, `checkout-token-index`, `cognito_sub-index`. ~42 items.
- Identity-relevant fields present: `lead_id`, `email`, `name`, `phone_full`, `email_status`, `profile_status`, `review_status`, `payment_status`, `subscriber_type`, `selected_tier`, `effective_tier`, `tier`, `test_tier`, `founder_eligible`, `founder_gate_status`, `founder_token_status`, `magic_token`, `checkout_token`, `review_token`, `synthetic_test`, `account_active`.
- NO record currently has `password`, `password_hash`, `cognito_sub`, `external_id`, `auth_provider`, or `identity_provider`. Members have NO login today. Clean start, no migration.
- Identity Step 2 field contract lives in `docs/Presttige_Identity_Data_Model.md` and code constants live in `backend/lib/member-identity-fields.js` and `backend/lib/member_identity_fields.py`.

**Email:** SES production, configuration set `presttige-deliverability-v1`, domain `presttige.net` verified, inbox-confirmed. Senders use friendly From "Presttige <address>". Founder-facing emails are signed "The Founders' House", never the Committee.

**SMS:** NOT ready. SNS SMS shows spend limit 1, no Pinpoint. Member SMS verification needs setup / out-of-sandbox before it can be used.

**API / auth primitives:** API Gateway `presttige-api` (`rwkz3d86u0`) with Cognito JWT authorizer `presttige-admin-cognito` for admin routes. Token primitives are HMAC-SHA256; secrets in Secrets Manager / SSM (`presttige-magic-link-secret`, `presttige-founder-token-secret`, `presttige-review-token-secret`, Stripe secrets).

---

## 2. The model to build (fixed rules)

### 2.1 Separate Cognito pool per project (LOCKED)
Members get a NEW, separate Cognito User Pool, isolated from `ulttra-internal`. Never merge. A person who is both an internal user and a member has two accounts in two pools (may share credentials), by design.

Member pool policy:
- Sign-in: email.
- Members (Club / Premier / Patron / free): email + password + SMS verification. NO authenticator app.
- Founders: TOTP authenticator MANDATORY (label "Presttige, Founder"). Founder is the only tier where TOTP is required.
- The member pool's MFA/policy must NOT affect the internal pool, and vice versa.

### 2.2 Account creation trigger
A member account is created when the person COMPLETES THE CHOICE, by either path:
- Paid path (Club/Premier/Patron/Founder): Stripe payment confirmed via webhook.
- Free path: free subscription chosen and registered (no payment).
Both create a Cognito user in the member pool and link `cognito_sub` onto the `presttige-db` record. Build both paths; the free path is in scope from the start. Add the fields needed (e.g. `cognito_sub`) without breaking existing records.

### 2.3 Activation and success page
After completing the choice, the member sets their password on the SUCCESS page (Option 2). Emails:
- Password set on page → Welcome email.
- Page closed before setting → Activation email with a set-password link, then Welcome after the password is set (2 total).
Welcome is ALWAYS sent once the password is set, by any path. Provide a mechanism the Cockpit can call to manually re-fire activation/welcome to a member who completed the choice but was not auto-triggered.

### 2.4 Approval vs validation (do not conflate)
- Approval happened BEFORE payment (Committee or Founder invitation). Everyone reaching payment is already approved.
- Documentary validation happens AFTER the member enters and completes their profile, and is ALWAYS SILENT (no message, no "pending" notice).
- Until validated, the member ENTERS and SEES their own things but CANNOT ACT (full functions disabled). Locked/disabled items render greyed with NO link to proceed, silently. On validation, they unlock.

### 2.5 Normal-member profile (Club/Premier/Patron/free)
- Photos: 6 required to complete the profile. Two photos come from the original application (seed two of the six). Member chooses one as the face view.
- Photos can be substituted one-for-one at any time, NEVER removed (always 6).
- Member completes profile and interests.
- Editable: profile + interests. Locked: email + photos + the original approval base. Implement the editable/locked rule IN CODE (not a config table for now); it is NOT finalised yet, so structure it so it can be refined during testing, but do not over-build a config UI.

### 2.6 Founder profile (distinct flow, NOT the normal flow)
- Photos: minimum 1, rest optional up to 6 (member's choice).
- TOTP authenticator MANDATORY.
- Silent validation applies (enters, sees, cannot act until validated). NO real-time video validation (dropped).
- Founder gets a MUCH larger interests questionnaire (e.g. travel cities, food, events, favourite artists, more) whose purpose is to build the Premium Concierge profile. The exact questions will be provided later; structure the model to hold a richer Founder questionnaire, but do not invent the final questions now.

### 2.7 Member-to-member visibility
Visibility of other members (directory, seeing others) is OFF until official launch. Until then a member sees only their own things. Build with this gate in place.

---

## 3. Hard boundaries (do NOT do)

- Do NOT touch or weaken the `ulttra-internal` pool or the Directus/Ulttra auth.
- Do NOT merge internal and member identities into one pool.
- Do NOT enable member-to-member visibility before official launch.
- Do NOT auto-activate members; validation is silent and gating, not automatic approval.
- Do NOT let a member edit locked fields (email, photos beyond 1:1 substitution, approval base).
- Do NOT create or contact real records in tests; Testing Doctrine governs.
- Do NOT build the entire system in one pass; one ordered step at a time, each verified.
- Do NOT change Stripe amounts/webhooks/charge logic outside an explicit order.

---

## 4. Suggested build order (each step is a separate Antonio order)

1. Create the member Cognito pool (policy per 2.1), isolated, with Founder TOTP path. Resolve SMS out-of-sandbox as its own step so member SMS verification works.
2. Add identity fields to `presttige-db` (e.g. `cognito_sub`) without breaking records.
3. Account creation at the trigger: paid (webhook) and free paths create the Cognito user and link `cognito_sub`.
4. Success page set-password step + the two emails (activation / welcome) + the Cockpit manual re-fire.
5. Authenticated member area: enter, see-only, silent validation gating (greyed/no-link), normal-member 6-photo flow (2 seeded), profile, interests, editable/locked rule in code.
6. Founder flow: min-1 photos, mandatory TOTP, larger questionnaire (questions later), no video.
7. Member-to-member visibility gated to official launch.

Each step: confirm the existing funnels/payment still work, verify with allowed test addresses only, report fully, play the completion sound.

---

*This briefing is the technical contract for the identity build. Decisions live in `Presttige_Identity_Architecture.md`. Steps are issued by Antonio one at a time. Build the foundation first, never the roof.*
