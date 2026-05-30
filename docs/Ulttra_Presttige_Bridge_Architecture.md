# Ulttra to Presttige Bridge Architecture

## Decision

LOCKED: Internal members are managed in the Ulttra CRM as the source of truth, because there will be multiple projects, Antonio works exclusively inside Ulttra, and one person may belong to more than one project. The bridge to each project is C1, a minimal mirror.

## Two Systems

Ulttra CRM is PostgreSQL through Directus. It is the source of truth for internal members.

`presttige-db` is DynamoDB. It is the source of truth for Presttige subscribers.

Both systems live in the same AWS account and region, but they use different technology and must not be merged.

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

C1 is complete in code:

- Internal branch, A1 plus A2, DONE.
- Founder branch, B1 plus B2 plus B3, DONE.

Remaining branch B work:

- B4, run the controlled test with Antonio-controlled addresses only.

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

B3 is built. The Founder inviter branch is live and gated by the branch B
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
7. Build branch B step B4, controlled test with Antonio-controlled addresses
   only.
8. Build the permissions area, Standards per type, permissions, visibility,
   and dashboard.
9. Only then run the controlled Ambassador test with an Antonio-owned identity
   and no real member.

## Respects

This architecture respects:

- 1 to 10MM, gate reads local mirror, no live dependency, push-on-change
- project isolation
- frozen inviter rule
- real subscriber DB never used for tests
