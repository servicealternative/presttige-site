import json
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlencode

import boto3
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ.get("TABLE_NAME", "presttige-db"))

BASE_URL = os.environ.get("BASE_URL", "https://presttige.net").rstrip("/")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
}


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {**CORS_HEADERS, "Cache-Control": "no-store"},
        "body": json.dumps(body),
    }


def redirect(url):
    return {
        "statusCode": 302,
        "headers": {"Location": url, "Cache-Control": "no-store"},
        "body": "",
    }


def as_text(value):
    if value is None:
        return ""
    return str(value).strip()


def as_lower(value):
    return as_text(value).lower()


def parse_body(event):
    raw_body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        import base64

        raw_body = base64.b64decode(raw_body).decode("utf-8")
    return json.loads(raw_body or "{}")


def query_params(event):
    params = event.get("queryStringParameters") or {}
    if params:
        return params
    parsed = parse_qs(event.get("rawQueryString") or "")
    return {key: values[0] for key, values in parsed.items() if values}


def method(event):
    return (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "GET"
    ).upper()


def find_invited_lead(token):
    if not token:
        return None

    scan = table.scan(
        FilterExpression=Attr("founder_token").eq(token) | Attr("verification_token").eq(token),
        ConsistentRead=True,
    )
    items = scan.get("Items") or []
    return items[0] if items else None


def is_founder_c2_candidate(lead):
    if not lead:
        return False
    if as_lower(lead.get("subscriber_type")) != "founder_invited":
        return False
    if as_lower(lead.get("founder_token_status")) != "active":
        return False
    if lead.get("founder_eligible") is not True:
        return False
    if as_lower(lead.get("founder_gate_status")) != "confirmed":
        return False
    if as_lower(lead.get("tier_intent")) != "founder":
        return False
    if not as_text(lead.get("inviter_email")):
        return False
    return True


def public_context(lead):
    return {
        "lead_id": as_text(lead.get("lead_id")),
        "name": as_text(lead.get("name")),
        "email": as_lower(lead.get("email")),
        "country": as_text(lead.get("country")),
        "inviter_email": as_lower(lead.get("inviter_email")),
    }


def verify_email(event):
    token = as_text(query_params(event).get("token"))
    if not token:
        return redirect(f"{BASE_URL}/check-email.html?error=missing_token")

    lead = find_invited_lead(token)
    if not is_founder_c2_candidate(lead):
        return redirect(f"{BASE_URL}/check-email.html?error=invalid_token")

    lead_id = as_text(lead.get("lead_id"))
    if not lead_id:
        return redirect(f"{BASE_URL}/check-email.html?error=invalid_lead")

    now = utc_now_iso()
    table.update_item(
        Key={"lead_id": lead_id},
        UpdateExpression=(
            "SET email_status = :verified, "
            "founder_c2_email_verified_at = if_not_exists(founder_c2_email_verified_at, :now), "
            "updated_at = :now"
        ),
        ExpressionAttributeValues={":verified": "verified", ":now": now},
    )

    return redirect(f"{BASE_URL}/founder-c2.html?token={token}")


def verify_email_with_address(event):
    body = parse_body(event)
    token = as_text(body.get("token"))
    email = as_lower(body.get("email") or body.get("invited_email"))
    if not token:
        return response(400, {"error": "missing_token"})
    if not email:
        return response(400, {"error": "missing_email"})

    lead = find_invited_lead(token)
    if not is_founder_c2_candidate(lead):
        return response(404, {"error": "invalid_founder_invitation"})
    if as_lower(lead.get("email")) != email:
        return response(403, {"error": "email_mismatch"})

    lead_id = as_text(lead.get("lead_id"))
    if not lead_id:
        return response(404, {"error": "invalid_lead"})

    now = utc_now_iso()
    table.update_item(
        Key={"lead_id": lead_id},
        UpdateExpression=(
            "SET email_status = :verified, "
            "founder_c2_email_verified_at = if_not_exists(founder_c2_email_verified_at, :now), "
            "updated_at = :now"
        ),
        ExpressionAttributeValues={":verified": "verified", ":now": now},
    )

    return response(
        200,
        {
            "valid": True,
            "redirect_url": f"{BASE_URL}/founder-c2.html?token={token}",
        },
    )


def get_context(event):
    token = as_text(query_params(event).get("token"))
    lead = find_invited_lead(token)
    if not is_founder_c2_candidate(lead):
        return response(404, {"error": "invalid_founder_invitation"})
    if as_lower(lead.get("email_status")) != "verified":
        return response(403, {"error": "email_not_verified"})
    return response(200, {"lead": public_context(lead)})


