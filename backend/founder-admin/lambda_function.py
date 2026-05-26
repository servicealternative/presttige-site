import base64
import hashlib
import hmac
import json
import os
import secrets
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer


REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME = os.environ.get("TABLE_NAME", "presttige-db")
AUDIT_TABLE_NAME = os.environ.get("AUDIT_TABLE_NAME", "presttige-review-audit")
FOUNDER_TOKEN_SECRET_ID = os.environ.get(
    "FOUNDER_TOKEN_SECRET_ID",
    "presttige-founder-token-secret",
)
APP_ORIGIN = os.environ.get("APP_ORIGIN", "https://presttige.net")

VALID_ACTIONS = {
    "create_invite",
    "revoke_token",
    "regenerate_token",
}
ACTIVE_PAYMENT_STATUSES = {
    "paid",
    "free",
    "subscription_active",
    "preview_paid",
}
EMAIL_INDEX_NAME = "email-index"

dynamodb = boto3.resource("dynamodb", region_name=REGION)
ddb_client = boto3.client("dynamodb", region_name=REGION)
secrets_client = boto3.client("secretsmanager", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)
serializer = TypeSerializer()
_cached_founder_token_secret = None


def lambda_handler(event, context):
    method = request_method(event)
    if method == "OPTIONS":
        return empty_response()
    if method != "POST":
        return error_response(405, "method_not_allowed", "Use POST.")

    actor_id = get_cognito_actor_id(event)
    if not actor_id:
        return error_response(401, "unauthorized", "Cognito authentication is required.")

    try:
        payload = parse_json_body(event)
    except ValueError:
        return error_response(400, "invalid_json", "Request body must be valid JSON.")

    action = normalize_string(payload.get("action")).lower()
    if action not in VALID_ACTIONS:
        return error_response(400, "invalid_action", "Action is not supported.")

    try:
        if action == "create_invite":
            result = create_founder_invite(payload, actor_id)
        elif action == "revoke_token":
            result = update_founder_token(payload, actor_id, mode="revoke")
        else:
            result = update_founder_token(payload, actor_id, mode="regenerate")

        return response(200, result)
    except AdminError as exc:
        return error_response(exc.status_code, exc.code, exc.message, exc.details)
    except ddb_client.exceptions.TransactionCanceledException:
        return error_response(
            409,
            "transaction_cancelled",
            "Founder admin write could not be completed safely.",
        )
    except Exception as exc:
        print(
            json.dumps(
                {
                    "event": "founder_admin_error",
                    "name": exc.__class__.__name__,
                    "message": str(exc),
                }
            )
        )
        return error_response(500, "internal_error", "Founder admin request failed.")


def create_founder_invite(payload, actor_id):
    inviter_email = normalize_email(payload.get("inviter_email"))
    invited_email = normalize_email(payload.get("invited_email"))
    invited_name = normalize_string(payload.get("invited_name") or payload.get("name"))

    if not is_valid_email(inviter_email):
        raise AdminError(400, "invalid_inviter_email", "Inviter email is invalid.")
    if not is_valid_email(invited_email):
        raise AdminError(400, "invalid_invited_email", "Invited email is invalid.")
    if inviter_email == invited_email:
        raise AdminError(
            400,
            "same_email_not_allowed",
            "Inviter and invited Founder emails must be different.",
        )

    inviter = find_lead_by_email(inviter_email)
    if not inviter or not is_registered_member(inviter):
        raise AdminError(
            400,
            "inviter_not_registered_member",
            "Inviter must exist as an approved member with an active account marker.",
        )

    existing_invited = find_lead_by_email(invited_email)
    target_lead_id = (
        normalize_string(existing_invited.get("lead_id"))
        if existing_invited
        else generate_lead_id()
    )
    now = utc_now_iso()
    token_version = 1
    token_nonce = secrets.token_hex(16)
    founder_token = generate_founder_token(invited_email, token_version, token_nonce)

    new_state = {
        "subscriber_type": "founder_invited",
        "founder_eligible": True,
        "founder_gate_status": "confirmed",
        "tier_intent": "founder",
        "inviter_email": inviter_email,
        "inviter_lead_id": inviter["lead_id"],
        "founder_token_status": "active",
        "founder_token_version": token_version,
        "founder_token_generated_at": now,
        "consent_basis": "admin_invited_legitimate_interest",
        "consent_timestamp": now,
        "created_by_admin": True,
    }

    update_expression = """
        SET email = if_not_exists(email, :email),
            #name = if_not_exists(#name, :name),
            subscriber_type = :subscriber_type,
            founder_eligible = :founder_eligible,
            founder_gate_status = :founder_gate_status,
            tier_intent = :tier_intent,
            inviter_email = :inviter_email,
            inviter_lead_id = :inviter_lead_id,
            founder_token = :founder_token,
            founder_token_status = :founder_token_status,
            founder_token_version = :founder_token_version,
            founder_token_nonce = :founder_token_nonce,
            founder_token_generated_at = :founder_token_generated_at,
            consent_basis = :consent_basis,
            consent_timestamp = :consent_timestamp,
            created_by_admin = :created_by_admin,
            created_at = if_not_exists(created_at, :created_at),
            updated_at = :updated_at
        REMOVE founder_token_revoked_at
    """
    expression_names = {"#name": "name"}
    expression_values = {
        ":email": invited_email,
        ":name": invited_name,
        ":subscriber_type": "founder_invited",
        ":founder_eligible": True,
        ":founder_gate_status": "confirmed",
        ":tier_intent": "founder",
        ":inviter_email": inviter_email,
        ":inviter_lead_id": inviter["lead_id"],
        ":founder_token": founder_token,
        ":founder_token_status": "active",
        ":founder_token_version": token_version,
        ":founder_token_nonce": token_nonce,
        ":founder_token_generated_at": now,
        ":consent_basis": "admin_invited_legitimate_interest",
        ":consent_timestamp": now,
        ":created_by_admin": True,
        ":created_at": now,
        ":updated_at": now,
    }

    audit_item = build_audit_item(
        action="founder_invite_create",
        actor_id=actor_id,
        target_lead_id=target_lead_id,
        timestamp=now,
        previous_state=summarize_founder_state(existing_invited),
        new_state=new_state,
    )

    transact_audit_and_update(
        audit_item=audit_item,
        lead_id=target_lead_id,
        update_expression=update_expression,
        expression_values=expression_values,
        expression_names=expression_names,
    )

    return {
        "ok": True,
        "action": "founder_invite_create",
        "lead_id": target_lead_id,
        "founder_token_status": "active",
        "founder_token_version": token_version,
    }


