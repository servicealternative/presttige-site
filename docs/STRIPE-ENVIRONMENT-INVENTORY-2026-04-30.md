# STRIPE-ENVIRONMENT-INVENTORY-2026-04-30

Date: 30 April 2026  
Auditor: Codex CLI  
Repo commit audited: `67d28ae88a07318a1de50e55b7bbd365f29f0884`  
Mode: Read-only discovery  
Scope: Stripe keys, Stripe objects, webhook registration, code cross-reference, and documentation drift

No SSM parameters, Lambda configuration, Stripe objects, webhook destinations, DNS records, or lead records were modified during this inventory.

## Section 1 - Keys In Our Infrastructure

### 1.1 SSM Parameter Store

All parameters below are under `/presttige/stripe/` in `us-east-1`. Value prefixes are truncated. Full secret values are not printed.

| Parameter | Type | LastModifiedDate | Value prefix | Inferred account/scope |
|---|---|---:|---|---|
| `/presttige/stripe/club-monthly-price-id` | String | 2026-04-29T10:30:03.402000+04:00 | `price_1TRRdF` | ULTRATTEK fragment `DtYyg6ENBH` |
| `/presttige/stripe/club-to-patron-upgrade-price-id` | String | 2026-04-29T14:13:08.365000+04:00 | `price_1TRV78` | ULTRATTEK fragment `DtYyg6ENBH` |
| `/presttige/stripe/club-y1-price-id` | String | 2026-04-27T11:30:04.304000+04:00 | `price_1TQjak` | ULTRATTEK fragment `DtYyg6ENBH`; legacy B2 Y1 artifact |
| `/presttige/stripe/club-yearly-price-id` | String | 2026-04-29T10:30:06.919000+04:00 | `price_1TRRdJ` | ULTRATTEK fragment `DtYyg6ENBH` |
| `/presttige/stripe/founder-lifetime-price-id` | String | 2026-04-29T14:13:04.914000+04:00 | `price_1TRV75` | ULTRATTEK fragment `DtYyg6ENBH` |
| `/presttige/stripe/patron-lifetime-price-id` | String | 2026-04-27T11:30:06.635000+04:00 | `price_1TQjan` | ULTRATTEK fragment `DtYyg6ENBH`; legacy B2 lifetime artifact |
| `/presttige/stripe/patron-yearly-price-id` | String | 2026-04-29T14:13:01.601000+04:00 | `price_1TRV72` | ULTRATTEK fragment `DtYyg6ENBH` |
| `/presttige/stripe/patron/annual_price_id` | String | 2026-04-26T13:33:40.697000+04:00 | `price_1TQP4G` | ULTRATTEK fragment `DtYyg6ENBH`; legacy tier-style artifact |
| `/presttige/stripe/patron/monthly_price_id` | String | 2026-04-26T13:33:39.480000+04:00 | `price_1TQP4G` | ULTRATTEK fragment `DtYyg6ENBH`; legacy tier-style artifact |
| `/presttige/stripe/patron/product_id` | String | 2026-04-26T13:33:38.246000+04:00 | `prod_UPDVTlv` | Product ID; account not inferable from prefix alone |
| `/presttige/stripe/premier-monthly-price-id` | String | 2026-04-29T10:30:10.283000+04:00 | `price_1TRRdM` | ULTRATTEK fragment `DtYyg6ENBH` |
| `/presttige/stripe/premier-to-patron-upgrade-price-id` | String | 2026-04-29T14:13:11.813000+04:00 | `price_1TRV7C` | ULTRATTEK fragment `DtYyg6ENBH` |
| `/presttige/stripe/premier-y1-price-id` | String | 2026-04-27T11:30:05.459000+04:00 | `price_1TQjam` | ULTRATTEK fragment `DtYyg6ENBH`; legacy B2 Y1 artifact |
| `/presttige/stripe/premier-yearly-price-id` | String | 2026-04-29T10:30:13.686000+04:00 | `price_1TRRdQ` | ULTRATTEK fragment `DtYyg6ENBH` |
| `/presttige/stripe/tier2/annual_price_id` | String | 2026-04-26T13:33:46.849000+04:00 | `price_1TQP4N` | ULTRATTEK fragment `DtYyg6ENBH`; legacy tier-style artifact |
| `/presttige/stripe/tier2/monthly_price_id` | String | 2026-04-26T13:33:45.657000+04:00 | `price_1TQP4M` | ULTRATTEK fragment `DtYyg6ENBH`; legacy tier-style artifact |
| `/presttige/stripe/tier2/product_id` | String | 2026-04-26T13:33:44.440000+04:00 | `prod_UPDVprw` | Product ID; account not inferable from prefix alone |
| `/presttige/stripe/tier3/annual_price_id` | String | 2026-04-26T13:33:53.076000+04:00 | `price_1TQP4T` | ULTRATTEK fragment `DtYyg6ENBH`; legacy tier-style artifact |
| `/presttige/stripe/tier3/monthly_price_id` | String | 2026-04-26T13:33:51.859000+04:00 | `price_1TQP4S` | ULTRATTEK fragment `DtYyg6ENBH`; legacy tier-style artifact |
| `/presttige/stripe/tier3/product_id` | String | 2026-04-26T13:33:50.632000+04:00 | `prod_UPDV4Iv` | Product ID; account not inferable from prefix alone |
| `/presttige/stripe/webhook-secret` | SecureString | 2026-04-30T08:36:27.621000+04:00 | `whsec_4eKWjn` | Webhook signing secret; account not inferable from value |

SSM contains no key that points to the separate Stripe sandbox `acct_1TJdzqDmiQXcrE5N`.

### 1.2 Frontend Publishable Keys

Repo grep found no hardcoded `pk_test_` or `pk_live_` values.

Current frontend behavior:

