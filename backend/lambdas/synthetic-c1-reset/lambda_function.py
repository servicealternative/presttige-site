import datetime
import os

import boto3
from boto3.dynamodb.conditions import Attr


TABLE_NAME = os.environ.get("TABLE_NAME", "presttige-db")
REGION = os.environ.get("AWS_REGION", "us-east-1")

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)

BASELINE_SET_VALUES = {
    "subscriber_type": "subscriber",
    "tier": "free",
    "selected_tier": "free",
    "effective_tier": "free",
    "founder_eligible": False,
    "review_status": "approved",
    "email_status": "verified",
    "profile_status": "profile_submitted",
    "payment_status": "free",
}

RESET_REMOVE_FIELDS = [
    "founder_token_status",
    "founder_gate_status",
    "founder_token",
    "founder_token_nonce",
    "founder_token_generated_at",
    "founder_token_version",
    "founder_invite_flow",
    "founder_invite_email_sent_at",
    "founder_inviter_email_sent_at",
    "founder_c2_email_verified_at",
    "founder_c2_profile_completed_at",
    "founder_c2_no_committee",
    "founder_invite_status",
    "founder_invite_token",
    "founder_invite_issued_at",
    "founder_invite_expires_at",
    "founder_invite_invitee_lead_id",
    "inviter_email",
    "inviter_role",
    "inviter_source",
    "inviter_lead_id",
    "inviter_ulttra_person_id",
    "inviter_founder_invite_token",
    "checkout_token",
    "checkout_token_status",
    "checkout_token_issued_at",
    "checkout_token_expires_at",
    "checkout_token_version",
    "selected_contract_key",
    "selected_checkout_mode",
    "selected_price_id",
    "stripe_checkout_started_at",
    "stripe_payment_intent_id",
    "payment_status_reason",
    "checkbox_consent_at",
    "consent_basis",
    "consent_timestamp",
]


def lambda_handler(event, context):
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    reset_count = 0
    scanned_count = 0
    touched = []
    start_key = None

    while True:
        scan_kwargs = {
            "FilterExpression": Attr("synthetic_test").eq(True),
            "ProjectionExpression": "lead_id, email, synthetic_test",
        }
        if start_key:
            scan_kwargs["ExclusiveStartKey"] = start_key
        response = table.scan(**scan_kwargs)
        items = response.get("Items", [])
        scanned_count += response.get("ScannedCount", 0)
        for item in items:
            lead_id = item.get("lead_id")
            email = item.get("email")
            if not lead_id:
                continue
            reset_synthetic_lead(lead_id, email, now)
            reset_count += 1
            touched.append({"lead_id": lead_id, "email": email})
        start_key = response.get("LastEvaluatedKey")
        if not start_key:
            break

    print(
        "SYNTHETIC_C1_RESET "
        f"reset_count={reset_count} scanned_count={scanned_count} table={TABLE_NAME}"
    )
    return {
        "ok": True,
        "reset_count": reset_count,
        "scanned_count": scanned_count,
        "fields_set": sorted(BASELINE_SET_VALUES.keys()),
        "fields_removed": RESET_REMOVE_FIELDS,
        "touched": touched,
    }


def reset_synthetic_lead(lead_id, email, now):
    names = {"#updated_at": "updated_at"}
    values = {
        ":true": True,
        ":updated_at": now,
    }
    set_parts = ["#updated_at = :updated_at"]
    remove_parts = []

    for index, (field_name, value) in enumerate(BASELINE_SET_VALUES.items()):
        name_key = f"#set{index}"
        value_key = f":set{index}"
        names[name_key] = field_name
        values[value_key] = value
        set_parts.append(f"{name_key} = {value_key}")

    for index, field_name in enumerate(RESET_REMOVE_FIELDS):
        name_key = f"#remove{index}"
        names[name_key] = field_name
        remove_parts.append(name_key)

    update_expression = "SET " + ", ".join(set_parts)
    if remove_parts:
        update_expression += " REMOVE " + ", ".join(remove_parts)

    table.update_item(
        Key={"lead_id": lead_id},
        UpdateExpression=update_expression,
        ConditionExpression="synthetic_test = :true",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    print(f"SYNTHETIC_C1_RESET_LEAD lead_id={lead_id} email={email or ''}")
