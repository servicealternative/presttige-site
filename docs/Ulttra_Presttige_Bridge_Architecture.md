# Ulttra to Presttige Bridge Architecture

## Decision

LOCKED: Internal members are managed in the Ulttra CRM as the source of truth, because there will be multiple projects, Antonio works exclusively inside Ulttra, and one person may belong to more than one project. The bridge to each project is C1, a minimal mirror.

## Two Systems

Ulttra CRM is PostgreSQL through Directus. It is the source of truth for internal members.

`presttige-db` is DynamoDB. It is the source of truth for Presttige subscribers.

Both systems live in the same AWS account and region, but they use different technology and must not be merged.

## Identity Decision, 2026-06-02

Cognito is the decided central identity layer for Presttige site, Presttige
App, and Ulttra CRM.

- One person has one login across all surfaces.
- Login is created after payment.
- Ulttra CRM requires MFA for everyone, always.
- Presttige Club, Premier, and Patron members use email plus password plus SMS
  or email verification, without authenticator by default.
- Founders may add TOTP authenticator labelled `Presttige . Founder`.
- Directus remains the CRM application and operating data layer.

## Internal Member Model In Ulttra

The Ulttra `people` collection gains:

- `role`, one of `team`, `ambassador`, `business_partner`, `influencer`, `admin`
- `projects`, many-to-many
- `status` per project, one of `active`, `standby`, `cancelled`, `removed`
- invite permission

## C1 Bridge

Presttige receives a minimal mirror table named `presttige-eligible-inviters`.

The mirror stores only:

- `email`
- `role`
- `project=presttige`
- `status`
- `source=ulttra`
- `last_synced_at`

Ulttra is the writer and pushes changes when internal-member eligibility changes.

The Founder gate is reader only.

The bridge is push/event based, not real-time-per-second.

Each project gets its own mirror. Nobody hops between projects.

## C1 Step State

C1 step A1 is DONE.

Live A1 components:

- Directus read-only identity: role `Presttige Sync (read-only)`, user
  `Presttige Sync`, email `presttige-sync@ulttra.net`
- Static sync token stored encrypted in SSM at
  `/presttige/ulttra-sync/directus-token`, separate from the Codex admin token
- DynamoDB mirror `presttige-eligible-inviters`, account `343218208384`,
  region `us-east-1`, partition key `email`, on-demand billing
- Sync Lambda `presttige-eligible-inviters-sync`, Python 3.12, reconciling the
  mirror from active Presttige `people_projects` rows where
  `invite_permission=true`
- EventBridge rule `presttige-eligible-inviters-sync-5min`, enabled,
  `rate(5 minutes)`
- Least-privilege IAM scoped to the sync token parameter and mirror table

The mirror is currently empty because no active Presttige `people_projects`
row has `invite_permission=true`; this is expected and safe.

Live founder-gate, checkout, and existing Lambdas or routes were untouched by
A1.

C1 step A2 is DONE.

Live A2 state:

- Shared `isEligibleFounderInviter(inviterEmail)` is wired into
  `founder-gate`, admin invite-create, and Founder checkout.
- Internal inviter eligibility reads the local
  `presttige-eligible-inviters` mirror.
- Club, Premier, Patron, and plain subscriber records are explicitly blocked
  as inviters, even when active or paid in `presttige-db`.
- The Founder inviter branch was fail-closed with a TODO for branch B.
- With A1 plus A2 complete, the C1 internal inviter branch is complete.

Branch B step B1 is DONE.

Live B1 state:

- Founder-invite timing and cap configuration is stored in SSM Parameter
  Store under `/presttige/founder-invite/*`.
- The canonical Founder entitlement field contract is documented for
  `presttige-db`.

Branch B step B2 is DONE.

Live B2 state:

- `presttige-stripe-webhook` stamps `founder_activated_at` from
  `confirmed_payment_at` during live Founder activation, using
  `if_not_exists` so an existing timestamp is never overwritten.
- `presttige-founder-invite-scheduler` is deployed as a new isolated Lambda.
- EventBridge rule `presttige-founder-invite-scheduler-daily` is enabled at
  `rate(1 day)`.
- The scheduler reads `/presttige/founder-invite/*` at runtime, issues
  monthly pure one-at-a-time invites, uses the activation anchor plus the
  configured initial delay, clamps the monthly anchor day to month length,
  respects the global cap, and excludes `synthetic_test` records.
- Dry-run verification found zero real paid Founders and issued zero invites,
  with zero emails sent and no test data left behind.
- Gate and checkout were not changed by B2. The Founder branch remained
  fail-closed until B3.

Branch B step B3 is DONE.

Live B3 state:

- The Founder branch is wired into the shared `isEligibleFounderInviter()`
  implementations in JavaScript and Python.
- Internal inviter eligibility through the mirror remains unchanged and is
  checked first.
- Club, Premier, Patron, and plain subscriber records remain blocked.
- Founder inviter eligibility requires a genuine paid active Founder,
  `founder_invite_status=active`, a present token, a non-expired invite, and a
  presented invitee matching `founder_invite_invitee_lead_id`.
- Admin invite-create binds `founder_invite_invitee_lead_id` to the Founder
  inviter's active invite transactionally.
- Activation resolution marks the inviter invite `consumed`, increments
  `founder_invites_converted_count`, and grants no extra invite.
- B3 verification kept zero real paid Founders, zero active Founder invites,
  and an empty internal mirror. No emails were sent and no test data was left
  behind.

Branch B step B5 is DONE.

Live B5 state:

- `presttige-stripe-webhook` sends the dedicated Founder welcome email from
  `founders@presttige.net` after the hardened Founder activation transaction
  succeeds.
- The welcome send is idempotent through `founder_welcome_email_sent_at`.
- Synthetic test safety allows sends only to Antonio-controlled test
  addresses.
