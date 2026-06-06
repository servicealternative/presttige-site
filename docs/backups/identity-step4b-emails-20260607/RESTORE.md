# Identity Step 4b Emails Backup, 2026-06-07

This backup was captured before adding activation and welcome email sending to the Step 4a password setup flow.

Restore outline:
1. Restore `backend/lambdas/member-set-password/index.js`, `package.json`, and the package script from `local-current/` or `local-main/` as appropriate.
2. Repackage with `scripts/package-presttige-member-set-password.sh` and update Lambda `presttige-member-set-password`.
3. Restore `subscriber-activated.html` and `welcome.html` from the matching source folder, then redeploy the web branch used by Amplify.
4. Use `aws/lambda` and `aws/api` JSON captures to restore environment, IAM, route, integration, and log settings if needed.
5. Restore tester record fields manually from `tester-records/` only if a test mutation needs to be undone.

Passwords, Cognito TOTP secrets, and member passwords are not exportable. This step does not delete the pool or users.
