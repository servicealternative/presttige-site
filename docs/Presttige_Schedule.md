# PRESTTIGE SCHEDULE

Status: open-items schedule. No secrets or token values.

## Scheduled / Parked

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

## Next Active Plan

- Finish the full Founder process:
  1. `/founder` checkbox to payment, reuse proven live mechanism, no payment
     tests.
  2. Activation `founder_invited` to Founder post-payment.
  3. Submission flow and Antonio approval panel.
  4. The two automatic emails.
- Do the Founder process alongside or right after SES.
- SES: resolve email deliverability, prerequisite for the two Founder emails
  and all email automation. Run in parallel with the Founder build.
