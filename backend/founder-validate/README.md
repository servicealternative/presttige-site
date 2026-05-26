# presttige-founder-validate

Status: redundant; mark for retirement.

This folder records the older token-only Founder validator that is still present
as `presttige-founder-validate` in AWS. It has been superseded by
`presttige-founder-gate`, which implements the approved dual-email gate and the
`founder_token_status` kill switch.

Do not extend this Lambda. Retire the live function and `/founder-validate`
route after all callers have moved to `/founder-gate`.
