import datetime
import os

import boto3

METRICS_TABLE_NAME = os.environ.get("DASHBOARD_METRICS_TABLE_NAME", "ulttra-crm-dashboard-metrics")

dynamodb = boto3.resource("dynamodb")
metrics_table = dynamodb.Table(METRICS_TABLE_NAME)

MEMBER_TIERS = {"club", "premier", "patron", "founder"}
PRIORITY_MEMBER_TIERS = {"founder", "patron"}
ACTIVE_PAYMENT_STATUSES = {"subscription_active", "paid"}


def lambda_handler(event, context):
    for record in event.get("Records", []):
        event_name = record.get("eventName")
        dynamodb_record = record.get("dynamodb", {})
        old_image = from_ddb_image(dynamodb_record.get("OldImage"))
        new_image = from_ddb_image(dynamodb_record.get("NewImage"))

        if event_name == "INSERT":
            apply_delta(contributions(new_image), 1)
        elif event_name == "MODIFY":
            apply_difference(contributions(old_image), contributions(new_image))
        elif event_name == "REMOVE":
            apply_delta(contributions(old_image), -1)

    return {"ok": True, "records": len(event.get("Records", []))}


def contributions(item):
    if not item or is_synthetic(item.get("synthetic_test")):
        return {}

    output = {}
    tier = normalize_tier(item.get("tier") or item.get("selected_tier") or item.get("subscriber_type"))
    access_status = normalize_string(item.get("access_status")).lower()
    payment_status = normalize_string(item.get("payment_status")).lower()

    if tier in MEMBER_TIERS and access_status == "active" and payment_status in ACTIVE_PAYMENT_STATUSES:
        output[("counter", "members#active_total")] = 1
        output[("counter", f"members#tier#{tier}")] = 1

        subscription_id = normalize_string(item.get("stripe_subscription_id"))
        if subscription_id:
            output[("active_stripe_subscription", subscription_id)] = {
                "customer_id": normalize_string(item.get("stripe_customer_id")),
            }

        country = normalize_geo(item.get("country") or item.get("member_country"))
        city = normalize_geo(item.get("city") or item.get("member_city"))
        if country:
            output[("member_geo_country", country)] = 1
        if city:
            output[("member_geo_city", city)] = 1

        if tier in PRIORITY_MEMBER_TIERS:
            lead_id = normalize_string(item.get("lead_id") or item.get("id"))
            if lead_id:
                output[("member_list_founder_patron", lead_id)] = {
                    "tier": tier,
                    "name": normalize_string(item.get("name") or item.get("full_name")),
                    "country": country,
                    "city": city,
                }

    created_at = parse_date(item.get("created_at"))
    if created_at:
        output[("lead_day", created_at.date().isoformat())] = 1

    return output


def apply_difference(old_contributions, new_contributions):
    keys = set(old_contributions.keys()) | set(new_contributions.keys())
    for key in keys:
        old_value = old_contributions.get(key)
        new_value = new_contributions.get(key)
        if isinstance(old_value, dict) or isinstance(new_value, dict):
            if old_value and not new_value:
                delete_item(key)
            elif new_value:
                put_item(key, new_value)
            continue

        delta = int(new_value or 0) - int(old_value or 0)
        if delta:
            update_counter(key, delta)


def apply_delta(items, direction):
    for key, value in items.items():
        if isinstance(value, dict):
            if direction > 0:
                put_item(key, value)
            else:
                delete_item(key)
        else:
            update_counter(key, int(value) * direction)


def update_counter(key, delta):
    metric_group, metric_key = key
    metrics_table.update_item(
        Key={"metric_group": metric_group, "metric_key": metric_key},
        UpdateExpression="ADD #value :delta SET updated_at = :updated_at",
        ExpressionAttributeNames={"#value": "value"},
        ExpressionAttributeValues={
            ":delta": delta,
            ":updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
    )


def put_item(key, values):
    metric_group, metric_key = key
    item = {
        "metric_group": metric_group,
        "metric_key": metric_key,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        **values,
    }
    metrics_table.put_item(Item=item)


def delete_item(key):
    metric_group, metric_key = key
    metrics_table.delete_item(Key={"metric_group": metric_group, "metric_key": metric_key})


def from_ddb_image(image):
    if not image:
        return None
    return {key: decode_value(value) for key, value in image.items()}


def decode_value(value):
    if "S" in value:
        return value["S"]
    if "BOOL" in value:
        return value["BOOL"]
    if "N" in value:
        raw = value["N"]
        return int(raw) if raw.isdigit() else float(raw)
    if "NULL" in value:
        return None
    return None


def normalize_string(value):
    return "" if value is None else str(value).strip()


def normalize_tier(value):
    return normalize_string(value).lower().replace(" ", "_").replace("-", "_")


def normalize_geo(value):
    raw = normalize_string(value)
    if not raw:
        return ""
    if raw.lower() in {"unknown", "not set", "(not set)", "n/a", "na"}:
        return ""
    return " ".join(raw.split())


def is_synthetic(value):
    if value is True:
        return True
    if value is False or value is None:
        return False
    return normalize_string(value).lower() in {"true", "1", "yes"}


def parse_date(value):
    raw = normalize_string(value)
    if not raw:
        return None
    try:
        return datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
