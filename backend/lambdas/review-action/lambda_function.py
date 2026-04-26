import base64
import boto3
import json
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer

dynamodb = boto3.resource("dynamodb")
ddb_client = boto3.client("dynamodb")
lambda_client = boto3.client("lambda")
table = dynamodb.Table("presttige-db")

DELAY_HOURS = 12
VALIDITY_HOURS = 72
REVIEWER_ID = "committee"
VALID_ACTIONS = {"approve", "reject", "standby"}
ACCOUNT_CREATE_FUNCTION = "presttige-account-create"
serializer = TypeSerializer()


def lambda_handler(event, context):
    try:
        payload = parse_payload(event)
        action = (payload.get("action") or "").strip().lower()
        token = (payload.get("token") or payload.get("review_token") or "").strip()
        lead_id = (payload.get("lead_id") or "").strip()
        note = normalize_note(payload.get("note"))
        wants_html = request_method(event) == "GET"

        if action not in VALID_ACTIONS:
            return respond(wants_html, 400, {"error": "Invalid action", "valid": sorted(VALID_ACTIONS)})

        lead = find_lead(token=token, lead_id=lead_id)
        if not lead:
            return respond(wants_html, 404, {"error": "Token not found"})

        if lead.get("review_token_status") == "used":
            return respond(
                wants_html,
                410,
                {
                    "error": "Token already used",
                    "decision": lead.get("review_status"),
                    "reviewed_at": lead.get("reviewed_at"),
                },
            )

        if lead.get("review_status") not in (None, "", "pending"):
            return respond(
                wants_html,
                410,
                {
                    "error": "Application already reviewed",
                    "decision": lead.get("review_status"),
                    "reviewed_at": lead.get("reviewed_at"),
                },
            )

        source_ip, user_agent = build_request_metadata(event, context)
        reviewed_at = datetime.now(timezone.utc).isoformat()
        decision = map_decision(action)
        audit_item = build_audit_item(lead, token, decision, note, reviewed_at, source_ip, user_agent)
        update_spec = build_lead_update(lead, decision, note, reviewed_at)

        transact_review(audit_item, lead["lead_id"], update_spec)

        if decision == "approved":
            trigger_account_create_async(lead["lead_id"])

        return respond(wants_html, 200, {"decision": decision, "recorded_at": reviewed_at})
    except ddb_client.exceptions.TransactionCanceledException:
        return respond(False, 410, {"error": "Token already consumed (race)"})
    except Exception as exc:
        return respond(False, 500, {"error": "Internal error", "detail": str(exc)})


def parse_payload(event):
    payload = {}

    body = event.get("body")
    if body:
        if event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        try:
            payload.update(json.loads(body or "{}"))
        except json.JSONDecodeError:
            pass

    payload.update(event.get("queryStringParameters") or {})
    return payload


def request_method(event):
    return (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or "POST"
    ).upper()


def normalize_note(value):
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned[:2000] if cleaned else None


def find_lead(token, lead_id=""):
    if lead_id:
        item = table.get_item(Key={"lead_id": lead_id}).get("Item")
        if item and item.get("review_token") == token:
            return item
        return None

    scan_kwargs = {
        "FilterExpression": "review_token = :token",
        "ExpressionAttributeValues": {":token": token},
    }

    while True:
        result = table.scan(**scan_kwargs)
        items = result.get("Items") or []
        if items:
            return items[0]

        last_evaluated_key = result.get("LastEvaluatedKey")
        if not last_evaluated_key:
            return None

        scan_kwargs["ExclusiveStartKey"] = last_evaluated_key


def map_decision(action):
    if action == "approve":
        return "approved"
    if action == "reject":
        return "rejected"
    return "standby"


def build_request_metadata(event, context):
    headers = event.get("headers") or {}
    request_context = event.get("requestContext") or {}
    http_context = request_context.get("http") or {}
    source_ip = (
        http_context.get("sourceIp")
        or request_context.get("identity", {}).get("sourceIp")
        or headers.get("x-forwarded-for", "").split(",")[0].strip()
    )
    user_agent = headers.get("user-agent") or headers.get("User-Agent") or ""
    return source_ip or "unknown", user_agent or "unknown"


def build_audit_item(lead, token, decision, note, reviewed_at, source_ip, user_agent):
    previous_cycle = lead.get("approval_cycle", Decimal(0))
    return {
        "audit_id": str(uuid.uuid4()),
        "timestamp": reviewed_at,
        "lead_id": lead["lead_id"],
        "action": decision,
        "decision": decision,
        "note": note,
        "reviewer_id": REVIEWER_ID,
        "token_used": token,
        "review_attempt_id": lead.get("review_attempt_id"),
        "source_ip": source_ip,
        "user_agent": user_agent,
        "metadata": {
            "ip": source_ip,
            "user_agent": user_agent,
        },
        "previous_state": {
            "review_status": lead.get("review_status", ""),
            "approval_cycle": previous_cycle,
            "review_cycle": previous_cycle,
        },
        "new_state": {
            "review_status": decision,
            "approval_cycle": previous_cycle,
            "review_cycle": previous_cycle,
        },
        "is_test": bool(lead.get("is_test", False)),
    }