- `checkout.html` loads Stripe.js from `https://js.stripe.com/v3/`.
- `checkout.html` initializes Stripe with `state.bootstrap.publishableKey`, returned by the backend bootstrap endpoint.
- The publishable key source is Secrets Manager via `presttige-create-checkout-session`, not a hardcoded frontend value.

### 1.3 Secret Keys In Code

Repo grep found no hardcoded `sk_test_` or `sk_live_` values.

No full Stripe secret key appears in the repo. Stripe secret key references are environment variable names or Secrets Manager field names only.

### 1.4 Lambda Environment Variables

Inventory is based on the current package-script/Lambda deploy set, now 25 Lambdas after M-R5 added `presttige-tier-downgrade`.

| Lambda | Stripe-related environment variables |
|---|---|
| `presttige-account-create` | none |
| `presttige-activate-subscriber` | none |
| `presttige-checkout-context` | none |
| `presttige-checkout-status` | none |
| `presttige-cookie-diag` | none |
| `presttige-create-checkout-session` | none |
| `presttige-create-lead` | none |
| `presttige-gateway` | `STRIPE_SECRET_KEY` |
| `presttige-magic-link-verify` | none |
| `presttige-photo-upload-init` | none |
| `presttige-photo-upload-status` | none |
| `presttige-review-action` | none |
| `presttige-review-fetch` | none |
| `presttige-send-application-received` | none |
| `presttige-send-committee-email` | none |
| `presttige-send-subscriber-welcome-email` | none |
| `presttige-send-tier-select-email` | none |
| `presttige-send-welcome-email` | none |
| `presttige-stripe-webhook` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
| `presttige-submit-access` | none |
| `presttige-tester-cleanup` | none |
| `presttige-thumbnail-generator` | none |
| `presttige-tier-downgrade` | none |
| `presttige-tier-select-fetch` | none |
| `presttige-verify-email` | none |

The only effective secret key discovered in Lambda env resolves to `acct_1TJe02DtYyg6ENBH`.

### 1.5 Other Stripe-Related Config

Secrets Manager contains:

| Secret | Last changed | Description | Prefix-safe fields |
|---|---:|---|---|
| `presttige-stripe-secret` | 2026-04-29T23:53:15.256000+04:00 | `Presttige Stripe API keys (test/live JSON payload)` | `secret_key=sk_test_51TJ`, `publishable_key=pk_test_51TJ`, `account_id=acct_1TJe02D`, `mode=test` |

Effective account check using that `sk_test_51TJ...` secret returned:

- Stripe account: `acct_1TJe02DtYyg6ENBH`
- Business profile name: `METTALIX`
- Country: `AE`
- Charges enabled: `true`
- Payouts enabled: `true`

Other code/config references:

- `backend/create-checkout-session/index.js:45` uses `STRIPE_SECRET_ID = "presttige-stripe-secret"`.
- `backend/create-checkout-session/index.js:167-169` reads `secret_key` and `publishable_key`.
- `backend/checkout-status/index.js:43` uses `STRIPE_SECRET_ID = "presttige-stripe-secret"`.
- `backend/lambdas/stripe-webhook/lambda_function.py:28-29` reads webhook signing secret from SSM parameter `/presttige/stripe/webhook-secret`.
- `backend/lambdas/gateway/lambda_function.py:27` still reads legacy `STRIPE_SECRET_KEY` from Lambda env.

No `.env` Stripe key file was found in the repo search.

## Section 2 - Stripe Objects Per Sandbox

### Accessible Sandbox: ULTRATTEK / `acct_1TJe02DtYyg6ENBH`

This is the only Stripe sandbox for which a secret key exists in AWS/repo infrastructure.

### Dashboard-Visible But Not API-Accessible From Current Infrastructure: Test mode / `acct_1TJdzqDmiQXcrE5N`

Antonio reported this sandbox exists in Stripe Dashboard. No API key for it was found in SSM, Secrets Manager, Lambda env, or repo code, so Codex could not inventory products, prices, webhooks, events, customers, subscriptions, or payment intents for that sandbox via API in this read-only pass.

### 2.1 Products And Prices - ULTRATTEK

