import json
import os
import sys
import boto3
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


def lambda_handler(event, context):
    try:
        print("VERIFY EMAIL EVENT:", json.dumps(event))

        params = event.get("queryStringParameters") or {}
        token = params.get("token")

        # Fallback extra para casos em que o token não venha em queryStringParameters
        if not token:
            raw_query = event.get("rawQueryString") or ""
            parsed = parse_qs(raw_query)
            token_list = parsed.get("token") or []
            token = token_list[0] if token_list else None

        print("VERIFY EMAIL TOKEN:", token)

        if not token:
            return redirect(f"{BASE_URL}/check-email.html?error=missing_token")

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
            return redirect(f"{BASE_URL}/access-form.html?lead_id={lead_id}")

        response = table.scan(
            FilterExpression=Attr("verification_token").eq(token),
            ConsistentRead=True
        )

        print("VERIFY EMAIL SCAN RESPONSE:", json.dumps(response, default=str))

        items = response.get("Items", [])

        if not items:
            return redirect(f"{BASE_URL}/check-email.html?error=invalid_token")

        lead = items[0]
        lead_id = lead.get("lead_id")
        current_email_status = lead.get("email_status", "pending")

        print("VERIFY EMAIL LEAD ID:", lead_id)
        print("VERIFY EMAIL CURRENT STATUS:", current_email_status)

        if not lead_id:
            return redirect(f"{BASE_URL}/check-email.html?error=invalid_lead")

        # Se já estiver verificado, segue diretamente para o form
        if current_email_status != "verified":
            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="SET email_status = :s, updated_at = :u",
                ExpressionAttributeValues={
                    ":s": "verified",
                    ":u": datetime.utcnow().isoformat()
                }
            )
            print("VERIFY EMAIL UPDATED SUCCESSFULLY")

        return redirect(f"{BASE_URL}/access-form.html?lead_id={lead_id}")

    except Exception as e:
        print("VERIFY EMAIL ERROR:", str(e))
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
