# Identity Step 3a free path backup, 2026-06-06

This backup captures the pre-change state for the free Subscriber account creation work.

## Contents

- Lambda configuration and code zip for presttige-activate-subscriber.
- IAM role and policy snapshot for presttige-activate-subscriber-role.
- Cognito presttige-members pool, groups, and users before the step.
- DynamoDB records for the three authorized testers used by Step 3a.
- Repo copies of activate-subscriber source and package script before changes.

## Restore notes

1. To restore Lambda code, update presttige-activate-subscriber with lambda/presttige-activate-subscriber/code-before.zip.
2. To restore Lambda configuration or IAM, compare the saved JSON files and apply the previous settings manually.
3. To restore a tester record, put the saved DynamoDB typed item back into presttige-db by exact lead_id.
4. If test Cognito users need removal after rollback, delete only users created for the authorized tester emails listed in MANIFEST.json.
