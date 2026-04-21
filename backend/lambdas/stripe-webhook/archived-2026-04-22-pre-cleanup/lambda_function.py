import json
import os
import base64
import boto3
from decimal import Decimal, ROUND_HALF_UP

try:
    import stripe
    STRIPE_IMPORT_OK = True
    STRIPE_IMPORT_ERROR = None
except Exception as e:
    stripe = None
    STRIPE_IMPORT_OK = False
    STRIPE_IMPORT_ERROR = str(e)

dynamodb = boto3.resource("dynamodb")

LEADS_TABLE = dynamodb.Table("presttige-db")
CAMPAIGNS_TABLE = dynamodb.Table("ulttra-campaigns")
REPORTS_TABLE = dynamodb.Table("ulttra-daily-reports")

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()

DEFAULT_CLIENT_ID = "ultrattek"
DEFAULT_CLIENT_NAME = "ULTRATTEK"
DEFAULT_PROJECT_ID = "presttige"
DEFAULT_PROJECT_NAME = "Presttige"
DEFAULT_CAMPAIGN_ID = "presttige_founder_default"
DEFAULT_CAMPAIGN_NAME = "Presttige Founder Default"
DEFAULT_PARTNER_ID = "partner_default_presttige"
DEFAULT_PARTNER_NAME = "Presttige Default Partner"
DEFAULT_CURRENCY = "USD"

if STRIPE_IMPORT_OK:
    stripe.api_key = STRIPE_SECRET_KEY


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps(body, default=str)
    }


def to_decimal_amount_from_cents(amount_cents):
    if amount_cents is None:
        return Decimal("0.00")
    return (Decimal(str(amount_cents)) / Decimal("100")).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP
    )


def normalize_product_type(metadata):
    product_type = (
        metadata.get("product_type")
        or metadata.get("product")
        or ""
    ).strip().lower()

    if product_type in ["founder", "access", "membership"]:
        return product_type

    return "founder"


def get_campaign_defaults(campaign_id):
    try:
        result = CAMPAIGNS_TABLE.get_item(Key={"campaign_id": campaign_id})
        item = result.get("Item", {})

        if not item:
            return {
                "campaign_name": DEFAULT_CAMPAIGN_NAME,
                "default_commission_founder": Decimal("0.15"),
                "default_commission_access": Decimal("0.12"),
                "default_commission_membership": Decimal("0.12"),
            }

        return {
            "campaign_name": item.get("campaign_name", DEFAULT_CAMPAIGN_NAME),
            "default_commission_founder": Decimal(str(item.get("default_commission_founder", "0.15"))),
            "default_commission_access": Decimal(str(item.get("default_commission_access", "0.12"))),
            "default_commission_membership": Decimal(str(item.get("default_commission_membership", "0.12"))),
        }
    except Exception:
        return {
            "campaign_name": DEFAULT_CAMPAIGN_NAME,
            "default_commission_founder": Decimal("0.15"),
            "default_commission_access": Decimal("0.12"),
            "default_commission_membership": Decimal("0.12"),
        }


def get_commission_rate(product_type, campaign_defaults):
    if product_type == "access":
        return campaign_defaults["default_commission_access"]
    if product_type == "membership":
        return campaign_defaults["default_commission_membership"]
    return campaign_defaults["default_commission_founder"]


def update_daily_report(
    report_date,
    client_id,
    client_name,
    project_id,
    project_name,
    campaign_id,
    campaign_name,
    partner_id,
    partner_name,
    product_type,
    currency,
    amount_paid,
    commission_amount
):
    report_id = f"report_{report_date}_{partner_id}_{product_type}"

    REPORTS_TABLE.update_item(
        Key={"report_id": report_id},
        UpdateExpression="""
            SET report_date = :report_date,
                client_id = :client_id,
                client_name = :client_name,
                project_id = :project_id,
                project_name = :project_name,
                campaign_id = :campaign_id,
                campaign_name = :campaign_name,
                partner_id = :partner_id,
                partner_name = :partner_name,
                product_type = :product_type,
                currency = :currency,
                #status = :status,
                created_at = if_not_exists(created_at, :created_at)
            ADD transactions_count :transactions_inc,
                total_revenue :revenue_inc,
                total_commission :commission_inc
        """,
        ExpressionAttributeNames={
            "#status": "status"
        },
        ExpressionAttributeValues={
            ":report_date": report_date,
            ":client_id": client_id,
            ":client_name": client_name,
            ":project_id": project_id,
            ":project_name": project_name,
            ":campaign_id": campaign_id,
            ":campaign_name": campaign_name,
            ":partner_id": partner_id,
            ":partner_name": partner_name,
            ":product_type": product_type,
            ":currency": currency,
            ":status": "active",
            ":created_at": f"{report_date}T00:00:00Z",
            ":transactions_inc": Decimal("1"),
            ":revenue_inc": amount_paid,
            ":commission_inc": commission_amount
        }
    )

    return report_id


