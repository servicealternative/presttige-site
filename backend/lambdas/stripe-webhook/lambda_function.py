import json
import os
import base64
import boto3
import sys
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from botocore.exceptions import ClientError

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

from shared.testers import log_tester_event, normalize_email

dynamodb = boto3.resource("dynamodb")
lambda_client = boto3.client("lambda")
s3 = boto3.client("s3")
scheduler = boto3.client("scheduler", region_name="us-east-1")
sesv2 = boto3.client("sesv2", region_name="us-east-1")

LEADS_TABLE = dynamodb.Table("presttige-db")
SEND_WELCOME_EMAIL_FUNCTION = "presttige-send-welcome-email"
ORIGINALS_BUCKET = os.environ.get("PHOTOS_ORIGINALS_BUCKET", "presttige-applicant-photos")
THUMBNAILS_BUCKET = os.environ.get("PHOTOS_THUMBNAILS_BUCKET", "presttige-applicant-photos-thumbnails")
SCHEDULER_GROUP_NAME = os.environ.get("TESTER_PURGE_SCHEDULER_GROUP", "default")
TESTER_WHITELIST = {
    "antoniompereira@me.com",
    "alternativeservice@gmail.com",
}

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


def is_tester_email(email):
    return normalize_email(email) in TESTER_WHITELIST


def is_legacy_tester_session(session):
    metadata = safe_get(session, "metadata", {}) or {}
    tester_flag = str(safe_get(metadata, "tester", "")).strip().lower() == "true"
    lead_id = str(safe_get(session, "client_reference_id", "") or "").strip()
    return tester_flag or lead_id.startswith("fdm_tst")


def delete_schedule_if_present(schedule_name):
    if not schedule_name:
        return False

    try:
        scheduler.delete_schedule(Name=schedule_name, GroupName=SCHEDULER_GROUP_NAME)
        return True
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code not in ("ResourceNotFoundException", "ValidationException"):
            print(f"TESTER_PURGE_WARN schedule_delete_failed name={schedule_name} error={error_code or str(exc)}")
        return False
    except Exception as exc:
        print(f"TESTER_PURGE_WARN schedule_delete_failed name={schedule_name} error={exc}")
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
            list_response = s3.list_objects_v2(**params)
        except ClientError as exc:
            print(f"TESTER_PURGE_WARN s3_list_failed bucket={bucket_name} prefix={prefix} error={exc.response.get('Error', {}).get('Code', str(exc))}")
            break
        except Exception as exc:
            print(f"TESTER_PURGE_WARN s3_list_failed bucket={bucket_name} prefix={prefix} error={exc}")
            break

        contents = list_response.get("Contents") or []
        if contents:
            objects = [{"Key": item["Key"]} for item in contents if item.get("Key")]
            try:
                delete_response = s3.delete_objects(
                    Bucket=bucket_name,
                    Delete={"Objects": objects, "Quiet": True},
                )
                deleted += len(delete_response.get("Deleted") or [])
            except ClientError as exc:
                print(f"TESTER_PURGE_WARN s3_delete_failed bucket={bucket_name} prefix={prefix} error={exc.response.get('Error', {}).get('Code', str(exc))}")
            except Exception as exc:
                print(f"TESTER_PURGE_WARN s3_delete_failed bucket={bucket_name} prefix={prefix} error={exc}")

        if not list_response.get("IsTruncated"):
            break
        continuation_token = list_response.get("NextContinuationToken")

    return deleted


def remove_ses_suppression_if_present(email):
    if not email:
        return False

    try:
        sesv2.get_suppressed_destination(EmailAddress=email)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        if error_code in ("NotFoundException", "BadRequestException"):
            return False
        print(f"TESTER_PURGE_WARN ses_get_suppression_failed email={email} error={error_code or str(exc)}")
        return False
    except Exception as exc:
        print(f"TESTER_PURGE_WARN ses_get_suppression_failed email={email} error={exc}")
        return False

    try:
        sesv2.delete_suppressed_destination(EmailAddress=email)
        return True
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "")
        print(f"TESTER_PURGE_WARN ses_delete_suppression_failed email={email} error={error_code or str(exc)}")
        return False
    except Exception as exc:
        print(f"TESTER_PURGE_WARN ses_delete_suppression_failed email={email} error={exc}")
        return False


