import hashlib
import hmac
import json
import os
from datetime import datetime, timezone

# TODO (follow-up when source lands):
# - add tester guard to the missing Stripe checkout session-creation lambda
# - add tester guard to the missing Stripe Connect split routing logic

PREVIEW_MODE_EMAILS_ENV = "PREVIEW_MODE_EMAILS"
PREVIEW_MODE_BANNER_TEXT = (
    "PREVIEW MODE · No payment was processed · "
    "This journey will not appear in member records"
)


def normalize_email(email):
    return (email or "").strip().lower()


def parse_preview_mode_emails(raw_value=None):
    raw = raw_value if raw_value is not None else os.environ.get(PREVIEW_MODE_EMAILS_ENV, "")
    normalized = []
    seen = set()

    for item in str(raw or "").split(","):
        email = normalize_email(item)
        if not email or email in seen:
            continue
        seen.add(email)
        normalized.append(email)

    return normalized


TESTER_EMAILS = parse_preview_mode_emails()

TESTER_SKIP_MARKER = "Skipped DynamoDB, CAPI, LinkedIn, GA4"


def is_tester_email(email):
    return normalize_email(email) in [normalize_email(item) for item in TESTER_EMAILS]


def is_preview_mode_email(email):
    return is_tester_email(email)


def is_preview_mode_lead(lead):
    return bool((lead or {}).get("preview_mode"))


def build_preview_banner_html():
    return (
        '<div style="margin:0 0 28px 0;padding:10px 14px;'
        'background:#353535;color:#D7D3CC;font-family:Georgia,serif;'
        'font-size:13px;line-height:1.5;font-style:italic;">'
        f"{PREVIEW_MODE_BANNER_TEXT}"
        "</div>"
    )


def build_preview_banner_text():
    return PREVIEW_MODE_BANNER_TEXT


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
        "email": normalize_email(email),
        "marker": TESTER_SKIP_MARKER,
    }

    if metadata:
        payload["metadata"] = metadata

    if extra:
        payload["extra"] = extra

    return payload


def log_tester_event(event_name, email="", metadata=None, extra=None):
    print("[TESTER] " + json.dumps(build_tester_log_payload(
        event_name=event_name,
        email=email,
        metadata=metadata,
        extra=extra,
    ), sort_keys=True))
