# CI Deploy Diagnostic - 2026-04-30

- Date: 30 April 2026
- Auditor: Codex CLI
- Repo: `/Users/antonio/Desktop/presttige-site`
- Primary run audited: GitHub Actions `Deploy Lambdas to AWS`, run `25138706916`, commit `15bbd77304473c3a1bab2c8030c82f69c9b0ea18`
- Status: READ-ONLY DIAGNOSTIC
- Scope: diagnose the 18 Lambda deploy failures exposed by expanded CI inventory coverage

## Executive Finding

The `15bbd77` run failed because the GitHub Actions deploy role could only operate on the original 6 Lambda ARNs. The workflow inventory had expanded to 24 Lambdas, but the attached IAM policy still listed only:

- `presttige-create-lead`
- `presttige-gateway`
- `presttige-review-action`
- `presttige-stripe-webhook`
- `presttige-submit-access`
- `presttige-verify-email`

Those same 6 succeeded. The other 18 failed before deployment at `Capture pre-deploy CodeSha256`, which calls `aws lambda get-function-configuration`.

GitHub public job pages expose the failed step and exit code but hide the raw AWS CLI stderr unless signed in. The public annotation for the failed jobs is:

```text
Capture pre-deploy CodeSha256
Process completed with exit code 254.
```

Given the workflow step, exit code, and old IAM policy content, the concrete failure pattern is:

```text
AccessDeniedException on lambda:GetFunctionConfiguration for Lambda ARNs not listed in presttige-github-actions-lambda-deploy policy v1.
```

No evidence was found that the 18 failed because of missing Lambda functions, missing package scripts, missing dependencies, function-name mismatch, or business-logic runtime errors in this `15bbd77` run. They failed before `Deploy Lambda`.

## 1. Failing Job Logs and Failure Patterns

Primary run:

- URL: `https://github.com/servicealternative/presttige-site/actions/runs/25138706916`
- Commit: `15bbd77304473c3a1bab2c8030c82f69c9b0ea18`
- Result: `failure`
- `detect-changes`: `success`
- Deploy jobs: 6 `success`, 18 `failure`

### Pattern A - IAM policy did not include the Lambda ARN

All 18 failing jobs share the same public annotation:

```text
Capture pre-deploy CodeSha256
Process completed with exit code 254.
```

The failed workflow step was:

```bash
aws lambda get-function-configuration \
  --function-name ${{ matrix.lambda }} \
  --region us-east-1 \
  --query CodeSha256 --output text
```

At the time of the run, the attached policy `presttige-github-actions-lambda-deploy` allowed `lambda:GetFunctionConfiguration`, `lambda:UpdateFunctionCode`, `lambda:GetFunction`, and `lambda:PublishVersion` only on the original 6 Lambda ARNs. Therefore the 18 newly covered Lambdas failed at the first Lambda API call.

### Failed Jobs by Lambda

| Lambda | Failed step | Public annotation | Failure category |
|---|---|---|---|
| `presttige-account-create` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-activate-subscriber` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-checkout-context` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-checkout-status` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-cookie-diag` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-create-checkout-session` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-magic-link-verify` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-photo-upload-init` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-photo-upload-status` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-review-fetch` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-send-application-received` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-send-committee-email` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-send-subscriber-welcome-email` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-send-tier-select-email` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-send-welcome-email` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-tester-cleanup` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-thumbnail-generator` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |
| `presttige-tier-select-fetch` | `Capture pre-deploy CodeSha256` | `Process completed with exit code 254.` | IAM ARN missing |

### Succeeded Jobs in the Same Run

These succeeded because their ARNs were already listed in the IAM policy:

- `presttige-create-lead`
- `presttige-gateway`
- `presttige-review-action`
- `presttige-stripe-webhook`
- `presttige-submit-access`
- `presttige-verify-email`

### Secondary Latent Failure Pattern

After the IAM gap is removed, another deployment-contract issue exists unless the workflow supports mixed package output paths:

- older Python package scripts output `/tmp/<lambda>-package.zip`
- many Node package scripts output `backend/<lambda>/dist.zip`

This was not the cause of the 18 failures in `15bbd77`, because those jobs failed before deploy. It is still part of the remediation set needed for a fully green expanded-inventory workflow.

## 2. Failing Lambda Classification

