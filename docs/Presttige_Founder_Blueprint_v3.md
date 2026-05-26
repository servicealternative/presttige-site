# PRESTTIGE — FOUNDER ACCESS BLUEPRINT (v3)

Status: Approved. Controlling design for the Founder build.
Note: Aligned to GDPR / ISO 27001 principles. Not legal advice, not
certification. Professional review recommended before legal reliance.

## 1. The Founder journey
1. Invite created in Admin (Antonio). Invited Founder email added to
   subscribers DB, marked "founder_invited", gets a permanent token
   (stable for that email).
2. Committee approval splits the email path:
   - Normal approved people -> email to choose their tier (existing flow).
   - Founder invitees -> a separate "next steps to become a Founder"
     email, pointing to /founder.
3. Invited person opens /founder -> neutral gate only, no Founder content
   in page source.
4. Dual-email gate: enters own email, then inviter email. Server validates
   both exist AND are linked. Mismatch -> show founders@presttige.net
   (inbox: Antonio only). Failures = single neutral result, no reason
   leaked.
5. On success -> the full Founder detail page (Founder tier, full details).
6. Checkbox (consent) -> payment (existing payment mechanism, Stripe
   Founder product prod_URrwkKbbICL760, live).
7. After payment -> official Founder. subscriber_type: founder_invited
   -> founder.

## 2. The inviter rule
- To become a Founder, a matching inviter email is ALWAYS required.
- To take a different tier (Club/Patron/Premier), the inviter email is
  NOT required (normal path).
- After 3 months unused: email retained, person treated as a normal
  person; Founder gate/token no longer governs.
- Token + Founder obligations apply ONLY while in the Founder track.

## 3. Retention / emails
- Invite actionable any time. During 3 months: one "next steps" email
  every 30 days (max 3). Choosing another tier ends Founder eligibility
  and removes Founder eligibility. If never acted on after 3 months:
  record remains; person treated as normal.

## 4. Admin token kill switch
Antonio (only) can revoke a token (invalidate) or regenerate it (bump
version + nonce, recompute, set active) and re-issue the invitation.

## 5. Permanent token security model
Permanent token is acceptable because never sufficient alone: the gate
ALWAYS also requires the matching inviter email. Leaked token without the
exact inviter opens nothing. Plus the kill switch.

## 6. Data model (additions to presttige-db, non-destructive)
- lead_id
- email (normalised) - locked in funnel
- subscriber_type: founder_invited -> founder (or club/patron/premier if
  switched) / standard_member
- founder_token (permanent, stable; revocable/regenerable)
- founder_token_status (active/revoked), founder_token_version (int),
  founder_token_nonce, founder_token_generated_at, founder_token_revoked_at
- inviter_email (normalised) + inviter_lead_id
- founder_eligible = true (NOTE: already consumed by checkout; write only
  when truly Founder-eligible)
- founder_gate_status (pending/confirmed/declined/expired/removed),
  require confirmed
- tier_intent (founder/club/premier/patron/subscriber)
- consent_basis, consent_timestamp, checkbox_consent_at
- created_by_admin, created_at
Canonical tier stays in tier / selected_tier.
Inviter must be a registered member (review_status approved + active
account marker). Gate passes only if invited record inviter link matches.

## 7. Compliance-by-design (GDPR / ISO 27001 aligned)
- Lawful basis (Art 6): legitimate interest for invite + consent at
  /founder.
- Rights (15-17): access/export, erasure (real delete, logged),
  rectification.
- Minimisation (Art 5): store only what the funnel needs.
- Retention: per section 3; stale records handled on schedule.
- Security (Art 32 / ISO A.8-A.9): HTTPS; DynamoDB encryption at rest
  (confirm); access = Antonio only; Antonio owns auth setup (Claude
  cannot create accounts/credentials).
- Audit (ISO A.12.4): every admin action logged in presttige-review-audit
  (who/when). No PII/secrets in logs.

## 8. Build order (one pass)
1. Data model (locked spec, non-destructive, written when invite created).
2. Deploy dual-email gate (DONE: presttige-founder-gate, /founder-gate,
   read-only, throttled, kill-switch verified).
3. Admin: create-invite + revoke/regenerate (Antonio owns login).
4. Split emails (Founder "next steps" email).
5. /founder page (neutral gate -> full Founder detail page).
6. Checkbox -> payment (Stripe prod_URrwkKbbICL760, live).
7. Activation (subscriber_type -> founder).

## 9. CRM (next phase)
Antonio's full internal toolset: team, ambassadors, agencies, members.
Sole admin = Antonio (owns auth). Same compliance layer. Shares the
subscriber/member data model. First CRM-phase decision: template vs custom
(recommendation: proven open-source CRM foundation over from-scratch).
