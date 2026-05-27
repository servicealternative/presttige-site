---
PRESTTIGE / ULTTRA - NEXT STEP (saved 2026-05-27 end of day)

1. Check Route 53 DNS propagation for ulttra.net (NS records resolved
   to the four AWS nameservers globally). Use dig +short NS ulttra.net
   against 8.8.8.8 and 1.1.1.1.

2. Once propagated, proceed with Directus deployment on AWS:
   - Target architecture: ECS Fargate (built for 1-10MM scale).
   - Database: RDS PostgreSQL (separate from presttige-db).
   - Storage: S3 bucket for files.
   - HTTPS: ACM certificate for crm.ulttra.net.
   - DNS: A/Alias record for crm.ulttra.net to ALB.
   - Auth: Cognito SSO via OpenID Connect, Admins group required.

3. After Antonio logs into Directus successfully, design the master
   CRM blueprint on top of it (entities, projects, workflows) BEFORE
   building specific CRM logic.

4. Founder controls live INSIDE the CRM (Path B). The existing
   presttige-founder-admin Lambda remains the backend; the CRM
   provides the UI.
---
