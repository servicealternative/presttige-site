# Identity Step 3a Free Path Backup

Created: 20260606T195102Z

Scope: presttige-activate-subscriber Lambda source and live code, IAM metadata, presttige-members pool state, and authorized synthetic tester records before Step 3a changes.

Restore notes:
1. Restore Lambda code from lambda/presttige-activate-subscriber/code-before.zip with aws lambda update-function-code.
2. Restore Lambda configuration from lambda/presttige-activate-subscriber/configuration.json if environment or runtime settings were changed.
3. Restore tester records only by exact lead_id using items/authorized-testers-before.json.
4. The Cognito users were not deleted or modified by the backup. Passwords and TOTP secrets are not exportable by AWS.
