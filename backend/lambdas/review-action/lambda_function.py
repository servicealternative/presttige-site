import boto3
import time
from decimal import Decimal

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")

DELAY_HOURS = 12
VALIDITY_HOURS = 72

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

        now = int(time.time())

        if action == "approve":
            invite_send_at = now + (DELAY_HOURS * 60 * 60)
            invite_expires_at = invite_send_at + (VALIDITY_HOURS * 60 * 60)
            reminder_due_at = invite_send_at + (48 * 60 * 60)

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
                        approval_cycle = if_not_exists(approval_cycle, :zero) + :one
                """,
                ExpressionAttributeValues={
                    ":review_status": "approved",
                    ":token_status": "active",
                    ":reviewed_at": str(now),
                    ":updated_at": str(now),
                    ":invite_status": "scheduled",
                    ":invite_send_at": Decimal(invite_send_at),
                    ":invite_expires_at": Decimal(invite_expires_at),
                    ":reminder_due_at": Decimal(reminder_due_at),
                    ":reinvite_eligible": True,
                    ":zero": Decimal(0),
                    ":one": Decimal(1),
                }
            )

            return html_response("APPROVED")

        elif action == "reject":
            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET review_status = :review_status,
                        token_status = :token_status,
                        reviewed_at = :reviewed_at,
                        updated_at = :updated_at,
                        invite_status = :invite_status,
                        reinvite_eligible = :reinvite_eligible
                """,
                ExpressionAttributeValues={
                    ":review_status": "rejected",
                    ":token_status": "inactive",
                    ":reviewed_at": str(now),
                    ":updated_at": str(now),
                    ":invite_status": "closed",
                    ":reinvite_eligible": False,
                }
            )

            return html_response("REJECTED")

        elif action == "standby":
            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET review_status = :review_status,
                        token_status = :token_status,
                        reviewed_at = :reviewed_at,
                        updated_at = :updated_at,
                        invite_status = :invite_status
                """,
                ExpressionAttributeValues={
                    ":review_status": "standby",
                    ":token_status": "inactive",
                    ":reviewed_at": str(now),
                    ":updated_at": str(now),
                    ":invite_status": "standby",
                }
            )

            return html_response("STANDBY")

        else:
            return html_response("Invalid action")

    except Exception as e:
        return html_response(f"Error: {str(e)}")


def html_response(message: str):
    return {
        "statusCode": 200,
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
              <p>Presttige review action processed.</p>
            </div>
          </body>
        </html>
        """
    }