| Product | Name | Active | Created UTC | Price(s) |
|---|---|---:|---:|---|
| `prod_UIFeH3Y5xZERZp` | Presttige Founder | true | 2026-04-07 19:18:45 | `price_1TJf97DtYyg6ENBHQZrRhOvY` USD 99000 one-time active |
| `prod_UIFjoxa5bfyiWv` | Presttige Access | true | 2026-04-07 19:23:44 | `price_1TJfDwDtYyg6ENBH85VhNBRe` USD 22000 one-time active |
| `prod_UIGHpqMgWbmsAZ` | Presttige Membership ENTRY | true | 2026-04-07 19:57:37 | `price_1TJfkkDtYyg6ENBHSgyxn3wW` USD 9900/month active; `price_1TJfo0DtYyg6ENBHPYPXMGXO` USD 25000/month active; `price_1TJfojDtYyg6ENBHy7WXqap7` USD 84000/year active |
| `prod_UIGOt8Y0mqFwen` | Presttige Membership MID | true | 2026-04-07 20:04:23 | `price_1TJfrHDtYyg6ENBHjf0vY9Kg` USD 14900/month active; `price_1TJfs0DtYyg6ENBHvLxbwBgJ` USD 36000/month active; `price_1TJfsXDtYyg6ENBH95j0CRTN` USD 120000/year active |
| `prod_UIGReCSkQ53F05` | Presttige Membership PREMIUM | true | 2026-04-07 20:07:28 | `price_1TJfuGDtYyg6ENBHTwPVGA0b` USD 24900/month active; `price_1TJfuZDtYyg6ENBHZvwADYOp` USD 60000/month active; `price_1TJfuzDtYyg6ENBHViLWYVJa` USD 200000/year active |
| `prod_UPDVTlvUNNdlbv` | Presttige Patron | true | 2026-04-26 09:33:35 | `price_1TQP4GDtYyg6ENBH10jLlPgW` USD 5100000/year active; `price_1TQP4GDtYyg6ENBHHMlYF4pS` USD 500000/month active |
| `prod_UPDVprwgo3C2NF` | Presttige Tier 2 | true | 2026-04-26 09:33:41 | `price_1TQP4MDtYyg6ENBHF8yScYBG` USD 150000/month active; `price_1TQP4NDtYyg6ENBHPnFgg5Jl` USD 1530000/year active |
| `prod_UPDV4IvsrDwuUw` | Presttige Tier 3 | true | 2026-04-26 09:33:47 | `price_1TQP4SDtYyg6ENBH2Z0dpt4R` USD 50000/month active; `price_1TQP4TDtYyg6ENBHVaPcR1fp` USD 510000/year active |
| `prod_UPYifyqCnIA6NU` | Club | true | 2026-04-27 07:28:29 | `price_1TQjakDtYyg6ENBHzm7vnMZf` USD 9900 one-time active |
| `prod_UPYichSqKshSbr` | Premier | true | 2026-04-27 07:28:31 | `price_1TQjamDtYyg6ENBHLE9tWLwN` USD 22200 one-time active |
| `prod_UPYiaDVUeth0U6` | Patron | true | 2026-04-27 07:28:32 | `price_1TQjanDtYyg6ENBHVPmGE60Z` USD 99900 one-time active |
| `prod_UQID5FnbF4OFr6` | Presttige Club Monthly | true | 2026-04-29 06:30:00 | `price_1TRRdFDtYyg6ENBHma7WCeUI` USD 999/month active, lookup `club_monthly` |
| `prod_UQIDjBmz1kct38` | Presttige Club Yearly | true | 2026-04-29 06:30:04 | `price_1TRRdJDtYyg6ENBHQGFbyjkT` USD 9900/year active, lookup `club_yearly` |
| `prod_UQIDTmumCSIMgt` | Presttige Premier Monthly | true | 2026-04-29 06:30:07 | `price_1TRRdMDtYyg6ENBH6VMBbSPE` USD 3300/month active, lookup `premier_monthly` |
| `prod_UQIDpQ9fqWs2jr` | Presttige Premier Yearly | true | 2026-04-29 06:30:11 | `price_1TRRdQDtYyg6ENBH1uHictf8` USD 22200/year active, lookup `premier_yearly` |
| `prod_UQIDb2Oh5P5k8i` | Presttige Club to Patron Upgrade | true | 2026-04-29 06:30:14 | `price_1TRRdTDtYyg6ENBHlWL4TyjI` USD 90000 one-time active, lookup `club_to_patron_upgrade`; legacy v1 upgrade artifact |
| `prod_UQID2ItMRRXxMz` | Presttige Premier to Patron Upgrade | true | 2026-04-29 06:30:17 | `price_1TRRdWDtYyg6ENBHU7yl5dt3` USD 77700 one-time active, lookup `premier_to_patron_upgrade`; legacy v1 upgrade artifact |
| `prod_UQLo0b7C8UCmzY` | Presttige Patron Yearly | true | 2026-04-29 10:12:59 | `price_1TRV72DtYyg6ENBHJowWLnVC` USD 99900/year active, lookup `patron_yearly` |
| `prod_UQLo1qDxwckono` | Presttige Founder Lifetime | true | 2026-04-29 10:13:02 | `price_1TRV75DtYyg6ENBHtjnRr8KB` USD 999900 one-time active, lookup `founder_lifetime` |
| `prod_UQLo6oVaGH2Yv6` | Presttige Club to Patron Upgrade | true | 2026-04-29 10:13:05 | `price_1TRV78DtYyg6ENBHExoOD9re` USD 99900/year active, metadata `initial_charge_usd_cents=90000`, `upgrade_strategy=first_invoice_adjustment` |
| `prod_UQLoyF42ORZ1Cl` | Presttige Premier to Patron Upgrade | true | 2026-04-29 10:13:09 | `price_1TRV7CDtYyg6ENBHCLIGVd2f` USD 99900/year active, metadata `initial_charge_usd_cents=77700`, `upgrade_strategy=first_invoice_adjustment` |

The active M-R2v2 contract products/prices all live in ULTRATTEK.

### 2.2 Webhook Endpoints / Destinations - ULTRATTEK

Current Lambda Function URL for `presttige-stripe-webhook`:

- URL: `https://flryyvnmb5bwdaeknvs6xcbgmi0dedfe.lambda-url.us-east-1.on.aws/`
- AuthType: `NONE`
- LastModifiedTime: `2026-04-08T14:10:30.757562902Z`

Stripe webhook endpoints visible through ULTRATTEK API:

| Webhook endpoint | URL | Status | Events subscribed | Created UTC | API version |
|---|---|---|---|---:|---|
| `we_1TL4ZsDtYyg6ENBHd0CshVDr` | `https://flryyvnmb5bwdaeknvs6xcbgmi0dedfe.lambda-url.us-east-1.on.aws/` | enabled | `checkout.session.completed` | 2026-04-11 16:40:12 | 2026-03-25.dahlia |
| `we_1TJwwQDtYyg6ENBHsvbdb4S6` | `https://flryyvnmb5bwdaeknvs6xcbgmi0dedfe.lambda-url.us-east-1.on.aws/` | enabled | `checkout.session.completed` | 2026-04-08 14:18:50 | 2026-03-25.dahlia |

Both registered endpoints point to the correct Lambda Function URL, but both are legacy subscriptions for `checkout.session.completed` only. Neither is subscribed to the M-R5 webhook event matrix.

