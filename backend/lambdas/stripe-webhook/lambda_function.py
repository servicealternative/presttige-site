import base64
import html
import json
import os
import traceback
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.types import TypeSerializer

try:
    import stripe

    STRIPE_IMPORT_OK = True
    STRIPE_IMPORT_ERROR = None
except Exception as exc:
    stripe = None
    STRIPE_IMPORT_OK = False
    STRIPE_IMPORT_ERROR = str(exc)

STRIPE_SIGNATURE_ERROR = (
    stripe.error.SignatureVerificationError if STRIPE_IMPORT_OK else ValueError
)


REGION = os.environ.get("AWS_REGION", "us-east-1")
LEADS_TABLE_NAME = os.environ.get("LEADS_TABLE_NAME", "presttige-db")
EVENTS_TABLE_NAME = os.environ.get("STRIPE_EVENTS_TABLE_NAME", "presttige-stripe-events")
AUDIT_TABLE_NAME = os.environ.get("AUDIT_TABLE_NAME", "presttige-review-audit")
WEBHOOK_SECRET_PARAMETER = os.environ.get(
    "STRIPE_WEBHOOK_SECRET_PARAMETER", "/presttige/stripe/webhook-secret"
)
SEND_WELCOME_EMAIL_FUNCTION = os.environ.get(
    "SEND_WELCOME_EMAIL_FUNCTION", "presttige-send-welcome-email"
)
DOWNGRADE_FUNCTION_ARN = os.environ.get(
    "TIER_DOWNGRADE_FUNCTION_ARN",
    "arn:aws:lambda:us-east-1:343218208384:function:presttige-tier-downgrade",
)
DOWNGRADE_SCHEDULER_ROLE_ARN = os.environ.get(
    "TIER_DOWNGRADE_SCHEDULER_ROLE_ARN",
    "arn:aws:iam::343218208384:role/presttige-scheduler-invoke-tier-downgrade-role",
)
SCHEDULER_GROUP_NAME = os.environ.get("DOWNGRADE_SCHEDULER_GROUP", "default")
OFFICE_NOTIFICATION_FROM = os.environ.get(
    "OFFICE_NOTIFICATION_FROM", "office@presttige.net"
)
OFFICE_NOTIFICATION_TO = os.environ.get("OFFICE_NOTIFICATION_TO", "office@presttige.net")
FOUNDER_WELCOME_EMAIL_FROM = "founders@presttige.net"
SES_CONFIGURATION_SET = os.environ.get("SES_CONFIGURATION_SET", "presttige-deliverability-v1")

TESTER_WHITELIST = {
    "antoniompereira@me.com",
    "alternativeservice@gmail.com",
    "analuisasf@gmail.com",
}
FOUNDER_TEST_WELCOME_ALLOWLIST = {
    "antoniompereira@icloud.com",
    "fq@freequenza.net",
}

CONTRACTS = {
    "club_monthly": {
        "tier": "club",
        "billing": "monthly",
        "checkout_mode": "subscription",
        "founder_lifetime": False,
    },
    "club_yearly": {
        "tier": "club",
        "billing": "yearly",
        "checkout_mode": "subscription",
        "founder_lifetime": False,
    },
    "premier_monthly": {
        "tier": "premier",
        "billing": "monthly",
        "checkout_mode": "subscription",
        "founder_lifetime": False,
    },
    "premier_yearly": {
        "tier": "premier",
        "billing": "yearly",
        "checkout_mode": "subscription",
        "founder_lifetime": False,
    },
    "patron_yearly": {
        "tier": "patron",
        "billing": "yearly",
        "checkout_mode": "subscription",
        "founder_lifetime": False,
    },
    "founder_lifetime": {
        "tier": "founder",
        "billing": "lifetime",
        "checkout_mode": "payment",
        "founder_lifetime": True,
        "stripe_product_id": "prod_URrwkKbbICL760",
    },
    "club_to_patron_upgrade": {
        "tier": "patron",
        "billing": "yearly",
        "checkout_mode": "subscription",
        "founder_lifetime": False,
    },
    "premier_to_patron_upgrade": {
        "tier": "patron",
        "billing": "yearly",
        "checkout_mode": "subscription",
        "founder_lifetime": False,
    },
}

FOUNDER_LIVE_PRICE_ID = "price_1TSyCjDmiQXcrE5NyKR5cb60"
SUBSCRIPTION_ACTIVE_STATUSES = {"active", "trialing"}
SUBSCRIPTION_PROCESSING_STATUSES = {"incomplete", "incomplete_expired"}
SUBSCRIPTION_PAST_DUE_STATUSES = {"past_due", "unpaid"}

dynamodb = boto3.resource("dynamodb", region_name=REGION)
ddb_client = boto3.client("dynamodb", region_name=REGION)
leads_table = dynamodb.Table(LEADS_TABLE_NAME)
events_table = dynamodb.Table(EVENTS_TABLE_NAME)
serializer = TypeSerializer()
ssm = boto3.client("ssm", region_name=REGION)
lambda_client = boto3.client("lambda", region_name=REGION)
scheduler = boto3.client("scheduler", region_name=REGION)
ses = boto3.client("ses", region_name=REGION)

_cached_webhook_secret = None


def format_source(address):
    return f"Presttige <{address}>"


def simple_email_html(subject, paragraphs):
    paragraph_html = "\n".join(
        f'<p style="margin:0 0 20px 0;font-family:Georgia,serif;font-size:16px;line-height:26px;color:#0A0A0A;">{paragraph}</p>'
        for paragraph in paragraphs
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{html.escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F2ED;color:#0A0A0A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F2ED;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#FBF9F4;">
          <tr>
            <td style="padding:40px 48px;">
              <h1 style="margin:0 0 28px 0;font-family:Georgia,serif;font-weight:400;font-size:32px;line-height:40px;color:#0A0A0A;">{html.escape(subject)}</h1>
              {paragraph_html}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=str),
    }


def normalize_string(value):
    if value is None:
        return ""
    return str(value).strip()


def normalize_email(value):
    return normalize_string(value).lower()


def is_tester_lead(lead):
    return bool((lead or {}).get("is_test")) or normalize_email((lead or {}).get("email")) in TESTER_WHITELIST


def is_valid_email_address(email):
    return (
        bool(email)
        and len(email) <= 254
        and "@" in email
        and "." in email.rsplit("@", 1)[-1]
        and not any(char.isspace() for char in email)
    )


def is_founder_test_welcome_allowed(email):
    normalized = normalize_email(email)
    if normalized in FOUNDER_TEST_WELCOME_ALLOWLIST:
        return True
    local_part, separator, domain = normalized.partition("@")
    return separator == "@" and domain == "icloud.com" and local_part.startswith("antoniompereira+")


