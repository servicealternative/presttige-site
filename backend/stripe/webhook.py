import json
import os
import base64
import boto3

try:
    import stripe
    STRIPE_IMPORT_OK = True
    STRIPE_IMPORT_ERROR = None
except Exception as e:
    stripe = None
    STRIPE_IMPORT_OK = False
    STRIPE_IMPORT_ERROR = str(e)

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table("presttige-db")

STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()

if STRIPE_IMPORT_OK:
    stripe.api_key = STRIPE_SECRET_KEY


def response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json"
        },
        "body": json.dumps(body)
    }


def lambda_handler(event, context):
    try:
        if not STRIPE_IMPORT_OK:
            return response(500, {
                "error": "stripe_import_error",
                "message": STRIPE_IMPORT_ERROR
            })

        if not STRIPE_SECRET_KEY:
            return response(500, {
                "error": "config_error",
                "message": "STRIPE_SECRET_KEY not configured"
            })

        if not STRIPE_WEBHOOK_SECRET:
            return response(500, {
                "error": "config_error",
                "message": "STRIPE_WEBHOOK_SECRET not configured"
            })

        headers = event.get("headers") or {}
        sig_header = headers.get("Stripe-Signature") or headers.get("stripe-signature")

        if not sig_header:
            return response(400, {
                "error": "missing_signature",
                "message": "Missing Stripe-Signature header"
            })

        raw_body = event.get("body", "")

        if event.get("isBase64Encoded", False):
            payload = base64.b64decode(raw_body)
        else:
            payload = raw_body.encode("utf-8")

        webhook_event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=STRIPE_WEBHOOK_SECRET
        )

        event_type = webhook_event["type"]

        if event_type == "checkout.session.completed":
            session = webhook_event["data"]["object"]

            lead_id = session["client_reference_id"] if "client_reference_id" in session else None
            subscription_id = session["subscription"] if "subscription" in session else ""
            customer_id = session["customer"] if "customer" in session else ""

            metadata = session["metadata"] if "metadata" in session else {}
            product = metadata["product"] if "product" in metadata else ""
            plan = metadata["plan"] if "plan" in metadata else ""
            term = metadata["term"] if "term" in metadata else ""
            referral_code = metadata["referral_code"] if "referral_code" in metadata else "unknown"

            if product == "founder":
                commission_rate = 0.15
            elif product == "access":
                commission_rate = 0.12
            elif product == "membership":
                commission_rate = 0.12
            else:
                commission_rate = 0

            amount_paid = session["amount_total"] / 100 if "amount_total" in session else 0
            commission_amount = amount_paid * commission_rate
            partner_id = referral_code

            if not lead_id:
                return response(400, {
                    "error": "missing_lead_id",
                    "message": "client_reference_id missing"
                })

            table.update_item(
                Key={"lead_id": lead_id},
                UpdateExpression="""
                    SET payment_status = :paid,
                        access_status = :active,
                        stripe_checkout_completed = :true,
                        stripe_subscription_id = :subscription_id,
                        stripe_customer_id = :customer_id,
                        referral_code = :referral_code,
                        #product = :product,
                        #plan = :plan,
                        #term = :term
                """,
                ExpressionAttributeNames={
                    "#product": "product",
                    "#plan": "plan",
                    "#term": "term"
                },
                ExpressionAttributeValues={
                    ":paid": "paid",
                    ":active": "active",
                    ":true": True,
                    ":subscription_id": subscription_id,
                    ":customer_id": customer_id,
                    ":referral_code": referral_code,
                    ":product": product,
                    ":plan": plan,
                    ":term": term
                }
            )

            table.put_item(
                Item={
                    "pk": f"PARTNER#{partner_id}",
                    "sk": f"EARNING#{session['id']}",
                    "lead_id": lead_id,
                    "referral_code": referral_code,
                    "project_id": "presttige",
                    "project_name": "Presttige",
                    "product": product,
                    "amount_paid": amount_paid,
                    "commission_rate": commission_rate,
                    "commission_amount": commission_amount,
                    "status": "earned",
                    "created_at": session["created"]
                }
            )

            return response(200, {
                "received": True,
                "updated_lead_id": lead_id,
                "event_type": event_type
            })

        return response(200, {
            "received": True,
            "ignored_event_type": event_type
        })

    except stripe.error.SignatureVerificationError as e:
        return response(400, {
            "error": "signature_verification_failed",
            "message": str(e)
        })

    except Exception as e:
        return response(500, {
            "error": "internal_error",
            "message": str(e)
        })
