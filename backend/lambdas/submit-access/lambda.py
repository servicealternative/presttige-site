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

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")
lambda_client = boto3.client("lambda", region_name="us-east-1")
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


def request_method(event):
    return as_text(
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "POST"
    ).upper()


def normalize_boolean_text(value):
    return "true" if as_text(value).lower() == "true" else "false"


def parse_photo_ids(value):
    if not isinstance(value, list):
        return []

    photo_ids = []
    seen = set()
    for item in value:
        photo_id = as_text(item)
        if not photo_id or photo_id in seen:
            continue
        seen.add(photo_id)
        photo_ids.append(photo_id)
    return photo_ids


def invoke_async(function_name, payload):
    lambda_client.invoke(
        FunctionName=function_name,
        InvocationType="Event",
        Payload=json.dumps({"body": json.dumps(payload)}).encode("utf-8"),
    )


def mark_photo_removed(body):
    lead_id = as_text(body.get("lead_id"))
    photo_id = as_text(body.get("photo_id"))

    if not lead_id or not photo_id:
        return response(400, {"error": "missing_lead_id_or_photo_id"})

    now = utc_now_iso()
    table.update_item(
        Key={"lead_id": lead_id},
        UpdateExpression=(
            "SET photo_uploads.#pid.#status = :removed, "
            "photo_uploads.#pid.removed_at = :removed_at, "
            "photo_uploads.#pid.selected_for_committee = :selected, "
            "updated_at = :updated_at"
        ),
        ExpressionAttributeNames={
            "#pid": photo_id,
            "#status": "status",
        },
        ExpressionAttributeValues={
            ":removed": "removed",
            ":removed_at": now,
            ":selected": False,
            ":updated_at": now,
        },
    )

    return response(200, {"removed": True, "lead_id": lead_id, "photo_id": photo_id})


def finalize_photo_submission(body):
    lead_id = as_text(body.get("lead_id"))
    photo_ids = parse_photo_ids(body.get("photo_ids"))

    if not lead_id:
        return response(400, {"error": "missing_lead_id"})

    if len(photo_ids) < 2:
        return response(400, {"error": "minimum_two_photos_required", "photo_count": len(photo_ids)})

    if len(photo_ids) > 3:
        return response(400, {"error": "maximum_three_photos_allowed", "photo_count": len(photo_ids)})

    db_response = table.get_item(Key={"lead_id": lead_id})
    lead = db_response.get("Item")
    if not lead:
        return response(404, {"error": "lead_not_found"})

    photo_uploads = dict(lead.get("photo_uploads") or {})
    missing_or_not_ready = []
    for photo_id in photo_ids:
        photo = photo_uploads.get(photo_id) or {}
        if photo.get("status") != "ready":
            missing_or_not_ready.append(photo_id)

    if missing_or_not_ready:
        return response(425, {
            "error": "photos_not_ready",
            "photo_ids": missing_or_not_ready,
        })

    now = utc_now_iso()
    selected = set(photo_ids)
    updated_uploads = {}

    for photo_id, photo in photo_uploads.items():
        photo_meta = dict(photo or {})
        if photo_id in selected:
            photo_meta["selected_for_committee"] = True
            photo_meta["submitted_at"] = now
            if photo_meta.get("status") == "removed":
                photo_meta["status"] = "ready"
            photo_meta.pop("removed_at", None)
        else:
            photo_meta["selected_for_committee"] = False
            if photo_meta.get("status") in {"awaiting_upload", "processing", "ready", "timeout"}:
                photo_meta["status"] = "removed"
                photo_meta["removed_at"] = now
        updated_uploads[photo_id] = photo_meta

    table.update_item(
        Key={"lead_id": lead_id},
        UpdateExpression=(
            "SET photo_uploads = :photo_uploads, "
            "submitted_photo_ids = :photo_ids, "
            "profile_status = :profile_status, "
            "profile_completed_at = :completed_at, "
            "submitted_to_committee_at = :submitted_at, "
            "updated_at = :updated_at"
        ),
        ExpressionAttributeValues={
            ":photo_uploads": updated_uploads,
            ":photo_ids": photo_ids,
            ":profile_status": "submitted_to_committee",
            ":completed_at": now,
            ":submitted_at": now,
            ":updated_at": now,
        },
    )

    invoke_async("presttige-send-committee-email", {"lead_id": lead_id, "photo_ids": photo_ids})
    invoke_async("presttige-send-application-received", {"lead_id": lead_id})

    return response(200, {
        "message": "application_submitted",
        "lead_id": lead_id,
        "photo_ids": photo_ids,
        "committee_notification_triggered": True,
        "application_received_triggered": True,
    })


def get_country_context(event):
    params = event.get("queryStringParameters") or {}
    lead_id = as_text(params.get("lead_id") or params.get("leadId"))

    if not lead_id:
        return response(400, {"error": "missing_lead_id"})

    db_response = table.get_item(Key={"lead_id": lead_id})
    lead = db_response.get("Item")

    if not lead:
        return response(404, {"error": "lead_not_found"})

    country = as_text(lead.get("country"))
    if not country:
        return response(404, {"error": "country_not_found"})

    return response(200, {
        "lead_id": lead_id,
        "country": country,
    })


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


def lambda_handler(event, context):
    method = request_method(event)

    if method == "OPTIONS":
        return response(200, {"message": "OK"})

    if method == "GET":
        action = as_text((event.get("queryStringParameters") or {}).get("action")).lower()
        if action == "get_country_context":
            return get_country_context(event)
        return response(400, {"error": "unsupported_action"})

    if method != "POST":
        return response(405, {"error": "method_not_allowed"})

    try:
        body = parse_body(event)
        action = as_text(body.get("action")).lower()

        if action == "remove_photo":
            return mark_photo_removed(body)

        if action == "finalize_photos":
            return finalize_photo_submission(body)

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

        return response(200, {
            "message": "profile_saved",
            "lead_id": lead_id,
            "application_received_sent": False,
            "preview_mode": bool(lead.get("preview_mode")),
        })

    except Exception as e:
        return response(500, {"error": str(e)})
