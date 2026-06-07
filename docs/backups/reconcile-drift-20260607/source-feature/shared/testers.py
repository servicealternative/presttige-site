import hashlib
import hmac
import json
from datetime import datetime, timezone

# TODO (follow-up when source lands):
# - add tester guard to the missing Stripe checkout session-creation lambda
# - add tester guard to the missing Stripe Connect split routing logic

AUTHORIZED_TEST_EMAILS = (
    "antoniompereira@me.com",
    "codex.subscriber.tester@presttige.net",
    "analuisasf@gmail.com",
    "fq@freequenza.net",
)
TESTER_EMAILS = list(AUTHORIZED_TEST_EMAILS)
CODEX_TESTER_EMAIL = "codex.subscriber.tester@presttige.net"
TEST_SEND_RECEIVE_EMAIL = "fq@freequenza.net"
TESTER_TIER = "tester"
DEFAULT_SIMULATED_TIER = "free"

TESTER_SKIP_MARKER = "Skipped DynamoDB, CAPI, LinkedIn, GA4"


def normalize_email(email):
    return (email or "").strip().lower()


def hash_identifier(value):
    normalized = normalize_email(value)
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]


SENSITIVE_LOG_KEY_PARTS = ("email", "phone", "token", "name", "lead_id")


def sanitize_log_value(key, value):
    normalized_key = str(key or "").lower()
    if isinstance(value, dict):
        return {nested_key: sanitize_log_value(nested_key, nested_value) for nested_key, nested_value in value.items()}
    if isinstance(value, list):
        return [sanitize_log_value(key, item) for item in value]
    if any(part in normalized_key for part in SENSITIVE_LOG_KEY_PARTS):
        return hash_identifier(value)
    return value


def sanitize_log_mapping(mapping):
    if not mapping:
        return None
    return {key: sanitize_log_value(key, value) for key, value in mapping.items()}


def is_tester_email(email):
    return is_authorized_test_email(email)


def is_authorized_test_email(email):
    return normalize_email(email) in {normalize_email(item) for item in AUTHORIZED_TEST_EMAILS}


def assert_authorized_test_email(email, context="test record"):
    if is_authorized_test_email(email):
        return
    raise ValueError(
        f"{context} is restricted to the four authorized Presttige tester addresses."
    )


def is_test_send_receive_email(email):
    return normalize_email(email) == TEST_SEND_RECEIVE_EMAIL


def assert_test_send_receive_email(email, context="test email send"):
    if is_test_send_receive_email(email):
        return
    raise ValueError(
        f"{context} is restricted to {TEST_SEND_RECEIVE_EMAIL}."
    )


def get_tester_lead_id(email):
    normalized = normalize_email(email)
    if not is_tester_email(normalized):
        return ""
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:12]
    return f"fdm_tst{digest}"


def get_tester_email_for_lead_id(lead_id):
    normalized_lead_id = (lead_id or "").strip()
    for email in TESTER_EMAILS:
        if get_tester_lead_id(email) == normalized_lead_id:
            return normalize_email(email)
    return ""


def generate_tester_verification_token(email, secret):
    normalized = normalize_email(email)
    if not normalized or not is_tester_email(normalized) or not secret:
        return ""
    raw = f"tester:{normalized}:email_verify"
    digest = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"tst_{digest}"


def get_tester_email_for_verification_token(token, secret):
    if not token or not secret:
        return ""
    for email in TESTER_EMAILS:
        candidate = generate_tester_verification_token(email, secret)
        if candidate and hmac.compare_digest(candidate, token):
            return normalize_email(email)
    return ""


def extract_tester_tracking_metadata(body):
    tracked_keys = (
        "source",
        "campaign_id",
        "referral_code",
        "ref",
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_content",
        "utm_term",
    )

    mapped = {}
    body = body if isinstance(body, dict) else {}
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    fields = data.get("fields") if isinstance(data.get("fields"), list) else []

    for field in fields:
        key = field.get("key")
        value = field.get("value")
        if key in tracked_keys and value not in (None, "") and key not in mapped:
            mapped[key] = str(value).strip()

    for source in (data, body):
        for key in tracked_keys:
            value = source.get(key) if isinstance(source, dict) else None
            if key not in mapped and value not in (None, ""):
                mapped[key] = str(value).strip()

    return mapped


def build_tester_log_payload(event_name, email="", metadata=None, extra=None):
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event_name,
        "email_hash": hash_identifier(email),
        "marker": TESTER_SKIP_MARKER,
    }

    safe_metadata = sanitize_log_mapping(metadata)
    if safe_metadata:
        payload["metadata"] = safe_metadata

    safe_extra = sanitize_log_mapping(extra)
    if safe_extra:
        payload["extra"] = safe_extra

    return payload


def log_tester_event(event_name, email="", metadata=None, extra=None):
    print("[TESTER] " + json.dumps(build_tester_log_payload(
        event_name=event_name,
        email=email,
        metadata=metadata,
        extra=extra,
    ), sort_keys=True))
