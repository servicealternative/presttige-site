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
from botocore.exceptions import ClientError

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
    is_authorized_test_email,
    normalize_email,
)

# AWS
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")
ses = boto3.client("ses", region_name="us-east-1")
s3 = boto3.client("s3", region_name="us-east-1")
scheduler = boto3.client("scheduler", region_name="us-east-1")
sesv2 = boto3.client("sesv2", region_name="us-east-1")

# CONFIG
TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "")
FROM_EMAIL = "committee@presttige.net"
REPLY_TO_EMAIL = "committee@presttige.net"
SES_CONFIGURATION_SET = os.environ.get("SES_CONFIGURATION_SET", "presttige-deliverability-v1")
VERIFY_BASE_URL = "https://presttige.net/verify-email.html"
ORIGINALS_BUCKET = os.environ.get("PHOTOS_ORIGINALS_BUCKET", "presttige-applicant-photos")
THUMBNAILS_BUCKET = os.environ.get("PHOTOS_THUMBNAILS_BUCKET", "presttige-applicant-photos-thumbnails")
SCHEDULER_GROUP_NAME = os.environ.get("TESTER_PURGE_SCHEDULER_GROUP", "default")
TEST_MARKER_KEYS = {
    "synthetic_test",
    "synthetic",
    "is_test",
    "test_tier",
}
TEST_TIER_KEYS = {
    "tier",
    "selected_tier",
    "effective_tier",
    "subscriber_type",
}
TEST_TRUE_VALUES = {"1", "true", "yes", "y", "test", "synthetic"}
TEST_TIER_VALUES = {"test", "synthetic"}

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


def short_hash(value):
    text = str(value or "").strip().lower()
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def log_safe(event_name, **metadata):
    safe_metadata = {key: value for key, value in metadata.items() if value not in (None, "")}
    print(json.dumps({"event": event_name, **safe_metadata}, sort_keys=True))


def format_source(address):
    return f"Presttige <{address}>"


def generate_lead_id():
    return "fdm_" + uuid.uuid4().hex[:10]


def is_tester(email: str) -> bool:
    return is_authorized_test_email(email)


def iter_payload_pairs(value):
    if isinstance(value, dict):
        if "key" in value and "value" in value:
            yield str(value.get("key") or ""), value.get("value")
        for key, nested_value in value.items():
            yield str(key), nested_value
            yield from iter_payload_pairs(nested_value)
    elif isinstance(value, list):
        for item in value:
            yield from iter_payload_pairs(item)


def payload_requests_test_record(body):
    for key, value in iter_payload_pairs(body):
        normalized_key = str(key or "").strip().lower()
        normalized_value = str(value or "").strip().lower()
        if normalized_key in TEST_MARKER_KEYS:
            if value is True or normalized_value in TEST_TRUE_VALUES:
                return True
        if normalized_key in TEST_TIER_KEYS and normalized_value in TEST_TIER_VALUES:
            return True
    return False


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
        "prst_candidate_display_name",
        "prst_candidate_contact_email",
        "prst_candidate_phone_e164",
        "prst_candidate_country_iso2",
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

        name = as_text(mapped.get("prst_candidate_display_name") or mapped.get("name"))
        email = as_text(mapped.get("prst_candidate_contact_email") or mapped.get("email")).lower()
        country = as_text(mapped.get("prst_candidate_country_iso2") or mapped.get("country"))
        phone = as_text(mapped.get("prst_candidate_phone_e164") or mapped.get("phone"))
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


def find_leads_by_email(email):
    result = table.query(
        IndexName="email-index",
        KeyConditionExpression=Key("email").eq(email),
    )
    return result.get("Items") or []


def delete_schedule_if_present(schedule_name):
    if not schedule_name:
        return False

    try:
        scheduler.delete_schedule(Name=schedule_name, GroupName=SCHEDULER_GROUP_NAME)
        return True
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code not in ("ResourceNotFoundException", "ValidationException"):
            log_safe("tester_purge_warn", action="schedule_delete_failed", error=error_code or type(exc).__name__)
        return False
    except Exception as exc:
        log_safe("tester_purge_warn", action="schedule_delete_failed", error=type(exc).__name__)
        return False


def delete_s3_prefix(bucket_name, prefix):
    if not bucket_name or not prefix:
        return 0

    deleted = 0
    continuation_token = None

    while True:
        try:
            params = {
                "Bucket": bucket_name,
                "Prefix": prefix,
                "MaxKeys": 1000,
            }
            if continuation_token:
                params["ContinuationToken"] = continuation_token
            response = s3.list_objects_v2(**params)
        except ClientError as exc:
            log_safe("tester_purge_warn", action="s3_list_failed", bucket=bucket_name, prefix_hash=short_hash(prefix), error=exc.response.get("Error", {}).get("Code", type(exc).__name__))
            break
        except Exception as exc:
            log_safe("tester_purge_warn", action="s3_list_failed", bucket=bucket_name, prefix_hash=short_hash(prefix), error=type(exc).__name__)
            break

        contents = response.get("Contents") or []
        if contents:
            objects = [{"Key": item["Key"]} for item in contents if item.get("Key")]
            try:
                delete_response = s3.delete_objects(
                    Bucket=bucket_name,
                    Delete={"Objects": objects, "Quiet": True},
                )
                deleted += len(delete_response.get("Deleted") or [])
            except ClientError as exc:
                log_safe("tester_purge_warn", action="s3_delete_failed", bucket=bucket_name, prefix_hash=short_hash(prefix), error=exc.response.get("Error", {}).get("Code", type(exc).__name__))
            except Exception as exc:
                log_safe("tester_purge_warn", action="s3_delete_failed", bucket=bucket_name, prefix_hash=short_hash(prefix), error=type(exc).__name__)

        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")

    return deleted


