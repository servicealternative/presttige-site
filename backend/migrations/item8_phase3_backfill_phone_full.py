import boto3
import json
import re
from datetime import datetime, timezone

client = boto3.client("dynamodb", region_name="us-east-1")

with open("/tmp/presttige_snapshot_pre_phase3.json") as f:
    snap = json.load(f)

ts = datetime.now(timezone.utc).isoformat()
mutated = []
skipped = []

for item in snap["Items"]:
    lead_id = item["lead_id"]["S"]
    if "phone_full" in item and item["phone_full"]["S"]:
        continue
    phone = item.get("phone", {}).get("S", "").strip()
    if not phone:
        skipped.append((lead_id, "no phone field"))
        continue
    phone_full = re.sub(r"[\s\-()]", "", phone)
    if not phone_full.startswith("+"):
        skipped.append((lead_id, f"phone not E.164: {phone_full}"))
        continue
    client.update_item(
        TableName="presttige-db",
        Key={"lead_id": {"S": lead_id}},
        UpdateExpression="SET phone_full = :p, phone_full_backfilled_at = :t",
        ExpressionAttributeValues={
            ":p": {"S": phone_full},
            ":t": {"S": ts},
        },
        ConditionExpression="attribute_exists(lead_id)",
    )
    mutated.append((lead_id, phone_full))

print(f"Mutated: {len(mutated)}, Skipped: {len(skipped)}")
if mutated:
    print("Mutated leads:")
    for lead_id, phone_full in mutated:
        print(f"{lead_id}: {phone_full}")
if skipped:
    print("Skipped leads:")
    for lead_id, reason in skipped:
        print(f"{lead_id}: {reason}")
