import boto3
import json
from datetime import datetime, timezone

client = boto3.client("dynamodb", region_name="us-east-1")

with open("/tmp/presttige_snapshot_pre_phase3.json") as f:
    snap = json.load(f)

ts = datetime.now(timezone.utc).isoformat()
mutated = []

for item in snap["Items"]:
    lead_id = item["lead_id"]["S"]
    email = item["email"]["S"]
    normalised = email.strip().lower()
    if normalised != email:
        client.update_item(
            TableName="presttige-db",
            Key={"lead_id": {"S": lead_id}},
            UpdateExpression="SET email = :e, email_normalised_at = :t",
            ExpressionAttributeValues={
                ":e": {"S": normalised},
                ":t": {"S": ts},
            },
            ConditionExpression="attribute_exists(lead_id)",
        )
        mutated.append((lead_id, email, normalised))
        print(f"Normalised {lead_id}: '{email}' -> '{normalised}'")

print(f"Total mutated: {len(mutated)}")
