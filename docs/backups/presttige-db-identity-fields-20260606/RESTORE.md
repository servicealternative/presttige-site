# presttige-db identity fields backup

Created: 2026-06-06
Region: us-east-1
Account: 343218208384

## Captured state

- Table: `presttige-db`
- Capture point: before adding `cognito_sub-index`
- Files:
  - `presttige-db-describe-before-gsi.json`
  - `presttige-db-pitr-before-gsi.json`
  - `presttige-db-tags-before-gsi.json`
  - `summary-before-gsi.json`
  - `presttige-db-describe-after-gsi.json`
  - `presttige-db-pitr-after-gsi.json`
  - `summary-after-gsi.json`

## Restore notes

This folder captures the DynamoDB table schema, keys, GSIs, item count, tags, and PITR state before Identity Step 2.

No table items were exported or modified by this backup. Table data remains protected by DynamoDB PITR, which was captured as enabled in `presttige-db-pitr-before-gsi.json`.

The `after-gsi` files record the verified state after `cognito_sub-index` became `ACTIVE`.

If `cognito_sub-index` must be removed, use `update-table` with a `GlobalSecondaryIndexUpdates` delete action for `cognito_sub-index`. Do not delete table items.
