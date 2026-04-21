# Decisions Log

## 2026-04-21 — Item 14: migrate `presttige-stripe-gateway` legacy secret

- Decision: move the legacy HMAC secret used by the live `presttige-stripe-gateway` Lambda out of source code and into AWS Secrets Manager.
- Secret: `arn:aws:secretsmanager:us-east-1:343218208384:secret:presttige/stripe-gateway/legacy-secret-wyflRJ`.
- Lambda role policy: `presttige-stripe-gateway-secret-access` on `presttige-stripe-gateway-role-7zy9eu6r`.
- Runtime behavior: Lambda fetches the secret from Secrets Manager on cold start and caches it in memory for warm invocations.
- Scope: security-only change; no frontend, email, Stripe checkout behavior, API structure, or DynamoDB schema changes.