Stripe API does not return webhook signing secret values or a secret last-rotated timestamp for existing endpoints.

### 2.3 Recent Events - ULTRATTEK Last 24h

Observed since `2026-04-29T06:40:27Z`.

| Event type | Count |
|---|---:|
| `charge.failed` | 1 |
| `charge.succeeded` | 10 |
| `charge.updated` | 1 |
| `customer.created` | 24 |
| `customer.subscription.created` | 21 |
| `customer.subscription.updated` | 9 |
| `customer.updated` | 22 |
| `invoice.created` | 21 |
| `invoice.finalized` | 21 |
| `invoice.paid` | 9 |
| `invoice.payment_failed` | 1 |
| `invoice.payment_succeeded` | 9 |
| `invoice.updated` | 10 |
| `invoice_payment.paid` | 9 |
| `invoiceitem.created` | 3 |
| `payment_intent.created` | 25 |
| `payment_intent.payment_failed` | 1 |
| `payment_intent.succeeded` | 10 |
| `payment_method.attached` | 9 |
| `plan.created` | 3 |
| `price.created` | 4 |
| `product.created` | 4 |

These are Stripe event creation counts from the account API, not per-webhook delivery-attempt counts.

### 2.4 Customers - ULTRATTEK Last 24h

| Customer | Created UTC | Email | Name | Lead |
|---|---:|---|---|---|
| `cus_UQdCulL2FR2MIO` | 2026-04-30 04:10:49 | `antoniompereira@me.com` | Antonio Manuel Pereira | `fdm_25dd27b36c` |
| `cus_UQY1gJRi73UkKI` | 2026-04-29 22:49:24 | `alternativeservice@gmail.com` | E3 Fix Final Candidate | `fdm_e3fixfinal_20260429224917` |
| `cus_UQXylDTZoYMZo4` | 2026-04-29 22:46:48 | `alternativeservice@gmail.com` | E3 Fix Proof Candidate | `fdm_e3fix_20260429224640` |
| `cus_UQWMNCUR84drKD` | 2026-04-29 21:06:49 | `alternativeservice@gmail.com` | M-R4 Decline Candidate | `fdm_mr4_decline_20260429210606_66b715` |
| `cus_UQWMolsD0vLw9H` | 2026-04-29 21:06:34 | `alternativeservice@gmail.com` | M-R4 Upgrade Candidate | `fdm_mr4_upgrade_20260429210606_ebd6d5` |
| `cus_UQWMRDrHpfEuoC` | 2026-04-29 21:06:25 | `alternativeservice@gmail.com` | M-R4 Founder Candidate | `fdm_mr4_founder_20260429210606_f7c060` |
| `cus_UQWLJdwcM4aa1A` | 2026-04-29 21:06:12 | `alternativeservice@gmail.com` | M-R4 Standard Candidate | `fdm_mr4_standard_20260429210606_a4ea1e` |
| `cus_UQWKAWZjx079JG` | 2026-04-29 21:05:01 | `alternativeservice@gmail.com` | Std Probe | `fdm_mr4_stdprobe_20260429210456` |
| `cus_UQWIF1RyRUBzHF` | 2026-04-29 21:02:48 | `alternativeservice@gmail.com` | M-R4 Standard Candidate | `fdm_mr4_standard_20260429210241_b6e509` |
| `cus_UQWGXj18zJb5EC` | 2026-04-29 21:01:13 | `alternativeservice@gmail.com` | M-R4 First Load Candidate | `fdm_mr4_firstload_20260429210110` |
| `cus_UQW97Rgb3IxqVR` | 2026-04-29 20:53:39 | `alternativeservice@gmail.com` | M-R4 Standard Candidate | `fdm_mr4_standard_20260429205254` |
| `cus_UQW4nmzehCPDvv` | 2026-04-29 20:48:24 | `alternativeservice@gmail.com` | M-R4 Founder Candidate | `fdm_mr4_founder` |
| `cus_UQVtToFto2Pa8Y` | 2026-04-29 20:38:14 | `alternativeservice@gmail.com` | M-R4 Standard Candidate | `fdm_mr4_standard` |
| `cus_UQVHDFfFo2h9nd` | 2026-04-29 19:59:39 | `alternativeservice@gmail.com` | M-R3 Club Upgrade | `fdm_mr3_club_upgrade` |
| `cus_UQVHcH5asloIMt` | 2026-04-29 19:59:31 | `alternativeservice@gmail.com` | M-R3 Patron Yearly | `fdm_mr3_patron_yearly` |
| `cus_UQVHTINDDUSyR5` | 2026-04-29 19:59:27 | `alternativeservice@gmail.com` | M-R3 Premier Monthly | `fdm_mr3_premier_monthly` |
| `cus_UQVHSLqPEpKXnU` | 2026-04-29 19:59:22 | `alternativeservice@gmail.com` | M-R3 Club Yearly | `fdm_mr3_club_yearly` |
| `cus_UQVFSD5o5r4dDr` | 2026-04-29 19:57:37 | `alternativeservice@gmail.com` | blank | blank |
| `cus_UQVFk6domt6lFS` | 2026-04-29 19:57:24 | `alternativeservice@gmail.com` | blank | blank |
| `cus_UQVE96ckF3vhJ0` | 2026-04-29 19:57:03 | `alternativeservice@gmail.com` | M-R3 Club Upgrade | `fdm_mr3_club_upgrade` |
| `cus_UQVEOPIDNtMRNl` | 2026-04-29 19:57:00 | `alternativeservice@gmail.com` | M-R3 Founder Lifetime | `fdm_mr3_founder_lifetime` |
| `cus_UQVEHWWQrRqFiJ` | 2026-04-29 19:56:54 | `alternativeservice@gmail.com` | M-R3 Patron Yearly | `fdm_mr3_patron_yearly` |
| `cus_UQVEHYNJeuSwxJ` | 2026-04-29 19:56:49 | `alternativeservice@gmail.com` | M-R3 Premier Monthly | `fdm_mr3_premier_monthly` |
| `cus_UQVE7X30fsfVNi` | 2026-04-29 19:56:44 | `alternativeservice@gmail.com` | M-R3 Club Yearly | `fdm_mr3_club_yearly` |

