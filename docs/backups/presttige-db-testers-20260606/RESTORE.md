# presttige-db testers backup, 2026-06-06

This folder contains DynamoDB typed JSON for the exact records modified or deleted by the tester cleanup task.

## Scope

- Delete candidate: victoriaburca@icloud.com.
- Tester records: antoniompereira@me.com, codex.subscriber.tester@presttige.net, fq@freequenza.net.
- Verification snapshots only: victoriaburca@gmail.com and soloviova.ellen@gmail.com.

## Restore

1. Open MANIFEST.json and identify the record to restore by lead_id and email.
2. For a deleted item, use the saved item under items/<lead_id>.json and put the nested item object back into presttige-db with aws dynamodb put-item.
3. For a modified tester item, use aws dynamodb put-item with the saved pre-change item to restore the full previous state.
4. Re-query email-index for the restored email and confirm exactly one expected record exists.
5. Do not restore verification snapshots unless Antonio explicitly asks, those records were not changed by this task.

No Cognito users, Directus configuration, payment configuration, checkout logic, or funnels are included or changed in this backup.
