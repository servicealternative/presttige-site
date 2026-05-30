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
- The Founder inviter branch is fail-closed with a TODO for branch B.
- With A1 plus A2 complete, the C1 internal inviter branch is complete.

Remaining bridge work:

- Branch B, the qualifying-Founder invitation tree.

## Rewritten Gate Eligibility

Use one shared `isEligibleFounderInviter()` function in:

- `founder-gate`
- admin invite-create
- Founder checkout

An inviter is eligible only if:

- internal inviter is active in the mirror with invite permission, or
- later branch B says a genuine Founder has `tier=founder`,
  `founder_lifetime=true`, paid/active status, and meets monthly-entitlement
  plus previous-invitee-converted conditions

Explicitly block Club, Premier, Patron, and plain subscriber records, even if active.

Until branch B is built, the Founder inviter branch fails closed.

## Founder Monthly Entitlement

For the external Founder branch, later, `presttige-db` needs:

- `founder_invite_entitlement_window`
- `founder_last_invitee_lead_id`
- `converted_to_paid`

## Build Order

1. Build the Ulttra internal-member model, DONE.
2. Build C1 step A1, read-only sync identity, mirror table, and five-minute
   sync Lambda, DONE.
3. Build C1 step A2, wire shared `isEligibleFounderInviter()` into gate,
   admin, and checkout with explicit blocking and fail-closed mirror reads,
   DONE.
4. Build branch B, the Founder monthly-entitlement tree.
5. Build the permissions area, Standards per type, permissions, visibility,
   and dashboard.
6. Only then run the controlled Ambassador test with an Antonio-owned identity
   and no real member.

## Respects

This architecture respects:

- 1 to 10MM, gate reads local mirror, no live dependency, push-on-change
- project isolation
- frozen inviter rule
- real subscriber DB never used for tests