Antonio's M-R4 verification customer exists in ULTRATTEK: `cus_UQdCulL2FR2MIO`.

### 2.5 Subscriptions - ULTRATTEK Last 24h

| Subscription | Created UTC | Status | Customer | Contract | Lead | Price |
|---|---:|---|---|---|---|---|
| `sub_1TRlw6DtYyg6ENBHg7hHlyRc` | 2026-04-30 04:10:50 | active | `cus_UQdCulL2FR2MIO` | `patron_yearly` | `fdm_25dd27b36c` | `price_1TRV72DtYyg6ENBHJowWLnVC` |
| `sub_1TRgv2DtYyg6ENBHfGAlMSTM` | 2026-04-29 22:49:24 | active | `cus_UQY1gJRi73UkKI` | `premier_yearly` | `fdm_e3fixfinal_20260429224917` | `price_1TRRdQDtYyg6ENBH1uHictf8` |
| `sub_1TRgsWDtYyg6ENBHgu3uAXPG` | 2026-04-29 22:46:48 | active | `cus_UQXylDTZoYMZo4` | `premier_yearly` | `fdm_e3fix_20260429224640` | `price_1TRRdQDtYyg6ENBH1uHictf8` |
| `sub_1TRfJlDtYyg6ENBHwnBUGdEp` | 2026-04-29 21:06:49 | incomplete | `cus_UQWMNCUR84drKD` | `club_yearly` | `fdm_mr4_decline_20260429210606_66b715` | `price_1TRRdJDtYyg6ENBHQGFbyjkT` |
| `sub_1TRfJXDtYyg6ENBH3NxYk2cy` | 2026-04-29 21:06:35 | active | `cus_UQWMolsD0vLw9H` | `club_to_patron_upgrade` | `fdm_mr4_upgrade_20260429210606_ebd6d5` | `price_1TRV72DtYyg6ENBHJowWLnVC` |
| `sub_1TRfJBDtYyg6ENBHS5LVxxVG` | 2026-04-29 21:06:12 | active | `cus_UQWLJdwcM4aa1A` | `premier_yearly` | `fdm_mr4_standard_20260429210606_a4ea1e` | `price_1TRRdQDtYyg6ENBH1uHictf8` |
| `sub_1TRfI1DtYyg6ENBHIE6ffPkz` | 2026-04-29 21:05:01 | active | `cus_UQWKAWZjx079JG` | `premier_yearly` | `fdm_mr4_stdprobe_20260429210456` | `price_1TRRdQDtYyg6ENBH1uHictf8` |
| `sub_1TRfFtDtYyg6ENBHKdXVa1dH` | 2026-04-29 21:02:48 | active | `cus_UQWIF1RyRUBzHF` | `premier_yearly` | `fdm_mr4_standard_20260429210241_b6e509` | `price_1TRRdQDtYyg6ENBH1uHictf8` |
| `sub_1TRfEMDtYyg6ENBHr9wNPW4h` | 2026-04-29 21:01:14 | incomplete | `cus_UQWGXj18zJb5EC` | `premier_yearly` | `fdm_mr4_firstload_20260429210110` | `price_1TRRdQDtYyg6ENBH1uHictf8` |
| `sub_1TRf72DtYyg6ENBHHNhK0OvM` | 2026-04-29 20:53:40 | active | `cus_UQW97Rgb3IxqVR` | `premier_yearly` | `fdm_mr4_standard_20260429205254` | `price_1TRRdQDtYyg6ENBH1uHictf8` |
| `sub_1TRes6DtYyg6ENBHfbrpXJSi` | 2026-04-29 20:38:14 | active | `cus_UQVtToFto2Pa8Y` | `premier_yearly` | `fdm_mr4_standard` | `price_1TRRdQDtYyg6ENBH1uHictf8` |
| `sub_1TReGlDtYyg6ENBH3wbtNSUi` | 2026-04-29 19:59:39 | incomplete | `cus_UQVHDFfFo2h9nd` | `club_to_patron_upgrade` | `fdm_mr3_club_upgrade` | `price_1TRV72DtYyg6ENBHJowWLnVC` |
| `sub_1TReGeDtYyg6ENBHLuFDGfWX` | 2026-04-29 19:59:32 | incomplete | `cus_UQVHcH5asloIMt` | `patron_yearly` | `fdm_mr3_patron_yearly` | `price_1TRV72DtYyg6ENBHJowWLnVC` |
| `sub_1TReGZDtYyg6ENBH1ntsXZYJ` | 2026-04-29 19:59:27 | incomplete | `cus_UQVHTINDDUSyR5` | `premier_monthly` | `fdm_mr3_premier_monthly` | `price_1TRRdMDtYyg6ENBH6VMBbSPE` |
| `sub_1TReGVDtYyg6ENBH9ivHKCdp` | 2026-04-29 19:59:23 | incomplete | `cus_UQVHSLqPEpKXnU` | `club_yearly` | `fdm_mr3_club_yearly` | `price_1TRRdJDtYyg6ENBHQGFbyjkT` |
| `sub_1TReEoDtYyg6ENBHcK8jYcku` | 2026-04-29 19:57:38 | incomplete | `cus_UQVFSD5o5r4dDr` | blank | blank | `price_1TRRdJDtYyg6ENBHQGFbyjkT` |
| `sub_1TReEbDtYyg6ENBH4AAhzgYv` | 2026-04-29 19:57:25 | incomplete | `cus_UQVFk6domt6lFS` | blank | blank | `price_1TRRdJDtYyg6ENBHQGFbyjkT` |
| `sub_1TReEGDtYyg6ENBHIQUfuEXz` | 2026-04-29 19:57:04 | incomplete | `cus_UQVE96ckF3vhJ0` | `club_to_patron_upgrade` | `fdm_mr3_club_upgrade` | `price_1TRV72DtYyg6ENBHJowWLnVC` |
| `sub_1TReE6DtYyg6ENBHk3rqgTS5` | 2026-04-29 19:56:54 | incomplete | `cus_UQVEHWWQrRqFiJ` | `patron_yearly` | `fdm_mr3_patron_yearly` | `price_1TRV72DtYyg6ENBHJowWLnVC` |
| `sub_1TReE2DtYyg6ENBHZSNztSCT` | 2026-04-29 19:56:50 | incomplete | `cus_UQVEHYNJeuSwxJ` | `premier_monthly` | `fdm_mr3_premier_monthly` | `price_1TRRdMDtYyg6ENBH6VMBbSPE` |
| `sub_1TReDxDtYyg6ENBHda2TjP7p` | 2026-04-29 19:56:45 | incomplete | `cus_UQVE7X30fsfVNi` | `club_yearly` | `fdm_mr3_club_yearly` | `price_1TRRdJDtYyg6ENBHQGFbyjkT` |