| Lambda | Classification | Feature or route using it | Last source/package touch |
|---|---|---|---|
| `presttige-account-create` | ACTIVE | EventBridge E3 target; initializes approved candidate account/tier flow | `0a766c4` - 2026-04-26 |
| `presttige-activate-subscriber` | ACTIVE | `POST /activate-subscriber`; free Subscriber activation path | `0919624` - 2026-04-27 |
| `presttige-checkout-context` | ACTIVE | M-R4 funnel; `GET/POST /checkout-context` | `15bbd77` - 2026-04-30 |
| `presttige-checkout-status` | ACTIVE | M-R4 welcome status; `GET /checkout-status` | `15bbd77` - 2026-04-30 |
| `presttige-cookie-diag` | ACTIVE | Safari/cookie diagnostic route; `GET /api/cookie-diag` | `6b5a264` - 2026-04-27 |
| `presttige-create-checkout-session` | ACTIVE | M-R3 Payment Element bootstrap; `POST /create-checkout-session` | `15bbd77` - 2026-04-30 |
| `presttige-magic-link-verify` | ACTIVE | Welcome/account activation fallback; `GET /magic-link-verify` | `0a766c4` - 2026-04-26 |
| `presttige-photo-upload-init` | ACTIVE | S2 photo upload start; `POST /photo-upload-init` | `21bedfe` - 2026-04-26 |
| `presttige-photo-upload-status` | ACTIVE | S2 photo upload polling; `GET /photo-upload-status` | `21bedfe` - 2026-04-26 |
| `presttige-review-fetch` | ACTIVE | Committee review read path; `GET /review-fetch` | `b6a17be` - 2026-04-27 |
| `presttige-send-application-received` | ACTIVE | Application-received email path and guarded backfill surface | `9aa6029` - 2026-04-27 |
| `presttige-send-committee-email` | ACTIVE | E2 committee email path; `POST /send-committee-email` | `b6a17be` - 2026-04-27 |
| `presttige-send-subscriber-welcome-email` | ACTIVE | E5-SUB free Subscriber welcome | `6132dd9` - 2026-04-27 |
| `presttige-send-tier-select-email` | ACTIVE | E3 tier-selection email; `POST /send-tier-select-email` | `1593bc2` - 2026-04-30 |
| `presttige-send-welcome-email` | ACTIVE | E5 paid welcome email; invoked by Stripe webhook | `78373c1` - 2026-04-27 |
| `presttige-tester-cleanup` | ACTIVE | Scheduled tester cleanup after E5/E5-SUB | `5011099` - 2026-04-27 |
| `presttige-thumbnail-generator` | ACTIVE | S3 photo thumbnail generation and committee-email fallback | `9aa6029` - 2026-04-27 |
| `presttige-tier-select-fetch` | ACTIVE | Legacy/tier context read still used by `subscriber-activated.html` | `6132dd9` - 2026-04-27 |

No failing Lambda in the `15bbd77` run is clearly legacy. All 18 should remain CI-deployable unless Antonio separately retires a route or feature.

## 3. Proposed Fixes by Category

| Category | Smallest concrete fix | Estimate | Risk |
|---|---|---:|---|
| IAM ARN missing for expanded inventory | Expand `presttige-github-actions-lambda-deploy` policy to include the 24 function ARNs generated from `scripts/package-presttige-*.sh`. | 15-30 minutes | Low |
| Mixed package output paths | Update workflow deploy step to use the zip path emitted by each package script, supporting both `/tmp/<lambda>-package.zip` and `backend/**/dist.zip`. | 30-45 minutes | Low |
| Missing package scripts for M-R4 helpers | Add `scripts/package-presttige-checkout-context.sh` and `scripts/package-presttige-checkout-status.sh`, including `lib/stripe-tier-contract.js`. | 20-30 minutes | Low |
| Shared contract missing from `presttige-create-checkout-session` package | Update `scripts/package-presttige-create-checkout-session.sh` to include `lib/stripe-tier-contract.js`. | 10-15 minutes | Low |
| Node.js 20 action warnings | Bump or configure GitHub actions so they run on Node 24-compatible versions, or set the documented migration environment flag after testing. | 30-60 minutes | Low |

## 4. Live State for All 24 Lambdas

Current live state was checked after the later successful deploy run for commit `1162ddb`. Every Lambda in the expanded inventory exists in AWS and was updated by the green deploy run at approximately `2026-04-29T23:21Z`.

Successful proof runs now available:

- Linear push proof: `https://github.com/servicealternative/presttige-site/actions/runs/25138880640`
- Amend/replace proof: `https://github.com/servicealternative/presttige-site/actions/runs/25138940499`

The amend/replace run includes the expected fallback warning:

```text
Base SHA 43396b4a09370cdf10dceacb64693707e1aa0422 unavailable, deploying ALL Lambdas defensively
```

