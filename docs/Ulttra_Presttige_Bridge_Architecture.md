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

## Rewritten Gate Eligibility

Use one shared `isEligibleFounderInviter()` function in:

- `founder-gate`
- admin invite-create
- Founder checkout

An inviter is eligible only if:

- internal inviter is active in the mirror with invite permission, or
- genuine Founder has `tier=founder`, `founder_lifetime=true`, paid/active status, and meets monthly-entitlement plus previous-invitee-converted conditions

Explicitly block Club, Premier, Patron, and plain subscriber records, even if active.

## Founder Monthly Entitlement

For the external Founder branch, later, `presttige-db` needs:

- `founder_invite_entitlement_window`
- `founder_last_invitee_lead_id`
- `converted_to_paid`

## Build Order

1. Build the Ulttra internal-member model.
2. Build the C1 mirror table.
3. Build the Ulttra to mirror push mechanism.
4. Wire shared `isEligibleFounderInviter()` into gate, admin, and checkout with explicit blocking.
5. Later, build Founder monthly-entitlement.
6. Only then run the controlled Ambassador test with an Antonio-owned identity and no real member.

## Respects

This architecture respects:

- 1 to 10MM, gate reads local mirror, no live dependency, push-on-change
- project isolation
- frozen inviter rule
- real subscriber DB never used for tests
