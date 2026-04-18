import json
import os
import boto3
import hmac
import hashlib
from datetime import datetime, timedelta

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('presttige-db')

TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "")
OFFER_TIMESTAMP_FIELD = "offer_sent_at"


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body)
    }

def generate_token(lead_id):
    return hmac.new(
        TOKEN_SECRET.encode(),
        lead_id.encode(),
        hashlib.sha256
    ).hexdigest()

def lambda_handler(event, context):
    try:
        params = event.get("queryStringParameters") or {}

        lead_id = params.get("id") or params.get("lead_id")
        token = params.get("token")

        if not TOKEN_SECRET:
            return response(500, {"error": "config_error"})

        if not lead_id or not token:
            return response(400, {"error": "missing_parameters"})

        # validar token
        expected_token = generate_token(lead_id)

        if token != expected_token:
            return response(403, {"error": "invalid_token"})

        # buscar na DB
        db_response = table.get_item(Key={"lead_id": lead_id})
        item = db_response.get("Item")
        referral_code = (item.get("referral_code") or "unknown").strip() or "unknown" if item else "unknown"

        if not item:
            return response(404, {"error": "lead_not_found"})

        if item.get("payment_status") == "paid":
            return response(400, {"error": "already_paid"})

        offer_sent_at_raw = (item.get(OFFER_TIMESTAMP_FIELD) or "").strip()

        if not offer_sent_at_raw:
            return response(403, {"error": "offer_window_unavailable"})

        try:
            offer_sent_at = datetime.fromisoformat(offer_sent_at_raw.replace("Z", ""))
        except ValueError:
            return response(403, {"error": "offer_window_invalid"})

        if datetime.utcnow() > offer_sent_at + timedelta(hours=72):
            return response(410, {"error": "offer_expired"})

        # para já só validar (Stripe vem já a seguir)
        return response(200, {
            "message": "Gateway validated",
            "lead_id": lead_id,
            "email": item.get("email"),
            "name": item.get("name"),
            "referral_code": referral_code
        })

    except Exception as e:
        return response(500, {"error": str(e)})