def verify_founder_gate(event):
    body = parse_body(event)
    token = as_text(body.get("token"))
    email = as_lower(body.get("email") or body.get("invited_email"))
    lead = find_invited_lead(token)

    if not is_founder_c2_candidate(lead):
        return response(404, {"error": "invalid_founder_invitation"})
    if as_lower(lead.get("email_status")) != "verified":
        return response(403, {"error": "email_not_verified"})
    if as_lower(lead.get("email")) != email:
        return response(403, {"error": "email_mismatch"})

    return response(
        200,
        {
            "valid": True,
            "tier": "founder",
            "email": as_lower(lead.get("email")),
            "inviter_email": as_lower(lead.get("inviter_email")),
        },
    )


def parse_iso_timestamp(value):
    timestamp = as_text(value)
    if not timestamp:
        raise ValueError("missing_timestamp")
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def validate_recent_timestamp(value, max_age_minutes=10):
    parsed = parse_iso_timestamp(value)
    now = datetime.now(timezone.utc)
    if parsed < now - timedelta(minutes=max_age_minutes) or parsed > now + timedelta(minutes=1):
        raise ValueError("stale_timestamp")


def submit_form(event):
    body = parse_body(event)
    token = as_text(body.get("token"))
    lead = find_invited_lead(token)

    if not is_founder_c2_candidate(lead):
        return response(404, {"error": "invalid_founder_invitation"})
    if as_lower(lead.get("email_status")) != "verified":
        return response(403, {"error": "email_not_verified"})

    lead_id = as_text(lead.get("lead_id"))
    terms_accepted = "true" if as_lower(body.get("terms_accepted")) == "true" else "false"
    terms_accepted_at = as_text(body.get("terms_accepted_at"))
    marketing_consent = "true" if as_lower(body.get("marketing_consent")) == "true" else "false"
    marketing_consent_at = as_text(body.get("marketing_consent_at"))

    if terms_accepted != "true":
        return response(400, {"error": "TERMS_NOT_ACCEPTED"})
    try:
        validate_recent_timestamp(terms_accepted_at)
        if marketing_consent == "true":
            validate_recent_timestamp(marketing_consent_at)
        else:
            marketing_consent_at = ""
    except Exception:
        return response(400, {"error": "INVALID_CONSENT_TIMESTAMP"})

    profile_fields = {
        "country": as_text(lead.get("country") or body.get("country")),
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
    }
    required_fields = ("country", "phone_country", "phone", "age", "city", "instagram", "bio")
    missing_fields = [field for field in required_fields if not profile_fields.get(field)]
    if missing_fields:
        return response(400, {"error": "missing_required_fields", "fields": missing_fields})
    if len(profile_fields["bio"]) < 50:
        return response(400, {"error": "bio_too_short"})

    now = utc_now_iso()
    update_fields = {
        **profile_fields,
        "terms_accepted": terms_accepted,
        "terms_accepted_at": terms_accepted_at,
        "marketing_consent": marketing_consent,
        "marketing_consent_at": marketing_consent_at,
        "profile_status": "founder_c2_ready_for_payment",
        "profile_submitted_at": now,
        "founder_c2_profile_completed_at": now,
        "founder_c2_no_committee": True,
        "review_status": "approved",
        "reviewed_at": now,
        "reviewed_by": "founder_c2_no_committee",
        "updated_at": now,
    }

    names = {}
    values = {}
    set_parts = []
    for key, value in update_fields.items():
        name_key = f"#{key}"
        value_key = f":{key}"
        names[name_key] = key
        values[value_key] = value
        if key in {"terms_accepted", "terms_accepted_at", "marketing_consent", "marketing_consent_at"}:
            set_parts.append(f"{name_key} = if_not_exists({name_key}, {value_key})")
        else:
            set_parts.append(f"{name_key} = {value_key}")

    values[":active"] = "active"
    values[":founder_invited"] = "founder_invited"
    values[":founder"] = "founder"
    table.update_item(
        Key={"lead_id": lead_id},
        UpdateExpression="SET " + ", ".join(set_parts),
        ConditionExpression=(
            "subscriber_type = :founder_invited AND "
            "founder_token_status = :active AND "
            "tier_intent = :founder"
        ),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )

    params = urlencode(
        {
            "invited_email": as_lower(lead.get("email")),
            "token": token,
            "from": "c2",
        }
    )
    return response(
        200,
        {
            "message": "founder_c2_ready_for_payment",
            "lead_id": lead_id,
            "redirect_url": f"{BASE_URL}/founder/?{params}",
        },
    )


def lambda_handler(event, context):
    if method(event) == "OPTIONS":
        return response(200, {"message": "OK"})

    try:
        action = as_lower(query_params(event).get("action"))
        if method(event) == "GET" and action == "verify":
            return verify_email(event)
        if method(event) == "GET":
            return get_context(event)
        if method(event) == "POST" and action == "verify-email":
            return verify_email_with_address(event)
        if method(event) == "POST" and action == "gate":
            return verify_founder_gate(event)
        if method(event) == "POST":
            return submit_form(event)
        return response(405, {"error": "method_not_allowed"})
    except Exception as error:
        print("FOUNDER C2 ERROR:", str(error))
        return response(500, {"error": "server_error"})
