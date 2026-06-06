# presttige-db cleanup backup

Created: 2026-06-06
Region: us-east-1
Account: 343218208384

## Scope

This backup was captured before the ordered cleanup:

- Delete `fdm_552b7cb39c`, `alternativeservice@gmail.com`
- Delete `fdm_founder_63c5385260`, `antoniompereira@icloud.com`
- Delete `fdm_b26verify_1777288502`, `verify@presttige.net`
- Rename `fdm_cdf3687eab`, `franciscompereira202212@gmail.com`
- Adjust role state for `fdm_3cf8337bb7`, `antoniompereira@me.com`

Read-only Victoria investigation snapshots were also captured:

- `fdm_4ce6a9508a`, `victoriaburca@gmail.com`
- `fdm_c5866ef213`, `victoriaburca@icloud.com`
- `fdm_c5c831e5e7`, the lead id named in the order, currently `soloviova.ellen@gmail.com`

## Files

- `items-dynamodb-json/*.json`, full DynamoDB item JSON
- `items-readable.json`, unwrapped readable copy of the same items
- `presttige-db-table-before-cleanup.json`, table description before cleanup
- `presttige-db-pitr-before-cleanup.json`, PITR state before cleanup
- `manifest.json`, capture summary

## Restore notes

To restore a deleted record, use `aws dynamodb put-item` with the matching file in `items-dynamodb-json`.

To reverse the rename or role-state update, compare the live item with its backed-up JSON, then apply an exact `update-item` or `put-item`. Do not use wildcard or pattern deletes.

PITR was enabled before the cleanup and remains the table-level data recovery path.