| Lambda | Exists | Current AWS LastModified | Current drift assessment |
|---|---:|---|---|
| `presttige-account-create` | Yes | `2026-04-29T23:21:24Z` | No drift detected; updated by green full-inventory run |
| `presttige-activate-subscriber` | Yes | `2026-04-29T23:21:20Z` | No drift detected; updated by green full-inventory run |
| `presttige-checkout-context` | Yes | `2026-04-29T23:21:19Z` | No drift detected; updated by green full-inventory run |
| `presttige-checkout-status` | Yes | `2026-04-29T23:21:21Z` | No drift detected; updated by green full-inventory run |
| `presttige-cookie-diag` | Yes | `2026-04-29T23:21:14Z` | No drift detected; updated by green full-inventory run |
| `presttige-create-checkout-session` | Yes | `2026-04-29T23:21:21Z` | No drift detected; updated by green full-inventory run |
| `presttige-create-lead` | Yes | `2026-04-29T23:21:18Z` | No drift detected; updated by green full-inventory run |
| `presttige-gateway` | Yes | `2026-04-29T23:21:17Z` | No drift detected; updated by green full-inventory run, but function is legacy-public and scheduled for later retirement |
| `presttige-magic-link-verify` | Yes | `2026-04-29T23:21:42Z` | No drift detected; updated by green full-inventory run |
| `presttige-photo-upload-init` | Yes | `2026-04-29T23:21:21Z` | No drift detected; updated by green full-inventory run |
| `presttige-photo-upload-status` | Yes | `2026-04-29T23:21:35Z` | No drift detected; updated by green full-inventory run |
| `presttige-review-action` | Yes | `2026-04-29T23:21:15Z` | No drift detected; updated by green full-inventory run |
| `presttige-review-fetch` | Yes | `2026-04-29T23:21:23Z` | No drift detected; updated by green full-inventory run |
| `presttige-send-application-received` | Yes | `2026-04-29T23:21:22Z` | No drift detected; updated by green full-inventory run |
| `presttige-send-committee-email` | Yes | `2026-04-29T23:21:22Z` | No drift detected; updated by green full-inventory run |
| `presttige-send-subscriber-welcome-email` | Yes | `2026-04-29T23:21:22Z` | No drift detected; updated by green full-inventory run |
| `presttige-send-tier-select-email` | Yes | `2026-04-29T23:21:39Z` | No drift detected; updated by green full-inventory run |
| `presttige-send-welcome-email` | Yes | `2026-04-29T23:21:23Z` | No drift detected; updated by green full-inventory run |
| `presttige-stripe-webhook` | Yes | `2026-04-29T23:21:48Z` | No drift detected; updated by green full-inventory run |
| `presttige-submit-access` | Yes | `2026-04-29T23:21:23Z` | No drift detected; updated by green full-inventory run |
| `presttige-tester-cleanup` | Yes | `2026-04-29T23:21:16Z` | No drift detected; updated by green full-inventory run |
| `presttige-thumbnail-generator` | Yes | `2026-04-29T23:21:23Z` | No drift detected; updated by green full-inventory run |
| `presttige-tier-select-fetch` | Yes | `2026-04-29T23:21:16Z` | No drift detected; updated by green full-inventory run |
| `presttige-verify-email` | Yes | `2026-04-29T23:21:14Z` | No drift detected; updated by green full-inventory run |

Important note: there are unrelated uncommitted local workspace changes in `backend/lambdas/verify-email/lambda_function.py` and `docs/STRIPE-REBUILD-PLAN-v2-2026-04-29.md`. They are not committed to `main`, were not part of the CI deploy, and were not touched by this diagnostic.

## 5. Node.js 20 Deprecation Warnings

The GitHub job annotations report Node.js 20 deprecation warnings from these actions:

- `actions/checkout@v4`
- `actions/setup-python@v5`
- `aws-actions/configure-aws-credentials@v4`

GitHub warning text states:

- Node.js 24 becomes the default for JavaScript actions on 2 June 2026.
- Node.js 20 support is removed from the runner on 16 September 2026.

Smallest proposed fix:

- Verify latest major/minor versions of those actions that declare Node 24 compatibility.
- Update the workflow action pins in one dedicated CI-maintenance commit.
- Run the same linear and amend/replace deploy proofs after the bump.

Risk: low, but it should be done separately from Lambda business work because it affects every CI job.

## Conclusion

The `15bbd77` red run was caused by CI permissions debt exposed by expanded Lambda inventory coverage. The live AWS Lambda fleet is currently solid: all 24 functions exist and were updated by the later green full-inventory deploy run from current `main`.

For Antonio's remediation planning, the highest-value next action is not Lambda code work. It is to keep the CI deploy policy, package-script inventory, and package-output contract aligned so future green runs really mean AWS is current.