def build_lead_update(lead, decision, note, reviewed_at):
    expressions = [
        "review_token_status = :used",
        "review_token_used_at = :reviewed_at",
        "review_status = :review_status",
        "reviewed_at = :reviewed_at",
        "updated_at = :updated_at",
        "review_note = :review_note",
    ]
    values = {
        ":used": "used",
        ":active": "active",
        ":review_status": decision,
        ":reviewed_at": reviewed_at,
        ":updated_at": reviewed_at,
        ":review_note": note,
    }

    if decision == "approved":
        now_epoch = int(time.time())
        invite_send_at = now_epoch + (DELAY_HOURS * 60 * 60)
        invite_expires_at = invite_send_at + (VALIDITY_HOURS * 60 * 60)
        reminder_due_at = invite_send_at + (48 * 60 * 60)
        expressions.extend(
            [
                "token_status = :token_status",
                "invite_status = :invite_status",
                "invite_send_at = :invite_send_at",
                "invite_expires_at = :invite_expires_at",
                "reminder_due_at = :reminder_due_at",
                "reinvite_eligible = :reinvite_eligible",
                "reinvite_count = if_not_exists(reinvite_count, :zero)",
            ]
        )
        values.update(
            {
                ":token_status": "active",
                ":invite_status": "scheduled",
                ":invite_send_at": Decimal(invite_send_at),
                ":invite_expires_at": Decimal(invite_expires_at),
                ":reminder_due_at": Decimal(reminder_due_at),
                ":reinvite_eligible": True,
                ":zero": Decimal(0),
            }
        )
    elif decision == "rejected":
        expressions.extend(
            [
                "token_status = :token_status",
                "invite_status = :invite_status",
                "reinvite_eligible = :reinvite_eligible",
            ]
        )
        values.update(
            {
                ":token_status": "inactive",
                ":invite_status": "closed",
                ":reinvite_eligible": False,
            }
        )
    else:
        expressions.extend(
            [
                "token_status = :token_status",
                "invite_status = :invite_status",
            ]
        )
        values.update(
            {
                ":token_status": "inactive",
                ":invite_status": "standby",
            }
        )

    return {
        "UpdateExpression": "SET " + ", ".join(expressions),
        "ConditionExpression": "review_token_status = :active",
        "ExpressionAttributeValues": values,
    }


def transact_review(audit_item, lead_id, update_spec):
    ddb_client.transact_write_items(
        TransactItems=[
            {
                "Put": {
                    "TableName": "presttige-review-audit",
                    "Item": serialize_item(audit_item),
                    "ConditionExpression": "attribute_not_exists(audit_id)",
                }
            },
            {
                "Update": {
                    "TableName": "presttige-db",
                    "Key": serialize_item({"lead_id": lead_id}),
                    "UpdateExpression": update_spec["UpdateExpression"],
                    "ConditionExpression": update_spec["ConditionExpression"],
                    "ExpressionAttributeValues": serialize_item(update_spec["ExpressionAttributeValues"]),
                }
            },
        ]
    )


def trigger_account_create_async(lead_id):
    try:
        lambda_client.invoke(
            FunctionName=ACCOUNT_CREATE_FUNCTION,
            InvocationType="Event",
            Payload=json.dumps({"body": json.dumps({"lead_id": lead_id})}).encode("utf-8"),
        )
    except Exception as exc:
        print(f"account-create async invoke failed for {lead_id}: {exc}")


def serialize_item(item):
    return {key: serializer.serialize(value) for key, value in item.items()}


def html_response(message, detail="Presttige review action processed.", status_code=200):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "text/html"
        },
        "body": f"""
        <html>
          <head>
            <title>Presttige Review</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body {{
                margin: 0;
                background: #0b0b0c;
                color: #f4f1eb;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                text-align: center;
                padding: 24px;
              }}
              .box {{
                max-width: 560px;
                width: 100%;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 24px;
                padding: 40px 28px;
              }}
              h2 {{
                margin: 0 0 12px;
                font-size: 2rem;
                letter-spacing: -0.03em;
              }}
              p {{
                margin: 0;
                color: rgba(244,241,235,0.72);
                line-height: 1.7;
              }}
            </style>
          </head>
          <body>
            <div class="box">
              <h2>{message}</h2>
              <p>{detail}</p>
            </div>
          </body>
        </html>
        """
    }


def json_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "https://presttige.net",
        },
        "body": json.dumps(body),
    }


def respond(wants_html, status_code, body):
    if wants_html:
        if status_code == 200:
            return html_response(body.get("decision", "Recorded").upper(), "Presttige review action processed.", status_code)
        detail = body.get("error") or body.get("detail") or "Presttige review action could not be processed."
        return html_response("Review action unavailable", detail, status_code)
    return json_response(status_code, body)
