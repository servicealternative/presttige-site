# presttige-db Ana anti-fake backup, 2026-06-06

This folder contains the pre-change DynamoDB typed JSON for Ana's personal Gmail tester record, lead_id fdm_c8f2b323a4.

## Restore

1. Open items/fdm_c8f2b323a4-before.json.
2. Use the nested Item value with aws dynamodb put-item to restore the full previous Ana record.
3. Re-query email-index for analuisasf@gmail.com and confirm one record exists with lead_id fdm_c8f2b323a4.

No Cognito users, Directus configuration, payment configuration, checkout logic, or funnels are included or changed in this backup.