def safe_get(value, key, default=None):
    if value is None:
        return default
    if isinstance(value, dict):
        return value.get(key, default)
    getter = getattr(value, "get", None)
    if callable(getter):
        try:
            return getter(key, default)
        except TypeError:
            pass
    try:
        return value[key]
    except Exception:
        return getattr(value, key, default)


def to_plain_dict(value):
    if value is None:
        return {}
    to_dict = getattr(value, "to_dict_recursive", None)
    if callable(to_dict):
        return to_dict()
    if isinstance(value, dict):
        return value
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return {}


def log_json(message, **fields):
    payload = {
        "message": message,
        "timestamp": now_iso(),
        **fields,
    }
    print(json.dumps(payload, default=str, sort_keys=True))


def get_webhook_secret():
    global _cached_webhook_secret
    if _cached_webhook_secret:
        return _cached_webhook_secret

    result = ssm.get_parameter(Name=WEBHOOK_SECRET_PARAMETER, WithDecryption=True)
    secret = normalize_string(result.get("Parameter", {}).get("Value"))
    if not secret:
        raise RuntimeError(f"Stripe webhook secret parameter is empty: {WEBHOOK_SECRET_PARAMETER}")

    _cached_webhook_secret = secret
    return secret


def decode_payload(event):
    raw_body = event.get("body", "")
    if event.get("isBase64Encoded"):
        return base64.b64decode(raw_body)
    return raw_body.encode("utf-8")


def parse_event(event):
    if not STRIPE_IMPORT_OK:
        raise RuntimeError(f"stripe_import_error: {STRIPE_IMPORT_ERROR}")

    headers = event.get("headers") or {}
    sig_header = headers.get("Stripe-Signature") or headers.get("stripe-signature")
    if not sig_header:
        raise ValueError("Missing Stripe-Signature header")

    return stripe.Webhook.construct_event(
        payload=decode_payload(event),
        sig_header=sig_header,
        secret=get_webhook_secret(),
    )


def event_object(webhook_event):
    return safe_get(safe_get(webhook_event, "data", {}) or {}, "object", {}) or {}


def collect_metadata(obj):
    metadata = {}

    def merge(candidate):
        plain = to_plain_dict(candidate)
        for key, value in plain.items():
            if value is not None and normalize_string(value) != "":
                metadata.setdefault(key, value)

    merge(safe_get(obj, "metadata", {}) or {})
    merge(safe_get(safe_get(obj, "subscription_details", {}) or {}, "metadata", {}) or {})
    merge(
        safe_get(
            safe_get(safe_get(obj, "parent", {}) or {}, "subscription_details", {}) or {},
            "metadata",
            {},
        )
        or {}
    )

    lines = safe_get(obj, "lines", {}) or {}
    for line in safe_get(lines, "data", []) or []:
        merge(safe_get(line, "metadata", {}) or {})

    charge = safe_get(obj, "charge", {}) or {}
    if isinstance(charge, dict):
        merge(safe_get(charge, "metadata", {}) or {})

    return {str(k): v for k, v in metadata.items()}


def extract_context(event_type, obj):
    obj_id = normalize_string(safe_get(obj, "id"))
    metadata = collect_metadata(obj)
    charge = safe_get(obj, "charge", None)
    charge_obj = charge if isinstance(charge, dict) else {}

    subscription_id = (
        obj_id
        if event_type.startswith("customer.subscription.")
        else normalize_string(safe_get(obj, "subscription"))
        or normalize_string(
            safe_get(safe_get(obj, "subscription_details", {}) or {}, "subscription")
        )
        or normalize_string(
            safe_get(
                safe_get(safe_get(obj, "parent", {}) or {}, "subscription_details", {}) or {},
                "subscription",
            )
        )
    )
    payment_intent_id = (
        obj_id
        if event_type.startswith("payment_intent.")
        else normalize_string(safe_get(obj, "payment_intent"))
        or normalize_string(safe_get(charge_obj, "payment_intent"))
    )
    charge_id = (
        obj_id
        if event_type.startswith("charge.")
        else normalize_string(charge if isinstance(charge, str) else safe_get(charge_obj, "id"))
    )

    return {
        "object_id": obj_id,
        "lead_id": normalize_string(
            metadata.get("lead_id") or safe_get(obj, "client_reference_id")
        ),
        "contract_key": normalize_string(metadata.get("contract_key")),
        "checkout_mode": normalize_string(metadata.get("checkout_mode")),
        "customer_id": normalize_string(safe_get(obj, "customer") or safe_get(charge_obj, "customer")),
        "subscription_id": subscription_id,
        "payment_intent_id": payment_intent_id,
        "charge_id": charge_id,
        "livemode": bool(safe_get(obj, "livemode", False)),
        "metadata": metadata,
    }


def get_contract(contract_key, lead=None):
    key = normalize_string(contract_key) or normalize_string((lead or {}).get("selected_contract_key"))
    return key, CONTRACTS.get(key, {})


def get_lead(lead_id):
    if not lead_id:
        return None
    return leads_table.get_item(Key={"lead_id": lead_id}).get("Item")


def put_event_reservation(webhook_event):
    event_id = normalize_string(safe_get(webhook_event, "id"))
    event_type = normalize_string(safe_get(webhook_event, "type"))
    if not event_id:
        raise ValueError("Stripe event is missing id")

    received_at = now_iso()
    try:
        events_table.put_item(
            Item={
                "event_id": event_id,
                "stripe_event_id": event_id,
                "event_type": event_type,
                "processing_status": "processing",
                "attempts": 1,
                "received_at": received_at,
                "updated_at": received_at,
            },
            ConditionExpression="attribute_not_exists(event_id)",
        )
        return {"reserved": True, "event_id": event_id, "event_type": event_type}
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code != "ConditionalCheckFailedException":
            raise

        current = events_table.get_item(Key={"event_id": event_id}).get("Item") or {}
        if current.get("processing_status") == "processed":
            return {
                "reserved": False,
                "duplicate_processed": True,
                "event_id": event_id,
                "event_type": event_type,
            }

        events_table.update_item(
            Key={"event_id": event_id},
            UpdateExpression="""
                SET processing_status = :status,
                    updated_at = :updated_at,
                    retry_started_at = :retry_started_at,
                    attempts = if_not_exists(attempts, :zero) + :one
            """,
            ExpressionAttributeValues={
                ":status": "retrying",
                ":updated_at": received_at,
                ":retry_started_at": received_at,
                ":zero": 0,
                ":one": 1,
            },
        )
        return {"reserved": True, "retrying": True, "event_id": event_id, "event_type": event_type}


