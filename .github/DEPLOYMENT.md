# Lambda Deployment Pipeline

Backend Lambdas auto-deploy on push to `main` via GitHub Actions + AWS OIDC.

## Architecture

1. Push to `main` triggers `.github/workflows/deploy-lambdas.yml` if these paths change: `backend/**`, `shared/**`, `scripts/package-*.sh`, or the workflow file itself.
2. `detect-changes` determines affected Lambdas via per-Lambda dependency filters.
3. `deploy` packages each affected Lambda, assumes the AWS deploy role via OIDC, runs `aws lambda update-function-code`, verifies `CodeSha256`, and publishes a Lambda version.

## Per-Lambda dependency map

| Lambda | Path triggers | Dependencies |
| --- | --- | --- |
| `presttige-create-lead` | `backend/lambdas/create-lead/`, `backend/email_utils.py`, `backend/email/`, `shared/` | Inline transactional email templates |
| `presttige-verify-email` | `backend/lambdas/verify-email/`, `shared/` | `shared/testers.py` |
| `presttige-submit-access` | `backend/lambdas/submit-access/`, `shared/` | SES stored template `presttige_transactional_v1` |
| `presttige-review-action` | `backend/lambdas/review-action/` only | No `shared/` dependency |
| `presttige-stripe-webhook` | `backend/lambdas/stripe-webhook/`, `shared/` | `stripe>=8.0.0,<9.0.0` |
| `presttige-gateway` | `backend/lambdas/gateway/`, `shared/` | `stripe>=8.0.0,<9.0.0` |

## Adding a new Lambda

1. Create `backend/lambdas/<name>/lambda_function.py` or `lambda.py` to match the configured handler.
2. If external Python dependencies are needed, create `backend/lambdas/<name>/requirements.txt`.
3. Create `scripts/package-presttige-<name>.sh`.
4. Add the Lambda's dependency filter to `.github/workflows/deploy-lambdas.yml`.
5. Add the Lambda ARN to IAM policy `presttige-github-actions-lambda-deploy`.

## Rollback procedure

Each successful deploy publishes a Lambda version.

Quick rollback by reverting the commit:

```bash
git revert <bad-commit>
git push origin main
```

Advanced rollback:

```bash
aws lambda list-versions-by-function --function-name <name> --region us-east-1
```

Then deploy the desired version's code package or move an alias if aliases are introduced later.

## Troubleshooting

- `Could not assume role`
  - Confirm the trust policy allows `repo:servicealternative/presttige-site:ref:refs/heads/main`.
  - Pull requests and non-`main` branches are intentionally blocked.
- `CodeSha256 unchanged`
  - This usually means the packaged code is bit-identical to the live code.
- `Module not found: stripe`
  - Confirm the Lambda has `requirements.txt` and the packaging script installs it.
- Workflow not triggering
  - Confirm the change matches the `on.push.paths` filters or the workflow file path.

## Environment variables

This pipeline does not manage Lambda environment variables. Continue managing them in AWS Console or migrate them later to AWS Systems Manager Parameter Store or Secrets Manager.
