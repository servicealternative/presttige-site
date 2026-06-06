# Compliance Group A Restore Notes

Backup captured before compliance group A changes on 2026-06-06.

## Lambda source
Restore files from `source/` to their matching repo paths, then redeploy the affected Lambda functions.

## CloudWatch retention
Use `aws logs put-retention-policy` with the prior `retentionInDays` values from `aws/cloudwatch-log-groups-before.json`. Missing/null means no retention policy was set before.

## CloudTrail
Before this order, `aws/cloudtrail describe-trails --include-shadow-trails` returned the state saved in `aws/cloudtrail-describe-before.json`. To roll back, disable or delete the newly created trail only if Antonio explicitly authorizes that.

## CloudFront
Use `aws/cloudfront update-distribution` with the saved config and ETag from `aws/cloudfront-EPU4BRNGY6CN4-before.json` to restore the previous TLS policy.
