# Presttige Technical Radiography Snapshot

Snapshot date: 2026-04-21  
AWS account observed: `343218208384`  
Scope: read-only inspection. No system changes were made during the snapshot.

## 1. AWS Infrastructure Inventory

| Service | Region(s) | Purpose | Current configuration highlights |
|---|---:|---|---|
| Lambda | `us-east-1` | Backend execution for leads, verification, Step 2, review, invites, Stripe/payment logic | 11 live functions, Python `3.12`, ZIP packages, x86_64, mostly 128 MB, mostly 3s timeout |
| API Gateway | `us-east-1` | Public HTTP API for site forms, verification, review, checkout gateway | HTTP API `presttige-api`, API ID `rwkz3d86u0`, stages `$default` and `prod`, CORS configured for `presttige.net` and `www.presttige.net` |
| DynamoDB | `us-east-1` | Central lead/application/payment/affiliate data store | Main table `presttige-db`, on-demand, PK `lead_id`, no GSIs/LSIs |
| SES | `us-east-1`, `eu-west-1` | Transactional email sending | Production access enabled in both regions; domain `presttige.net` verified; DKIM success |
| S3 | Global / inferred | Static site origin | Confirmed by live headers: `server: AmazonS3`; bucket inventory not accessible with current IAM |
| CloudFront | Global / inferred | CDN for website | Confirmed by live headers: `x-cache`, `via ... cloudfront.net`; distribution inventory not accessible with current IAM |
| Route53 | Global / inferred | DNS for `presttige.net` | DNS SOA shows AWS nameserver; hosted zone listing not accessible with current IAM |
| CloudWatch Logs | `us-east-1` | Lambda logs | Log groups exist for Presttige Lambdas; no metric filters observed; no alarms observed |
| IAM | Global | Execution roles and current technical user | Function roles exist; current user is `codex-presttige-deploy`; IAM listing not accessible |
| Secrets Manager | Unknown | Not confirmed | `ListSecrets` denied; code uses Lambda env vars and at least one live hardcoded secret |
| SQS | Unknown | Not confirmed | `ListQueues` denied; no code references found |
| SNS | `us-east-1` | Not currently used | `list-topics` returned empty |
| Cognito | Unknown | Not confirmed | `ListUserPools` denied; no code references found |

## 2. Lambda Functions

Account concurrency limit: `1000`. Reserved concurrency: none detected for listed functions.

| Function | Runtime | Memory / timeout | Trigger | Purpose | Dependencies | Env vars |
|---|---:|---:|---|---|---|---|
| `presttige-create-lead` | Python 3.12 | 128 MB / 3s | API Gateway `POST /create-lead` | Step 1 lead creation, verification email | `boto3`, local `email_utils`, SES, DynamoDB, hmac/hashlib | `TOKEN_SECRET` |
| `presttige-verify-email` | Python 3.12 | 128 MB / 3s | API Gateway `GET/OPTIONS /verify-email` | Verify email token, redirect to Step 2 | `boto3`, DynamoDB scan | none |
| `presttige-submit-access` | Python 3.12 | 128 MB / 3s | API Gateway `POST/OPTIONS /submit-access` | Step 2 profile submit, A4 Application Received email | `boto3`, SES templated email, DynamoDB | none |
| `presttige-review-action` | Python 3.12 | 128 MB / 3s | API Gateway `GET /review` | Review approve/reject/standby via tokenized URL | `boto3`, DynamoDB | none |
| `presttige-send-invite` | Python 3.12 | 128 MB / 3s | No resource policy detected; likely manual/EventBridge intended | Sends old-style invite/payment link after approval | `boto3`, SES, DynamoDB | none |
| `presttige-gateway` | Python 3.12 | 128 MB / 15s | API Gateway `ANY /gateway`, public Lambda Function URL | Stripe Checkout session creation | `boto3`, `stripe-layer`, Stripe | `STRIPE_SECRET_KEY`, `TOKEN_SECRET`, all price IDs, `SUCCESS_URL`, `CANCEL_URL` |
| `presttige-stripe-webhook` | Python 3.12 | 128 MB / 3s | Public Lambda Function URL | Stripe webhook for `checkout.session.completed`, updates lead/payment/Ulttra reports | `boto3`, `stripe-layer`, DynamoDB | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `presttige-stripe-gateway` | Python 3.12 | 128 MB / 195s | Public Lambda Function URL | Legacy validation gateway; current live code does not create Stripe Checkout | `boto3`; layer attached but code does not import Stripe | `STRIPE_SECRET_KEY` |
| `presttige-validate` | Python 3.12 | 128 MB / 3s | Route exists as `POST /validate` but no target shown in API route output | Member/access validation by lead/token/payment status | `boto3`, DynamoDB | none |
| `presttige-member` | Python 3.12 | 128 MB / 3s | Route exists as `POST /member` but no target shown in API route output | Member area status fetch | `boto3`, DynamoDB | none |
| `presttige-founder-confirm` | Python 3.12 | 128 MB / 3s | Public Lambda Function URL | Legacy founder confirmation flow, schedules follow-up | `boto3`, SES, EventBridge Scheduler | none |

