Ulttra Compliance Group A restore notes, 2026-06-06

This folder captures the pre-change state for the Ulttra compliance Group A run.

Restore source
- Restore `backend/founder-admin/lambda_function.py` from `source/backend/founder-admin/lambda_function.py`, then redeploy `presttige-founder-admin`.
- Restore `infra/ulttra-directus-dashboard/extensions/directus-extension-ulttra-dashboard-endpoint/dist/index.js` from `source/infra/ulttra-directus-dashboard/extensions/directus-extension-ulttra-dashboard-endpoint/dist/index.js`, then rebuild and redeploy the Directus ECS image.

Restore log retention
- Use `aws logs put-retention-policy` or `aws logs delete-retention-policy` according to `aws/log-groups-before.json`.

Restore `ulttra-crm-files` bucket policy
- If `aws/s3-ulttra-crm-files-policy-before.json` contains a previous policy, reapply it with `aws s3api put-bucket-policy`.
- If it was empty or absent, remove the policy with `aws s3api delete-bucket-policy`.

Restore ALB access log attributes
- Reapply the attributes captured in `aws/alb-attributes-before.json` with `aws elbv2 modify-load-balancer-attributes`.

Restore ECS and Lambda references
- `aws/ecs-service-ulttra-crm-directus-before.json` and `aws/ecs-task-definition-ulttra-crm-directus-before.json` capture the prior service and task definition.
- `aws/lambda-presttige-founder-admin-before.json` captures the prior Lambda deployment metadata.

No user records, auth settings, Cognito MFA, Directus roles, Directus permissions, payment logic, or residency settings were part of this backup scope.
