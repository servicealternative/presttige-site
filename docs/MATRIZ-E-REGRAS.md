# PRESTTIGE — MATRIZ & REGRAS

**Source of Truth Document — v0.1**
**Date:** 28 April 2026
**Owner:** Antonio Pereira
**Status:** Draft for review

---

## How to use this document

This is the canonical source of truth for Presttige. When code, designs, communications, or processes contradict this document, **this document wins** — until it is updated through an explicit revision.

- Claude (in any chat) references this document before making decisions
- Codex CLI references this document on every commit; commits that violate locked rules must fail
- Antonio updates this document when business decisions change; the change date is recorded
- All questions of "is this consistent with Presttige?" resolve here

If something is not yet decided, it appears in **Chapter 14 — Open Decisions** with a `TODO` marker. Locked items are marked `LOCKED`. Items under active debate appear in chapter 14 only — never elsewhere.

---

## Versioning

| Version | Date | Author | Change |
|---|---|---|---|
| v0.1 | 28 Apr 2026 | Claude (under Antonio direction) | Initial draft from parking lot + Chats 001-007 |

---

# Chapter 1 — Identity

## 1.1 What Presttige is

Presttige is a **closed, by-application luxury membership network**, headquartered in Dubai, operating globally in USD. Members access a curated network of like-minded individuals, exclusive add-on services (for the highest tier), and the social infrastructure of a private club without the geographic confinement of one.

The full product name is `Presttige` (one word, double-T, capital P-only in body text, all-caps `PRESTTIGE` in display contexts: logo, statement descriptors, stamps).

## 1.2 What Presttige is not

- Presttige is **not** a public consumer subscription. There is no public sign-up form. Every member is approved by committee.
- Presttige is **not** a discount/perks platform. The value is the network and curated add-ons, not coupon books.
- Presttige is **not** a financial product. Membership grants access — not investment, securities, or fund participation.
- Presttige is **not** a dating platform, business directory, or networking app. Those framings cheapen the brand.

## 1.3 Brand soul

