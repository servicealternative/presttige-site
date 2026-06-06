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

Codex must not create new test records except when Antonio explicitly authorizes one of the four addresses above for a specific task. Codex must never create ad hoc plus-addresses or placeholder test users.

## Guard Location

The readable allowlist lives in `shared/testers.py` and is mirrored for future Node handlers in `shared/testers.js`.

The current server-side creation guards are enforced in:

- `backend/lambdas/create-lead/lambda.py`, public lead creation rejects unauthorized test markers and only marks the four authorized addresses as test or synthetic.
- `backend/lambdas/founder-test-harness/lambda_function.py`, synthetic Founder test preparation is restricted to the same four exact emails.