Antonio's M-R4 Patron yearly subscription exists in ULTRATTEK: `sub_1TRlw6DtYyg6ENBHg7hHlyRc`.

### 2.6 Payment Intents - ULTRATTEK Last 24h

| PaymentIntent | Created UTC | Status | Amount | Customer | Contract metadata | Lead metadata |
|---|---:|---|---:|---|---|---|
| `pi_3TRlw6DtYyg6ENBH1rZNlF8l` | 2026-04-30 04:10:50 | succeeded | 99900 usd | `cus_UQdCulL2FR2MIO` | blank | blank |
| `pi_3TRgv3DtYyg6ENBH2VQe43TR` | 2026-04-29 22:49:25 | succeeded | 22200 usd | `cus_UQY1gJRi73UkKI` | blank | blank |
| `pi_3TRgsXDtYyg6ENBH10Jh9GFQ` | 2026-04-29 22:46:49 | succeeded | 22200 usd | `cus_UQXylDTZoYMZo4` | blank | blank |
| `pi_3TRfJmDtYyg6ENBH2CfmEvHN` | 2026-04-29 21:06:50 | requires_payment_method | 9900 usd | `cus_UQWMNCUR84drKD` | blank | blank |
| `pi_3TRfJYDtYyg6ENBH00D2cNL9` | 2026-04-29 21:06:36 | succeeded | 90000 usd | `cus_UQWMolsD0vLw9H` | blank | blank |
| `pi_3TRfJNDtYyg6ENBH044prSXy` | 2026-04-29 21:06:25 | succeeded | 999900 usd | `cus_UQWMRDrHpfEuoC` | `founder_lifetime` | `fdm_mr4_founder_20260429210606_f7c060` |
| `pi_3TRfJBDtYyg6ENBH2eqAX7vx` | 2026-04-29 21:06:13 | succeeded | 22200 usd | `cus_UQWLJdwcM4aa1A` | blank | blank |
| `pi_3TRfI2DtYyg6ENBH27jr6cUV` | 2026-04-29 21:05:02 | succeeded | 22200 usd | `cus_UQWKAWZjx079JG` | blank | blank |
| `pi_3TRfFtDtYyg6ENBH1ZboF6Wf` | 2026-04-29 21:02:49 | succeeded | 22200 usd | `cus_UQWIF1RyRUBzHF` | blank | blank |
| `pi_3TRfEMDtYyg6ENBH22Aim28j` | 2026-04-29 21:01:14 | requires_payment_method | 22200 usd | `cus_UQWGXj18zJb5EC` | blank | blank |
| `pi_3TRf72DtYyg6ENBH2DUPYV8V` | 2026-04-29 20:53:40 | succeeded | 22200 usd | `cus_UQW97Rgb3IxqVR` | blank | blank |
| `pi_3TRf1wDtYyg6ENBH0WYiAfaS` | 2026-04-29 20:48:24 | requires_payment_method | 999900 usd | `cus_UQW4nmzehCPDvv` | `founder_lifetime` | `fdm_mr4_founder` |
| `pi_3TRes7DtYyg6ENBH1nApqsU2` | 2026-04-29 20:38:15 | succeeded | 22200 usd | `cus_UQVtToFto2Pa8Y` | blank | blank |
| `pi_3TReGmDtYyg6ENBH2mFg1unX` | 2026-04-29 19:59:40 | requires_payment_method | 90000 usd | `cus_UQVHDFfFo2h9nd` | blank | blank |
| `pi_3TReGiDtYyg6ENBH2IFAxAKE` | 2026-04-29 19:59:36 | requires_payment_method | 999900 usd | `cus_UQVEOPIDNtMRNl` | `founder_lifetime` | `fdm_mr3_founder_lifetime` |
| `pi_3TReGfDtYyg6ENBH07o5MzGt` | 2026-04-29 19:59:33 | requires_payment_method | 99900 usd | `cus_UQVHcH5asloIMt` | blank | blank |
| `pi_3TReGaDtYyg6ENBH0AeBOS9T` | 2026-04-29 19:59:28 | requires_payment_method | 3300 usd | `cus_UQVHTINDDUSyR5` | blank | blank |
| `pi_3TReGVDtYyg6ENBH0GeeDVL7` | 2026-04-29 19:59:23 | requires_payment_method | 9900 usd | `cus_UQVHSLqPEpKXnU` | blank | blank |
| `pi_3TReEpDtYyg6ENBH0l3y8OOQ` | 2026-04-29 19:57:39 | requires_payment_method | 9900 usd | `cus_UQVFSD5o5r4dDr` | blank | blank |
| `pi_3TReEcDtYyg6ENBH2OesQoau` | 2026-04-29 19:57:26 | requires_payment_method | 9900 usd | `cus_UQVFk6domt6lFS` | blank | blank |
| `pi_3TReEHDtYyg6ENBH1rb7UZLL` | 2026-04-29 19:57:05 | requires_payment_method | 90000 usd | `cus_UQVE96ckF3vhJ0` | blank | blank |
| `pi_3TReECDtYyg6ENBH1n4j59Fl` | 2026-04-29 19:57:00 | requires_payment_method | 999900 usd | `cus_UQVEOPIDNtMRNl` | `founder_lifetime` | `fdm_mr3_founder_lifetime` |
| `pi_3TReE7DtYyg6ENBH0Jp1khe4` | 2026-04-29 19:56:55 | requires_payment_method | 99900 usd | `cus_UQVEHWWQrRqFiJ` | blank | blank |
| `pi_3TReE2DtYyg6ENBH2jvsurkq` | 2026-04-29 19:56:50 | requires_payment_method | 3300 usd | `cus_UQVEHYNJeuSwxJ` | blank | blank |
| `pi_3TReDxDtYyg6ENBH1y2JnqiH` | 2026-04-29 19:56:45 | requires_payment_method | 9900 usd | `cus_UQVE7X30fsfVNi` | blank | blank |

