# PRESTTIGE SCHEDULE

Status: open-items schedule. No secrets or token values.

## Roadmap

Antonio's order:

1. Founder complete, full funnel: payment plus activation is live, remaining
   work is submission flow plus Antonio approval panel and the two automatic
   emails, SES-dependent.
2. SES emails complete, including the Founder emails.
3. Cleanups and blockers, including parked legacy Stripe test-key cleanup,
   `/gateway` route plus `presttige-gateway` archive plus stripping test keys
   from `presttige-gateway` and `presttige-stripe-webhook`,
   `brand-fonts.css` on non-home pages, retire `presttige-founder-validate`,
   Galyna emails, missing E2 email, retire bootstrap admins after MFA, and
   Ulttra GitHub remote.
4. CRM Phase 2 plus Admin plus GA, sync the 37 real subscribers by state,
   command panel and funnel analytics, GA connection once Viewer access
   propagates. Frozen: no `synthetic_test` data ever in any analytic. Locked
   CRM access model is documented. Dedicated Codex Service Directus user is
   live for schema/build work. Internal-member structural base on
   `people_projects` is DONE. C1 step A1 mirror infrastructure is DONE and
   live, with the mirror currently empty by design. C1 step A2 gate
   eligibility fix is DONE and live; the Galina inviter hole is closed.
5. Subscribers and users: login, photos, profile.
6. Form with interests, etc.
7. Member Cards.
8. Promotion campaigns.
9. App.

## Active Plan

Roadmap items 1 and 2 are active.

- Finish the full Founder process:
  1. `/founder` checkbox to payment, DONE and live.
  2. Activation `founder_invited` to Founder post-payment, DONE and live with
     hardened webhook matching.
  3. Submission flow and Antonio approval panel, remaining.
  4. The two automatic emails, remaining and SES-dependent.
- Do the Founder process alongside or right after SES.
- SES: resolve email deliverability, prerequisite for the two Founder emails
  and all email automation. Run in parallel with the Founder build.

## Scheduled / Parked

Roadmap item 3 is parked until separately approved.

- Legacy Stripe test-key cleanup, separate approved config task:
  disable or remove API Gateway route `ANY /gateway`.
  `presttige-gateway` is dead, 0 invocations in 30 days, no live caller.
  Then archive `presttige-gateway` and strip its TEST `STRIPE_SECRET_KEY`
  plus legacy price environment variables. Remove unused TEST environment
  variables `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` from
  `presttige-stripe-webhook`. Keep SSM `/presttige/stripe/webhook-secret`.
  Do not touch `presttige-create-checkout-session`,
  `presttige-checkout-status`, `presttige-db`, or the real live member.
  Low risk, targets confirmed dead or unused.
- Non-home pages still load `brand-fonts.css`, font fix.
- Retire redundant `presttige-founder-validate` Lambda.
- Galyna: welcome-email "Patron for life" copy fix, interest email.
- Ulttra repo: add GitHub remote, currently local only.
- Retire bootstrap admins after MFA confirmed via clean logout/login.
- `/founder` page: design and all copy/content review, technically approved
  only.
- Missing E2 email.
- Review and safely commit or stash the parked uncommitted worktree work:
  tier-select redesign, subscriber-activated redesign, payment-failed page,
  welcome and index redirect changes, verify-email country propagation,
  tier-select-fetch, `STRIPE-REBUILD-PLAN` doc, `dist.zip` artifacts, image
  zip, and `index.html.pre-T3-backup`. Uncommitted work is a loss risk and
  makes deploys delicate.

## Future Phases

Roadmap items 4 and later are future phases.

- CRM Phase 2 plus Admin plus GA:
  1. Internal-member structural base on `people_projects`, DONE.
  2. C1 step A1 mirror infrastructure, DONE.
  3. C1 step A2, gate eligibility fix, DONE.
  4. Build branch B, Founder tree, pending Antonio's two confirmations.
  5. Build the permissions area, Standards per type, permissions plus
     visibility plus dashboard.
  6. Only then run the controlled Ambassador test.
- Subscribers and users: login, photos, profile.
- Form with interests, etc.
- Member Cards.
- Promotion campaigns.
- App.
