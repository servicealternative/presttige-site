import json
import boto3
from datetime import datetime
from urllib.parse import parse_qs
from boto3.dynamodb.conditions import Attr

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")

BASE_URL = "https://presttige.net"


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