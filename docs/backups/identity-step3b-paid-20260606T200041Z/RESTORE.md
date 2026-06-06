# Identity Step 3b Paid Path Backup

Created: 20260606T200041Z

Scope: presttige-stripe-webhook Lambda source and live code, package script, IAM metadata, presttige-members pool state, and authorized synthetic tester records before Step 3b changes.

Restore notes:
1. Restore Lambda code from lambda/presttige-stripe-webhook/code-before.zip with aws lambda update-function-code.
2. Restore Lambda configuration from lambda/presttige-stripe-webhook/configuration.json if environment or runtime settings changed.
3. Restore IAM role/policies from iam/ only if Step 3b IAM changes must be rolled back.
4. Restore tester records only by exact lead_id using items/authorized-testers-before.json.
5. Cognito passwords and TOTP secrets are not exportable by AWS.