Lambda layer:

| Layer | Region | Version | Purpose |
|---|---:|---:|---|
| `stripe-layer` | `us-east-1` | `1` | Stripe Python package for checkout/webhook functions |

## 3. DynamoDB Tables

| Table | PK | SK | GSIs / LSIs | Capacity | Approx count | Approx size |
|---|---|---|---|---|---:|---:|
| `presttige-db` | `lead_id` S | none | none | On-demand | describe: 59, scan: 63 | 29,748 bytes; approx 504 bytes/item by table metric |
| `ulttra-campaigns` | `campaign_id` S | none | none | On-demand | 1 | 328 bytes |
| `ulttra-clients` | `client_id` S | none | none | On-demand | 1 | 98 bytes |
| `ulttra-commission-rules` | `rule_id` S | none | none | On-demand | 1 | 423 bytes |
| `ulttra-daily-reports` | `report_id` S | none | none | On-demand | 0 | 0 bytes |
| `ulttra-partners` | `partner_id` S | none | none | On-demand | 1 | 315 bytes |
| `ulttra-projects` | `project_id` S | none | none | On-demand | 1 | 120 bytes |

Observed `presttige-db` attributes and DynamoDB types:

`lead_id S`, `name S`, `email S`, `country S`, `application_type S`, `source S`, `campaign_id S`, `referral_code S`, `email_status S`, `phone_status S`, `profile_status S`, `review_status S`, `application_received_sent BOOL`, `application_received_sent_at S/NULL`, `verification_token S`, `created_at S`, `updated_at S`, `age S`, `city S`, `phone S`, `phone_country S`, `instagram S`, `linkedin S`, `occupation S`, `company S`, `website S`, `tiktok S`, `bio S`, `why S`, `profile_submitted_at S`, `review_token S`, `reviewed_at S`, `approval_cycle N`, `invite_status S`, `invite_send_at N`, `invite_expires_at N`, `reminder_due_at N`, `reinvite_eligible BOOL`, `reinvite_count N`, `token_status S`.

Sanitised example lead item:

```json
{
  "lead_id": {"S": "fdm_example1234"},
  "name": {"S": "Example Member"},
  "email": {"S": "member@example.com"},
  "country": {"S": "United Arab Emirates"},
  "application_type": {"S": "access"},
  "source": {"S": "hero"},
  "campaign_id": {"S": ""},
  "referral_code": {"S": "hero"},
  "email_status": {"S": "verified"},
  "phone_status": {"S": "pending"},
  "profile_status": {"S": "profile_submitted"},
  "review_status": {"S": "pending"},
  "application_received_sent": {"BOOL": true},
  "application_received_sent_at": {"S": "2026-04-21T11:31:15.516561+00:00"},
  "verification_token": {"S": "sha256_hex_token"},
  "created_at": {"S": "2026-04-21T00:00:00"},
  "updated_at": {"S": "2026-04-21T11:31:15.516561+00:00"},
  "age": {"S": "35"},
  "city": {"S": "Dubai"},
  "phone": {"S": "+0000000000"},
  "instagram": {"S": "example.handle"},
  "bio": {"S": "Sanitised free-text response."},
  "why": {"S": "Sanitised free-text response."}
}
```

## 4. API Gateway / Endpoints

Base endpoint: `https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com`  
Production site uses `/prod/...` for Step 1 and Step 2.

| Method | Path | Auth | Rate limiting | Lambda / integration | Purpose |
|---|---|---|---|---|---|
| `POST` | `/create-lead` | None | None configured in route settings | `presttige-create-lead` | Step 1 submit, create lead, send verify email |
| `OPTIONS` | `/create-lead` | None | None configured | No target shown | CORS preflight |
| `GET` | `/verify-email` | None | None configured | `presttige-verify-email` | Email verification redirect |
| `OPTIONS` | `/verify-email` | None | None configured | `presttige-verify-email` | CORS/preflight or options handling |
| `POST` | `/submit-access` | None | None configured | `presttige-submit-access` | Step 2 submit, A4 email |
| `OPTIONS` | `/submit-access` | None | None configured | `presttige-submit-access` | CORS preflight |
| `GET` | `/review` | None | None configured | `presttige-review-action` | Tokenized approve/reject/standby URL |
| `ANY` | `/gateway` | None | None configured | `presttige-gateway` | Stripe checkout gateway |
| `POST` | `/validate` | None | None configured | No target shown in route output | Intended access/member validation; may be misconfigured |
| `POST` | `/member` | None | None configured | No target shown in route output | Intended member status; may be misconfigured |

