# Ulttra CRM Access Model

Status: LOCKED control rules.

## User Creation

Antonio adds internal team users.

Antonio may delegate adding certain types, such as Ambassadors, Agencies, or similar internal operating relationships, to someone he chooses, currently Ana as BD Manager, or to nobody. This is Antonio's call.

Any delegate adds users only in `pending` state, applying the type's predefined Standard with no customizing.

Nobody a delegate adds becomes `active` without Antonio's validation. Only Antonio activates.

No automatic flow ever creates users by itself.

Presttige subscribers, including Club, Premier, Patron, and Founder, are not covered by this CRM access model. They enter through the public funnel. This prevents a Galina-type error where a real subscriber is treated as an internal inviter.

## Profiles And Permissions

Every internal user has a profile defining:

- projects, existing projects only
- permissions
- visibility

Permissions and visibility are set at three levels:

- per project
- per user type, one of `team`, `ambassador`, `business_partner`, `influencer`, `admin`
- per specific user

A Standard per type defines permissions, visibility, and dashboard. Standards are set globally by Antonio and Claude, then executed by Codex.

Only Antonio grants per-user authorizations above or below the Standard.

The `people_projects` junction is the structural backing for project access:

- `status` records the per-project lifecycle, including `pending` and `active`.
- `invite_permission` records whether the user may issue Founder invites for
  that project.
- `added_by` records who created the project membership.
- `validated_by` and `validated_at` record Antonio's activation step.

Delegated adds remain `pending` until Antonio validates them. Antonio-only
activation is represented by `validated_by`, `validated_at`, and
`status=active`.

## Dashboard And Visibility

Each user's dashboard shows all of their own personal information without restriction, including their data, commissions, invitees, and equivalent personal operating records.

Common or global project information is shown only as far as Antonio authorizes.

The Standard, meaning what each type sees globally, is decided by Antonio and Claude, then executed by Codex.

Antonio may additionally choose to show extra information to a specific user. That per-user extra remains open for later.

### Dashboard Standards v1

Dashboard Standards v1 are implemented for `admin` and `team` only.

The Standards are stored and enforced as server-side config inside the Ulttra
dashboard endpoint:

`infra/ulttra-directus-dashboard/extensions/directus-extension-ulttra-dashboard-endpoint/dist/index.js`

Admin Standard:

- visibility: all v1 panels and all global metrics
- revenue: global month-to-date paid revenue
- Founder Invitation: present and active through the existing safe path
- permissions: dashboard read plus the gated Founder invite action only

Team Standard:

- visibility: active members, by tier, Founders against cap, leads, website
  visitors, revenue panel, and Founder Invitation
- revenue: own attributed revenue only, currently `$0.00` until attribution
  exists
- Founder Invitation: present, with the logged-in user as inviter and the
  existing eligibility check at submit time
- permissions: dashboard read plus the gated Founder invite action only

Ambassador, Business Partner, and Influencer Standards are not built yet. They
remain stubs until Antonio defines those Standards.

## Isolation

Permissions, visibility, and dashboard apply per project.

A user only sees and acts in the projects Antonio assigned.

Nobody hops between projects.

## Inviter Eligibility

Founder-invite inviter eligibility is cross-referenced with the Presttige C1 bridge architecture.

A Founder-invite inviter must be either:

- a registered internal member, one of `team`, `ambassador`, `business_partner`, `influencer`, `admin`
- a qualifying Founder

Club, Premier, Patron, and plain subscribers can never invite.
