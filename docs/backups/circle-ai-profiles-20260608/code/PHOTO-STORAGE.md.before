# Presttige Photo Storage Infrastructure

## Architecture Overview

Photos uploaded by applicants flow through this layered architecture:

1. Browser uploads original photo directly to S3 via pre-signed POST URL (Round B2)
2. S3 originals bucket triggers thumbnail Lambda (Round B2)
3. Thumbnails written to thumbnails bucket
4. CloudFront serves thumbnails via signed URLs to committee email recipients (Round B3)
5. WAF protects all CloudFront traffic
6. KMS encrypts all data at rest

## Resources

### KMS
- Alias: `alias/presttige-photos`
- Key ARN: `arn:aws:kms:us-east-1:343218208384:key/723bb788-9911-4c49-bf1d-792b73685e7c`
- Rotation: enabled (annual, 365 days)
- Customer-managed CMK

### Key Policy Grants
- Account root (default)
- Codex IAM user and Lambda execution roles via IAM permissions enabled by the root key policy statement
- CloudFront service principal (new): `kms:Decrypt` scoped via `aws:SourceArn` to distribution `EPU4BRNGY6CN4`

### S3 Buckets (us-east-1, private, KMS-encrypted)
- `presttige-applicant-photos` — original uploads, browser direct access via pre-signed POST URLs
- `presttige-applicant-photos-thumbnails` — auto-generated thumbnails for committee preview

### CloudFront Distribution
- Distribution ID: `EPU4BRNGY6CN4`
- Domain: `d2arhx2eclkhy0.cloudfront.net`
- Origin: thumbnails bucket via Origin Access Control (OAC `ELXSB2DE4UM5V`)
- Access: HTTPS only, signed URLs only
- WAF: `presttige-photos-waf` attached
- Price class: PriceClass_100

### WAF Web ACL (presttige-photos-waf)
- ARN: `arn:aws:wafv2:us-east-1:343218208384:global/webacl/presttige-photos-waf/23cc04ee-0c60-4d1d-829c-b15f5b126908`
- Scope: CLOUDFRONT (global, anchored in us-east-1)

#### Rules
1. AWS Managed Common Rule Set
2. AWS Managed Known Bad Inputs Rule Set
3. Rate limit: 100 req per 5 min per IP

## Lifecycle Policies (S3)

| Tag | Action | Days |
|---|---|---|
| `retention=tester` | Delete | 7 |
| `retention=rejected` | Delete | 30 |
| `retention=standby` | Delete | 90 |
| `retention=approved` | Indefinite | — |
| (untagged, default) | Transition to STANDARD_IA | 30 |

## Principle: Photo Lifecycle ≠ Lead Lifecycle

S3 photos are deleted per retention policy. DynamoDB lead records persist indefinitely regardless of photo deletion. This protects:

- Anti-fraud (re-application detection)
- Anti-duplication (same applicant tracking)
- Audit trail (committee history)
- GDPR posture (sensitive media deletes; identifying lead metadata retained as legitimate interest)

## CORS Configuration (originals bucket)

- Allowed origins: https://presttige.net, https://www.presttige.net
- Allowed methods: POST, PUT
- Max age: 3000s

## SSM Parameter Discovery (for Lambda code in Round B2)

| Parameter | Purpose |
|---|---|
| `/presttige/photos/kms-key-arn` | KMS key ARN for encryption |
| `/presttige/photos/originals-bucket` | Originals bucket name |
| `/presttige/photos/thumbnails-bucket` | Thumbnails bucket name |
| `/presttige/photos/cloudfront-domain` | CloudFront domain for signed URLs |
| `/presttige/photos/cloudfront-distribution-id` | Distribution ID for invalidations |

## Verification Notes

WAF association with CloudFront distributions is verified via `cloudfront get-distribution-config --query 'DistributionConfig.WebACLId'` rather than `wafv2 get-web-acl-for-resource`, because the latter does not support CloudFront ARNs (CloudFront is a global resource, not regional).

## How Application Code Will Integrate (Round B2 preview)

- Lambda `presttige-photo-upload-init` reads SSM params, generates pre-signed POST URL with KMS encryption headers
- Browser uploads directly to S3 (bypasses Lambda payload limits)
- S3 ObjectCreated event triggers `presttige-thumbnail-generator` Lambda
- Thumbnail Lambda uses Sharp (with libheif for HEIC) to produce 400x400 + 1200x1200 variants
- Variants written to thumbnails bucket
- `presttige-photo-upload-complete` Lambda writes metadata to DynamoDB

## Accepted Photo Formats (Round B2)

- JPEG (.jpg, .jpeg) — universal
- PNG (.png) — screenshots, edited photos
- HEIC (.heic) — iPhone native (>50% mobile market)

WebP excluded (rare in human upload, can be added if demand emerges).
