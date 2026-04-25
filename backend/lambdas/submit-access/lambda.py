import json
import logging
import boto3
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone

CURRENT_FILE = Path(__file__).resolve()
for candidate in (CURRENT_FILE.parent, *CURRENT_FILE.parents):
    candidate_str = str(candidate)
    if (candidate / "shared").exists() and candidate_str not in sys.path:
        sys.path.append(candidate_str)

from shared.testers import get_tester_email_for_lead_id, log_tester_event

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")
ses = boto3.client("ses", region_name="eu-west-1")
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "*",
}


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def parse_body(event):
    raw_body = event.get("body") or "{}"

    if event.get("isBase64Encoded"):
        import base64
        raw_body = base64.b64decode(raw_body).decode("utf-8")

    return json.loads(raw_body or "{}")


def as_text(value):
    if value is None:
        return ""
    return str(value).strip()


def normalize_boolean_text(value):
    return "true" if as_text(value).lower() == "true" else "false"


def parse_iso_timestamp(value):
    timestamp = as_text(value)
    if not timestamp:
        raise ValueError("missing_timestamp")

    candidate = timestamp.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(candidate)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def validate_recent_timestamp(value, max_age_minutes=10):
    parsed = parse_iso_timestamp(value)
    now = datetime.now(timezone.utc)
    lower_bound = now - timedelta(minutes=max_age_minutes)
    upper_bound = now + timedelta(minutes=1)

    if parsed < lower_bound or parsed > upper_bound:
        raise ValueError("stale_timestamp")

    return parsed


def build_recipient_name(lead):
    full_name = as_text(lead.get("full_name") or lead.get("name"))
    if full_name:
        parts = full_name.split()
        if len(parts) >= 2:
            return " ".join(parts[:2])
        return parts[0]

    first_middle = f"{as_text(lead.get('first_name'))} {as_text(lead.get('middle_name'))}".strip()
    if first_middle:
        return first_middle

    first_name = as_text(lead.get("first_name"))
    if first_name:
        return first_name

    last_name = as_text(lead.get("last_name"))
    if last_name:
        return f"Mr/Ms {last_name}"

    return "Member"


def send_application_received_email(recipient_email, recipient_name):
    if not recipient_name or not recipient_name.strip():
        recipient_name = "Member"

    return ses.send_templated_email(
        Source="Presttige <no-reply@presttige.net>",
        Destination={"ToAddresses": [recipient_email]},
        Template="presttige_transactional_v1",
        TemplateData=json.dumps({
            "subject": "Your application is with us — Presttige",
            "preheader": "Thank you for submitting your application. We will be in touch.",
            "brand_url": "https://www.presttige.net",
            "logo_url": "https://presttige.net/assets/images/presttige-p-lettering-no-fund.svg",
            "footer_logo_url": "https://presttige.net/assets/images/presttige-p-ring-no-fund.svg",
            "recipient_name": recipient_name,
            "eyebrow": "MEMBERSHIP · APPLICATION RECEIVED",
            "headline": "Your application is with us.",
            "body_html": "<p style=\"margin:0 0 16px 0;\">Thank you for submitting your application to Presttige. Our members committee will review your profile with the attention it deserves, and you will hear from us within seven to fourteen days. No further action is required from you at this stage.</p>",
            "cta_url": "",
            "cta_label": "",
            "disclaimer": "We appreciate your interest in joining our private community.",
            "sign_off_name": "Member Services",
            "sign_off_title": "PRESTTIGE PRIVATE OFFICE",
        }),
    )