def update_founder_token(payload, actor_id, mode):
    invited_email = normalize_email(payload.get("invited_email") or payload.get("email"))
    lead_id = normalize_string(payload.get("lead_id"))

    if not lead_id and not is_valid_email(invited_email):
        raise AdminError(
            400,
            "target_required",
            "Provide a valid invited_email or lead_id.",
        )

    lead = table.get_item(Key={"lead_id": lead_id}).get("Item") if lead_id else None
    if not lead:
        lead = find_lead_by_email(invited_email)
    if not lead:
        raise AdminError(404, "invite_not_found", "Founder invite record was not found.")

    email = normalize_email(lead.get("email"))
    if not is_valid_email(email):
        raise AdminError(409, "invite_email_missing", "Founder invite record has no valid email.")

    target_lead_id = lead["lead_id"]
    now = utc_now_iso()
    previous_state = summarize_founder_state(lead)

    if mode == "revoke":
        action = "founder_token_revoke"
        new_state = {
            **previous_state,
            "founder_token_status": "revoked",
            "founder_token_revoked_at": now,
        }
        update_expression = """
            SET founder_token_status = :founder_token_status,
                founder_token_revoked_at = :founder_token_revoked_at,
                updated_at = :updated_at
        """
        expression_values = {
            ":founder_token_status": "revoked",
            ":founder_token_revoked_at": now,
            ":updated_at": now,
        }
    else:
        action = "founder_token_regenerate"
        next_version = int(lead.get("founder_token_version") or 0) + 1
        token_nonce = secrets.token_hex(16)
        founder_token = generate_founder_token(email, next_version, token_nonce)
        new_state = {
            **previous_state,
            "founder_token_status": "active",
            "founder_token_version": next_version,
            "founder_token_generated_at": now,
        }
        update_expression = """
            SET founder_token = :founder_token,
                founder_token_status = :founder_token_status,
                founder_token_version = :founder_token_version,
                founder_token_nonce = :founder_token_nonce,
                founder_token_generated_at = :founder_token_generated_at,
                updated_at = :updated_at
            REMOVE founder_token_revoked_at
        """
        expression_values = {
            ":founder_token": founder_token,
            ":founder_token_status": "active",
            ":founder_token_version": next_version,
            ":founder_token_nonce": token_nonce,
            ":founder_token_generated_at": now,
            ":updated_at": now,
        }

    audit_item = build_audit_item(
        action=action,
        actor_id=actor_id,
        target_lead_id=target_lead_id,
        timestamp=now,
        previous_state=previous_state,
        new_state=new_state,
    )

    transact_audit_and_update(
        audit_item=audit_item,
        lead_id=target_lead_id,
        update_expression=update_expression,
        expression_values=expression_values,
    )

    return {
        "ok": True,
        "action": action,
        "lead_id": target_lead_id,
        "founder_token_status": new_state["founder_token_status"],
        "founder_token_version": new_state.get("founder_token_version"),
    }


