import os
import json
import boto3
from datetime import datetime
from urllib.parse import urlencode
from boto3.dynamodb.conditions import Attr


dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")

ACCESS_FORM_URL = os.environ.get("ACCESS_FORM_URL", "https://presttige.net/access-form.html").strip()


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def redirect(location):
    return {
        "statusCode": 302,
        "headers": {
            "Location": location,
            "Cache-Control": "no-store",
        },
    }


def lambda_handler(event, context):
    try:
        params = event.get("queryStringParameters") or {}
        token = (params.get("token") or "").strip()

        if not token:
            return response(400, {"error": "missing_token"})

        scan_response = table.scan(
            FilterExpression=Attr("verification_token").eq(token),
        )
        items = scan_response.get("Items") or []

        if not items:
            return response(404, {"error": "lead_not_found"})

        lead = items[0]
        lead_id = (lead.get("lead_id") or "").strip()
        country = (lead.get("country") or "").strip()

        if not lead_id:
            return response(500, {"error": "invalid_lead_record"})

        now = datetime.utcnow().isoformat()
        update_kwargs = {
            "Key": {"lead_id": lead_id},
            "UpdateExpression": "SET email_status = :verified, profile_status = :step_2, updated_at = :updated_at",
            "ExpressionAttributeValues": {
                ":verified": "verified",
                ":step_2": "step_2",
                ":updated_at": now,
            },
        }

        if not lead.get("email_verified_at"):
            update_kwargs["UpdateExpression"] += ", email_verified_at = :email_verified_at"
            update_kwargs["ExpressionAttributeValues"][":email_verified_at"] = now

        table.update_item(**update_kwargs)

        redirect_params = {"lead_id": lead_id}
        if country:
            redirect_params["country"] = country

        return redirect(f"{ACCESS_FORM_URL}?{urlencode(redirect_params)}")

    except Exception as e:
        return response(500, {"error": str(e)})