def lambda_handler(event, context):
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return response(200, {"message": "OK"})

    try:
        body = parse_body(event)
        lead_id = as_text(body.get("lead_id"))
        terms_accepted = normalize_boolean_text(body.get("terms_accepted"))
        terms_accepted_at = as_text(body.get("terms_accepted_at"))
        marketing_consent = normalize_boolean_text(body.get("marketing_consent"))
        marketing_consent_at = as_text(body.get("marketing_consent_at"))

        if not lead_id:
            return response(400, {"error": "missing_lead_id"})

        if terms_accepted != "true":
            return response(400, {"error": "TERMS_NOT_ACCEPTED"})

        try:
            validate_recent_timestamp(terms_accepted_at)
        except Exception:
            return response(400, {"error": "INVALID_TERMS_ACCEPTED_AT"})

        if marketing_consent == "true":
            try:
                validate_recent_timestamp(marketing_consent_at)
            except Exception:
                return response(400, {"error": "INVALID_MARKETING_CONSENT_AT"})
        else:
            marketing_consent_at = ""

        now = utc_now_iso()
        profile_fields = {
            "country": as_text(body.get("country")),
            "phone_country": as_text(body.get("phone_country")),
            "phone": as_text(body.get("phone")),
            "age": as_text(body.get("age")),
            "city": as_text(body.get("city")),
            "instagram": as_text(body.get("instagram")),
            "linkedin": as_text(body.get("linkedin")),
            "occupation": as_text(body.get("occupation")),
            "company": as_text(body.get("company")),
            "website": as_text(body.get("website")),
            "tiktok": as_text(body.get("tiktok")),
            "bio": as_text(body.get("bio")),
            "why": as_text(body.get("why")),
            "profile_status": "profile_submitted",
            "profile_submitted_at": now,
            "updated_at": now,
        }
        consent_fields = {
            "terms_accepted": terms_accepted,
            "terms_accepted_at": terms_accepted_at,
            "marketing_consent": marketing_consent,
            "marketing_consent_at": marketing_consent_at,
        }

        required_fields = ("country", "phone_country", "phone", "age", "city", "instagram", "bio", "why")
        missing_fields = [field for field in required_fields if not profile_fields.get(field)]

        if missing_fields:
            return response(400, {"error": "missing_required_fields", "fields": missing_fields})

        tester_email = get_tester_email_for_lead_id(lead_id)
        if tester_email:
            logger.info(
                "[TESTER] consent received",
                extra={
                    "lead_id": lead_id,
                    "terms_accepted": terms_accepted,
                    "terms_accepted_at": terms_accepted_at,
                    "marketing_consent": marketing_consent,
                    "marketing_consent_at": marketing_consent_at,
                },
            )
            log_tester_event(
                event_name="submit_access",
                email=tester_email,
                extra={
                    "lead_id": lead_id,
                    "delay_bypassed": True,
                    "immediate_processing": True,
                    "terms_accepted": terms_accepted,
                    "terms_accepted_at": terms_accepted_at,
                    "marketing_consent": marketing_consent,
                    "marketing_consent_at": marketing_consent_at,
                },
            )
            return response(200, {
                "message": "application_submitted",
                "lead_id": lead_id,
                "application_received_sent": True,
            })

        db_response = table.get_item(Key={"lead_id": lead_id})
        lead = db_response.get("Item")

        if not lead:
            return response(404, {"error": "lead_not_found"})

        update_names = {}
        update_values = {}
        set_parts = []

        for key, value in {**profile_fields, **consent_fields}.items():
            name_key = f"#{key}"
            value_key = f":{key}"
            update_names[name_key] = key
            update_values[value_key] = value
            if key in consent_fields:
                set_parts.append(f"{name_key} = if_not_exists({name_key}, {value_key})")
            else:
                set_parts.append(f"{name_key} = {value_key}")

        table.update_item(
            Key={"lead_id": lead_id},
            UpdateExpression="SET " + ", ".join(set_parts),
            ExpressionAttributeNames=update_names,
            ExpressionAttributeValues=update_values,
        )

        lead.update(profile_fields)
        lead.update(consent_fields)

        if not lead.get("application_received_sent", False):
            recipient_email = as_text(lead.get("email")).lower()

            if not recipient_email:
                return response(400, {"error": "missing_email"})

            send_application_received_email(
                recipient_email=recipient_email,
                recipient_name=build_recipient_name(lead),
            )

            application_received_sent_at = utc_now_iso()
            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET application_received_sent = :sent,
                        application_received_sent_at = :sent_at,
                        updated_at = :updated_at
                """,
                ExpressionAttributeValues={
                    ":sent": True,
                    ":sent_at": application_received_sent_at,
                    ":updated_at": application_received_sent_at,
                },
            )

        return response(200, {
            "message": "application_submitted",
            "lead_id": lead_id,
            "application_received_sent": True,
        })

    except Exception as e:
        return response(500, {"error": str(e)})
