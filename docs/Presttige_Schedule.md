# PRESTTIGE SCHEDULE

Status: open-items schedule. No secrets or token values.

## Roadmap

Antonio's order:

1. Founder complete, full funnel: payment plus activation is live, remaining
   work is submission flow plus Antonio approval panel and the two automatic
   emails, SES-dependent.
2. SES emails complete, including the Founder emails.
3. Cleanups and blockers, including completed legacy Stripe test-key cleanup,
   completed Directus bootstrap admin retirement, `brand-fonts.css` on
   non-home pages, retire `presttige-founder-validate`, Galyna emails, missing
   E2 email, and Ulttra GitHub remote.
4. CRM Phase 2 plus Admin plus GA, sync the 37 real subscribers by state,
   command panel and funnel analytics, GA connection once Viewer access
   propagates. Frozen: no `synthetic_test` data ever in any analytic. Locked
   CRM access model is documented. Dedicated Codex Service Directus user is
   live for schema/build work. Internal-member structural base on
   `people_projects` is DONE. C1 step A1 mirror infrastructure is DONE and
   live, with the mirror currently empty by design. C1 step A2 gate
   eligibility fix is DONE and live; the Galina inviter hole is closed. C1
   branch B steps B1, B2, B3, B4, B5, and B6 are DONE. Branch B code and
   controlled cleanup are complete. Next: the permissions area, then the
   post-permissions Ambassador test.
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
  4. Founder welcome email on activation, DONE.
  5. Founder invite email scheduler and test harness, DONE.
  6. Controlled test run through the B6 harness, DONE, with the synthetic
     Founder eligibility limitation recorded in Technical State.
  7. Real Founder email sender, copy, and design review, remaining, including
     the founder-admin inviter thank-you plus invitee invitation sender
     decision.
  8. Founder checkout pay button, disabled until Stripe live.
- Do the Founder process alongside or right after SES.
- SES: resolve email deliverability for the controlled Founder test sends and
  all email automation. Run in parallel with the Founder build.

## Scheduled / Parked

Roadmap item 3 is parked until separately approved.

- Legacy Stripe test-key cleanup, DONE:
  `ANY /gateway` removed, `presttige-gateway` archived in place with reserved
  concurrency `0`, gateway `STRIPE_SECRET_KEY` removed, and unused webhook
  env vars `STRIPE_SECRET_KEY` plus `STRIPE_WEBHOOK_SECRET` removed.
  `presttige-create-checkout-session`, `presttige-checkout-status`,
  SSM `/presttige/stripe/*`, `presttige-db`, and the real live member were
  untouched. Legacy Secrets Manager secret `presttige-stripe-secret` remains
  parked for a separate approved deletion decision.
- Follow-up found during cleanup verification:
  `presttige-checkout-status` invalid-token smoke returns a pre-existing
  `dynamodb:Scan` IAM denial. This is separate from Stripe key cleanup.
- Directus bootstrap admin retirement, DONE:
  `bootstrap-admin@ulttra.net` is suspended and has no static token. Antonio's
  Cognito SSO admin and the dedicated Codex Service admin token remain active.
- Non-home pages still load `brand-fonts.css`, font fix.
- Retire redundant `presttige-founder-validate` Lambda.
- Galyna: welcome-email "Patron for life" copy fix, interest email.
- Ulttra repo: add GitHub remote, currently local only.
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
  4. Branch B step B1, Founder-invite config and entitlement field contract,
     DONE.
  5. Branch B step B2, activation stamp and monthly invite scheduler, DONE.
  6. Branch B step B3, wire the Founder branch into the shared eligibility
     function and resolve invite state when the invitee subscribes, DONE.
  7. Branch B step B5, Founder welcome email on activation, DONE.
  8. Branch B step B6, repeatable self-cleaning Founder test harness, DONE.
  9. Branch B step B4, controlled test run with Antonio-controlled addresses
     only, through the B6 harness, DONE.
  10. Build the permissions area, Standards per type, permissions plus
     visibility plus dashboard.
  11. Run the post-permissions Ambassador test.
- Subscribers and users: login, photos, profile.
- Form with interests, etc.
- Member Cards.
- Promotion campaigns.
- App.