def lambda_handler(event, context):
    try:
        if not STRIPE_IMPORT_OK:
            return response(500, {
                "error": "stripe_import_error",
                "message": STRIPE_IMPORT_ERROR
            })

        if not STRIPE_SECRET_KEY:
            return response(500, {
                "error": "config_error",
                "message": "STRIPE_SECRET_KEY not configured"
            })

        if not STRIPE_WEBHOOK_SECRET:
            return response(500, {
                "error": "config_error",
                "message": "STRIPE_WEBHOOK_SECRET not configured"
            })

        headers = event.get("headers") or {}
        sig_header = headers.get("Stripe-Signature") or headers.get("stripe-signature")

        if not sig_header:
            return response(400, {
                "error": "missing_signature",
                "message": "Missing Stripe-Signature header"
            })

        raw_body = event.get("body", "")

        if event.get("isBase64Encoded", False):
            payload = base64.b64decode(raw_body)
        else:
            payload = raw_body.encode("utf-8")

        webhook_event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=STRIPE_WEBHOOK_SECRET
        )

        event_type = webhook_event["type"]

        if event_type != "checkout.session.completed":
            return response(200, {
                "received": True,
                "ignored_event_type": event_type
            })

        session = webhook_event["data"]["object"]

        lead_id = session.get("client_reference_id")
        subscription_id = session.get("subscription", "")
        customer_id = session.get("customer", "")
        metadata = session.get("metadata", {}) or {}

        if not lead_id:
            return response(400, {
                "error": "missing_lead_id",
                "message": "client_reference_id missing"
            })

        product = metadata.get("product", "")
        plan = metadata.get("plan", "")
        term = metadata.get("term", "")

        client_id = metadata.get("client_id", DEFAULT_CLIENT_ID)
        client_name = metadata.get("client_name", DEFAULT_CLIENT_NAME)
        project_id = metadata.get("project_id", DEFAULT_PROJECT_ID)
        project_name = metadata.get("project_name", DEFAULT_PROJECT_NAME)
        campaign_id = metadata.get("campaign_id", DEFAULT_CAMPAIGN_ID)
        partner_id = metadata.get("partner_id", DEFAULT_PARTNER_ID)
        partner_name = metadata.get("partner_name", DEFAULT_PARTNER_NAME)
        currency = (session.get("currency") or DEFAULT_CURRENCY).upper()

        product_type = normalize_product_type(metadata)

        campaign_defaults = get_campaign_defaults(campaign_id)
        campaign_name = metadata.get("campaign_name") or campaign_defaults["campaign_name"]

        commission_rate = get_commission_rate(product_type, campaign_defaults)

        amount_total_cents = session.get("amount_total", 0)
        amount_paid = to_decimal_amount_from_cents(amount_total_cents)
        commission_amount = (amount_paid * commission_rate).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP
        )

        created_unix = session.get("created")
        if created_unix:
            event_date = __import__("datetime").datetime.utcfromtimestamp(created_unix).strftime("%Y-%m-%d")
        else:
            event_date = "2026-04-16"

        LEADS_TABLE.update_item(
            Key={"lead_id": lead_id},
            UpdateExpression="""
                SET payment_status = :paid,
                    access_status = :active,
                    stripe_checkout_completed = :true,
                    stripe_subscription_id = :subscription_id,
                    stripe_customer_id = :customer_id,
                    #product = :product,
                    #plan = :plan,
                    #term = :term,
                    client_id = :client_id,
                    client_name = :client_name,
                    project_id = :project_id,
                    project_name = :project_name,
                    campaign_id = :campaign_id,
                    campaign_name = :campaign_name,
                    partner_id = :partner_id,
                    partner_name = :partner_name,
                    product_type = :product_type,
                    commission_rate = :commission_rate,
                    commission_amount = :commission_amount,
                    amount_paid = :amount_paid,
                    currency = :currency,
                    stripe_event_type = :stripe_event_type
            """,
            ExpressionAttributeNames={
                "#product": "product",
                "#plan": "plan",
                "#term": "term"
            },
            ExpressionAttributeValues={
                ":paid": "paid",
                ":active": "active",
                ":true": True,
                ":subscription_id": subscription_id,
                ":customer_id": customer_id,
                ":product": product,
                ":plan": plan,
                ":term": term,
                ":client_id": client_id,
                ":client_name": client_name,
                ":project_id": project_id,
                ":project_name": project_name,
                ":campaign_id": campaign_id,
                ":campaign_name": campaign_name,
                ":partner_id": partner_id,
                ":partner_name": partner_name,
                ":product_type": product_type,
                ":commission_rate": commission_rate,
                ":commission_amount": commission_amount,
                ":amount_paid": amount_paid,
                ":currency": currency,
                ":stripe_event_type": event_type
            }
        )

        report_id = update_daily_report(
            report_date=event_date,
            client_id=client_id,
            client_name=client_name,
            project_id=project_id,
            project_name=project_name,
            campaign_id=campaign_id,
            campaign_name=campaign_name,
            partner_id=partner_id,
            partner_name=partner_name,
            product_type=product_type,
            currency=currency,
            amount_paid=amount_paid,
            commission_amount=commission_amount
        )

        return response(200, {
            "received": True,
            "updated_lead_id": lead_id,
            "event_type": event_type,
            "partner_id": partner_id,
            "campaign_id": campaign_id,
            "product_type": product_type,
            "amount_paid": str(amount_paid),
            "commission_rate": str(commission_rate),
            "commission_amount": str(commission_amount),
            "report_id": report_id
        })

    except stripe.error.SignatureVerificationError as e:
        return response(400, {
            "error": "signature_verification_failed",
            "message": str(e)
        })

    except Exception as e:
        return response(500, {
            "error": "internal_error",
            "message": str(e)
        })