Antonio's M-R4 verification PaymentIntent exists in ULTRATTEK: `pi_3TRlw6DtYyg6ENBH1rZNlF8l`, succeeded, USD 999.00.

## Section 3 - Code Vs Reality Cross-Reference

### 3.1 Price ID Match

`backend/lib/stripe-tier-contract.js:102-198` does not hardcode Stripe price IDs. It hardcodes SSM parameter paths, then runtime code resolves the actual price IDs.

Active v2 contract parameter resolution:

| Contract key | SSM parameter | Resolved price | Sandbox containing price | Status |
|---|---|---|---|---|
| `club_monthly` | `/presttige/stripe/club-monthly-price-id` | `price_1TRRdFDtYyg6ENBHma7WCeUI` | ULTRATTEK | exists, active |
| `club_yearly` | `/presttige/stripe/club-yearly-price-id` | `price_1TRRdJDtYyg6ENBHQGFbyjkT` | ULTRATTEK | exists, active |
| `premier_monthly` | `/presttige/stripe/premier-monthly-price-id` | `price_1TRRdMDtYyg6ENBH6VMBbSPE` | ULTRATTEK | exists, active |
| `premier_yearly` | `/presttige/stripe/premier-yearly-price-id` | `price_1TRRdQDtYyg6ENBH1uHictf8` | ULTRATTEK | exists, active |
| `patron_yearly` | `/presttige/stripe/patron-yearly-price-id` | `price_1TRV72DtYyg6ENBHJowWLnVC` | ULTRATTEK | exists, active |
| `founder_lifetime` | `/presttige/stripe/founder-lifetime-price-id` | `price_1TRV75DtYyg6ENBHtjnRr8KB` | ULTRATTEK | exists, active |
| `club_to_patron_upgrade` | `/presttige/stripe/club-to-patron-upgrade-price-id` | `price_1TRV78DtYyg6ENBHExoOD9re` | ULTRATTEK | exists, active |
| `premier_to_patron_upgrade` | `/presttige/stripe/premier-to-patron-upgrade-price-id` | `price_1TRV7CDtYyg6ENBHCLIGVd2f` | ULTRATTEK | exists, active |

No active contract price was missing in ULTRATTEK.

### 3.2 Product ID Match

Active contract code does not reference product IDs. Product IDs are only present in SSM legacy parameters and in Stripe objects.

Legacy product SSM parameters resolve to ULTRATTEK products:

| Parameter | Product prefix | Reality |
|---|---|---|
| `/presttige/stripe/patron/product_id` | `prod_UPDVTlv` | ULTRATTEK legacy product exists |
| `/presttige/stripe/tier2/product_id` | `prod_UPDVprw` | ULTRATTEK legacy product exists |
| `/presttige/stripe/tier3/product_id` | `prod_UPDV4Iv` | ULTRATTEK legacy product exists |

### 3.3 Account ID Match

| Surface | Effective key source | Effective account |
|---|---|---|
| `presttige-create-checkout-session` | Secrets Manager `presttige-stripe-secret` | `acct_1TJe02DtYyg6ENBH` |
| `presttige-checkout-status` | Secrets Manager `presttige-stripe-secret` | `acct_1TJe02DtYyg6ENBH` |
| `presttige-stripe-webhook` | Lambda env `STRIPE_SECRET_KEY`; webhook signing secret from SSM `/presttige/stripe/webhook-secret` | `acct_1TJe02DtYyg6ENBH` for Stripe API key |
| `presttige-gateway` | Lambda env `STRIPE_SECRET_KEY` | `acct_1TJe02DtYyg6ENBH` |

The separate `acct_1TJdzqDmiQXcrE5N` sandbox is not referenced by any discovered repo/AWS key source.

### M-R5 Handler Event Types

The rebuilt webhook router in `backend/lambdas/stripe-webhook/lambda_function.py:1036-1047` handles:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `invoice.payment_succeeded`
- `invoice.payment_failed`
- `charge.refunded`
- `charge.dispute.created`
- `charge.dispute.closed`

Stripe's currently registered ULTRATTEK webhook endpoints do not subscribe to these events, except that neither endpoint subscribes to even `payment_intent.succeeded`; both are `checkout.session.completed` only.

## Section 4 - Documentation Drift

