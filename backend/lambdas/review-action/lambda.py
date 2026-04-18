import json
import os
import boto3
import hmac
import hashlib
from datetime import datetime

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")
ses = boto3.client("ses", region_name="us-east-1")

TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "")
FROM_EMAIL = os.environ.get("FROM_EMAIL", "info@presttige.net").strip()
OFFER_BASE_URL = os.environ.get("OFFER_BASE_URL", "https://presttige.net/offer.html").strip()
OFFER_TIMESTAMP_FIELD = "offer_sent_at"


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body)
    }


def generate_token(lead_id):
    return hmac.new(
        TOKEN_SECRET.encode(),
        lead_id.encode(),
        hashlib.sha256
    ).hexdigest()


def get_request_value(event, key):
    params = event.get("queryStringParameters") or {}
    if key in params and params.get(key) is not None:
        return str(params.get(key)).strip()

    raw_body = event.get("body") or ""
    if not raw_body:
        return ""

    if event.get("isBase64Encoded"):
        import base64
        raw_body = base64.b64decode(raw_body).decode("utf-8")

    try:
        body = json.loads(raw_body or "{}")
    except Exception:
        return ""

    value = body.get(key)
    if value is None:
        return ""
    return str(value).strip()


def is_true(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y"}


def parse_score(value):
    try:
        score = int(str(value).strip())
    except Exception:
        return None

    if 0 <= score <= 3:
        return score
    return None


def normalize_decision(action):
    if action == "approve":
        return "approve"
    if action == "reject":
        return "reject"
    if action in {"hold", "standby"}:
        return "hold"
    return ""


def normalize_reason(value):
    return " ".join(str(value).strip().split())


def send_offer_email(email, name, offer_link):
    ses.send_email(
        Source=FROM_EMAIL,
        Destination={"ToAddresses": [email]},
        Message={
            "Subject": {
                "Data": "Your private Presttige invitation is now open"
            },
            "Body": {
                "Html": {
                    "Data": f"""
                    <div style="background:#050505;color:#f4f1eb;padding:40px;font-family:Arial,sans-serif;">
                      <div style="max-width:620px;margin:0 auto;">
                        <h2 style="margin-bottom:16px;">Your private invitation is ready</h2>

                        <p>Hello {name},</p>

                        <p>Your Presttige private offer is now active.</p>

                        <p>This invitation remains valid for 72 hours from the moment it is issued.</p>

                        <div style="margin:32px 0;">
                          <a href="{offer_link}"
                             style="display:inline-block;padding:14px 24px;background:#d1ae72;color:#0d0d0d;text-decoration:none;border-radius:999px;font-weight:600;">
                            Open Private Offer
                          </a>
                        </div>

                        <p style="font-size:14px;opacity:0.7;">
                          If your invitation expires, a new cycle must be issued manually.
                        </p>
                      </div>
                    </div>
                    """
                }
            }
        }
    )


def lambda_handler(event, context):
    try:
        if not TOKEN_SECRET:
            return response(500, {"error": "config_error"})

        lead_id = get_request_value(event, "lead_id")
        action = get_request_value(event, "action").lower()
        new_cycle = is_true(get_request_value(event, "new_cycle"))
        reviewer_id = get_request_value(event, "reviewer_id")
        decision_reason = normalize_reason(get_request_value(event, "decision_reason"))
        score_a = parse_score(get_request_value(event, "score_a"))
        score_b = parse_score(get_request_value(event, "score_b"))
        score_c = parse_score(get_request_value(event, "score_c"))
        decision = normalize_decision(action)

        if not lead_id or not action:
            return response(400, {"error": "missing_parameters"})

        if not reviewer_id or not decision_reason:
            return response(400, {"error": "missing_review_fields"})

        if score_a is None or score_b is None or score_c is None:
            return response(400, {"error": "invalid_scores"})

        if not decision:
            return response(400, {"error": "invalid_action"})

        db_response = table.get_item(Key={"lead_id": lead_id})
        item = db_response.get("Item")

        if not item:
            return response(404, {"error": "lead_not_found"})

        now = datetime.utcnow().isoformat()
        total_score = score_a + score_b + score_c

        if action == "approve":
            email = (item.get("email") or "").strip().lower()
            name = (item.get("name") or "Presttige Member").strip()

            if not email:
                return response(400, {"error": "missing_email"})

            existing_offer_sent_at = (item.get(OFFER_TIMESTAMP_FIELD) or "").strip()
            offer_sent_at = now if new_cycle or not existing_offer_sent_at else existing_offer_sent_at

            token = generate_token(lead_id)
            offer_link = (
                f"{OFFER_BASE_URL}?lead_id={lead_id}&token={token}"
            )

            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET review_status = :approved,
                        decision = :decision,
                        decision_reason = :decision_reason,
                        reviewer_id = :reviewer_id,
                        reviewed_at = :reviewed_at,
                        score_a = :score_a,
                        score_b = :score_b,
                        score_c = :score_c,
                        total_score = :total_score,
                        access_status = :invited,
                        invitation_status = :sent,
                        offer_link = :offer_link,
                        offer_cycle_active = :true,
                        #offer_sent_at = :offer_sent_at,
                        updated_at = :updated_at
                """,
                ExpressionAttributeNames={
                    "#offer_sent_at": OFFER_TIMESTAMP_FIELD
                },
                ExpressionAttributeValues={
                    ":approved": "approved",
                    ":decision": decision,
                    ":decision_reason": decision_reason,
                    ":reviewer_id": reviewer_id,
                    ":reviewed_at": now,
                    ":score_a": score_a,
                    ":score_b": score_b,
                    ":score_c": score_c,
                    ":total_score": total_score,
                    ":invited": "invited",
                    ":sent": "sent",
                    ":offer_link": offer_link,
                    ":true": True,
                    ":offer_sent_at": offer_sent_at,
                    ":updated_at": now
                }
            )

            send_offer_email(email, name, offer_link)

            return response(200, {
                "message": "invitation_sent",
                "lead_id": lead_id,
                "decision": decision,
                "total_score": total_score,
                "offer_sent_at": offer_sent_at,
                "new_cycle": new_cycle
            })

        if action == "reject":
            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET review_status = :rejected,
                        decision = :decision,
                        decision_reason = :decision_reason,
                        reviewer_id = :reviewer_id,
                        reviewed_at = :reviewed_at,
                        score_a = :score_a,
                        score_b = :score_b,
                        score_c = :score_c,
                        total_score = :total_score,
                        updated_at = :updated_at
                """,
                ExpressionAttributeValues={
                    ":rejected": "rejected",
                    ":decision": decision,
                    ":decision_reason": decision_reason,
                    ":reviewer_id": reviewer_id,
                    ":reviewed_at": now,
                    ":score_a": score_a,
                    ":score_b": score_b,
                    ":score_c": score_c,
                    ":total_score": total_score,
                    ":updated_at": now
                }
            )
            return response(200, {
                "message": "lead_rejected",
                "lead_id": lead_id,
                "decision": decision,
                "total_score": total_score
            })

        if action in {"standby", "hold"}:
            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET review_status = :standby,
                        decision = :decision,
                        decision_reason = :decision_reason,
                        reviewer_id = :reviewer_id,
                        reviewed_at = :reviewed_at,
                        score_a = :score_a,
                        score_b = :score_b,
                        score_c = :score_c,
                        total_score = :total_score,
                        updated_at = :updated_at
                """,
                ExpressionAttributeValues={
                    ":standby": "standby",
                    ":decision": decision,
                    ":decision_reason": decision_reason,
                    ":reviewer_id": reviewer_id,
                    ":reviewed_at": now,
                    ":score_a": score_a,
                    ":score_b": score_b,
                    ":score_c": score_c,
                    ":total_score": total_score,
                    ":updated_at": now
                }
            )
            return response(200, {
                "message": "lead_on_hold",
                "lead_id": lead_id,
                "decision": decision,
                "total_score": total_score
            })

    except Exception as e:
        return response(500, {"error": str(e)})