- Later task, not actioned here: review which sender each Founder email uses,
  and replace the plain SES emails with approved Presttige branded templates
  and design.
- `presttige-stripe-webhook` CodeSha256:
  `0wu384dLDfO+xjkqVbqk6GREs1J3vNHBZ6DQPA0uwGY=`.
- `stripe-layer:1` is preserved.

Branch B step B6 is DONE.

Live B6 state:

- Test-only Lambda `presttige-founder-test-harness` is deployed.
- Harness CodeSha256:
  `qwgEPRx2pYN2X7KkXIocE4Q5W/0C5Anhj42w69I2yWI=`.
- Commands are `welcome`, `schedule_invite`, and `reset`.
- SSM test delay config:
  `/presttige/founder-invite/test-delay-minutes = 5`.
- Reset requires `confirm=RESET_FOUNDER_TEST`.
- The harness refuses non-Antonio addresses and non-`synthetic_test` records.
- Production webhook and production scheduler are unchanged. The production
  scheduler still excludes `synthetic_test`.

Branch B step B4, controlled test run, is DONE.

B4 result:

- Test A, internal Ambassador branch, passed.
- Manuel Fonseca was created as a synthetic Ambassador in Ulttra, added to the
  Presttige project as pending, activated by Antonio authorization, synced into
  `presttige-eligible-inviters`, and accepted by
  `isEligibleFounderInviter()` through `source=ulttra`.
- Galina's Club record remained rejected as an inviter.
- Founder welcome Email 1 delivered to `fq@freequenza.net` during the test.
  The live Founder welcome sender was later changed to `founders@presttige.net`.
- Test B confirmed monthly-pure, one-at-a-time behavior: one active synthetic
  Founder invite existed, and an immediate re-run returned
  `active_invite_already_exists` without issuing a second invite.
- The synthetic Founder to checkout path did not pass by design. The shared
  eligibility function correctly blocks `synthetic_test=true` Founders from
  being treated as genuine Founder inviters. A full Founder-inviter checkout
  exercise requires a genuine paid active Founder with a bound active invite.
- Cleanup is done. The synthetic Founder lead, Manuel's Ulttra person and
  `people_projects` row, the mirror row, and one-off schedules were removed.
  Post-cleanup mirror count is `0`, real paid active Founders are `0`, and real
  members remain `1`.

C1 branch B is complete in code:

- Internal branch, A1 plus A2, DONE.
- Founder branch, B1 plus B2 plus B3 plus B4 plus B5 plus B6, DONE.

Remaining real work:

- Align the Chairman-invited Founder checkout path.
- Build the permissions area, then run the post-permissions Ambassador test.

## Chairman Founder Invite Blocker, 2026-06-02

Presttige Invitation from the Ulttra dashboard is live for Chairman and uses
`committee@presttige.net`.

Founder invite end-to-end is working, including the restricted synthetic test
exception for `fq@freequenza.net`.

Open blocker:

- `presttige-checkout-context` still rejects Chairman-invited Founders with
  `founder_gate_not_confirmed`.
- Cause: checkout still requires `inviter_lead_id` in `presttige-db`.
- Chairman is an Ulttra/Directus identity with `inviter_lead_id = NULL`.
- This is the fourth eligibility layer to align before a Chairman-invited
  Founder can pay.

Decided Founder invite paths:

- Path A: Chairman invites an already-registered person. The person goes
  directly to Founder Step 1, Step 2, and payment. No data is recollected.
- Path B: a new invitee receives a refined fill form plus double opt-in. There
  is no committee review. Login is created after payment.

## Rewritten Gate Eligibility

Use one shared `isEligibleFounderInviter()` function in:

- `founder-gate`
- admin invite-create
- Founder checkout

An inviter is eligible only if:

- internal inviter is active in the mirror with invite permission, or
- a genuine Founder has `tier=founder`, `founder_lifetime=true`, paid and
  active status, an active non-expired invite token, and a bound invitee match

Explicitly block Club, Premier, Patron, and plain subscriber records, even if active.

Branch B is built. The Founder inviter branch is live and gated by the
conditions above.

## Founder Monthly Entitlement

For the external Founder branch, `presttige-db` uses:

- `founder_activated_at`
- `founder_invite_status`
- `founder_invite_token`
- `founder_invite_issued_at`
- `founder_invite_expires_at`
- `founder_invite_invitee_lead_id`
- `founder_invites_issued_count`
- `founder_invites_converted_count`

## Build Order

1. Build the Ulttra internal-member model, DONE.
2. Build C1 step A1, read-only sync identity, mirror table, and five-minute
   sync Lambda, DONE.
3. Build C1 step A2, wire shared `isEligibleFounderInviter()` into gate,
   admin, and checkout with explicit blocking and fail-closed mirror reads,
   DONE.
4. Build branch B step B1, dynamic config and entitlement field contract,
   DONE.
5. Build branch B step B2, activation stamp and monthly invite scheduler,
   DONE.
6. Build branch B step B3, wire the Founder branch into shared eligibility
   and resolve invite state when the invitee subscribes, DONE.
7. Build branch B step B5, Founder welcome email on activation, DONE.
8. Build branch B step B6, repeatable self-cleaning Founder test harness,
   DONE.
9. Run branch B step B4, controlled test with Antonio-controlled addresses
   only, through the B6 harness, DONE.
10. Build the permissions area, Standards per type, permissions, visibility,
   and dashboard.
11. Run the post-permissions Ambassador test with an Antonio-owned identity
   and no real member.

## Respects

This architecture respects:

- 1 to 10MM, gate reads local mirror, no live dependency, push-on-change
- project isolation
- frozen inviter rule
- real subscriber DB never used for tests