def transact_audit_and_update(
    audit_item,
    lead_id,
    update_expression,
    expression_values,
    expression_names=None,
):
    update_request = {
        "TableName": TABLE_NAME,
        "Key": serialize_item({"lead_id": lead_id}),
        "UpdateExpression": clean_expression(update_expression),
        "ExpressionAttributeValues": serialize_item(expression_values),
    }
    if expression_names:
        update_request["ExpressionAttributeNames"] = expression_names

    ddb_client.transact_write_items(
        TransactItems=[
            {
                "Put": {
                    "TableName": AUDIT_TABLE_NAME,
                    "Item": serialize_item(audit_item),
                    "ConditionExpression": "attribute_not_exists(audit_id)",
                }
            },
            {"Update": update_request},
        ]
    )


def build_audit_item(action, actor_id, target_lead_id, timestamp, previous_state, new_state):
    return {
        "audit_id": str(uuid.uuid4()),
        "timestamp": timestamp,
        "lead_id": target_lead_id,
        "target_lead_id": target_lead_id,
        "action": action,
        "actor_id": actor_id,
        "reviewer_id": actor_id,
        "previous_state": previous_state,
        "new_state": new_state,
        "metadata": {
            "component": "presttige-founder-admin",
        },
        "is_test": target_lead_id.startswith("fdm_codex_"),
    }


def summarize_founder_state(lead):
    if not lead:
        return {}
    return {
        "subscriber_type": lead.get("subscriber_type"),
        "founder_eligible": lead.get("founder_eligible"),
        "founder_gate_status": lead.get("founder_gate_status"),
        "tier_intent": lead.get("tier_intent"),
        "inviter_lead_id": lead.get("inviter_lead_id"),
        "founder_token_status": lead.get("founder_token_status"),
        "founder_token_version": lead.get("founder_token_version"),
        "founder_token_generated_at": lead.get("founder_token_generated_at"),
        "founder_token_revoked_at": lead.get("founder_token_revoked_at"),
        "consent_basis": lead.get("consent_basis"),
        "created_by_admin": lead.get("created_by_admin"),
    }


def get_cognito_actor_id(event):
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    if not claims:
        claims = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
    return normalize_string(
        claims.get("sub")
        or claims.get("cognito:username")
        or claims.get("username")
    )


def find_lead_by_email(email):
    result = table.query(
        IndexName=EMAIL_INDEX_NAME,
        KeyConditionExpression=Key("email").eq(email),
        Limit=1,
    )
    items = result.get("Items") or []
    return items[0] if items else None


def is_registered_member(lead):
    if normalize_string(lead.get("review_status")).lower() != "approved":
        return False
    return has_active_account_marker(lead)


def has_active_account_marker(lead):
    payment_status = normalize_string(lead.get("payment_status")).lower()
    return (
        is_truthy(lead.get("account_active"))
        or normalize_string(lead.get("access_status")).lower() == "active"
        or payment_status in ACTIVE_PAYMENT_STATUSES
    )


def generate_founder_token(email, version, nonce):
    message = f"{email}:{version}:{nonce}"
    return hmac.new(
        load_founder_token_secret().encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def load_founder_token_secret():
    global _cached_founder_token_secret
    if _cached_founder_token_secret:
        return _cached_founder_token_secret

    result = secrets_client.get_secret_value(SecretId=FOUNDER_TOKEN_SECRET_ID)
    secret = result.get("SecretString") or ""
    if not secret:
        raise RuntimeError("Founder token secret is missing or empty.")
    _cached_founder_token_secret = secret
    return secret


def request_method(event):
    return (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "POST"
    ).upper()


def parse_json_body(event):
    body = event.get("body")
    if not body:
        return {}
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    parsed = json.loads(body)
    if not isinstance(parsed, dict):
        raise ValueError("JSON body must be an object.")
    return parsed


def normalize_string(value):
    if value is None:
        return ""
    return str(value).strip()


def normalize_email(value):
    return normalize_string(value).lower()


def is_valid_email(email):
    return (
        bool(email)
        and len(email) <= 254
        and "@" in email
        and "." in email.rsplit("@", 1)[-1]
        and not any(char.isspace() for char in email)
    )


def is_truthy(value):
    if value is True:
        return True
    if value is False or value is None:
        return False
    return normalize_string(value).lower() in {"true", "1", "yes"}


def generate_lead_id():
    return "fdm_founder_" + secrets.token_hex(5)


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def clean_expression(expression):
    return " ".join(line.strip() for line in expression.strip().splitlines())


def serialize_item(item):
    return {key: serializer.serialize(value) for key, value in item.items()}


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": cors_headers(),
        "body": json.dumps(body, default=json_default),
    }


def empty_response():
    return {
        "statusCode": 204,
        "headers": cors_headers(),
        "body": "",
    }


def error_response(status_code, code, message, details=None):
    body = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    if details:
        body["error"].update(details)
    return response(status_code, body)


def cors_headers():
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": APP_ORIGIN,
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
    }


class AdminError(Exception):
    def __init__(self, status_code, code, message, details=None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}


def json_default(value):
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    raise TypeError(f"Object of type {value.__class__.__name__} is not JSON serializable")