CORS:

| Setting | Value |
|---|---|
| Allowed origins | `https://presttige.net`, `https://www.presttige.net` |
| Allowed methods | `POST`, `OPTIONS` |
| Allowed headers | `content-type`, `accept`, `*` |
| Credentials | false |
| MaxAge | 0 |

## 5. SES Setup

| Item | `us-east-1` | `eu-west-1` |
|---|---|---|
| Production access | true | true |
| Daily quota | 50,000 | 50,000 |
| Send rate | 14/sec | 14/sec |
| Sent last 24h at snapshot | 18 | 3 |
| Domain `presttige.net` | Verified | Verified |
| DKIM | Success | Success |
| Custom MAIL FROM | `mail.presttige.net`, success | Not configured |
| Configuration sets | Not checked in us-east-1 | none |
| Suppression list | BOUNCE/COMPLAINT enabled | empty at snapshot |

DNS:

| Record | Observed value |
|---|---|
| SPF root | `v=spf1 include:amazonses.com ~all` |
| DMARC | `v=DMARC1; p=none;` |
| MAIL FROM MX | `mail.presttige.net -> feedback-smtp.us-east-1.amazonses.com` |
| MAIL FROM SPF | `v=spf1 include:amazonses.com ~all` |

Transactional template:

| Template | Region | Current use |
|---|---:|---|
| `presttige_transactional_v1` | `eu-west-1` | A4 Application Received via `presttige-submit-access` |

Bounce/complaint handling:

| Area | Status |
|---|---|
| SES feedback forwarding | enabled on identity |
| SNS topics | none in `us-east-1` |
| Configuration sets | none in `eu-west-1` |
| Dedicated bounce/complaint pipeline | not implemented yet |

## 6. Frontend / Site

| Area | Current state |
|---|---|
| Hosting | Static site confirmed via S3 origin and CloudFront headers |
| Framework | Static HTML/CSS/JS; no `package.json`; no React/Next build pipeline detected |
| Main files | `index.html`, `access-form.html`, `offer.html`, static legal/status pages |
| Step 1 submit | `POST https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/prod/create-lead` |
| Step 2 submit | `POST https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com/prod/submit-access` |
| Offer validation | `GET .../prod/stripe-gateway` in `offer.html`, but API route inventory does not show `/stripe-gateway` |
| Validation/member JS | `assets/js/app.js` uses `/gateway`, `/validate`, `/member` without `/prod`; routes `/validate` and `/member` appear untargeted |
| Client validation | Vanilla JavaScript only |
| Analytics | Google tag `G-H7BFLVL4F5` on `index.html`, `access-form.html`, `offer.html`, `confirm.html` |

## 7. Third-Party Integrations

| Service | Current integration |
|---|---|
| Stripe | `presttige-gateway` creates Checkout Sessions; `presttige-stripe-webhook` handles `checkout.session.completed`; Stripe Python package supplied by `stripe-layer` |
| Google Analytics | `gtag.js`, measurement ID `G-H7BFLVL4F5` |
| SES | Primary email provider |
| CRM | None detected |
| Affiliate/partner tracking | Implemented internally through `ulttra-*` DynamoDB tables and Stripe metadata/referral fields |
| Tally | Legacy page references exist only under `legacy/`; not part of current live Step 1/Step 2 flow |

Stripe webhook subscribed events:

| Event | Confirmed in code |
|---|---|
| `checkout.session.completed` | yes |
| Other events | ignored if received |

Stripe API version:

| Status |
|---|
| Not discoverable from local code or Lambda env; must be checked in Stripe Dashboard |

## 8. Authentication and Admin

| Area | Current state |
|---|---|
| Reviewer/admin access | Tokenized public review URL via `GET /review?action=...&lead_id=...&review_token=...` |
| Admin dashboard | No dashboard detected in repo or AWS inventory |
| Admin authentication | No Cognito/custom login detected; review token acts as capability token |
| IAM-only admin tooling | AWS Console/IAM used operationally |
| Review implementation note | Live `presttige-review-action` is simpler than repo version and does not require reviewer ID/scores |

