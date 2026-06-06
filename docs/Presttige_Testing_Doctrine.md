# Presttige Testing Doctrine

Last updated: 2026-06-06.

## Authorized Test Addresses

Only these four addresses may ever be treated as Presttige test or synthetic records:

- `antoniompereira@me.com`
- `codex.subscriber.tester@presttige.net`
- `analuisasf@gmail.com`
- `fq@freequenza.net`

No other email may be created, updated, or marked as `synthetic_test=true`, `test_tier=true`, `is_test=true`, or `subscriber_type=test`.

## Production Data Rule

The production database `presttige-db` must stay clean of fake data. Test and synthetic records are allowed only for the four authorized addresses above, must carry `synthetic_test=true`, and must be excluded from all metrics, analytics, dashboards, counts, and real communication sets.

If a request tries to create a test or synthetic record for any other email, the server must refuse it. The system must not silently convert an unauthorized email into a test record.

## Codex Rule

Codex may use only its own Presttige test identity for account and member-flow tests:

- `codex.subscriber.tester@presttige.net`

Codex must not create new test records except when Antonio explicitly authorizes one of the four addresses above for a specific task. Codex must never create ad hoc plus-addresses or placeholder test users.

Any Codex-initiated test email send must go only to:

- `fq@freequenza.net`

No other email destination is self-authorized. If any other destination is needed, Codex must ask Antonio first.

## Tester Tier Model

The three Presttige member testers are real Presttige member records with `tier=tester`, `selected_tier=tester`, and `effective_tier=tester`. Their active simulation target is stored in `simulated_tier`, default `free`. Tester is a synthetic technical tier only, not a public or commercial membership tier.

The three member testers are:

- `antoniompereira@me.com`
- `codex.subscriber.tester@presttige.net`
- `analuisasf@gmail.com`

They always carry `synthetic_test=true` and remain excluded from every metric, dashboard, count, analytic, and real communication set.

The FQ record, `fq@freequenza.net`, is not a normal member tester tier. It is the fixed send and receive test address, marked with `test_email_role=send_receive`, `test_send_receive_address=true`, `test_always_active=true`, and `test_never_expires=true`.

## Guard Location

The readable allowlist lives in `shared/testers.py` and is mirrored for future Node handlers in `shared/testers.js`.

The current server-side creation guards are enforced in:

- `backend/lambdas/create-lead/lambda.py`, public lead creation rejects unauthorized test markers and only marks the four authorized addresses as test or synthetic.
- `backend/lambdas/founder-test-harness/lambda_function.py`, synthetic Founder test preparation is restricted to the same four exact emails.
- `backend/lambdas/founder-test-harness/lambda_function.py`, email-send actions are restricted to `fq@freequenza.net`.
