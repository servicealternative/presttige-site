# Restore Notes, Cognito ULTTRA Rename Backup, 2026-06-06

This folder captures the current state before any attempted rename of Cognito pool `presttige-internal`, id `us-east-1_s5PvTEeHv`, and hosted UI domain `presttige-internal`.

No live configuration was changed while creating this backup.

## Backup Contents

- `cognito-user-pool-describe.json`, full `describe-user-pool` output.
- `cognito-app-clients-list.json`, app client list.
- `cognito-app-clients-describe.sanitized.json`, app client details with `ClientSecret` redacted and `ClientSecretPresent` noted.
- `cognito-user-pool-domain-describe.json`, hosted UI domain details.
- `cognito-resource-servers.json`, resource server export.
- `cognito-groups.json`, Cognito groups.
- `cognito-users.json`, Cognito users and attributes.
- `cognito-users-in-group-Admins.json`, members of the `Admins` group.
- `cognito-users-with-group-membership.json`, users with group memberships.
- `directus-ecs-service-describe.json`, current Directus ECS service state.
- `directus-ecs-service-summary.json`, summarized ECS service state.
- `directus-task-definition-full.json`, full active Directus task definition.
- `directus-oidc-ecs-auth-config.sanitized.json`, auth/OIDC ECS environment with secret references redacted.
- `references-presttige-internal-repo.txt`, repo references to `presttige-internal`, excluding this backup folder.
- `references-presttige-internal-ssm-parameter-names.json`, SSM parameter names containing `presttige-internal`.
- `references-presttige-internal-secret-names.json`, Secrets Manager names containing `presttige-internal`.
- `references-presttige-internal-summary.json`, reference scan counts.

## What Cannot Be Exported

AWS Cognito does not export user passwords or TOTP authenticator secrets. They are not included in this backup.

This is expected and not a risk for a pool name or hosted domain rename, because those operations do not delete the user pool or users. Existing user credentials and MFA devices remain on the same pool as long as the pool itself is not recreated.

## Restore Pool Friendly Name

If only the user pool friendly name was changed, restore the name to `presttige-internal` in the Cognito console, or use `UpdateUserPool` with the full current pool configuration.

Important: do not call `update-user-pool` with only `--pool-name`, because Cognito update calls can reset omitted settings to defaults. Start from the current `describe-user-pool` output, preserve all settings, and change only `PoolName`.

The saved original name is in:

```text
cognito-user-pool-describe.json
```

## Restore Hosted UI Domain

If the hosted UI domain was changed from `presttige-internal` to `ulttra-internal`, restore it only after confirming the old prefix is available.

Original domain state is in:

```text
cognito-user-pool-domain-describe.json
```

Restore approach:

1. Confirm current domain state:

```bash
aws cognito-idp describe-user-pool --user-pool-id us-east-1_s5PvTEeHv --region us-east-1
```

2. If the active domain is `ulttra-internal`, remove that domain:

```bash
aws cognito-idp delete-user-pool-domain \
  --user-pool-id us-east-1_s5PvTEeHv \
  --domain ulttra-internal \
  --region us-east-1
```

3. Recreate the original domain:

```bash
aws cognito-idp create-user-pool-domain \
  --user-pool-id us-east-1_s5PvTEeHv \
  --domain presttige-internal \
  --region us-east-1
```

4. Wait for the domain status to be active:

```bash
aws cognito-idp describe-user-pool-domain \
  --domain presttige-internal \
  --region us-east-1
```

## Restore Directus OIDC Configuration

The original Directus ECS task definition ARN and auth env are saved in:

```text
directus-ecs-service-summary.json
directus-task-definition-full.json
directus-oidc-ecs-auth-config.sanitized.json
```

If a later task definition breaks CRM login, restore the saved task definition revision:

```bash
aws ecs update-service \
  --cluster ulttra-crm-directus \
  --service ulttra-crm-directus \
  --task-definition <saved taskDefinitionArn> \
  --region us-east-1
```

Then wait until the service is stable:

```bash
aws ecs wait services-stable \
  --cluster ulttra-crm-directus \
  --services ulttra-crm-directus \
  --region us-east-1
```

## Restore Repo References

Repo references to `presttige-internal` before the rename are listed in:

```text
references-presttige-internal-repo.txt
```

If a later code/doc change replaces these references with `ulttra-internal` and must be reverted, use this list as the restore checklist. Update only the files that were intentionally changed during the rename task.

## Restore SSM and Secrets Names

The pre-rename scan found SSM parameter names and Secrets Manager names in these files:

```text
references-presttige-internal-ssm-parameter-names.json
references-presttige-internal-secret-names.json
```

These scans check names only, not secret values. If later work creates new parameters or secrets for `ulttra-internal`, do not delete or rename any secret without a separate explicit order.

## Post-Restore Verification

After any restore, verify:

1. Cognito pool ID remains `us-east-1_s5PvTEeHv`.
2. Cognito pool name is back to `presttige-internal`, if that was the restore target.
3. Hosted UI domain is active at `presttige-internal`.
4. Directus login buttons for `ULTTRA chairman` and `ULTTRA admin` render.
5. `https://crm.ulttra.net/admin` reaches Cognito login and returns through the configured callback.
6. No users were deleted.