def mark_event_processed(event_id, lead_id, action_taken, new_state):
    events_table.update_item(
        Key={"event_id": event_id},
        UpdateExpression="""
            SET processing_status = :status,
                processed_at = :processed_at,
                updated_at = :updated_at,
                lead_id = :lead_id,
                action_taken = :action_taken,
                new_state = :new_state
            REMOVE last_error
        """,
        ExpressionAttributeValues={
            ":status": "processed",
            ":processed_at": now_iso(),
            ":updated_at": now_iso(),
            ":lead_id": lead_id or "unresolved",
            ":action_taken": action_taken,
            ":new_state": new_state or {},
        },
    )


def mark_event_failed(event_id, error):
    events_table.update_item(
        Key={"event_id": event_id},
        UpdateExpression="""
            SET processing_status = :status,
                failed_at = :failed_at,
                updated_at = :updated_at,
                last_error = :last_error
        """,
        ExpressionAttributeValues={
            ":status": "failed",
            ":failed_at": now_iso(),
            ":updated_at": now_iso(),
            ":last_error": str(error)[:1000],
        },
    )


def set_lead_fields(lead_id, fields, remove_fields=None, add_fields=None):
    expression_names = {}
    expression_values = {}
    set_parts = []
    remove_parts = []
    add_parts = []

    for index, (field, value) in enumerate((fields or {}).items()):
        name_key = f"#s{index}"
        value_key = f":s{index}"
        expression_names[name_key] = field
        expression_values[value_key] = value
        set_parts.append(f"{name_key} = {value_key}")

    offset = len(expression_names)
    for index, field in enumerate(remove_fields or []):
        name_key = f"#r{offset + index}"
        expression_names[name_key] = field
        remove_parts.append(name_key)

    offset = len(expression_names)
    for index, (field, value) in enumerate((add_fields or {}).items()):
        name_key = f"#a{offset + index}"
        value_key = f":a{offset + index}"
        expression_names[name_key] = field
        expression_values[value_key] = value
        add_parts.append(f"{name_key} {value_key}")

    update_expression = " ".join(
        part
        for part in [
            f"SET {', '.join(set_parts)}" if set_parts else "",
            f"REMOVE {', '.join(remove_parts)}" if remove_parts else "",
            f"ADD {', '.join(add_parts)}" if add_parts else "",
        ]
        if part
    )

    if not update_expression:
        return get_lead(lead_id)

    result = leads_table.update_item(
        Key={"lead_id": lead_id},
        UpdateExpression=update_expression,
        ExpressionAttributeNames=expression_names,
        ExpressionAttributeValues=expression_values,
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes", {})


def serialize_item(item):
    return {key: serializer.serialize(value) for key, value in item.items()}


def summarize_founder_activation_state(lead):
    if not lead:
        return {}
    return {
        "subscriber_type": lead.get("subscriber_type"),
        "tier": lead.get("tier"),
        "selected_tier": lead.get("selected_tier"),
        "selected_tier_billing": lead.get("selected_tier_billing"),
        "selected_contract_key": lead.get("selected_contract_key"),
        "inviter_source": lead.get("inviter_source"),
        "inviter_lead_id": lead.get("inviter_lead_id"),
        "inviter_founder_invite_token": lead.get("inviter_founder_invite_token"),
        "payment_status": lead.get("payment_status"),
        "payment_status_reason": lead.get("payment_status_reason"),
        "subscription_status": lead.get("subscription_status"),
        "access_status": lead.get("access_status"),
        "founder_lifetime": lead.get("founder_lifetime"),
        "founder_activated_at": lead.get("founder_activated_at"),
        "synthetic_test": lead.get("synthetic_test"),
    }


def founder_inviter_resolution_update(lead, activated_at):
    inviter_lead_id = normalize_string(lead.get("inviter_lead_id"))
    if normalize_string(lead.get("inviter_source")).lower() != "founder" or not inviter_lead_id:
        return None

    invited_lead_id = normalize_string(lead.get("lead_id"))
    founder_invite_token = normalize_string(lead.get("inviter_founder_invite_token"))
    condition = [
        "subscriber_type = :founder",
        "(tier = :founder OR selected_tier = :founder)",
        "founder_lifetime = :true",
        "payment_status = :paid",
        "access_status = :active",
        "founder_invite_status = :active_invite",
        "founder_invite_invitee_lead_id = :invited_lead_id",
        "(attribute_not_exists(synthetic_test) OR synthetic_test = :false)",
    ]
    values = {
        ":founder": "founder",
        ":true": True,
        ":paid": "paid",
        ":active": "active",
        ":active_invite": "active",
        ":consumed": "consumed",
        ":invited_lead_id": invited_lead_id,
        ":activated_at": activated_at,
        ":one": 1,
        ":false": False,
    }

    if founder_invite_token:
        condition.append("founder_invite_token = :founder_invite_token")
        values[":founder_invite_token"] = founder_invite_token

    return {
        "Update": {
            "TableName": LEADS_TABLE_NAME,
            "Key": {"lead_id": serializer.serialize(inviter_lead_id)},
            "UpdateExpression": (
                "SET founder_invite_status = :consumed, "
                "founder_invite_resolved_at = :activated_at, "
                "founder_invite_converted_lead_id = :invited_lead_id, "
                "updated_at = :activated_at "
                "ADD founder_invites_converted_count :one"
            ),
            "ConditionExpression": " AND ".join(condition),
            "ExpressionAttributeValues": {key: serializer.serialize(value) for key, value in values.items()},
        }
    }


def founder_activation_audit_item(lead, event_id, event_type, previous_state, new_state):
    timestamp = now_iso()
    return {
        "audit_id": str(uuid.uuid4()),
        "timestamp": timestamp,
        "lead_id": lead["lead_id"],
        "target_lead_id": lead["lead_id"],
        "action": "founder_payment_activate",
        "actor_id": "stripe_webhook",
        "reviewer_id": "stripe_webhook",
        "previous_state": previous_state,
        "new_state": new_state,
        "metadata": {
            "component": "presttige-stripe-webhook",
            "stripe_event_id": event_id,
            "stripe_event_type": event_type,
            "operation": "founder_invited_to_founder",
            "synthetic_test": False,
        },
        "is_test": False,
    }


def activate_founder_payment_transaction(lead, fields, event_id, event_type):
    if (
        normalize_string(lead.get("subscriber_type")).lower() == "founder"
        and normalize_string(lead.get("payment_status")).lower() == "paid"
        and lead.get("founder_lifetime") is True
    ):
        return get_lead(lead["lead_id"]), {
            "invoked": False,
            "reason": "already_founder",
        }

    previous_state = summarize_founder_activation_state(lead)
    new_state = {
        **previous_state,
        "subscriber_type": "founder",
        "tier": "founder",
        "selected_tier": "founder",
        "selected_tier_billing": "lifetime",
        "selected_contract_key": "founder_lifetime",
        "payment_status": "paid",
        "payment_status_reason": "founder_payment_succeeded",
        "subscription_status": "none",
        "access_status": "active",
        "founder_lifetime": True,
        "founder_activated_at": lead.get("founder_activated_at") or fields.get("founder_activated_at"),
        "founder_inviter_resolution": {
            "inviter_source": lead.get("inviter_source"),
            "inviter_lead_id": lead.get("inviter_lead_id"),
            "status": "consumed",
        }
        if normalize_string(lead.get("inviter_source")).lower() == "founder"
        and normalize_string(lead.get("inviter_lead_id"))
        else None,
        "synthetic_test": False,
    }
    audit_item = founder_activation_audit_item(
        lead=lead,
        event_id=event_id,
        event_type=event_type,
        previous_state=previous_state,
        new_state=new_state,
    )

    expression_names = {f"#f{index}": field for index, field in enumerate(fields.keys())}
    expression_values = {f":v{index}": serializer.serialize(value) for index, value in enumerate(fields.values())}
    expression_values[":founder_invited"] = serializer.serialize("founder_invited")
    expression_values[":approved"] = serializer.serialize("approved")
    expression_values[":false"] = serializer.serialize(False)

    transact_items = [
        {
            "Put": {
                "TableName": AUDIT_TABLE_NAME,
                "Item": serialize_item(audit_item),
                "ConditionExpression": "attribute_not_exists(audit_id)",
            }
        },
        {
            "Update": {
                "TableName": LEADS_TABLE_NAME,
                "Key": {"lead_id": serializer.serialize(lead["lead_id"])},
                "UpdateExpression": "SET " + ", ".join(
                    (
                        f"{name_key} = if_not_exists({name_key}, :v{index})"
                        if expression_names[name_key] == "founder_activated_at"
                        else f"{name_key} = :v{index}"
                    )
                    for index, name_key in enumerate(expression_names.keys())
                ),
                "ConditionExpression": (
                    "subscriber_type = :founder_invited "
                    "AND review_status = :approved "
                    "AND (attribute_not_exists(synthetic_test) OR synthetic_test = :false)"
                ),
                "ExpressionAttributeNames": expression_names,
                "ExpressionAttributeValues": expression_values,
            }
        },
    ]
    resolution_update = founder_inviter_resolution_update(
        lead,
        fields.get("founder_activated_at") or fields.get("confirmed_payment_at") or now_iso(),
    )
    if resolution_update:
        transact_items.append(resolution_update)

    ddb_client.transact_write_items(TransactItems=transact_items)

    updated = get_lead(lead["lead_id"])
    return updated, {
        "invoked": True,
        "audit_id": audit_item["audit_id"],
        "founder_inviter_resolved": bool(resolution_update),
    }


def reject_founder_activation(event_id, event_type, lead, reason, metadata_price_id, metadata_product_id, selected_price_id):
    log_json(
        "founder_activation_rejected",
        event_id=event_id,
        event_type=event_type,
        lead_id=lead.get("lead_id"),
        reason=reason,
        stripe_price_id=metadata_price_id or None,
        stripe_product_id=metadata_product_id or None,
        selected_price_id=selected_price_id or None,
        expected_price_id=FOUNDER_LIVE_PRICE_ID,
        expected_product_id=CONTRACTS["founder_lifetime"]["stripe_product_id"],
    )
    return {
        "action": "founder_activation_rejected",
        "lead_id": lead.get("lead_id"),
        "new_state": {
            "reason": reason,
            "subscriber_type": lead.get("subscriber_type"),
            "payment_status": lead.get("payment_status"),
            "subscription_status": lead.get("subscription_status"),
        },
    }


def event_fields(event_id, event_type):
    return {
        "last_event_id": event_id,
        "last_event_type": event_type,
        "stripe_last_event_id": event_id,
        "stripe_event_type": event_type,
        "updated_at": now_iso(),
    }


def period_end_iso(obj):
    period_end = safe_get(obj, "current_period_end")
    if period_end is None:
        return None
    try:
        return datetime.fromtimestamp(int(period_end), tz=timezone.utc).isoformat()
    except Exception:
        return normalize_string(period_end) or None


def period_start_iso(obj):
    period_start = safe_get(obj, "current_period_start")
    if period_start is None:
        return None
    try:
        return datetime.fromtimestamp(int(period_start), tz=timezone.utc).isoformat()
    except Exception:
        return normalize_string(period_start) or None


def schedule_name_for_downgrade(lead_id, period_end_epoch):
    return f"presttige-downgrade-{lead_id}-{int(period_end_epoch)}"[:64]


def create_downgrade_schedule(lead_id, period_end_epoch):
    schedule_name = schedule_name_for_downgrade(lead_id, period_end_epoch)
    fire_at = datetime.fromtimestamp(int(period_end_epoch), tz=timezone.utc)
    scheduler.create_schedule(
        Name=schedule_name,
        GroupName=SCHEDULER_GROUP_NAME,
        ScheduleExpression=f"at({fire_at.strftime('%Y-%m-%dT%H:%M:%S')})",
        ScheduleExpressionTimezone="UTC",
        FlexibleTimeWindow={"Mode": "OFF"},
        Target={
            "Arn": DOWNGRADE_FUNCTION_ARN,
            "RoleArn": DOWNGRADE_SCHEDULER_ROLE_ARN,
            "Input": json.dumps(
                {
                    "lead_id": lead_id,
                    "reason": "subscription_cancelled",
                    "schedule_name": schedule_name,
                }
            ),
        },
        ActionAfterCompletion="DELETE",
    )
    return schedule_name, fire_at.isoformat()


def delete_schedule_if_present(schedule_name):
    if not schedule_name:
        return False
    try:
        scheduler.delete_schedule(Name=schedule_name, GroupName=SCHEDULER_GROUP_NAME)
        return True
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code not in {"ResourceNotFoundException", "ValidationException"}:
            raise
        return False


def invoke_welcome_email(lead):
    if not lead or not lead.get("lead_id"):
        return {"invoked": False, "reason": "missing_lead"}
    if lead.get("welcome_sent_at"):
        return {"invoked": False, "reason": "already_sent"}

    invocation_type = "RequestResponse" if is_tester_lead(lead) else "Event"
    result = lambda_client.invoke(
        FunctionName=SEND_WELCOME_EMAIL_FUNCTION,
        InvocationType=invocation_type,
        Payload=json.dumps({"body": json.dumps({"lead_id": lead["lead_id"]})}).encode("utf-8"),
    )
    return {
        "invoked": True,
        "invocation_type": invocation_type,
        "status_code": result.get("StatusCode"),
    }


def send_founder_welcome_email_if_needed(lead):
    if not lead or not lead.get("lead_id"):
        return {"sent": False, "skipped": True, "reason": "missing_lead"}
    if lead.get("founder_welcome_email_sent_at"):
        return {"sent": False, "skipped": True, "reason": "already_sent"}

    recipient = normalize_email(lead.get("email"))
    if not is_valid_email_address(recipient):
        return {"sent": False, "skipped": True, "reason": "missing_email"}
    if lead.get("synthetic_test") is True and not is_founder_test_welcome_allowed(recipient):
        return {"sent": False, "skipped": True, "reason": "synthetic_test_recipient_not_allowed"}

    member_name = normalize_string(lead.get("name")) or "Member"
    text_body = "\n\n".join(
        [
            f"Dear {member_name},",
            "Your membership is confirmed. Welcome to Presttige.",
            (
                "You now belong to a small, deliberately limited circle of Founding "
                "Members, a distinction that remains yours for life."
            ),
            (
                "In the days ahead you will receive your first invitation to introduce "
                "someone to Presttige, a privilege reserved for Founders."
            ),
            "We are honoured to have you with us.",
            "The Founders' House",
        ]
    )
    html_body = simple_email_html(
        "Welcome to Presttige",
        [
            f"Dear {html.escape(member_name)},",
            "Your membership is confirmed. Welcome to Presttige.",
            "You now belong to a small, deliberately limited circle of Founding Members, a distinction that remains yours for life.",
            "In the days ahead you will receive your first invitation to introduce someone to Presttige, a privilege reserved for Founders.",
            "We are honoured to have you with us.",
            "The Founders' House",
        ],
    )
    ses_response = ses.send_email(
        Source=format_source(FOUNDER_WELCOME_EMAIL_FROM),
        ConfigurationSetName=SES_CONFIGURATION_SET,
        ReplyToAddresses=[FOUNDER_WELCOME_EMAIL_FROM],
        Destination={"ToAddresses": [recipient]},
        Message={
            "Subject": {"Data": "Welcome to Presttige", "Charset": "UTF-8"},
            "Body": {
                "Text": {"Data": text_body, "Charset": "UTF-8"},
                "Html": {"Data": html_body, "Charset": "UTF-8"},
            },
        },
    )
    sent_at = now_iso()
    try:
        leads_table.update_item(
            Key={"lead_id": lead["lead_id"]},
            UpdateExpression=(
                "SET founder_welcome_email_sent_at = "
                "if_not_exists(founder_welcome_email_sent_at, :sent_at)"
            ),
            ConditionExpression=(
                "attribute_exists(lead_id) "
                "AND attribute_not_exists(founder_welcome_email_sent_at)"
            ),
            ExpressionAttributeValues={":sent_at": sent_at},
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return {"sent": False, "skipped": True, "reason": "already_sent"}
        raise

    return {
        "sent": True,
        "skipped": False,
        "sent_at": sent_at,
        "message_id": ses_response.get("MessageId"),
    }


def notify_office_dispute(lead, context, dispute):
    lead_id = (lead or {}).get("lead_id") or context.get("lead_id") or "unknown"
    subject = f"Presttige Stripe dispute opened, {lead_id}"
    body = "\n".join(
        [
            "A Stripe dispute has been opened and requires human review.",
            "",
            f"Lead ID: {lead_id}",
            f"Email: {(lead or {}).get('email') or 'unknown'}",
            f"Dispute ID: {safe_get(dispute, 'id') or 'unknown'}",
            f"Charge ID: {context.get('charge_id') or 'unknown'}",
            f"Payment Intent: {context.get('payment_intent_id') or 'unknown'}",
            f"Amount: {safe_get(dispute, 'amount') or 'unknown'} {normalize_string(safe_get(dispute, 'currency')).upper()}",
            f"Reason: {safe_get(dispute, 'reason') or 'unknown'}",
            "",
            "The lead has been marked under_dispute. Do not change tier state manually without review.",
        ]
    )
    html_body = simple_email_html(
        subject,
        [html.escape(line) if line else "&nbsp;" for line in body.splitlines()],
    )
    ses.send_email(
        Source=format_source(OFFICE_NOTIFICATION_FROM),
        ConfigurationSetName=SES_CONFIGURATION_SET,
        Destination={"ToAddresses": [OFFICE_NOTIFICATION_TO]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Text": {"Data": body, "Charset": "UTF-8"},
                "Html": {"Data": html_body, "Charset": "UTF-8"},
            },
        },
    )
    return {"notified": True, "to": OFFICE_NOTIFICATION_TO}


def handle_subscription_created(event_id, event_type, obj, context, lead):
    contract_key, contract = get_contract(context.get("contract_key"), lead)
    status = normalize_string(safe_get(obj, "status")).lower()
    cancel_at_period_end = bool(safe_get(obj, "cancel_at_period_end", False))
    fields = {
        **event_fields(event_id, event_type),
        "stripe_subscription_id": context.get("subscription_id") or safe_get(obj, "id"),
        "stripe_customer_id": context.get("customer_id") or safe_get(obj, "customer"),
        "subscription_status": status or "active",
        "subscription_current_period_start": period_start_iso(obj),
        "subscription_current_period_end": period_end_iso(obj),
        "cancel_at_period_end": cancel_at_period_end,
        "subscription_cancel_at_period_end": cancel_at_period_end,
    }

    welcome = {"invoked": False, "reason": "not_active"}
    if status in SUBSCRIPTION_ACTIVE_STATUSES or not status:
        fields.update(
            {
                "payment_status": "subscription_active",
                "payment_status_reason": "subscription_created",
                "access_status": "active",
                "tier": contract.get("tier") or lead.get("selected_tier"),
                "selected_tier": contract.get("tier") or lead.get("selected_tier"),
                "selected_tier_billing": contract.get("billing") or lead.get("selected_tier_billing"),
                "selected_contract_key": contract_key or lead.get("selected_contract_key"),
                "stripe_checkout_completed_at": lead.get("stripe_checkout_completed_at") or now_iso(),
            }
        )
        updated = set_lead_fields(lead["lead_id"], fields)
        welcome = invoke_welcome_email(updated)
    elif status in SUBSCRIPTION_PAST_DUE_STATUSES:
        fields.update(
            {
                "payment_status": "subscription_past_due",
                "payment_status_reason": "subscription_created_past_due",
            }
        )
        updated = set_lead_fields(lead["lead_id"], fields)
    else:
        fields.update(
            {
                "payment_status": "processing",
                "payment_status_reason": f"subscription_created_{status or 'processing'}",
            }
        )
        updated = set_lead_fields(lead["lead_id"], fields)

    return {
        "action": "subscription_created",
        "lead_id": lead["lead_id"],
        "new_state": {
            "payment_status": updated.get("payment_status"),
            "subscription_status": updated.get("subscription_status"),
            "welcome": welcome,
        },
    }


def handle_subscription_updated(event_id, event_type, obj, context, lead):
    contract_key, contract = get_contract(context.get("contract_key"), lead)
    status = normalize_string(safe_get(obj, "status")).lower()
    cancel_at_period_end = bool(safe_get(obj, "cancel_at_period_end", False))
    previous_schedule_name = normalize_string(lead.get("downgrade_schedule_name"))
    fields = {
        **event_fields(event_id, event_type),
        "stripe_subscription_id": context.get("subscription_id") or safe_get(obj, "id"),
        "stripe_customer_id": context.get("customer_id") or safe_get(obj, "customer"),
        "subscription_status": status or lead.get("subscription_status") or "active",
        "subscription_current_period_start": period_start_iso(obj),
        "subscription_current_period_end": period_end_iso(obj),
        "cancel_at_period_end": cancel_at_period_end,
        "subscription_cancel_at_period_end": cancel_at_period_end,
        "selected_contract_key": contract_key or lead.get("selected_contract_key"),
    }
    remove_fields = []
    schedule_action = {"action": "none"}
    welcome = {"invoked": False, "reason": "not_active"}

    if cancel_at_period_end:
        period_end = safe_get(obj, "current_period_end")
        if not period_end:
            raise RuntimeError("cancel_at_period_end=true but current_period_end missing")
        if previous_schedule_name:
            delete_schedule_if_present(previous_schedule_name)
        schedule_name, scheduled_at = create_downgrade_schedule(lead["lead_id"], period_end)
        fields.update(
            {
                "payment_status": "subscription_cancel_at_period_end",
                "payment_status_reason": "subscription_cancel_scheduled",
                "cancel_scheduled_at": scheduled_at,
                "downgrade_schedule_name": schedule_name,
            }
        )
        schedule_action = {"action": "created", "name": schedule_name, "fire_at": scheduled_at}
    else:
        if previous_schedule_name:
            deleted = delete_schedule_if_present(previous_schedule_name)
            schedule_action = {"action": "deleted", "name": previous_schedule_name, "deleted": deleted}
        remove_fields.extend(["cancel_scheduled_at", "downgrade_schedule_name"])

        if status in SUBSCRIPTION_ACTIVE_STATUSES or not status:
            fields.update(
                {
                    "payment_status": "subscription_active",
                    "payment_status_reason": "subscription_active",
                    "access_status": "active",
                    "tier": contract.get("tier") or lead.get("selected_tier"),
                    "selected_tier": contract.get("tier") or lead.get("selected_tier"),
                    "selected_tier_billing": contract.get("billing") or lead.get("selected_tier_billing"),
                }
            )
        elif status in SUBSCRIPTION_PAST_DUE_STATUSES:
            fields.update(
                {
                    "payment_status": "subscription_past_due",
                    "payment_status_reason": f"subscription_{status}",
                }
            )
        elif status in SUBSCRIPTION_PROCESSING_STATUSES:
            fields.update(
                {
                    "payment_status": "processing",
                    "payment_status_reason": f"subscription_{status}",
                }
            )

    updated = set_lead_fields(lead["lead_id"], fields, remove_fields=remove_fields)
    if updated.get("payment_status") == "subscription_active":
        welcome = invoke_welcome_email(updated)

    return {
        "action": "subscription_updated",
        "lead_id": lead["lead_id"],
        "new_state": {
            "payment_status": updated.get("payment_status"),
            "subscription_status": updated.get("subscription_status"),
            "cancel_at_period_end": updated.get("cancel_at_period_end"),
            "schedule": schedule_action,
            "welcome": welcome,
        },
    }


def handle_subscription_deleted(event_id, event_type, obj, context, lead):
    schedule_name = normalize_string(lead.get("downgrade_schedule_name"))
    deleted = delete_schedule_if_present(schedule_name) if schedule_name else False
    updated = set_lead_fields(
        lead["lead_id"],
        {
            **event_fields(event_id, event_type),
            "tier": "subscriber",
            "selected_tier": "subscriber",
            "subscription_status": "ended",
            "payment_status": "renewal_cancelled",
            "payment_status_reason": "subscription_deleted",
            "access_status": "subscriber",
            "cancel_at_period_end": False,
            "subscription_cancel_at_period_end": False,
            "downgraded_to_subscriber_at": now_iso(),
        },
        remove_fields=["cancel_scheduled_at", "downgrade_schedule_name"],
    )
    return {
        "action": "subscription_deleted_downgraded",
        "lead_id": lead["lead_id"],
        "new_state": {
            "tier": updated.get("tier"),
            "payment_status": updated.get("payment_status"),
            "schedule_deleted": deleted,
        },
    }


def handle_payment_intent_succeeded(event_id, event_type, obj, context, lead):
    contract_key, contract = get_contract(context.get("contract_key"), lead)
    is_founder = contract_key == "founder_lifetime" or contract.get("founder_lifetime")
    is_live_event = context.get("livemode") is True
    payment_intent_id = context.get("payment_intent_id") or safe_get(obj, "id")
    is_initial_payment = (
        not lead.get("stripe_checkout_completed_at")
        or normalize_string(lead.get("stripe_payment_intent_id")) == normalize_string(payment_intent_id)
        or is_founder
    )

    fields = {
        **event_fields(event_id, event_type),
        "stripe_payment_intent_id": payment_intent_id,
        "stripe_customer_id": context.get("customer_id") or safe_get(obj, "customer") or lead.get("stripe_customer_id"),
        "last_payment_at": now_iso(),
        "confirmed_payment_at": now_iso(),
        "stripe_checkout_completed_at": lead.get("stripe_checkout_completed_at") or now_iso(),
    }
    add_fields = {}
    welcome = {"invoked": False, "reason": "not_applicable"}

    if is_founder:
        if not is_live_event:
            raise RuntimeError("Founder activation requires a live Stripe payment event")
        metadata_price_id = normalize_string((context.get("metadata") or {}).get("stripe_price_id"))
        metadata_product_id = normalize_string((context.get("metadata") or {}).get("stripe_product_id"))
        selected_price_id = normalize_string(lead.get("selected_price_id"))
        expected_product_id = normalize_string(contract.get("stripe_product_id"))
        allowed_price_ids = {FOUNDER_LIVE_PRICE_ID}
        if selected_price_id:
            allowed_price_ids.add(selected_price_id)
        if not metadata_product_id:
            return reject_founder_activation(
                event_id,
                event_type,
                lead,
                "missing_founder_product_metadata",
                metadata_price_id,
                metadata_product_id,
                selected_price_id,
            )
        if metadata_product_id != expected_product_id:
            return reject_founder_activation(
                event_id,
                event_type,
                lead,
                "founder_product_metadata_mismatch",
                metadata_price_id,
                metadata_product_id,
                selected_price_id,
            )
        if not metadata_price_id:
            return reject_founder_activation(
                event_id,
                event_type,
                lead,
                "missing_founder_price_metadata",
                metadata_price_id,
                metadata_product_id,
                selected_price_id,
            )
        if metadata_price_id not in allowed_price_ids:
            return reject_founder_activation(
                event_id,
                event_type,
                lead,
                "founder_price_metadata_mismatch",
                metadata_price_id,
                metadata_product_id,
                selected_price_id,
            )
        fields.update(
            {
                "subscriber_type": "founder",
                "tier": "founder",
                "selected_tier": "founder",
                "selected_tier_billing": "lifetime",
                "payment_status": "paid",
                "payment_status_reason": "founder_payment_succeeded",
                "subscription_status": "none",
                "founder_lifetime": True,
                "access_status": "active",
                "selected_contract_key": "founder_lifetime",
                "founder_activated_at": fields["confirmed_payment_at"],
            }
        )
    else:
        fields.update(
            {
                "tier": contract.get("tier") or lead.get("selected_tier"),
                "selected_tier": contract.get("tier") or lead.get("selected_tier"),
                "selected_tier_billing": contract.get("billing") or lead.get("selected_tier_billing"),
                "payment_status": "subscription_active",
                "payment_status_reason": "payment_intent_succeeded",
                "subscription_status": "active",
                "access_status": "active",
                "selected_contract_key": contract_key or lead.get("selected_contract_key"),
            }
        )
        if not is_initial_payment:
            add_fields["renewal_count"] = 1

    if is_founder:
        updated, audit = activate_founder_payment_transaction(
            lead=lead,
            fields=fields,
            event_id=event_id,
            event_type=event_type,
        )
        welcome = send_founder_welcome_email_if_needed(updated)
    else:
        updated = set_lead_fields(lead["lead_id"], fields, add_fields=add_fields)
        audit = {"invoked": False, "reason": "not_founder"}
        welcome = invoke_welcome_email(updated)

    return {
        "action": "payment_intent_succeeded",
        "lead_id": lead["lead_id"],
        "new_state": {
            "payment_status": updated.get("payment_status"),
            "tier": updated.get("tier"),
            "founder_lifetime": updated.get("founder_lifetime", False),
            "renewal_count": updated.get("renewal_count"),
            "audit": audit,
            "welcome": welcome,
        },
    }


def handle_payment_intent_failed(event_id, event_type, obj, context, lead):
    updated = set_lead_fields(
        lead["lead_id"],
        {
            **event_fields(event_id, event_type),
            "payment_status": "failed",
            "payment_status_reason": "payment_intent_failed",
            "stripe_payment_failed_at": now_iso(),
        },
    )
    return {
        "action": "payment_intent_failed_logged",
        "lead_id": lead["lead_id"],
        "new_state": {"payment_status": updated.get("payment_status")},
    }


def handle_invoice_payment_succeeded(event_id, event_type, obj, context, lead):
    billing_reason = normalize_string(safe_get(obj, "billing_reason")).lower()
    invoice_id = normalize_string(safe_get(obj, "id"))
    fields = {
        **event_fields(event_id, event_type),
        "stripe_latest_invoice_id": invoice_id,
        "last_payment_at": now_iso(),
        "subscription_status": "active",
        "payment_status": "subscription_active",
        "payment_status_reason": "invoice_payment_succeeded",
    }
    add_fields = {}
    if billing_reason == "subscription_cycle" and lead.get("last_renewal_invoice_id") != invoice_id:
        fields["last_renewal_invoice_id"] = invoice_id
        add_fields["renewal_count"] = 1

    updated = set_lead_fields(lead["lead_id"], fields, add_fields=add_fields)
    return {
        "action": "invoice_payment_succeeded_reconciled",
        "lead_id": lead["lead_id"],
        "new_state": {
            "payment_status": updated.get("payment_status"),
            "renewal_count": updated.get("renewal_count"),
            "billing_reason": billing_reason,
        },
    }


def handle_invoice_payment_failed(event_id, event_type, obj, context, lead):
    updated = set_lead_fields(
        lead["lead_id"],
        {
            **event_fields(event_id, event_type),
            "payment_status": "renewal_failed_retrying",
            "payment_status_reason": "invoice_payment_failed",
            "renewal_last_failed_at": now_iso(),
            "subscription_status": "past_due",
        },
        add_fields={"renewal_attempt_count": 1},
    )
    return {
        "action": "invoice_payment_failed_logged",
        "lead_id": lead["lead_id"],
        "new_state": {"payment_status": updated.get("payment_status")},
    }


def handle_charge_refunded(event_id, event_type, obj, context, lead):
    amount = int(safe_get(obj, "amount", 0) or 0)
    amount_refunded = int(safe_get(obj, "amount_refunded", 0) or 0)
    full_refund = amount > 0 and amount_refunded >= amount
    fields = {
        **event_fields(event_id, event_type),
        "last_refund_at": now_iso(),
        "refund_reason": safe_get(obj, "refund_reason") or safe_get(obj, "reason"),
        "stripe_charge_id": context.get("charge_id") or safe_get(obj, "id"),
    }

    if full_refund:
        fields.update(
            {
                "tier": "subscriber",
                "selected_tier": "subscriber",
                "payment_status": "refunded",
                "payment_status_reason": "charge_fully_refunded",
                "subscription_status": "cancelled",
                "access_status": "subscriber",
                "downgraded_to_subscriber_at": now_iso(),
            }
        )
        action = "charge_fully_refunded_downgraded"
    else:
        fields.update(
            {
                "last_partial_refund_at": now_iso(),
                "payment_status_reason": "charge_partially_refunded",
            }
        )
        action = "charge_partially_refunded_logged"

    updated = set_lead_fields(lead["lead_id"], fields)
    return {
        "action": action,
        "lead_id": lead["lead_id"],
        "new_state": {
            "tier": updated.get("tier"),
            "payment_status": updated.get("payment_status"),
            "full_refund": full_refund,
        },
    }


def handle_dispute_created(event_id, event_type, obj, context, lead):
    expression_names = {
        "#last_event_id": "last_event_id",
        "#last_event_type": "last_event_type",
        "#stripe_last_event_id": "stripe_last_event_id",
        "#stripe_event_type": "stripe_event_type",
        "#updated_at": "updated_at",
        "#status": "status",
        "#subscription_status": "subscription_status",
        "#dispute_status": "dispute_status",
        "#stripe_dispute_id": "stripe_dispute_id",
        "#pre_dispute_tier": "pre_dispute_tier",
        "#tier": "tier",
        "#pre_dispute_payment_status": "pre_dispute_payment_status",
        "#payment_status": "payment_status",
    }
    values = {
        ":event_id": event_id,
        ":event_type": event_type,
        ":updated_at": now_iso(),
        ":under_dispute": "under_dispute",
        ":open": "open",
        ":dispute_id": safe_get(obj, "id"),
    }
    updated = leads_table.update_item(
        Key={"lead_id": lead["lead_id"]},
        UpdateExpression="""
            SET #last_event_id = :event_id,
                #last_event_type = :event_type,
                #stripe_last_event_id = :event_id,
                #stripe_event_type = :event_type,
                #updated_at = :updated_at,
                #status = :under_dispute,
                #subscription_status = :under_dispute,
                #dispute_status = :open,
                #stripe_dispute_id = :dispute_id,
                #pre_dispute_tier = if_not_exists(#pre_dispute_tier, #tier),
                #pre_dispute_payment_status = if_not_exists(#pre_dispute_payment_status, #payment_status)
        """,
        ExpressionAttributeNames=expression_names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    ).get("Attributes", {})
    notification = notify_office_dispute(updated, context, obj)
    return {
        "action": "dispute_created_frozen",
        "lead_id": lead["lead_id"],
        "new_state": {
            "status": updated.get("status"),
            "dispute_status": updated.get("dispute_status"),
            "notification": notification,
        },
    }


def handle_dispute_closed(event_id, event_type, obj, context, lead):
    dispute_status = normalize_string(safe_get(obj, "status")).lower()
    won = dispute_status == "won"
    if won:
        restored_tier = lead.get("pre_dispute_tier") or lead.get("selected_tier") or "subscriber"
        restored_payment_status = lead.get("pre_dispute_payment_status") or "subscription_active"
        updated = set_lead_fields(
            lead["lead_id"],
            {
                **event_fields(event_id, event_type),
                "tier": restored_tier,
                "selected_tier": restored_tier,
                "payment_status": restored_payment_status,
                "subscription_status": "active",
                "status": "active",
                "dispute_closed_at": now_iso(),
            },
            remove_fields=["dispute_status"],
        )
        action = "dispute_won_restored"
    else:
        updated = set_lead_fields(
            lead["lead_id"],
            {
                **event_fields(event_id, event_type),
                "tier": "subscriber",
                "selected_tier": "subscriber",
                "payment_status": "downgraded_to_subscriber",
                "payment_status_reason": "dispute_lost",
                "subscription_status": "ended",
                "status": "active",
                "dispute_status": "lost",
                "dispute_closed_at": now_iso(),
                "downgraded_to_subscriber_at": now_iso(),
            },
        )
        action = "dispute_lost_downgraded"

    return {
        "action": action,
        "lead_id": lead["lead_id"],
        "new_state": {
            "tier": updated.get("tier"),
            "payment_status": updated.get("payment_status"),
            "dispute_status": updated.get("dispute_status"),
        },
    }


HANDLERS = {
    "customer.subscription.created": handle_subscription_created,
    "customer.subscription.updated": handle_subscription_updated,
    "customer.subscription.deleted": handle_subscription_deleted,
    "payment_intent.succeeded": handle_payment_intent_succeeded,
    "payment_intent.payment_failed": handle_payment_intent_failed,
    "invoice.payment_succeeded": handle_invoice_payment_succeeded,
    "invoice.payment_failed": handle_invoice_payment_failed,
    "charge.refunded": handle_charge_refunded,
    "charge.dispute.created": handle_dispute_created,
    "charge.dispute.closed": handle_dispute_closed,
}


def route_event(event_id, event_type, obj, context):
    handler = HANDLERS.get(event_type)
    if not handler:
        return {
            "action": "ignored_event_type",
            "lead_id": context.get("lead_id") or "unresolved",
            "new_state": {"ignored_event_type": event_type},
        }

    lead = get_lead(context.get("lead_id"))
    if not lead:
        return {
            "action": "lead_unresolved_logged",
            "lead_id": context.get("lead_id") or "unresolved",
            "new_state": {
                "reason": "lead_id_missing_or_not_found",
                "subscription_id": context.get("subscription_id"),
                "payment_intent_id": context.get("payment_intent_id"),
                "charge_id": context.get("charge_id"),
            },
        }

    return handler(event_id, event_type, obj, context, lead)


def lambda_handler(event, context):
    event_id = None
    event_type = None
    try:
        webhook_event = parse_event(event)
        event_id = normalize_string(safe_get(webhook_event, "id"))
        event_type = normalize_string(safe_get(webhook_event, "type"))
        reservation = put_event_reservation(webhook_event)

        if reservation.get("duplicate_processed"):
            log_json(
                "stripe_webhook_duplicate_ignored",
                event_id=event_id,
                event_type=event_type,
            )
            return response(200, {"received": True, "duplicate": True, "event_id": event_id})

        obj = event_object(webhook_event)
        context_data = extract_context(event_type, obj)
        result = route_event(event_id, event_type, obj, context_data)

        mark_event_processed(
            event_id,
            result.get("lead_id"),
            result.get("action"),
            result.get("new_state"),
        )
        log_json(
            "stripe_webhook_processed",
            event_id=event_id,
            event_type=event_type,
            lead_id=result.get("lead_id"),
            action_taken=result.get("action"),
            new_state=result.get("new_state"),
        )
        return response(200, {"received": True, **result})

    except STRIPE_SIGNATURE_ERROR as exc:
        log_json("stripe_webhook_signature_failed", error=str(exc))
        return response(400, {"error": "signature_verification_failed", "message": str(exc)})
    except ValueError as exc:
        log_json("stripe_webhook_bad_request", error=str(exc))
        return response(400, {"error": "bad_request", "message": str(exc)})
    except Exception as exc:
        if event_id:
            try:
                mark_event_failed(event_id, exc)
            except Exception as mark_exc:
                log_json(
                    "stripe_webhook_mark_failed_error",
                    event_id=event_id,
                    error=str(mark_exc),
                )
        log_json(
            "stripe_webhook_handler_exception",
            event_id=event_id,
            event_type=event_type,
            error=str(exc),
            stack=traceback.format_exc(),
        )
        return response(500, {"error": "internal_error", "message": str(exc)})
