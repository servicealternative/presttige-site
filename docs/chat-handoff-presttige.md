# PRESTTIGE Chat Handoff

Use the following as the opening context in any new chat about PRESTTIGE.

---

PRESTTIGE is a fully independent system.

It has its own:
- frontend
- funnel
- tracking
- cookies
- metrics
- Stripe flow
- reporting

It must not be merged with ULTTRA.

Non-negotiable rules:
- no shared frontend with ULTTRA
- no shared tracking
- no shared cookies
- no shared reporting
- no shared business logic
- no redesign unless explicitly requested
- do not propose low-structure shortcuts such as Google Sheets as the operational core

Identity continuity is frozen:
- the registered user is not a separate identity disconnected from the lead
- the user is an evolution of the same identity
- there must be no broken transition between lead, approved lead, invited lead, paid member, and registered user
- continuity must remain anchored in:
  - `lead_id`
  - token logic
  - double opt-in trust chain
  - review history
  - approval state
  - invitation state
  - payment state
- do not propose solutions that create a disconnected second identity layer
- do not reinterpret or simplify this identity continuity rule away

Editable vs locked data:
- phone and email may change only with new verification
- payment method changes must happen through the payment layer
- username, internal identifiers, review history, identity-linking fields, and trust-sensitive fields are locked or highly restricted

No loss of history:
- lead to user evolution must preserve origin, review data, approval decision, invitation state, offer state, validation history, and payment relationship

Current accepted implementation:
- `offer.html` exists and is the private decision page
- `gateway` reads `offer_sent_at`
- `stripe-gateway` reads `offer_sent_at`
- `review-action` writes `offer_sent_at`
- the 72-hour invitation window depends only on `offer_sent_at`
- Stripe prices and products must not be changed

Final rule for `offer_sent_at`:
- written only in approval / invitation-send backend
- written at the exact moment the private invitation is issued/sent after approval
- current UTC ISO timestamp
- once per invitation cycle
- no overwrite unless a new cycle is intentionally created

Current goal:
- maintain PRESTTIGE in production-ready form
- continue inside the defined architecture
- do not reopen frozen decisions unless explicitly requested

Before giving any solution, first restate:
1. project identity
2. current phase
3. non-negotiable rules
4. what is out of scope

---

Reference file:
- `docs/master-context-presttige.md`