## 9. Secrets and Credentials Management

| Secret type | Current storage |
|---|---|
| `TOKEN_SECRET` | Lambda environment variable in some functions |
| Stripe secret key | Lambda environment variable in Stripe functions |
| Stripe webhook secret | Lambda environment variable in webhook |
| Price IDs | Lambda environment variables |
| Legacy hardcoded secret | Live `presttige-stripe-gateway` contains hardcoded `SECRET` in code |
| Secrets Manager | Not confirmed; `ListSecrets` denied and no code references found |
| Rotation | No rotation mechanism observed |

Values intentionally omitted.

## 10. Monitoring and Logging

CloudWatch log groups observed:

`/aws/lambda/presttige-create-lead`, `/aws/lambda/presttige-verify-email`, `/aws/lambda/presttige-submit-access`, `/aws/lambda/presttige-review-action`, `/aws/lambda/presttige-send-invite`, `/aws/lambda/presttige-gateway`, `/aws/lambda/presttige-stripe-gateway`, `/aws/lambda/presttige-stripe-webhook`, `/aws/lambda/presttige-founder-confirm`, plus older `presttige-founder-intake` and `presttige-founder-followup`.

| Monitoring area | Current state |
|---|---|
| CloudWatch Logs | enabled by Lambda default |
| Metric filters | 0 on observed log groups |
| Alarms | none in `us-east-1` |
| Dashboards | not checked; no evidence in repo |
| Error tracking | no Sentry/Rollbar detected |
| Custom metrics | none detected |
| Log retention | no explicit retention shown; likely never expire by default |

## 11. Deployment Pipeline

| Area | Current state |
|---|---|
| Repo | Monorepo: static frontend, backend Lambda source, docs, legacy pages |
| Remote | `https://github.com/servicealternative/presttige-site.git` |
| Current branch | `main` |
| Last relevant commit before this doc | `f6d0f73 Fix application received email logo URL` |
| Frontend deployment | Static files hosted on S3/CloudFront; CI/CD not visible in repo |
| Lambda deployment | Manual ZIP packaging/upload/AWS CLI updates |
| IaC | No SAM/CDK/Terraform/Serverless config detected |
| Staging | No separate staging environment detected |
| API stages | `$default` and `prod` exist on same HTTP API |
| Backups/rollback | Git commits exist; no formal release/versioning pipeline detected |

## 12. Known Limitations / Technical Debt

| Risk | Why it matters for 1 -> 500k leads |
|---|---|
| DynamoDB `presttige-db` has no GSIs | Verification uses scans by `verification_token`; this will degrade badly at scale |
| Public APIs have no auth/rate limiting | Step 1/Step 2 can be spammed; no WAF/API throttling visible |
| Manual Lambda ZIP deploys | High risk of drift, missed files, wrong handler, no repeatability |
| Live/repo drift exists | Live `verify-email`, `review-action`, `send-invite`, and legacy functions differ from current repo source |
| Secrets in env vars and one hardcoded secret | Not ideal for rotation, audit, or blast-radius control |
| SES region split | Verify/invite use `us-east-1`; A4 uses `eu-west-1`; operational complexity |
| No queue between form submit and email | SES latency/failure directly affects user request path |
| No DLQ/retry architecture | Failed emails or partial updates rely on inline exception handling |
| No bounce/complaint automation | SES suppression exists, but no SNS/config-set pipeline observed |
| No alarms | Failures can go unnoticed until manually tested |
| No load test evidence | 3s Lambda timeouts and scan-based reads have not been proven under load |
| Tokenized review is public URL based | Simpler than real admin auth; acceptable for MVP but fragile for team scale |
| `/validate` and `/member` routes appear untargeted | Frontend references may not work as expected |
| Legacy Function URLs are public with `AuthType: NONE` | `gateway`, `stripe-webhook`, `stripe-gateway`, `founder-confirm` are publicly invokable |
| Single-table lead model is not indexed for operations | Review queues, country segmentation, status queries, and retries will require scans or new indexes |
| No IaC/source-controlled AWS state | Rebuilding the environment from scratch would be manual and error-prone |

## Closed / Frozen Areas

| Area | Status |
|---|---|
| Frontend visual design | frozen |
| A4 Application Received | frozen |
| SES transactional template visual design | frozen |
| Presttige design rules | governed by `presttige_matriz_e_regras.md` |
| This snapshot | read-only; no system changes made during report generation |

No further system changes should be made until architectural decisions are made from this snapshot.
