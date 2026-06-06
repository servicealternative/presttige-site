import json
import os
import sys
import boto3
import hashlib
from pathlib import Path
from datetime import datetime
from urllib.parse import parse_qs
from boto3.dynamodb.conditions import Attr

CURRENT_FILE = Path(__file__).resolve()
for candidate in (CURRENT_FILE.parent, *CURRENT_FILE.parents):
    candidate_str = str(candidate)
    if (candidate / "shared").exists() and candidate_str not in sys.path:
        sys.path.append(candidate_str)

from shared.testers import (
    get_tester_email_for_verification_token,
    get_tester_lead_id,
    log_tester_event,
)

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")

BASE_URL = "https://presttige.net"
TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "").strip()


def short_hash(value):
    text = str(value or "").strip()
    if not text:
        return ""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def log_verify(status, **metadata):
    safe_metadata = {key: value for key, value in metadata.items() if value not in (None, "")}
    print(json.dumps({"event": "verify_email", "status": status, **safe_metadata}, sort_keys=True))


def lambda_handler(event, context):
    try:
        params = event.get("queryStringParameters") or {}
        token = params.get("token")

        # Some integrations pass the token through rawQueryString instead.
        if not token:
            raw_query = event.get("rawQueryString") or ""
            parsed = parse_qs(raw_query)
            token_list = parsed.get("token") or []
            token = token_list[0] if token_list else None

        if not token:
            log_verify("missing_token")
            return redirect(f"{BASE_URL}/check-email.html?error=missing_token")

        token_hash = short_hash(token)
        tester_email = get_tester_email_for_verification_token(token, TOKEN_SECRET)
        if tester_email:
            lead_id = get_tester_lead_id(tester_email)
            log_tester_event(
                event_name="verify_email",
                email=tester_email,
                extra={
                    "lead_id": lead_id,
                    "delay_bypassed": True,
                    "immediate_processing": True,
                },
            )
            log_verify("tester_verified", token_hash=token_hash, lead_hash=short_hash(lead_id))
            return redirect(f"{BASE_URL}/access-form.html?lead_id={lead_id}")

        response = table.scan(
            FilterExpression=Attr("verification_token").eq(token),
            ConsistentRead=True
        )

        items = response.get("Items", [])

        if not items:
            log_verify("invalid_token", token_hash=token_hash)
            return redirect(f"{BASE_URL}/check-email.html?error=invalid_token")

        lead = items[0]
        lead_id = lead.get("lead_id")
        current_email_status = lead.get("email_status", "pending")

        if not lead_id:
            log_verify("invalid_lead", token_hash=token_hash)
            return redirect(f"{BASE_URL}/check-email.html?error=invalid_lead")

        lead_hash = short_hash(lead_id)

        # If already verified, continue directly to the form.
        if current_email_status != "verified":
            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="SET email_status = :s, updated_at = :u",
                ExpressionAttributeValues={
                    ":s": "verified",
                    ":u": datetime.utcnow().isoformat()
                }
            )
            log_verify("verified", token_hash=token_hash, lead_hash=lead_hash)
        else:
            log_verify("already_verified", token_hash=token_hash, lead_hash=lead_hash)

        return redirect(f"{BASE_URL}/access-form.html?lead_id={lead_id}")

    except Exception as e:
        log_verify("server_error", error_type=type(e).__name__)
        return redirect(f"{BASE_URL}/check-email.html?error=server_error")


def redirect(url):
    return {
        "statusCode": 302,
        "headers": {
            "Location": url,
            "Cache-Control": "no-store"
        },
        "body": ""
    }
