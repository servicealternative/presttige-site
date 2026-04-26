# Stripe Account Rebranding to "Presttige"

## Current state
- Mode: TEST (Sandbox)
- Account business name: METTALIX
- Dashboard display name: ULTRATTEK
- Account ID: acct_1TJe02DtYyg6ENBH

## Required user actions (cannot be automated via API)

### A. Update business name
1. Log in to Stripe Dashboard at https://dashboard.stripe.com
2. Click your account icon, then open Settings
3. Open Business, then Public details
4. Set Public business name to `Presttige`
5. Set Statement descriptor to `PRESTTIGE`
6. Set Shortened statement descriptor to `PRESTTIGE`
7. Save

### B. Upload Presttige logo
1. In Settings, open Business, then Branding
2. Upload the Presttige logo as a square transparent PNG, 512x512 minimum
3. Set the primary brand color to `#0A0A0A`
4. Save

### C. If currently in TEST mode and LIVE is required
1. Open Settings, then Activate live payments
2. Complete Stripe KYC and submit the required business documents
3. Wait for Stripe approval
4. Update `STRIPE_SECRET_KEY` in:
   - `presttige-gateway` Lambda environment variables
   - `presttige-create-checkout-session` Lambda environment variables, if used there
5. Update `STRIPE_WEBHOOK_SECRET` in `presttige-stripe-webhook`
6. Re-create products and prices in live mode with the live secret key
7. Update SSM parameters under `/presttige/stripe/` with the live product and price IDs

## Verification after changes

After updating Stripe Dashboard settings, re-run:

```sh
curl -s https://api.stripe.com/v1/account -u "$STRIPE_KEY:" | jq '.business_profile, .settings.dashboard'
```

Expected:
- `business_profile.name = "Presttige"`
- `settings.dashboard.display_name = "Presttige"`
