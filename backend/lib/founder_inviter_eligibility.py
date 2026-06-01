import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError


REGION = os.environ.get("AWS_REGION", "us-east-1")
ELIGIBLE_INVITERS_TABLE_NAME = os.environ.get(
    "ELIGIBLE_INVITERS_TABLE_NAME",
    "presttige-eligible-inviters",
)
LEADS_TABLE_NAME = os.environ.get("TABLE_NAME") or os.environ.get("LEADS_TABLE_NAME", "presttige-db")
EMAIL_INDEX_NAME = os.environ.get("EMAIL_INDEX_NAME", "email-index")
INTERNAL_INVITER_ROLES = {
    "admin",
    "team",
    "ambassador",
    "business_partner",
    "influencer",
}
BLOCKED_SUBSCRIBER_TYPES = {
    "subscriber",
    "club",
    "premier",
    "patron",
}
MAX_EMAIL_LENGTH = 254

dynamodb = boto3.resource("dynamodb", region_name=REGION)
eligible_inviters_table = dynamodb.Table(ELIGIBLE_INVITERS_TABLE_NAME)
leads_table = dynamodb.Table(LEADS_TABLE_NAME)


def normalize_string(value):
    if value is None:
        return ""
    return str(value).strip()


def normalize_email(value):
    return normalize_string(value).lower()


def is_supported_email(email):
    return (
        bool(email)
        and len(email) <= MAX_EMAIL_LENGTH
        and "@" in email
        and "." in email.rsplit("@", 1)[-1]
        and not any(char.isspace() for char in email)
    )


def normalize_role(value):
    return normalize_string(value).lower().replace("-", "_").replace(" ", "_")


def is_truthy(value):
    if value is True:
        return True
    if value in (False, None):
        return False
    return normalize_string(value).lower() in {"true", "1", "yes"}


def parse_iso_datetime(value):
    raw = normalize_string(value)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def find_lead_by_email(email):
    result = leads_table.query(
        IndexName=EMAIL_INDEX_NAME,
        KeyConditionExpression=Key("email").eq(email),
        Limit=1,
    )
    items = result.get("Items") or []
    return items[0] if items else None


def is_genuine_active_founder(record, email):
    if not record or normalize_email(record.get("email")) != email:
        return False
    if is_truthy(record.get("synthetic_test")):
        return False

    subscriber_type = normalize_string(record.get("subscriber_type")).lower()
    tier = normalize_string(record.get("tier")).lower()
    selected_tier = normalize_string(record.get("selected_tier")).lower()
    if (
        subscriber_type in BLOCKED_SUBSCRIBER_TYPES
        or tier in BLOCKED_SUBSCRIBER_TYPES
        or selected_tier in BLOCKED_SUBSCRIBER_TYPES
    ):
        return False

    return (
        subscriber_type == "founder"
        and (tier == "founder" or selected_tier == "founder")
        and is_truthy(record.get("founder_lifetime"))
        and normalize_string(record.get("payment_status")).lower() == "paid"
        and normalize_string(record.get("access_status")).lower() == "active"
    )


def founder_invite_is_usable(record, invited_lead_id=None, allow_unbound_founder_invite=False, now=None):
    if normalize_string(record.get("founder_invite_status")).lower() != "active":
        return False
    if not normalize_string(record.get("founder_invite_token")):
        return False

    expires_at = parse_iso_datetime(record.get("founder_invite_expires_at"))
    effective_now = now or datetime.now(timezone.utc)
    if not expires_at or expires_at <= effective_now:
        return False

    bound_invitee_lead_id = normalize_string(record.get("founder_invite_invitee_lead_id"))
    presented_invitee_lead_id = normalize_string(invited_lead_id)
    if bound_invitee_lead_id:
        return bool(presented_invitee_lead_id and bound_invitee_lead_id == presented_invitee_lead_id)

    return allow_unbound_founder_invite is True


def is_eligible_founder_inviter(
    inviter_email,
    invited_lead_id=None,
    allow_unbound_founder_invite=False,
    inviter_record=None,
):
    email = normalize_email(inviter_email)
    if not is_supported_email(email):
        return {"eligible": False, "reason": "invalid_email"}

    try:
        result = eligible_inviters_table.get_item(Key={"email": email})
    except (BotoCoreError, ClientError) as exc:
        print(
            {
                "event": "founder_inviter_eligibility_lookup_failed",
                "name": exc.__class__.__name__,
                "message": str(exc),
            }
        )
        return {"eligible": False, "reason": "lookup_failed"}

    record = result.get("Item") or {}
    role = normalize_role(record.get("role"))
    if normalize_email(record.get("email") or email) == email and role in INTERNAL_INVITER_ROLES:
        return {
            "eligible": True,
            "source": "ulttra",
            "email": email,
            "role": role,
            "project": normalize_string(record.get("project")),
            "ulttra_person_id": normalize_string(record.get("ulttra_person_id")),
        }

    try:
        founder_record = inviter_record if inviter_record is not None else find_lead_by_email(email)
    except (BotoCoreError, ClientError) as exc:
        print(
            {
                "event": "founder_inviter_founder_lookup_failed",
                "name": exc.__class__.__name__,
                "message": str(exc),
            }
        )
        return {"eligible": False, "reason": "founder_lookup_failed"}

    if not is_genuine_active_founder(founder_record, email):
        return {"eligible": False, "reason": "not_eligible_founder"}

    if not founder_invite_is_usable(
        founder_record,
        invited_lead_id=invited_lead_id,
        allow_unbound_founder_invite=allow_unbound_founder_invite,
    ):
        return {"eligible": False, "reason": "founder_invite_not_usable"}

    return {
        "eligible": True,
        "source": "founder",
        "email": email,
        "role": "founder",
        "lead_id": normalize_string(founder_record.get("lead_id")),
        "founder_invite_token": normalize_string(founder_record.get("founder_invite_token")),
        "founder_invite_expires_at": normalize_string(founder_record.get("founder_invite_expires_at")),
    }
