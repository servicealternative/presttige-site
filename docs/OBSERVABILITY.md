# Observability — CloudWatch + X-Ray

## Dashboard

Single production dashboard: **`presttige-production`**

URL: `https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=presttige-production`

Widgets:
- **Lambda Invocations** (stacked) — request volume per Lambda
- **Lambda Errors** (stacked) — failures per Lambda
- **Lambda Duration p99** (lines) — latency per Lambda
- **DynamoDB Throttled Requests** — capacity issues

## Alarms (14 total, all → `presttige-ops-alerts` SNS topic)

### Error rate (6 alarms)

Per-Lambda alarm: triggers when error rate > 5% over 5 minutes.
Computed via metric math: `(Errors / Invocations) × 100`.

### Duration (6 alarms)

Per-Lambda alarm: triggers when p99 duration > 80% of timeout.
- 5 Lambdas with 3s timeout: threshold 2400ms
- presttige-gateway with 15s timeout: threshold 12000ms

### DynamoDB UserErrors (2 alarms)

Per-table alarm: triggers when UserErrors > 10 over 5 minutes.
Tables: `presttige-db`, `presttige-review-audit`.

## X-Ray tracing

All 6 Lambdas have **Active** tracing mode enabled. View distributed traces:
`https://us-east-1.console.aws.amazon.com/xray/home?region=us-east-1#/service-map`

X-Ray write access via `AWSXRayDaemonWriteAccess` policy attached to each Lambda role.

## SNS routing

| Topic | Purpose | Subscribers |
|---|---|---|
| `presttige-cost-alerts` | Budgets + Cost Anomaly | info@presttige.net |
| `presttige-ops-alerts` | CloudWatch Alarms (errors, latency, DynamoDB) | info@presttige.net |

Filter Apple Mail by `To:` header to separate cost from ops in inbox.

## Adding a new Lambda

1. After Lambda creation, enable X-Ray:
   `aws lambda update-function-configuration --function-name <name> --tracing-config Mode=Active --region us-east-1`
2. Attach X-Ray policy to its role:
   `aws iam attach-role-policy --role-name <role-name> --policy-arn arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess`
3. Add Invocations + Errors + Duration metrics to dashboard JSON.
4. Add error-rate + duration alarms (copy pattern from existing).
5. Update this document.

## Troubleshooting

- **No traces in X-Ray:** verify `TracingConfig.Mode` is `Active` (not `PassThrough`), and role has `AWSXRayDaemonWriteAccess` attached.
- **Alarms not firing:** check `ActionsEnabled=true`, SNS topic policy allows `cloudwatch.amazonaws.com:Publish`.
- **Dashboard widgets empty:** Lambdas may have no recent invocations. Confirm metric names + dimensions are exact.