def remove_ses_suppression_if_present(email):
    try:
        sesv2.get_suppressed_destination(EmailAddress=email)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code in ("NotFoundException", "BadRequestException"):
            return False
        log_safe("tester_purge_warn", action="ses_get_suppression_failed", email_hash=short_hash(email), error=error_code or type(exc).__name__)
        return False
    except Exception as exc:
        log_safe("tester_purge_warn", action="ses_get_suppression_failed", email_hash=short_hash(email), error=type(exc).__name__)
        return False

    try:
        sesv2.delete_suppressed_destination(EmailAddress=email)
        return True
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        log_safe("tester_purge_warn", action="ses_delete_suppression_failed", email_hash=short_hash(email), error=error_code or type(exc).__name__)
        return False
    except Exception as exc:
        log_safe("tester_purge_warn", action="ses_delete_suppression_failed", email_hash=short_hash(email), error=type(exc).__name__)
        return False


def purge_tester_records(email):
    deleted_records = 0
    deleted_schedules = 0
    deleted_photos = 0
    ses_suppression_removed = False

    try:
        existing_records = find_leads_by_email(email)
    except Exception as exc:
        log_safe("tester_purge_warn", action="lookup_failed", email_hash=short_hash(email), error=type(exc).__name__)
        existing_records = []

    for record in existing_records:
        lead_id = (record.get("lead_id") or "").strip()
        schedule_names = [
            (record.get("e3_schedule_name") or "").strip(),
            (record.get("tester_cleanup_schedule_name") or "").strip(),
        ]

        for schedule_name in schedule_names:
            if schedule_name and delete_schedule_if_present(schedule_name):
                deleted_schedules += 1

        if lead_id:
            deleted_photos += delete_s3_prefix(ORIGINALS_BUCKET, f"{lead_id}/")
            deleted_photos += delete_s3_prefix(THUMBNAILS_BUCKET, f"{lead_id}/")

            try:
                table.delete_item(Key={"lead_id": lead_id})
                deleted_records += 1
            except Exception as exc:
                log_safe("tester_purge_warn", action="delete_record_failed", lead_hash=short_hash(lead_id), error=type(exc).__name__)

    ses_suppression_removed = remove_ses_suppression_if_present(email)

    log_safe(
        "tester_purge_on_submit",
        email_hash=short_hash(email),
        deleted_records=deleted_records,
        deleted_schedules=deleted_schedules,
        deleted_photos=deleted_photos,
        ses_suppression_removed=ses_suppression_removed,
    )

    return {
        "deleted_records": deleted_records,
        "deleted_schedules": deleted_schedules,
        "deleted_photos": deleted_photos,
        "ses_suppression_removed": ses_suppression_removed,
    }


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

        email = normalize_email(email)
        tester_whitelisted = is_tester(email)
        requested_test_record = payload_requests_test_record(body)

        if requested_test_record and not tester_whitelisted:
            return response(403, {
                "error": "unauthorized_test_record",
                "message": "Synthetic and test records are restricted to the four authorized Presttige tester addresses."
            })

        if tester_whitelisted:
            try:
                purge_tester_records(email)
            except Exception as exc:
                log_safe("tester_purge_warn", action="purge_failed", email_hash=short_hash(email), error=type(exc).__name__)

        if not tester_whitelisted and email_already_exists(email):
            log_safe(
                "duplicate_email_attempt",
                email_hash=short_hash(email),
                source=source,
                campaign_hash=short_hash(campaign_id),
            )
            return response(409, {
                "error": "email_exists",
                "message": "This email is already registered. If you need access to your existing application, contact committee@presttige.net"
            })

        phone_full = re.sub(r"[\s\-()]", "", phone)
        if not tester_whitelisted and phone_already_exists(phone_full):
            log_safe(
                "duplicate_phone_attempt",
                phone_hash=short_hash(phone_full),
                source=source,
                campaign_hash=short_hash(campaign_id),
            )
            return response(409, {
                "error": "phone_exists",
                "message": "This phone number is already registered. If you need access to your existing application, contact committee@presttige.net"
            })

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
        if tester_whitelisted:
            item["is_test"] = True
            item["synthetic_test"] = True
            item["test_tier"] = True
            item["synthetic_test_reason"] = "authorized_test_address_create_lead"
            item["synthetic_test_flagged_by"] = "server_side_authorized_test_guard"
            item["synthetic_test_flagged_at"] = now
        if phone:
            item["phone"] = phone
        if phone_full:
            item["phone_full"] = phone_full

        table.put_item(Item=item)

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

        log_safe(
            "verification_email_sender",
            lead_hash=short_hash(lead_id),
            email_hash=short_hash(email),
            is_tester=tester_whitelisted,
        )

        ses_response = ses.send_email(
            Source=format_source(FROM_EMAIL),
            ConfigurationSetName=SES_CONFIGURATION_SET,
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

        log_safe(
            "verification_email_sent",
            lead_hash=short_hash(lead_id),
            email_hash=short_hash(email),
            ses_message_id=ses_response.get("MessageId"),
            is_tester=tester_whitelisted,
        )

        return response(200, {
            "message": "Step 1 submitted",
            "lead_id": lead_id
        })

    except Exception as e:
        return response(500, {"error": str(e)})