The register is *quiet luxury*: black, gold (#8C7040), Cormorant Garamond serif, generous whitespace, no exclamation marks, no emojis, no "premium" used as an adjective. The reader should feel they are reading something written for them by another adult who also values restraint.

If a piece of communication could appear in a discount airline email, it does not belong here.

## 1.4 Founding context (legal vs public)

- **Legal entity:** `MettaLix LLC FZ` (Meydan Free Zone, Dubai, UAE)
- **Trading name (public):** `PRESTTIGE`
- **Stripe public business name:** `PRESTTIGE` (all-caps everywhere — receipts, statement descriptors, customer emails)
- **Stripe legal entity:** `METTALIX LLC FZO` (the registered company, not customer-facing)
- **Statement descriptor:** `PRESTTIGE` (all-caps, max 22 chars, bank-system requirement)
- **Domain:** `presttige.net`
- **Support email:** `info@presttige.net`
- **Support phone:** `+971 58 560 0851`

Customers see `PRESTTIGE`. Tax authorities and banks see `MettaLix LLC FZ`. The split is intentional and permanent.

---

# Chapter 2 — Canonical Rules (R1–R5)

These rules are immutable. Code must enforce them; copy must respect them; designs must reflect them.

## R1 — Committee approval is mandatory for all members

**LOCKED.** Every member — paid or free, including Subscriber tier — passes through committee review before being granted access. There is no public free sign-up form. Subscriber is a post-approval *choice* on `/tier-select`, not an entry path.

**Approval grants access. Payment grants tier privilege.** Approval and payment are independent steps; approval is a precondition for both.

## R2 — Tier names are frozen

**LOCKED.** The four tier names are: `Subscriber`, `Club`, `Premier`, `Patron`. These are not under discussion. Claude does not propose alternatives. Codex does not generate new names.

## R3 — Locked decisions stay locked

**LOCKED.** This document is authoritative. When new code, copy, or designs contradict a locked rule, the contradiction must be flagged before being merged. Re-litigation requires Antonio explicitly opening the decision again.

## R4 — Backfill / resend filters must exclude non-pending review state

**LOCKED.** Any backfill or resend script that touches review-related emails (E2, E2.5, E3) MUST exclude records where `review_status NOT IN ("pending", null, "")`. Approved candidates receive E3 only — never another E2.

This is enforced in shared filter modules:
- `backend/lib/backfill-filters.js`
- `backend/lib/backfill_filters.py`

Three live Lambdas wire to these filters: `presttige-send-application-received`, `presttige-send-committee-email`, `presttige-thumbnail-generator`.

## R5 — Slot counts are internal only

**LOCKED.** The numbers `9,999 (Club)`, `2,222 (Premier)`, `999 (Patron)` are internal capacity targets. They do **not** appear in any public surface: website copy, email content, Stripe Checkout descriptions, marketing materials, social posts, paid ads, partnership decks. Internal documents and analytics may reference them.

A grep audit must return zero matches for these strings on any customer-facing surface.

---

# Chapter 3 — Membership Tiers

The four tiers are listed in ascending order of privilege. All prices are USD globally; charges are settled by Stripe to AED for payouts.

## 3.1 Subscriber — Free, post-approval

| Attribute | Value |
|---|---|
| Price | Free, ongoing |
| Slots | Unlimited (R5) |
| Renewal | None — no expiry |
| Application required | Yes (R1) |
| Stripe product | None (no payment processing) |
| Member directory inclusion | No |
| Member proposal rights | No |
| Founder line | No |
| Tier badge | Yes — `Subscriber` |
| Add-on services | No |
| Communications | "Stay informed" — periodic curated updates |

Subscriber is the post-approval default state for any candidate who does not (yet) commit to paid membership. Subscribers can upgrade to Club, Premier, or Patron at any time at the **full founding rate** during the upgrade window (Chapter 4).

## 3.2 Club — $99/year

| Attribute | Value |
|---|---|
| Price | $99 USD/year |
| Slots | 9,999 (R5) |
| Renewal Y2+ | $9.99/month or $99/year (founding rate locked) |
| Application required | Yes (R1) |
| Stripe product | Club Year-1 ($99 lifetime billing) + Club monthly + Club yearly |
| Member directory inclusion | Yes |
| Member proposal rights | No |
| Founder line | No |
| Tier badge | Yes — `Club` |
| Add-on services | No |
| Communications | Full network communications + curated updates |

## 3.3 Premier — $222/year

| Attribute | Value |
|---|---|
| Price | $222 USD/year |
| Slots | 2,222 (R5) |
| Renewal Y2+ | $33/month or $222/year (founding rate locked) |
| Application required | Yes (R1) |
| Stripe product | Premier Year-1 ($222) + Premier monthly + Premier yearly |
| Member directory inclusion | Yes |
| Member proposal rights | Yes (lower weight than Patron) |
| Founder line | No |
| Tier badge | Yes — `Premier` |
| Add-on services | No |
| Communications | Full network + curated updates |

## 3.4 Patron — $999 lifetime

| Attribute | Value |
|---|---|
| Price | $999 USD, single payment, **true lifetime** |
| Slots | 999 worldwide, ever (R5) |
| Renewal | None — never renews, never expires |
| Application required | Yes (R1) |
| Stripe product | Patron Lifetime ($999 one-time) |
| Member directory inclusion | Yes — with FOUNDER badge |
| Member proposal rights | Yes (greatest weight) |
| Founder line | Yes — direct line to founders |
| Tier badge | Yes — `Patron` + `FOUNDER` stamp |
| Add-on services | Yes — exclusive (full list in 3.5) |
| Voice on direction | Yes — Patrons are consulted on platform direction |
| Patron Card | Coming soon — Apple Wallet + QR, member verification at partners |
| Communications | Full network + add-on offers + founder updates |

## 3.5 Patron exclusive add-on services

Available only to Patron members. Operated through curated partnerships, billed separately by Presttige or partners depending on offer:

- **F1** — paddock access, hospitality, race weekends
- **Sports** — Wimbledon, NBA Finals, Champions League finals, major tennis & golf
- **VIP nightlife** — Dubai, London, New York, Ibiza, Mykonos
- **Private aviation** — empty leg booking, charter rates
- **Yacht charter** — Mediterranean, Caribbean, Indian Ocean
- **Fashion** — Paris/Milan Fashion Week front-row, atelier access
- **Art** — Art Basel (Miami / Hong Kong / Basel) VIP days, gallery introductions
- **Dining** — Michelin-starred reservations, chef's table, private dining
- **Hospitality** — suite upgrades and discreet rates at Bulgari, Aman, Rosewood, Six Senses
- **Wellness** — Lanserhof, SHA, Kamalaya, longevity clinics

The exact partner roster is operational and changes; the Patron benefit is the **standing access and curation**, not any specific brand listed above.

## 3.6 Member proposal rights — explained

Members can propose other candidates for committee review. Each proposal carries weight:

- **Patron** proposals: greatest weight — committee gives strong consideration
- **Premier** proposals: moderate weight — committee considers
- **Club** proposals: not enabled (Club members do not have proposal rights)
- **Subscriber** proposals: not enabled

Proposed candidates still complete the standard application; weight affects committee priority, not approval automaticity.

---

# Chapter 4 — Pricing, Currency & Upgrade Window

## 4.1 Currency

**LOCKED.** All prices are USD globally. Stripe processes USD; payouts settle to AED at the merchant's bank. Customers everywhere see USD prices regardless of geography.

## 4.2 Founding rates

Year-1 pricing for the founding cohort is the price listed in Chapter 3:

- Club $99/year
- Premier $222/year  
- Patron $999 lifetime

These are **founding rates**, locked for any member who joins during the upgrade window. Future cohorts may face higher pricing; founding members keep their entry rate (renewal logic in 4.4).

## 4.3 Upgrade window

**LOCKED.**

| Window opens | Now |
|---|---|
| Window closes | Earlier of: 31 Dec 2026, OR Patron 999 slots filled |

During this window:
- Subscriber → Club: $99 (full founding rate)
- Subscriber → Premier: $222 (full founding rate)
- Subscriber → Patron: $999 (full founding rate)
- Club → Patron: $900 difference, lifetime from upgrade date
- Premier → Patron: $777 difference, lifetime from upgrade date
- Club → Premier: TODO (decide before launch)
- Subscriber → Club/Premier: at founding rate

After the window closes (31 Dec 2026 or 999 Patron slots filled):
- **No more upgrade-to-Patron, ever.** This is structural — Patron is closed forever once the slot count is reached.
- Club ↔ Premier upgrades may continue subject to slot availability
- New Subscribers continue post-approval; their upgrade-to-Patron path is closed

## 4.4 Renewal logic Y2+

For Club and Premier (Patron is lifetime, no renewal):

- Year 1 is prepaid at founding rate ($99 / $222)
- Year 2 onward, the member chooses: monthly billing ($9.99 / $33) or annual billing ($99 / $222)
- The **founding rate is locked for the lifetime of the membership** — even if Presttige raises future cohort prices, the founding member never pays more than the founding rate as long as they remain a member

If a member lapses (cancels, payment fails 3x), they lose the founding rate. Re-joining requires re-application and re-pricing at the then-current rate.

## 4.5 Currency display rules

- All prices on the site display as `$999` or `$999.00` — never `USD 999`, never `$999 USD` (redundant)
- Stripe Checkout shows `$999.00` with the currency code embedded in the page chrome
- Receipts display `USD $999.00` (Stripe default — acceptable)

## 4.6 Refunds

- **Patron:** 14-day refund window from payment, no questions asked. After day 15, refunds are at Antonio's discretion case-by-case.
- **Club / Premier:** 14-day refund window. After day 15, no refunds; member retains access through paid period.
- **Subscriber:** N/A (free).
- All refunds processed in USD via Stripe; FX risk on AED settlement is Presttige's.

---

# Chapter 5 — Member Journey (Funnel States)

The funnel is a 5-step E-mail-driven flow from first contact to active membership. Each candidate has a `lead_id` (format `fdm_<10char>`) that persists across all states.

## 5.1 The 5 funnel stages

| Stage | Trigger | Email sent | Candidate state after |
|---|---|---|---|
| S1 | User submits email + country on landing page | E1 verify | `step_1`, email unverified |
| S2 | User clicks E1 link, completes profile + photos | E2 to committee | `step_2`, application complete |
| S3 | Committee approves on /review | E3 to candidate | `approved`, awaiting tier choice |
| S4 | Candidate selects tier on /tier-select | (Stripe / direct activation) | `tier_selected` |
| S5 | Payment completes (or Subscriber confirms free) | E5 welcome | `active`, member |

## 5.2 Standby and rejection paths

- **Standby:** committee marks `review_status = standby` → no E3 sent → candidate receives standby copy after configurable delay (TODO: copy)
- **Reject:** committee marks `review_status = rejected` → no further communication by default; M1 decision pending (Chapter 14)

## 5.3 Recovery flows (parked, H4)

Two recovery emails proposed but not yet implemented:

- **E0.5** — sent to candidates who completed S1 but not S2 within 72 hours
- **E1.5** — sent to candidates who completed S2 but not S3 within 72 hours

Single-touch only (no escalation). No S1 consent checkbox required.

11 candidates currently stuck in `step_1` from the legacy funnel; H4 backfill ships after E0.5/E1.5 implementation.

## 5.4 The 12 INC-001 candidates (special cohort)

12 candidates were approved between 17–22 April 2026 via a legacy review-action code path that recorded `review_status="approved"` but never created an EventBridge schedule for E3. These candidates are stranded — approved but never notified.

**Plan:** send E3 to all 12 in a single batch after B3 + B4 + B5 ship. They become live load-test data for the new funnel before broader campaign launch.

The 12 lead_ids are in the operational record (parking lot); not enumerated here to keep this document focused on rules over operations.

---

# Chapter 6 — Transactional Emails

All transactional email is sent via Amazon SES from the `presttige.net` domain. Three sender addresses are used by role:

- `committee@presttige.net` — committee-related sends (E1, E2, E3, etc.)
- `office@presttige.net` — operational sends (receipts, scheduling)
- `private@presttige.net` — direct member sends (E5 welcome, founder line)

All emails use the Presttige brand system (Chapter 9) and respect R5 (no slot counts).

## 6.1 Email reference table

| Code | Purpose | From | Trigger | Recipient |
|---|---|---|---|---|
| E1 | Verify email | committee@ | After S1 submit | Candidate |
| E2 | Application for review | committee@ | After S2 complete | Committee |
| E2.5 | Reminder to committee | committee@ | E2 unread after N hours | Committee |
| E3 | Approval — choose your tier | committee@ | After /review approve | Candidate |
| E5 | Welcome — paid member | private@ | After Stripe success | Candidate |
| E5-SUB | Welcome — free Subscriber | private@ | After Subscriber confirm | Candidate |
| E0.5 | Recovery — S1 not verified +72h | committee@ | EventBridge | Candidate |
| E1.5 | Recovery — S2 not done +72h | committee@ | EventBridge | Candidate |
| Standby-7 | Standby comms | committee@ | 7 days post-standby decision | Candidate |
| Standby-14 | Standby comms | committee@ | 14 days post-standby decision | Candidate |
| Reject | TODO — M1 pending | committee@ | Post-reject decision | Candidate |
| Profile-complete | TODO — H1 pending | office@ | Post-payment 2nd review | Member |
| Refund | Refund confirmation | office@ | Post-Stripe refund | Member |
| Renewal | Renewal reminder Y2+ | office@ | 30 days before renewal | Member |
| Receipt | Branded receipt | office@ | Post-payment | Member |

Full copy for each email lives in `Presttige_Transactional_Emails.md` (separate operational document). This Matriz lists structure and policy only.

## 6.2 Email policy rules

- No exclamation marks anywhere
- No emojis
- One CTA per email (button, gold)
- Plain-text alternative shipped for every HTML email
- Footer always includes: physical address, unsubscribe link (where applicable for marketing — never for transactional), support email
- Subject lines are sentence case, not Title Case

## 6.3 Tester whitelist

The following test addresses bypass production timing and trigger 5-min cleanup after E5 sends:

- `antoniompereira@me.com`
- `alternativeservice@gmail.com`

Tester records auto-delete from DynamoDB + S3 photos + EventBridge schedules + SES suppression 5 minutes after E5 fires. Recommended tester address: `alternativeservice@gmail.com` (Gmail handles repeat-sender testing better than iCloud, which spam-flags Codex traffic).

---

# Chapter 7 — Committee Review Process

## 7.1 The /review page

Each S2 application generates a unique signed token. E2 contains a link `https://presttige.net/review/{token}` that committee members click to evaluate the candidate.

**Token rules (LOCKED, codified in `docs/COMMITTEE-REVIEW.md` and code-asserted):**

- Tokens NEVER expire (`review_token_expires_at` is never written; defensive assertion guards against future expiry writes)
- Tokens are single-use for *decisions* — once Approve/Reject/Standby is clicked, the decision is recorded permanently
- Tokens remain *readable* after a decision — re-clicking the link shows the recorded decision + timestamp + full candidate info, but no buttons (read-only)
- POST attempts to overwrite an existing decision return 410 with the message: *"This decision has already been recorded and cannot be changed."*

## 7.2 Decision states

Three terminal states for a review:

- `approved` → triggers E3 schedule (48h delay in production, 15min for testers)
- `rejected` → no further candidate communication by default
- `standby` → triggers Standby-7, Standby-14 sequences

A standby state is **not** a soft-no — it means "interesting candidate, revisit." Re-evaluation may move them to approved or rejected later.

## 7.3 Standby priority tags (parked, H3)

Proposed taxonomy: Reserve / Consider / Pursue (red / yellow / green). Final names TBD. Used internally on /review page when committee marks standby.

## 7.4 Audit trail

Every decision write produces an append-only audit row recording:
- Timestamp (UTC)
- Decision value
- Reviewer identifier (if available)
- Token version
- IP address (for fraud detection only — never displayed)

Audit rows are NOT deleted by any normal operation. Only Antonio with explicit DBA action can purge audit rows.

---

# Chapter 8 — Platform Timeline

## 8.1 Phases

**LOCKED.**

| Phase | Dates | Status |
|---|---|---|
| Pre-launch | Now → 24 Dec 2026 | Active. All 4 tiers open. Patron upgrade available. |
| Launch | 25 Dec 2026 → 30 Nov 2027 | Future. Patron upgrade window CLOSES 31 Dec 2026. |
| Apps live | 1 Dec 2027 → indefinite | Future. Mobile apps go live. Patron remains permanently closed if 999 slots reached. |

## 8.2 Wednesday 29 April 2026 — soft launch goals (REVISED)

Originally targeted for full campaign launch. Revised by Antonio 28 April: **quality over speed**. Wednesday is no longer a hard deadline.

The new posture: ship when it's Presttige-grade, however long that takes. The phases above remain locked; specific in-phase milestones flex.

## 8.3 Marketing communications strategy

Separate working session, planned within ~2 months of this draft. The strategy will cover: paid acquisition, organic content, partnerships, ambassador program, PR. Not in scope for this document beyond the principle that all communications must respect R1–R5 and the brand system (Chapter 9).

---

# Chapter 9 — Brand System

## 9.1 Color palette

| Token | Hex | Use |
|---|---|---|
| Black | `#0A0A0A` | Headers, primary text, brand color in Stripe |
| Gold | `#8C7040` | Accents, CTAs, stamps, brand signature |
| Paper | `#FBF9F4` | Page backgrounds, soft surfaces |
| Stone | `#E8E4DA` | Dividers, secondary backgrounds |
| Ink | `#1F1B16` | Body text on paper |
| Mute | `#7A7570` | Secondary/meta text |

## 9.2 Typography

- **Display & headlines:** `Cormorant Garamond` (serif, light & medium weights)
- **Body & UI:** `system-ui` stack (Inter where available, falls back to native)
- **Numerals:** lining figures, never tabular for body, tabular only for tables
- **Tracking:** generous on display headlines; never tighter than -0.5%

## 9.3 Logo usage

The PRESTTIGE logo (P-mark + wordmark) is the primary brand identifier:

- Always reproduces in gold (#8C7040) on dark, or black (#0A0A0A) on light
- Never in any other color
- Never compressed, stretched, or recolored
- Minimum height: 24px on screen, 12mm in print
- Clear space: minimum 1× the height of the P-mark on all sides

The P-mark alone (icon) may be used where space is constrained: favicons, app icons, social avatars, payment processor avatars, Patron stamp cores.

## 9.4 Patron stamp specification

The Patron stamp is a high-leverage brand element appearing on:
- `/tier-select` Patron card
- E5 welcome email (Patron variant)
- Patron Card (future Apple Wallet asset)
- Patron-only printed materials

**Locked specification (B2.6):**

- Copy: `BECOME A FOUNDER` (3 words, no comma, no second line, no "FOR LIFE")
- aria-label: `Become a founder — Patron tier`
- Treatment: letterpress / notary stamp aesthetic
- Color: gold (#8C7040), double-line border
- Containment: fully inside the Patron card boundary at all breakpoints (geometric proof verified)
- Rotation: subtle (≤8°)
- Position on `/tier-select` Patron card: top-right inset 24px

## 9.5 Voice & tone

- Restrained. Never breathless.
- Direct. Never marketing.
- Adult. Never aspirational-as-condescending.
- Specific. Never generic ("we offer experiences" — bad. "F1 paddock weekends, Aman suite upgrades" — good.)
- Universalist where appropriate; particular where needed (Patron speaks to a different reader than Subscriber).

Avoid:
- "Premium," "exclusive," "luxurious" as adjectives
- "Network of high-net-worth individuals" or any phrase a 2008 LinkedIn deck would use
- "We pride ourselves on..."
- Any sentence beginning with "Welcome to..."

---

# Chapter 10 — Technical Architecture (high-level)

This chapter is a high-level reference. Detailed engineering documentation lives in repo `/docs/`.

## 10.1 Hosting

- Frontend: AWS Amplify, deployed from `main` branch on push, custom domain `presttige.net`
- Backend: AWS Lambda functions, API Gateway HTTP API
- Database: Amazon DynamoDB (table: `presttige-db`, single-table design, PITR enabled with 35-day rollback)
- Storage: S3 buckets for candidate photos
- Email: Amazon SES from `presttige.net` domain
- Scheduling: Amazon EventBridge Scheduler (E3 delays, recovery emails)
- Secrets: AWS Secrets Manager + SSM Parameter Store
- Account: 343218208384, region us-east-1

## 10.2 Critical Lambdas

| Lambda | Purpose |
|---|---|
| `presttige-create-lead` | Receives S1 submission, generates lead_id, sends E1 |
| `presttige-verify-email` | Handles E1 click, marks email verified |
| `presttige-thumbnail-generator` | Generates photo thumbnails post-S2 upload |
| `presttige-send-application-received` | Sends application-received confirmation |
| `presttige-send-committee-email` | Sends E2 to committee@, generates review tokens |
| `presttige-review-action` | Handles /review POST (Approve/Reject/Standby) |
| `presttige-review-fetch` | Handles /review GET (renders form or read-only state) |
| `presttige-create-checkout-session` | Creates Stripe Checkout session OR Payment Intent (B5) |
| `presttige-stripe-webhook` | Handles Stripe webhook events, triggers E5 |
| `presttige-send-welcome-email` | Sends E5 to paid member |
| `presttige-send-subscriber-welcome-email` | Sends E5-SUB to free Subscriber |

## 10.3 SSM parameter conventions

All Stripe-related parameters under `/presttige/stripe/`:

- `/presttige/stripe/club-y1-price-id`
- `/presttige/stripe/club-monthly-price-id`
- `/presttige/stripe/club-yearly-price-id`
- `/presttige/stripe/premier-y1-price-id`
- `/presttige/stripe/premier-monthly-price-id`
- `/presttige/stripe/premier-yearly-price-id`
- `/presttige/stripe/patron-lifetime-price-id`
- `/presttige/stripe/webhook-secret-live`
- `/presttige/review/approve-to-e3-delay-minutes` (currently `2880` for production = 48h)

Tester whitelist hardcoded in Lambda: 15-min E3 delay (bypasses SSM 2880).

## 10.4 Branch policy

- Single branch: `main`
- Every commit pushed to `main` triggers Amplify auto-deploy
- No feature branches in current repo (small team, fast iteration)
- Future: `staging` branch when team grows

## 10.5 The "uncommitted change" Codex flag

Codex repeatedly flags an uncommitted local modification in `backend/lambdas/verify-email/lambda_function.py` sitting in Antonio's working directory. Should be reviewed and either committed or reverted. Currently parked.

---

# Chapter 11 — Security & Compliance

## 11.1 PCI compliance

**LOCKED.** Presttige operates under **PCI SAQ-A** (the simplest level). This is achieved by:

- Using Stripe Elements iframes for all payment input — never custom card forms
- Never logging full card numbers, CVCs, or expiry in any system
- Never storing card data in DynamoDB or S3
- Stripe holds all card data; Presttige holds only Stripe customer IDs and payment intent IDs

Any future change to checkout architecture must preserve SAQ-A. Building custom card input directly (rather than Stripe iframes) immediately escalates to SAQ-D (~thousands of dollars/year compliance cost). **Do not do this.**

## 11.2 Authentication & access

- Committee review tokens: signed HMAC-SHA256 with secret from Secrets Manager
- Tier select tokens: signed HMAC-SHA256 with secret from Secrets Manager
- No passwords on the platform until apps phase (Dec 2027) — token-only
- AWS access via IAM roles, no shared credentials
- Antonio is sole root user; future delegation tracked separately

## 11.3 PII handling

- Candidate emails, names, countries, phone numbers, photos: stored in DynamoDB + S3
- Photos: signed URL access only, 1-hour expiry on signed URLs
- Photo deletion: full purge on tester whitelist cleanup; production photos retained per legal requirement
- Email & name on receipts: visible to Stripe, retained per Stripe policy
- IP addresses: collected at submission for fraud detection only, never displayed, purged after 90 days

## 11.4 GDPR / data subject rights

**Posture:** Even though Presttige is UAE-headquartered, the membership network is global and includes EU residents. We treat GDPR as the floor.

- Data export request: 30-day SLA, Antonio handles manually for now
- Data deletion request: 30-day SLA, full purge from DynamoDB + S3 + SES suppression
- Marketing consent: explicit opt-in only; transactional email is consent-implicit

## 11.5 Backup & restore

- DynamoDB PITR enabled (35-day rollback window) — covers `presttige-db`
- S3 versioning: TODO (recommend enabling; currently parked)
- Lambda code backed up via git (origin: GitHub repo)
- SSM/Secrets Manager backed up via AWS native replication

INC-002 (28 Apr 2026) ✅ — PITR was enabled this date.

---

# Chapter 12 — Operations

## 12.1 Incident management protocol

| Severity | Definition | Response |
|---|---|---|
| **SEV-1** | Live customer can't pay or member loses access | Antonio + Codex immediate, within 1 hour |
| **SEV-2** | Funnel breaks, candidates can apply but flow stalls | Same-day fix |
| **SEV-3** | Cosmetic / minor functional bug | Next-business-day fix |
| **SEV-4** | Improvement, not blocking | Parking lot, scheduled |

Naming convention: `INC-NNN` sequential (INC-001 = approved-but-no-E3 candidates; INC-002 = PITR enable; INC-003 = review token expiry audit & readable-after-use).

Each incident has: trigger, root cause, plan, status, related commits.

## 12.2 Tester whitelist behavior

Two tester addresses (Chapter 6.3) bypass:
- E3 production delay (15 min instead of 2880 min / 48h)
- Tester records auto-cleanup 5 min after E5

This enables rapid E2E testing without polluting production data. Tester records are clearly tagged with `is_test=true` so analytics and member counts exclude them.

## 12.3 Backfill safety

R4 (Chapter 2) is the backfill rule. All scripts that resend emails (any of E1, E2, E2.5, E3, E5) MUST use the shared filter modules and exclude non-pending review states.

C7-B (28 Apr 2026) ✅ — three live Lambdas hardened with this guard, plus dry-run audit script.

## 12.4 Email deliverability

- SES warm-up complete; sender reputation healthy (0/0/0 bounces/complaints/rejections)
- DKIM, SPF, DMARC configured for `presttige.net`
- Dedicated IP planned for launch phase (currently shared)
- Apple iCloud spam-flags repeat tester traffic — known limitation, tester address `alternativeservice@gmail.com` preferred
- Future: SES deliverability audit (C7-C, parked, low priority)

## 12.5 Working rhythm

- **English only** in all chats and documents
- **One topic at a time** in conversations with Codex
- **Antonio paste-courts** between Claude (architect) and Codex (executor)
- **Real-Safari sign-off** required for all UI-touching commits — Codex Playwright WebKit ≠ real Safari for some bugs
- **Glass.aiff** audible completion required for all Codex briefings (helps Antonio know when to return)

---

# Chapter 13 — Roadmap

Items beyond the locked Chapters 3–11 are organized by priority. This list is selectively curated — operational backlog lives in the parking lot.

## 13.1 High priority (H1–H9)

| ID | Item | Status |
|---|---|---|
| H1 | `/profile-complete` page + 2nd committee review + auto-refund (post-payment legal protection) | Parked, ~2-3 days |
| H2 | `/review` page redesign (bigger decision display, brand polish) | Parked |
| H3 | Standby priority tags (Reserve / Consider / Pursue) | Parked |
| H4 | Recovery emails E0.5 + E1.5 + backfill 11 stuck candidates | Parked |
| H5 | Tier renaming → Subscriber/Club/Premier/Patron | ✅ DONE |
| H6 | `/welcome` session_id fallback for real users (resilience) | Parked, optional |
| H7 | Patron Card (Apple Wallet + QR for partner verification) | Parked, post-launch |
| H8 | Patron add-on services partner pipeline | Parked, ongoing |
| H9 | "Stay informed" notification email infrastructure | Parked, post-campaign |

## 13.2 Medium priority (M1–M7)

| ID | Item | Status |
|---|---|---|
| M1 | REJECT email decision (silent or send respectful confirmation?) | TODO — Antonio decides |
| M2 | Standby-7 / Standby-14 copy | TODO — Antonio drafts |
| M3 | Branded RECEIPT email (replace Stripe default) | Parked |
| M4 | RENEWAL email branching (lifetime vs renewable) | Parked |
| M5 | Diego Miranda Ambassador proposal v2 (5 fixes pending) | Parked |
| M6 | Manual Safari sign-off Bug 1.5 | ✅ DONE |
| M7 | This document — `Presttige — Matriz & Regras` | Now writing v0.1 |

## 13.3 Low priority (L1–L4)

| ID | Item | Status |
|---|---|---|
| L1 | Phone selector "United St" truncation fix | Low priority, known |
| L2 | Referral system v2 (5 invites/paying member, 10% credits, "Presttige Credits", first-year only, language: "introduce" not "earn") | Parked, post-launch |
| L3 | Ambassador/Partner proposal pipeline (Ana Luisa + Laurie Weitzkorn shipped Chat 005, Diego v2 pending) | Parked |
| L4 | C7-C SES deliverability audit | Low priority, SES healthy |

---

# Chapter 14 — Open Decisions

Items still pending Antonio's resolution. Locked items move OUT of this chapter into the relevant chapter when resolved.

## 14.1 Pending product decisions

- [ ] **Premier perk list** — restaurants/discounts catalog. *"Talk later" — Antonio.*
- [ ] **Founding slots counter style on UI** — show real number, or "under 100 left," or no counter at all? Must respect R5 (no specific slot total).
- [ ] **REJECT email** — send respectful confirmation, or stay silent? (M1)
- [ ] **STANDBY copy drafting** — exact text for Standby-7 and Standby-14 (M2)
- [ ] **Standby priority tag names** — confirm "Reserve / Consider / Pursue" (H3)
- [ ] **Pixel IDs** — Meta Pixel ID, GA4 measurement ID, Google Ads conversion ID. Required for B4.
- [ ] **Club ↔ Premier upgrade pricing** during the upgrade window — locked at differential? (Chapter 4.3)
- [ ] **Apple Pay domain verification** — required for B5 if Apple Pay is in V1 scope; can ship card-only first

## 14.2 Pending technical decisions

- [ ] **B5 architecture** — embedded Stripe Elements on presttige.net (LOCKED 28 Apr) — but specific implementation patterns (Payment Intent vs Setup Intent for lifetime, success page handling, error recovery UX) TBD by Codex investigation
- [ ] **Webhook endpoint URL** for Live mode — confirm location (probably `https://api.presttige.net/stripe-webhook` — Codex audits)
- [ ] **`/welcome` session_id resilience** — H6, optional
- [ ] **Apps phase architecture** — native iOS/Android vs PWA vs Capacitor — defer to Q3 2027 planning
- [ ] **Member directory access control** — UI for browsing other members; permissions; visibility opt-out — TBD
- [ ] **Payment retry policy** — failed Y2+ renewal: how many retries before tier downgrade? Stripe default is 3; we may want different.

## 14.3 Pending operational decisions

- [ ] **S3 versioning** for photos — recommend enabling, currently disabled
- [ ] **Dedicated SES IP** — schedule for launch phase
- [ ] **Marketing communications strategy** — separate working session within 2 months
- [ ] **Privacy policy + Terms of Service** — drafted? On site? Linked from S1? TBD
- [ ] **Cookie consent regional behavior** — Bug 1.5 fixed Safari banner; full regional logic (EU vs US vs UAE) for cookie categories TBD

---

# Chapter 15 — Glossary

Terms used across Presttige codebase, communications, and operations.

| Term | Definition |
|---|---|
| **lead_id** | Unique candidate identifier, format `fdm_<10 hex chars>` (e.g., `fdm_d37fe07fe2`) |
| **S1 / S2 / S3 / S4 / S5** | Funnel stages (5.1) |
| **E1 / E2 / E3 / E5** | Transactional emails (Chapter 6) |
| **E2.5** | Reminder email to committee when E2 unread |
| **E5-SUB** | Welcome email for free Subscriber path |
| **E0.5 / E1.5** | Recovery emails (parked, H4) |
| **R1–R5** | Canonical rules (Chapter 2) |
| **INC-NNN** | Incident number, e.g., INC-001 (12 candidates approved-but-no-E3) |
| **C7-A / C7-B / C7-C** | Backfill / audit script generations |
| **B2 / B3 / B4 / B5** | Build phase identifiers (B2 = tier system; B3 = Stripe LIVE; B4 = Pixels; B5 = embedded checkout) |
| **PITR** | Point-In-Time Recovery (DynamoDB feature, 35-day rollback) |
| **Codex CLI** | The executor agent with full repo + AWS access |
| **Tester whitelist** | Two test email addresses (6.3) that trigger 15-min E3 + 5-min cleanup |
| **Founding rate** | Year-1 price locked for the founding cohort lifetime (4.4) |
| **Founder line** | Direct communication channel from Patron members to Antonio (3.4) |
| **Founder badge** | Visual marker for Patron members in member directory |
| **Patron Card** | Future Apple Wallet asset for partner verification (H7) |
| **Add-on services** | Patron-exclusive curated services (3.5) |
| **Member proposal rights** | Ability to nominate other candidates for committee review (3.6) |
| **Standby** | Review state meaning "interesting candidate, revisit" (7.2) |
| **Sandbox** | Stripe test environment within the METTALIX merchant account |
| **Live mode** | Stripe production environment, real payments |
| **Letterpress** | Visual treatment for Patron stamp — embossed, double-line, gold (9.4) |

---

# End of Matriz & Regras v0.1

**Next steps:**
1. Antonio reviews this draft
2. Antonio flags errors / additions / omissions
3. Claude iterates to v0.2
4. v1.0 commits to repo at `/docs/MATRIZ-E-REGRAS.md`
5. `AGENTS.md` updates the source-of-truth pointer to the new path
6. Codex stops flagging missing source-of-truth on every commit

---

`afplay /System/Library/Sounds/Glass.aiff`