### 4.1 Matriz References

Findings from `docs/MATRIZ-E-REGRAS.md`:

- `docs/MATRIZ-E-REGRAS.md:601-613` lists active v2 Stripe contract parameters but still includes `/presttige/stripe/club-y1-price-id` and `/presttige/stripe/premier-y1-price-id`, which are legacy and not active v2 contract keys.
- `docs/MATRIZ-E-REGRAS.md:613` lists `/presttige/stripe/webhook-secret-live`; actual M-R5 code reads `/presttige/stripe/webhook-secret`, and that is the parameter currently present in SSM.
- `docs/MATRIZ-E-REGRAS.md:629-646` has the M-R5 event matrix and matches the current webhook router event set.
- `docs/MATRIZ-E-REGRAS.md:867` defines Sandbox generically as a Stripe test environment within the METTALIX merchant account, but it does not distinguish between the two Dashboard-visible sandboxes: `acct_1TJdzqDmiQXcrE5N` and `acct_1TJe02DtYyg6ENBH`.

### 4.2 Stripe Rebuild Plan And Audit References

Findings from `docs/STRIPE-REBUILD-PLAN-v2-2026-04-29.md`:

- The plan says all rebuild work remains in TEST mode, but it does not explicitly name the sandbox account ID.
- The plan's v2 catalog expectations match reality in ULTRATTEK: `patron_yearly`, `founder_lifetime`, and first-invoice-adjustment upgrade prices exist.
- The plan says Secrets Manager should be the normalized source for Stripe secret key, publishable key, and webhook secret. Reality is mixed: checkout uses Secrets Manager for Stripe API/publishable keys, while webhook signing secret is in SSM and legacy Lambda env vars still exist on `presttige-gateway` and `presttige-stripe-webhook`.

Findings from `docs/STRIPE-INTEGRATION-AUDIT-2026-04-28.md`:

- `docs/STRIPE-INTEGRATION-AUDIT-2026-04-28.md:439-442` says `/presttige/stripe/webhook-secret` did not exist during the audit. That is now stale: it exists and was last modified 2026-04-30 08:36:27 Dubai.
- The audit's REBUILD recommendation remains historically accurate but no longer reflects the M-R3/M-R4/M-R5 state.

Findings from `docs/STRIPE-REBRAND.md`:

- `docs/STRIPE-REBRAND.md:4-7` explicitly identifies TEST/Sandbox account `acct_1TJe02DtYyg6ENBH` with Dashboard display name ULTRATTEK. This matches the infrastructure reality discovered today.
- It does not mention the additional Dashboard-visible sandbox `acct_1TJdzqDmiQXcrE5N`.

## Section 5 - Observations And Open Questions

### 5.1 Observations

- All currently discovered infrastructure keys point to ULTRATTEK `acct_1TJe02DtYyg6ENBH`.
- No key for the separate Dashboard-visible `acct_1TJdzqDmiQXcrE5N` sandbox exists in SSM, Secrets Manager, Lambda env, or repo code.
- Antonio's 30 April M-R4 Patron yearly test payment landed in ULTRATTEK, not the other sandbox.
- ULTRATTEK contains multiple generations of active Stripe products: early April products, 26 April legacy tier-style products, 27 April B2 one-time products, 29 April v1 products, and 29 April v2 products.
- The active M-R2v2 contract prices all exist and are active in ULTRATTEK.
- The legacy one-time upgrade products with lookup keys `club_to_patron_upgrade` and `premier_to_patron_upgrade` still exist in ULTRATTEK. The active v2 upgrade prices are separate yearly recurring prices with first-invoice-adjustment metadata.
- ULTRATTEK has two webhook endpoints pointing to the correct Lambda URL, but both subscribe only to `checkout.session.completed`. They do not match M-R5.
- SSM `/presttige/stripe/webhook-secret` exists and was recently modified, but Stripe API does not expose enough data to prove which endpoint it belongs to. Because no M-R5 endpoint is visible through the ULTRATTEK API, this secret/destination relationship needs Dashboard confirmation.
- The Dashboard empty-state Antonio saw is consistent with either viewing the other sandbox `acct_1TJdzqDmiQXcrE5N`, or viewing a Dashboard surface that is not showing the two legacy endpoints returned by the ULTRATTEK API.
- PaymentIntents generated by subscription invoices often have blank metadata, while the related subscription carries the contract metadata. M-R5 should keep using subscription/customer/invoice lookup paths, not rely only on PaymentIntent metadata for subscription payments.
- Current code still has legacy `presttige-gateway` Stripe env-key usage. This is not part of the M-R4/M-R5 candidate flow but remains an environment/config drift to retire at cutover.

### 5.2 Open Questions For Antonio

- Which Stripe sandbox should become canonical for ongoing TEST work: Dashboard "Test mode" `acct_1TJdzqDmiQXcrE5N` or ULTRATTEK `acct_1TJe02DtYyg6ENBH`?
- Should we obtain/read a test secret key for `acct_1TJdzqDmiQXcrE5N` in a later authorized pass so Codex can inventory that sandbox too?
- Should the current ULTRATTEK legacy webhook endpoints be replaced by one M-R5 endpoint subscribed to the full event matrix, or should Antonio create the M-R5 endpoint in the other sandbox after the canonical sandbox decision?
- Should SSM `/presttige/stripe/webhook-secret` remain the webhook signing secret source, or should the v2 plan's "Secrets Manager only for webhook secret" guidance be implemented in a future cleanup?
- Should legacy SSM parameters (`club-y1`, `premier-y1`, `patron-lifetime`, `/tier2/*`, `/tier3/*`, `/patron/*`) remain as historical artifacts, or be renamed/archived after the sandbox decision?
- Should ULTRATTEK's old active products be deactivated after migration planning, or left active for auditability until live cutover?

