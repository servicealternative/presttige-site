import json
import os
import logging
import boto3
import hmac
import hashlib
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('presttige-db')

_cached_secret = None


def get_legacy_secret():
    global _cached_secret
    if _cached_secret is not None:
        return _cached_secret

    secret_id = os.environ.get(
        "LEGACY_SECRET_ARN",
        "presttige/stripe-gateway/legacy-secret"
    )
    region = os.environ.get("AWS_REGION", "us-east-1")
    client = boto3.client("secretsmanager", region_name=region)

    try:
        response = client.get_secret_value(SecretId=secret_id)
    except ClientError as exc:
        logger.error("Failed to retrieve legacy secret from Secrets Manager: %s", exc)
        raise

    secret_payload = json.loads(response["SecretString"])
    _cached_secret = secret_payload["SECRET"]
    logger.info("Legacy secret retrieved from Secrets Manager.")
    return _cached_secret


def generate_token(lead_id):
    secret = get_legacy_secret()
    return hmac.new(
        secret.encode(),
        lead_id.encode(),
        hashlib.sha256
    ).hexdigest()


def lambda_handler(event, context):
    try:
        params = event.get("queryStringParameters") or {}

        lead_id = params.get("id")
        token = params.get("token")

        if not lead_id or not token:
            return {
                "statusCode": 400,
                "body": "Missing parameters"
            }

        # validar token
        expected_token = generate_token(lead_id)

        if token != expected_token:
            return {
                "statusCode": 403,
                "body": "Invalid token"
            }

        # buscar na DB
        response = table.get_item(Key={"lead_id": lead_id})
        item = response.get("Item")

        if not item:
            return {
                "statusCode": 404,
                "body": "Lead not found"
            }

        if item.get("payment_status") == "paid":
            return {
                "statusCode": 400,
                "body": "Already paid"
            }

        # para ja so validar (Stripe vem ja a seguir)
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Gateway validated",
                "lead_id": lead_id,
                "email": item.get("email"),
                "name": item.get("name")
            })
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "body": str(e)
        }
