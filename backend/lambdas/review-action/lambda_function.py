import boto3
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from boto3.dynamodb.conditions import Attr, Key

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")
audit_table = dynamodb.Table("presttige-review-audit")

DELAY_HOURS = 12
VALIDITY_HOURS = 72
REVIEWER_ID = "Antonio"
# Audit attribution stays explicit so review actions remain traceable across automated deploys.


def lambda_handler(event, context):
    try:
        params = event.get("queryStringParameters") or {}

        action = (params.get("action") or "").strip().lower()
        lead_id = (params.get("lead_id") or "").strip()
        review_token = (params.get("review_token") or "").strip()

        if not action or not lead_id or not review_token:
            return html_response("Missing parameters")

        res = table.get_item(Key={"lead_id": lead_id})
        item = res.get("Item")

        if not item:
            return html_response("Lead not found")

        if item.get("review_token") != review_token:
            return html_response("Invalid review token")

        if action not in ("approve", "reject", "standby", "requeue"):
            return html_response("Invalid action", status_code=400)

        if item.get("review_status") != "pending":
            return html_response(
                "Review action already processed",
                "This application is no longer pending review.",
                status_code=409,
            )

        existing_audit = audit_table.query(
            IndexName="lead-id-index",
            KeyConditionExpression=Key("lead_id").eq(lead_id),
            FilterExpression=Attr("token_used").eq(review_token),
        )

        if existing_audit.get("Items"):
            return html_response(
                "Review action already processed",
                "This review token has already been used.",
                status_code=409,
            )

        now = int(time.time())
        audit_timestamp = datetime.now(timezone.utc).isoformat()
        previous_cycle = item.get("approval_cycle", Decimal(0))
        is_test = bool(item.get("is_test", False))

        metadata = build_metadata(event, context)
        audit_action = "requeue" if action == "standby" else action

        if action == "approve":
            invite_send_at = now + (DELAY_HOURS * 60 * 60)
            invite_expires_at = invite_send_at + (VALIDITY_HOURS * 60 * 60)
            reminder_due_at = invite_send_at + (48 * 60 * 60)
            new_cycle = previous_cycle

            write_audit_entry(
                lead_id=lead_id,
                action=audit_action,
                token_used=review_token,
                timestamp=audit_timestamp,
                previous_state={
                    "review_status": item.get("review_status", ""),
                    "approval_cycle": previous_cycle,
                    "review_cycle": previous_cycle,
                },
                new_state={
                    "review_status": "approved",
                    "approval_cycle": new_cycle,
                    "review_cycle": new_cycle,
                },
                metadata=metadata,
                is_test=is_test,
            )
            reviewed_at = datetime.now(timezone.utc).isoformat()

            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET review_status = :review_status,
                        token_status = :token_status,
                        reviewed_at = :reviewed_at,
                        updated_at = :updated_at,
                        invite_status = :invite_status,
                        invite_send_at = :invite_send_at,
                        invite_expires_at = :invite_expires_at,
                        reminder_due_at = :reminder_due_at,
                        reinvite_eligible = :reinvite_eligible,
                        reinvite_count = if_not_exists(reinvite_count, :zero),
                        review_token_status = :review_token_status,
                        review_token_used_at = :review_token_used_at
                """,
                ExpressionAttributeValues={
                    ":review_status": "approved",
                    ":token_status": "active",
                    ":reviewed_at": reviewed_at,
                    ":updated_at": reviewed_at,
                    ":invite_status": "scheduled",
                    ":invite_send_at": Decimal(invite_send_at),
                    ":invite_expires_at": Decimal(invite_expires_at),
                    ":reminder_due_at": Decimal(reminder_due_at),
                    ":reinvite_eligible": True,
                    ":review_token_status": "used",
                    ":review_token_used_at": reviewed_at,
                    ":zero": Decimal(0),
                }
            )

            return html_response("APPROVED")

        elif action == "reject":
            write_audit_entry(
                lead_id=lead_id,
                action=audit_action,
                token_used=review_token,
                timestamp=audit_timestamp,
                previous_state={
                    "review_status": item.get("review_status", ""),
                    "approval_cycle": previous_cycle,
                    "review_cycle": previous_cycle,
                },
                new_state={
                    "review_status": "rejected",
                    "approval_cycle": previous_cycle,
                    "review_cycle": previous_cycle,
                },
                metadata=metadata,
                is_test=is_test,
            )
            reviewed_at = datetime.now(timezone.utc).isoformat()

            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET review_status = :review_status,
                        token_status = :token_status,
                        reviewed_at = :reviewed_at,
                        updated_at = :updated_at,
                        invite_status = :invite_status,
                        reinvite_eligible = :reinvite_eligible,
                        review_token_status = :review_token_status,
                        review_token_used_at = :review_token_used_at
                """,
                ExpressionAttributeValues={
                    ":review_status": "rejected",
                    ":token_status": "inactive",
                    ":reviewed_at": reviewed_at,
                    ":updated_at": reviewed_at,
                    ":invite_status": "closed",
                    ":reinvite_eligible": False,
                    ":review_token_status": "used",
                    ":review_token_used_at": reviewed_at,
                }
            )

            return html_response("REJECTED")

        elif action in ("standby", "requeue"):
            write_audit_entry(
                lead_id=lead_id,
                action="requeue",
                token_used=review_token,
                timestamp=audit_timestamp,
                previous_state={
                    "review_status": item.get("review_status", ""),
                    "approval_cycle": previous_cycle,
                    "review_cycle": previous_cycle,
                },
                new_state={
                    "review_status": "standby",
                    "approval_cycle": previous_cycle,
                    "review_cycle": previous_cycle,
                },
                metadata=metadata,
                is_test=is_test,
            )
            reviewed_at = datetime.now(timezone.utc).isoformat()

            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET review_status = :review_status,
                        token_status = :token_status,
                        reviewed_at = :reviewed_at,
                        updated_at = :updated_at,
                        invite_status = :invite_status,
                        review_token_status = :review_token_status,
                        review_token_used_at = :review_token_used_at
                """,
                ExpressionAttributeValues={
                    ":review_status": "standby",
                    ":token_status": "inactive",
                    ":reviewed_at": reviewed_at,
                    ":updated_at": reviewed_at,
                    ":invite_status": "standby",
                    ":review_token_status": "used",
                    ":review_token_used_at": reviewed_at,
                }
            )

            return html_response("STANDBY")

    except Exception as e:
        return html_response(f"Error: {str(e)}", status_code=500)


def build_metadata(event, context):
    headers = event.get("headers") or {}
    request_context = event.get("requestContext") or {}
    http_context = request_context.get("http") or {}
    source_ip = (
        http_context.get("sourceIp")
        or request_context.get("identity", {}).get("sourceIp")
        or headers.get("x-forwarded-for", "").split(",")[0].strip()
    )
    return {
        "ip": source_ip or "",
        "user_agent": headers.get("user-agent") or headers.get("User-Agent") or "",
        "request_id": request_context.get("requestId") or getattr(context, "aws_request_id", ""),
    }


def write_audit_entry(lead_id, action, token_used, timestamp, previous_state, new_state, metadata, is_test=False):
    audit_table.put_item(
        Item={
            "audit_id": str(uuid.uuid4()),
            "timestamp": timestamp,
            "lead_id": lead_id,
            "action": action,
            "reviewer_id": REVIEWER_ID,
            "token_used": token_used,
            "previous_state": previous_state,
            "new_state": new_state,
            "metadata": metadata,
            "is_test": is_test,
        },
        ConditionExpression="attribute_not_exists(audit_id)",
    )


def html_response(message: str, detail: str = "Presttige review action processed.", status_code: int = 200):
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
