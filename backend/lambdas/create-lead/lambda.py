import json
import os
import boto3
import uuid
import hmac
import hashlib
import re
import sys
from pathlib import Path
from datetime import datetime
from boto3.dynamodb.conditions import Key

CURRENT_FILE = Path(__file__).resolve()
for candidate in (CURRENT_FILE.parent, *CURRENT_FILE.parents):
    candidate_str = str(candidate)
    if (candidate / "email_utils.py").exists() and candidate_str not in sys.path:
        sys.path.append(candidate_str)
    if (candidate / "shared").exists() and candidate_str not in sys.path:
        sys.path.append(candidate_str)

from email_utils import (
    render_transactional_email_plaintext_template,
    render_transactional_email_template,
)
from shared.testers import (
    extract_tester_tracking_metadata,
    generate_tester_verification_token,
    get_tester_lead_id,
    is_tester_email,
    log_tester_event,
)

# AWS
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")
ses = boto3.client("ses", region_name="us-east-1")

# CONFIG
TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "")
FROM_EMAIL = "committee@presttige.net"
REPLY_TO_EMAIL = "committee@presttige.net"
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
    phone = ""
    application_type = "access"
    source = "unknown"
    campaign_id = ""
    referral_code = "unknown"
    supported_keys = (
        "name",
        "email",
        "country",
        "phone",
        "application_type",
        "source",
        "campaign_id",
        "referral_code",
    )
    mapped = {}

    data = body.get("data", {})
    fields = data.get("fields", [])

    if isinstance(fields, list):
        for field in fields:
            key = field.get("key")
            value = field.get("value")
            if key:
                mapped[key] = value

    if isinstance(data, dict):
        for key in supported_keys:
            if key not in mapped and data.get(key) is not None:
                mapped[key] = data.get(key)

    for key in supported_keys:
        if key not in mapped and body.get(key) is not None:
            mapped[key] = body.get(key)

    if mapped:
        def as_text(value):
            if value is None:
                return ""
            return str(value).strip()

        name = as_text(mapped.get("name"))
        email = as_text(mapped.get("email")).lower()
        country = as_text(mapped.get("country"))
        phone = as_text(mapped.get("phone"))
        application_type = as_text(mapped.get("application_type") or "access").lower()
        source = as_text(mapped.get("source") or "unknown")
        campaign_id = as_text(mapped.get("campaign_id"))
        referral_code = as_text(mapped.get("referral_code") or source or "unknown") or "unknown"

    return name, email, country, phone, application_type, source, campaign_id, referral_code


def email_already_exists(email):
    result = table.query(
        IndexName="email-index",
        KeyConditionExpression=Key("email").eq(email),
        Limit=1,
    )
    return bool(result.get("Items"))


def phone_already_exists(phone_full):
    if not phone_full:
        return False
    result = table.query(
        IndexName="phone-index",
        KeyConditionExpression=Key("phone_full").eq(phone_full),
        Limit=1,
    )
    return bool(result.get("Items"))


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

        name, email, country, phone, application_type, source, campaign_id, referral_code = extract_fields_from_body(body)

        if not name or not email or not country:
            return response(400, {"error": "Missing required fields"})

        is_tester = is_tester_email(email)

        if not is_tester and email_already_exists(email):
            print(json.dumps({
                "event": "duplicate_email_attempt",
                "email": email,
                "source": source,
                "campaign_id": campaign_id,
            }))
            return response(409, {
                "error": "email_exists",
                "message": "This email is already registered. If you need access to your existing application, contact committee@presttige.net"
            })

        phone_full = re.sub(r"[\s\-()]", "", phone)
        if not is_tester and phone_already_exists(phone_full):
            print(json.dumps({
                "event": "duplicate_phone_attempt",
                "phone_full": phone_full,
                "source": source,
                "campaign_id": campaign_id,
            }))
            return response(409, {
                "error": "phone_exists",
                "message": "This phone number is already registered. If you need access to your existing application, contact committee@presttige.net"
            })

        if is_tester:
            lead_id = get_tester_lead_id(email)
            verification_token = generate_tester_verification_token(email, TOKEN_SECRET)
        else:
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
            "application_received_sent": False,
            "application_received_sent_at": None,
            "verification_token": verification_token,
            "created_at": now,
            "updated_at": now
        }
        if phone:
            item["phone"] = phone
        if phone_full:
            item["phone_full"] = phone_full

        if not is_tester:
            table.put_item(Item=item)
        else:
            log_tester_event(
                event_name="create_lead",
                email=email,
                metadata=extract_tester_tracking_metadata(body),
                extra={
                    "lead_id": lead_id,
                    "application_type": application_type,
                    "delay_bypassed": True,
                    "duplicate_guard_skipped": True,
                },
            )

        verify_link = f"{VERIFY_BASE_URL}?token={verification_token}"

        email_context = {
            "subject": "Confirm your email to continue — Presttige",
            "preheader": "Confirm your email to continue your Presttige application.",
            "brand_url": "https://presttige.net",
            "logo_url": "https://presttige.net/assets/images/presttige-p-lettering-no-fund.svg",
            "footer_logo_url": "https://presttige.net/assets/images/presttige-p-ring-no-fund.svg",
            "recipient_name": name,
            "eyebrow": "MEMBERSHIP · EMAIL VERIFICATION",
            "headline": "Confirm your email to continue",
            "body_html": "<p style=\"margin:0;\">Your request has been received. To continue, please confirm your email address using the secure link below. This step is required before your application can proceed.</p>",
            "cta_label": "Confirm Email",
            "cta_url": verify_link,
            "disclaimer": "If you did not initiate this request, no action is required.",
            "sign_off_name": "Member Services",
            "sign_off_title": "PRESTTIGE PRIVATE OFFICE",
        }

        print(json.dumps({
            "event": "verification_email_sender",
            "lead_id": lead_id,
            "email": email,
            "source": FROM_EMAIL,
            "reply_to": REPLY_TO_EMAIL,
        }))

        ses_response = ses.send_email(
            Source=FROM_EMAIL,
            ReplyToAddresses=[REPLY_TO_EMAIL],
            Destination={
                "ToAddresses": [email],
            },
            Message={
                "Subject": {
                    "Data": "Confirm your email to continue — Presttige",
                },
                "Body": {
                    "Html": {
                        "Data": render_transactional_email_template(email_context)
                    },
                    "Text": {
                        "Data": render_transactional_email_plaintext_template(email_context)
                    }
                }
            }
        )

        print(json.dumps({
            "event": "verification_email_sent",
            "lead_id": lead_id,
            "email": email,
            "ses_message_id": ses_response.get("MessageId"),
            "is_tester": is_tester,
        }))

        return response(200, {
            "message": "Step 1 submitted",
            "lead_id": lead_id
        })

    except Exception as e:
        return response(500, {"error": str(e)})