def purge_tester_record(lead_id, email, schedule_name, trigger):
    deleted_schedules = 1 if delete_schedule_if_present((schedule_name or "").strip()) else 0
    deleted_photos = 0
    deleted_record = False
    ses_suppression_removed = remove_ses_suppression_if_present(email)

    if lead_id:
        deleted_photos += delete_s3_prefix(ORIGINALS_BUCKET, f"{lead_id}/")
        deleted_photos += delete_s3_prefix(THUMBNAILS_BUCKET, f"{lead_id}/")
        try:
            LEADS_TABLE.delete_item(Key={"lead_id": lead_id})
            deleted_record = True
        except Exception as exc:
            print(f"TESTER_PURGE_WARN delete_record_failed lead_id={lead_id} error={exc}")

    print(
        f"TESTER_PURGE_ON_FUNNEL_COMPLETE trigger={trigger} email={email} lead_id={lead_id} "
        f"deleted_record={str(deleted_record).lower()} deleted_schedules={deleted_schedules} "
        f"deleted_photos={deleted_photos} ses_suppression_removed={str(ses_suppression_removed).lower()}"
    )

    return {
        "deleted_record": deleted_record,
        "deleted_schedules": deleted_schedules,
        "deleted_photos": deleted_photos,
        "ses_suppression_removed": ses_suppression_removed,
    }


def invoke_welcome_email(lead_id, invocation_type="Event"):
    try:
        invoke_response = lambda_client.invoke(
            FunctionName=SEND_WELCOME_EMAIL_FUNCTION,
            InvocationType=invocation_type,
            Payload=json.dumps({"body": json.dumps({"lead_id": lead_id})}).encode("utf-8"),
        )
        if invocation_type == "RequestResponse":
            payload_stream = invoke_response.get("Payload")
            payload = payload_stream.read().decode("utf-8") if payload_stream else ""
            try:
                invoke_response["parsed_payload"] = json.loads(payload) if payload else {}
            except json.JSONDecodeError:
                invoke_response["parsed_payload"] = {"raw": payload}
        return invoke_response
    except Exception as exc:
        print(f"send-welcome-email async invoke failed for {lead_id}: {exc}")
        return None


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
        selected_tier = safe_get(metadata, "tier") or plan or ""
        selected_periodicity = safe_get(metadata, "periodicity") or term or ""

        currency = (safe_get(session, "currency") or DEFAULT_CURRENCY).upper()
        product_type = normalize_product_type(metadata)
        amount_total_cents = safe_get(session, "amount_total", 0)
        amount_paid = to_decimal_amount_from_cents(amount_total_cents)

        lead_result = LEADS_TABLE.get_item(Key={"lead_id": lead_id})
        lead = lead_result.get("Item")
        lead_email = normalize_email((lead or {}).get("email") or session_email)
        tester_completion = bool((lead or {}).get("is_test", False)) or is_tester_email(lead_email)

        if is_legacy_tester_session(session):
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

        if not lead:
            if tester_completion or is_tester_email(session_email):
                print(
                    f"TESTER_PURGE_ON_FUNNEL_COMPLETE trigger=stripe_success email={lead_email or session_email} "
                    f"lead_id={lead_id} deleted_record=false deleted_schedules=0 deleted_photos=0 "
                    f"ses_suppression_removed=false already_gone=true"
                )
                return response(200, {
                    "received": True,
                    "already_gone": True,
                    "event_type": event_type,
                    "lead_id": lead_id,
                })
            return response(404, {
                "error": "lead_not_found",
                "message": f"Lead {lead_id} not found"
            })

        LEADS_TABLE.update_item(
            Key={"lead_id": lead_id},
            UpdateExpression="""
                SET payment_status = :paid,
                    access_status = :active,
                    stripe_checkout_completed = :true,
                    stripe_session_id = :stripe_session_id,
                    stripe_subscription_id = :subscription_id,
                    stripe_customer_id = :customer_id,
                    #product = :product,
                    #plan = :plan,
                    #term = :term,
                    selected_tier = :selected_tier,
                    selected_periodicity = :selected_periodicity,
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
                ":stripe_session_id": safe_get(session, "id", ""),
                ":subscription_id": subscription_id,
                ":customer_id": customer_id,
                ":product": product,
                ":plan": plan,
                ":term": term,
                ":selected_tier": selected_tier,
                ":selected_periodicity": selected_periodicity,
                ":product_type": product_type,
                ":amount_paid": amount_paid,
                ":currency": currency,
                ":stripe_event_type": event_type
            }
        )

        if tester_completion:
            invoke_welcome_email(lead_id, invocation_type="RequestResponse")
            purge_tester_record(
                lead_id=lead_id,
                email=lead_email,
                schedule_name=(lead.get("e3_schedule_name") or ""),
                trigger="stripe_success",
            )
        else:
            invoke_welcome_email(lead_id, invocation_type="Event")

        return response(200, {
            "received": True,
            "updated_lead_id": lead_id,
            "event_type": event_type,
            "product_type": product_type,
            "amount_paid": str(amount_paid),
            "currency": currency,
            "tester_completion": tester_completion,
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
