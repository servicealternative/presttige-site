import json
import os
import hmac
import hashlib
import boto3

try:
    import stripe
    STRIPE_IMPORT_OK = True
except Exception as e:
    STRIPE_IMPORT_OK = False
    STRIPE_IMPORT_ERROR = str(e)

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "")

FOUNDER_PRICE_ID = os.environ.get("FOUNDER_PRICE_ID", "")
ACCESS_PRICE_ID = os.environ.get("ACCESS_PRICE_ID", "")

ENTRY_MONTHLY_PRICE_ID = os.environ.get("ENTRY_MONTHLY_PRICE_ID", "")
ENTRY_3MONTH_PRICE_ID = os.environ.get("ENTRY_3MONTH_PRICE_ID", "")
ENTRY_ANNUAL_PRICE_ID = os.environ.get("ENTRY_ANNUAL_PRICE_ID", "")

MID_MONTHLY_PRICE_ID = os.environ.get("MID_MONTHLY_PRICE_ID", "")
MID_3MONTH_PRICE_ID = os.environ.get("MID_3MONTH_PRICE_ID", "")
MID_ANNUAL_PRICE_ID = os.environ.get("MID_ANNUAL_PRICE_ID", "")

PREMIUM_MONTHLY_PRICE_ID = os.environ.get("PREMIUM_MONTHLY_PRICE_ID", "")
PREMIUM_3MONTH_PRICE_ID = os.environ.get("PREMIUM_3MONTH_PRICE_ID", "")
PREMIUM_ANNUAL_PRICE_ID = os.environ.get("PREMIUM_ANNUAL_PRICE_ID", "")

SUCCESS_URL = os.environ.get("SUCCESS_URL", "")
CANCEL_URL = os.environ.get("CANCEL_URL", "")

if STRIPE_IMPORT_OK:
    stripe.api_key = STRIPE_SECRET_KEY


def response(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body)
    }


def generate_token(lead_id):
    return hmac.new(
        TOKEN_SECRET.encode(),
        lead_id.encode(),
        hashlib.sha256
    ).hexdigest()


def get_membership_price(plan, term):
    mapping = {
        ("entry", "monthly"): ENTRY_MONTHLY_PRICE_ID,
        ("entry", "3month"): ENTRY_3MONTH_PRICE_ID,
        ("entry", "annual"): ENTRY_ANNUAL_PRICE_ID,

        ("mid", "monthly"): MID_MONTHLY_PRICE_ID,
        ("mid", "3month"): MID_3MONTH_PRICE_ID,
        ("mid", "annual"): MID_ANNUAL_PRICE_ID,

        ("premium", "monthly"): PREMIUM_MONTHLY_PRICE_ID,
        ("premium", "3month"): PREMIUM_3MONTH_PRICE_ID,
        ("premium", "annual"): PREMIUM_ANNUAL_PRICE_ID,
    }
    return mapping.get((plan, term), "")


def lambda_handler(event, context):
    try:
        params = event.get("queryStringParameters") or {}

        lead_id = params.get("id", "")
        token = params.get("token", "")
        product = params.get("product", "")
        plan = params.get("plan", "")
        term = params.get("term", "")

        if not lead_id or not token:
            return response(400, {"error": "missing_parameters"})

        if generate_token(lead_id) != token:
            return response(403, {"error": "invalid_token"})

        db = table.get_item(Key={"lead_id": lead_id})
        if "Item" not in db:
            return response(404, {"error": "lead_not_found"})

        mode = "payment"
        metadata = {"lead_id": lead_id}

        if product == "founder":
            price = FOUNDER_PRICE_ID
            metadata["product"] = "founder"

        elif product == "access":
            price = ACCESS_PRICE_ID
            metadata["product"] = "access"

        elif product == "membership":
            price = get_membership_price(plan, term)
            mode = "subscription"
            metadata.update({
                "product": "membership",
                "plan": plan,
                "term": term
            })

        else:
            return response(400, {"error": "invalid_product"})

        if not price:
            return response(500, {"error": "missing_price_id"})

        session = stripe.checkout.Session.create(
            mode=mode,
            line_items=[{"price": price, "quantity": 1}],
            success_url=SUCCESS_URL + "?session_id={CHECKOUT_SESSION_ID}",
            cancel_url=CANCEL_URL,
            client_reference_id=lead_id,
            metadata=metadata
        )

        return {
            "statusCode": 302,
            "headers": {"Location": session.url}
        }

    except Exception as e:
        return response(500, {"error": str(e)})