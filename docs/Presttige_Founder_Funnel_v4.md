# PRESTTIGE FOUNDER FUNNEL SPEC (v4)

Status: Approved. Controlling Founder funnel design for the next build steps.

## 1. Two Worlds

Founder lives entirely in Presttige.

Ulttra CRM is Antonio's control tower. Internal users submit invite requests
there, and Antonio approves or executes there.

No subscriber ever logs into Ulttra.

Founder candidates, members, and invitees interact only inside the Presttige
universe.

## 2. Who Can Request A Founder Invite

A Founder invite request may come from:

- An internal user, only if permitted, through a Founder Invitation button in
  Ulttra.
- A registered internal member.
- An active Founder who, inside the Presttige universe and their member portal,
  receives a periodic NEW FOUNDER invitation and submits through their own
  logged-in identity.

When an active Founder submits through the Presttige member portal, the request
reaches Antonio with the submitter already validated by their logged-in
identity.

## 3. Submission And Approval Flow

The requester enters:

- Invitee name
- Invitee email

The system automatically attaches who submitted the request.

The request lands with Antonio. Antonio sees:

- Invitee
- Submitter
- Approve button
- Reject silently button
- Stand-by silently button

Approve runs the existing invite process:

- Create or update the invited record as `founder_invited`
- Generate or assign the permanent Founder token
- Link the inviter
- Send the two automatic approval emails

## 4. Locked Silence Rule

Rejection, stand-by, or non-follow-up are never written to anyone.

No rejection email is ever sent.

The submitter may only receive a neutral prompt such as speak with me or we
follow up via me. The submitter must never receive a rejection message.

## 5. Automatic Emails On Approval

Approval sends two automatic emails.

Email A, invitee:

- Next steps to become a Founder
- Points to `/founder`
- Does not expose internal approval details

Email B, inviter:

- Thank-you and informative message
- Asks the inviter to accompany the invitee
- Framed as Premium Concierge / client support
- Does not include sensitive invitee detail

Automatic emails require SES. SES is an open blocker.

## 6. Invitee Funnel In Presttige

The invitee funnel remains the Presttige v3 path:

1. `/founder` neutral gate
2. Dual-email gate, already built
3. On success, full Founder detail page
4. Checkbox consent
5. Payment through Stripe product `prod_URrwkKbbICL760`
6. Activation, `subscriber_type` changes from `founder_invited` to `founder`

## 7. Build Order

1. `/founder` page, done
2. Checkbox to payment plus activation
3. Submission flow plus Antonio approval panel
4. The two automatic emails, requires SES
5. SES resolved in parallel

## 8. Dependencies

Automatic emails require SES.

SES remains an open blocker.

## 9. Permissions

Antonio controls who can submit Founder invite requests.

Antonio can:

- Add submit permission
- Cancel submit permission
- Remove submit permission
- Put a submitter on stand-by
- Limit requests per user

This is part of the broader CRM permissions module, designed later.

## 10. Pending Review

The `/founder` page design is pending review.

All Founder copy and content are pending review and revision later.

The current `/founder` page is technically approved only for now.
