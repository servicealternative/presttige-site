import json
import os
import sys
import boto3
from pathlib import Path
from datetime import datetime
from urllib.parse import parse_qs, urlencode
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

CURRENT_FILE = Path(__file__).resolve()
for candidate in (CURRENT_FILE.parent, *CURRENT_FILE.parents):
    candidate_str = str(candidate)
    if (candidate / "shared").exists() and candidate_str not in sys.path:
        sys.path.append(candidate_str)

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")

BASE_URL = "https://presttige.net"


def as_text(value):
    if value is None:
        return ""
    return str(value).strip()


def build_access_form_redirect(lead_id, country="", preview_mode=False):
    redirect_params = {"lead_id": lead_id}
    if country:
        redirect_params["country"] = country
    if preview_mode:
        redirect_params["preview"] = "1"
    return redirect(f"{BASE_URL}/access-form.html?{urlencode(redirect_params)}")


def build_already_used_redirect(preview_mode=False):
    params = {"error": "already_used"}
    if preview_mode:
        params["preview"] = "1"
    return redirect(f"{BASE_URL}/verify-email.html?{urlencode(params)}")


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

        response = table.scan(
            FilterExpression=Attr("verification_token").eq(token),
            ConsistentRead=True
        )

        print("VERIFY EMAIL SCAN RESPONSE:", json.dumps(response, default=str))

        items = response.get("Items", [])

        if not items:
            return redirect(f"{BASE_URL}/check-email.html?error=invalid_token")

        lead = items[0]
        lead_id = as_text(lead.get("lead_id"))
        country = as_text(lead.get("country"))
        preview_mode = bool(lead.get("preview_mode"))
        current_email_status = as_text(lead.get("email_status") or "pending")
        token_status = as_text(lead.get("verification_token_status") or "active").lower()

        print("VERIFY EMAIL LEAD ID:", lead_id)
        print("VERIFY EMAIL CURRENT STATUS:", current_email_status)
        print("VERIFY EMAIL TOKEN STATUS:", token_status)

        if not lead_id:
            return redirect(f"{BASE_URL}/check-email.html?error=invalid_lead")

        if current_email_status == "verified" or token_status == "used":
            return build_already_used_redirect(preview_mode)

        now = datetime.utcnow().isoformat()
        update_kwargs = {
            "Key": {"lead_id": lead_id},
            "ConditionExpression": "verification_token = :token AND (attribute_not_exists(verification_token_status) OR verification_token_status <> :used)",
            "UpdateExpression": "SET email_status = :status, profile_status = :profile_status, verification_token_status = :used, verification_token_used_at = :used_at, updated_at = :updated_at",
            "ExpressionAttributeValues": {
                ":token": token,
                ":status": "verified",
                ":profile_status": "step_2",
                ":used": "used",
                ":used_at": now,
                ":updated_at": now,
            },
        }
        if not lead.get("email_verified_at"):
            update_kwargs["UpdateExpression"] += ", email_verified_at = :verified_at"
            update_kwargs["ExpressionAttributeValues"][":verified_at"] = now

        try:
            table.update_item(**update_kwargs)
            print("VERIFY EMAIL UPDATED SUCCESSFULLY")
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                return build_already_used_redirect(preview_mode)
            raise

        return build_access_form_redirect(lead_id, country, preview_mode)

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
