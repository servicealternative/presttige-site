import json
import boto3
import uuid
import hmac
import hashlib
import sys
from pathlib import Path
from datetime import datetime

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.append(str(BACKEND_ROOT))

from email_utils import build_email_html

# AWS
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")
ses = boto3.client("ses", region_name="us-east-1")

# CONFIG
TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "")
FROM_EMAIL = "info@presttige.net"
VERIFY_BASE_URL = "https://presttige.net/verify-email.html"

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*"
}


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body)
    }


def generate_lead_id():
    return "fdm_" + uuid.uuid4().hex[:10]


def generate_token(lead_id, email):
    raw = f"{lead_id}:{email}:email_verify"
    return hmac.new(
        TOKEN_SECRET.encode(),
        raw.encode(),
        hashlib.sha256
    ).hexdigest()


def extract_fields_from_body(body):
    name = None
    email = None
    country = None
    application_type = "access"
    source = "unknown"
    campaign_id = ""
    referral_code = "unknown"

    data = body.get("data", {})
    fields = data.get("fields", [])

    if isinstance(fields, list):
        mapped = {}
        for field in fields:
            key = field.get("key")
            value = field.get("value")
            if key:
                mapped[key] = value

        name = (mapped.get("name") or "").strip()
        email = (mapped.get("email") or "").strip().lower()
        country = (mapped.get("country") or "").strip()
        application_type = (mapped.get("application_type") or "access").strip().lower()
        source = (mapped.get("source") or "unknown").strip()
        campaign_id = (mapped.get("campaign_id") or "").strip()
        referral_code = (mapped.get("referral_code") or source or "unknown").strip() or "unknown"

    return name, email, country, application_type, source, campaign_id, referral_code


def lambda_handler(event, context):
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return response(200, {"message": "OK"})

    try:
        if not TOKEN_SECRET:
            return response(500, {"error": "config_error"})

        raw_body = event.get("body", "{}")

        if event.get("isBase64Encoded"):
            import base64
            raw_body = base64.b64decode(raw_body).decode("utf-8")

        body = json.loads(raw_body or "{}")

        name, email, country, application_type, source, campaign_id, referral_code = extract_fields_from_body(body)

        if not name or not email or not country:
            return response(400, {"error": "Missing required fields"})

        lead_id = generate_lead_id()
        verification_token = generate_token(lead_id, email)
        now = datetime.utcnow().isoformat()

        item = {
            "lead_id": lead_id,
            "name": name,
            "email": email,
            "country": country,
            "application_type": application_type,
            "source": source,
            "campaign_id": campaign_id,
            "referral_code": referral_code,
            "email_status": "pending",
            "phone_status": "pending",
            "profile_status": "step_1",
            "review_status": "pending",
            "verification_token": verification_token,
            "created_at": now,
            "updated_at": now
        }

        table.put_item(Item=item)

        verify_link = f"{VERIFY_BASE_URL}?token={verification_token}"

        ses.send_email(
            Source=FROM_EMAIL,
            Destination={
                "ToAddresses": [email],
            },
            Message={
                "Subject": {
                    "Data": "Confirm your email to continue — Presttige",
                },
                "Body": {
                    "Html": {
                        "Data": build_email_html(
                            title="Confirm your email to continue",
                            greeting_name=name,
                            body_html="<p>Please confirm your email address to continue your Presttige application.</p>",
                            cta_label="Confirm Email",
                            cta_url=verify_link,
                            footer_note="If you did not request access, you can ignore this email."
                        )
                    }
                }
            }
        )

        return response(200, {
            "message": "Step 1 submitted",
            "lead_id": lead_id
        })

    except Exception as e:
        return response(500, {"error": str(e)})
