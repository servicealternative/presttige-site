import json
import os
import base64
import boto3
import sys
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP

try:
    import stripe
    STRIPE_IMPORT_OK = True
    STRIPE_IMPORT_ERROR = None
except Exception as e:
    stripe = None
    STRIPE_IMPORT_OK = False
    STRIPE_IMPORT_ERROR = str(e)

CURRENT_FILE = Path(__file__).resolve()
for candidate in (CURRENT_FILE.parent, *CURRENT_FILE.parents):
    candidate_str = str(candidate)
    if (candidate / "shared").exists() and candidate_str not in sys.path:
        sys.path.append(candidate_str)

from shared.testers import is_tester_email, log_tester_event, normalize_email

dynamodb = boto3.resource("dynamodb")

LEADS_TABLE = dynamodb.Table("presttige-db")

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()

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
        safe_get(metadata, "product_type")
        or safe_get(metadata, "product")
        or ""
    ).strip().lower()

    if product_type in ["founder", "access", "membership"]:
        return product_type

    return "founder"


def safe_get(mapping_like, key, default=None):
    if mapping_like is None:
        return default
    if isinstance(mapping_like, dict):
        return mapping_like.get(key, default)
    getter = getattr(mapping_like, "get", None)
    if callable(getter):
        try:
            return getter(key, default)
        except TypeError:
            pass
    try:
        return mapping_like[key]
    except Exception:
        return getattr(mapping_like, key, default)


def get_session_email(session):
    metadata = safe_get(session, "metadata", {}) or {}
    customer_details = safe_get(session, "customer_details", {}) or {}
    return normalize_email(
        safe_get(customer_details, "email")
        or safe_get(session, "customer_email")
        or safe_get(metadata, "tester_email")
    )


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

        lead_id = safe_get(session, "client_reference_id")
        subscription_id = safe_get(session, "subscription", "")
        customer_id = safe_get(session, "customer", "")
        metadata = safe_get(session, "metadata", {}) or {}
        session_email = get_session_email(session)

        if not lead_id:
            return response(400, {
                "error": "missing_lead_id",
                "message": "client_reference_id missing"
            })

        product = safe_get(metadata, "product", "")
        plan = safe_get(metadata, "plan", "")
        term = safe_get(metadata, "term", "")

        currency = (safe_get(session, "currency") or DEFAULT_CURRENCY).upper()
        product_type = normalize_product_type(metadata)
        amount_total_cents = safe_get(session, "amount_total", 0)
        amount_paid = to_decimal_amount_from_cents(amount_total_cents)

        if is_tester_email(session_email):
            log_tester_event(
                event_name="stripe_webhook_checkout_completed",
                email=session_email,
                extra={
                    "lead_id": lead_id,
                    "product": product,
                    "plan": plan,
                    "term": term,
                    "product_type": product_type,
                    "currency": currency,
                },
            )
            return response(200, {
                "received": True,
                "tester_skipped": True,
                "event_type": event_type,
                "lead_id": lead_id,
            })

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
                    product_type = :product_type,
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
                ":product_type": product_type,
                ":amount_paid": amount_paid,
                ":currency": currency,
                ":stripe_event_type": event_type
            }
        )

        return response(200, {
            "received": True,
            "updated_lead_id": lead_id,
            "event_type": event_type,
            "product_type": product_type,
            "amount_paid": str(amount_paid),
            "currency": currency
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
