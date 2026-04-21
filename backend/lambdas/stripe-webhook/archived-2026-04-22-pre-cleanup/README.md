# Archived pre-cleanup stripe webhook

This folder preserves the live `presttige-stripe-webhook` code that existed before the 2026-04-22 cleanup.

It was archived because it contained legacy Ulttra integration code:

- `ulttra-campaigns`
- `ulttra-daily-reports`
- client/project/campaign/partner defaults
- commission calculation
- daily report writes

The active `stripe-webhook/lambda_function.py` keeps Stripe signature verification and `checkout.session.completed` handling for `presttige-db`, while restoring Presttige/Ulttra isolation.
