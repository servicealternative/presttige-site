import calendar
import html
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError


REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME = os.environ.get("TABLE_NAME", "presttige-db")
FOUNDER_EMAIL_FROM = os.environ.get("FOUNDER_EMAIL_FROM", "founders@presttige.net")
SES_CONFIGURATION_SET = os.environ.get("SES_CONFIGURATION_SET", "presttige-deliverability-v1")
CONFIG_PARAMETER_NAMES = {
    "initial_delay_hours": "/presttige/founder-invite/initial-delay-hours",
    "cycle": "/presttige/founder-invite/cycle",
    "validity_days": "/presttige/founder-invite/validity-days",
    "global_cap": "/presttige/founder-invite/global-cap",
}

dynamodb = boto3.resource("dynamodb", region_name=REGION)
table = dynamodb.Table(TABLE_NAME)
ssm = boto3.client("ssm", region_name=REGION)
ses = boto3.client("ses", region_name=REGION)


def format_source(address):
    return f"Presttige <{address}>"


def lambda_handler(event, context):
    event = event or {}
    dry_run = bool(event.get("dry_run") or event.get("dryRun"))
    suppress_emails = dry_run or bool(event.get("suppress_emails") or event.get("suppressEmails"))
    now = utc_now()
    config = load_config()
    founders = list_real_paid_founders()
    real_founder_count = len(founders)
    result = {
        "ok": True,
        "dry_run": dry_run,
        "suppress_emails": suppress_emails,
        "config": {
            "initial_delay_hours": config["initial_delay_hours"],
            "cycle": config["cycle"],
            "validity_days": config["validity_days"],
            "global_cap": config["global_cap"],
        },
        "real_founder_count": real_founder_count,
        "eligible_count": 0,
        "issued_count": 0,
        "email_count": 0,
        "skipped": [],
    }

    if real_founder_count >= config["global_cap"]:
        result["skipped"].append({"reason": "global_cap_reached"})
        return result

    remaining_capacity = config["global_cap"] - real_founder_count
    for founder in founders:
        decision = founder_due_decision(founder, config, now)
        if not decision["due"]:
            result["skipped"].append(
                {
                    "lead_id": founder.get("lead_id"),
                    "reason": decision["reason"],
                }
            )
            continue

        result["eligible_count"] += 1
        if remaining_capacity <= 0:
            result["skipped"].append(
                {
                    "lead_id": founder.get("lead_id"),
                    "reason": "run_capacity_exhausted",
                }
            )
            continue

        remaining_capacity -= 1
        token = "fdi_" + secrets.token_urlsafe(24)
        issued_at = isoformat(now)
        expires_at = isoformat(now + timedelta(days=config["validity_days"]))

        if not dry_run:
            issued = issue_invite(founder, token, issued_at, expires_at, decision)
            if not issued:
                result["skipped"].append(
                    {
                        "lead_id": founder.get("lead_id"),
                        "reason": "conditional_update_failed",
                    }
                )
                continue

        result["issued_count"] += 1

        if not suppress_emails:
            send_founder_invitation_ready_email(founder)
            result["email_count"] += 1

    return result


def load_config():
    response = ssm.get_parameters(
        Names=list(CONFIG_PARAMETER_NAMES.values()),
        WithDecryption=False,
    )
    invalid = response.get("InvalidParameters") or []
    if invalid:
        raise RuntimeError(f"Missing Founder invite config parameters: {', '.join(sorted(invalid))}")

    values = {parameter["Name"]: parameter["Value"] for parameter in response.get("Parameters", [])}
    cycle = normalize_string(values[CONFIG_PARAMETER_NAMES["cycle"]]).lower()
    if cycle != "monthly":
        raise RuntimeError(f"Unsupported Founder invite cycle: {cycle}")

    return {
        "initial_delay_hours": parse_positive_int(values[CONFIG_PARAMETER_NAMES["initial_delay_hours"]], "initial-delay-hours"),
        "cycle": cycle,
        "validity_days": parse_positive_int(values[CONFIG_PARAMETER_NAMES["validity_days"]], "validity-days"),
        "global_cap": parse_positive_int(values[CONFIG_PARAMETER_NAMES["global_cap"]], "global-cap"),
    }


def parse_positive_int(value, label):
    parsed = int(normalize_string(value))
    if parsed <= 0:
        raise RuntimeError(f"Founder invite config {label} must be positive")
    return parsed


def list_real_paid_founders():
    founders = []
    exclusive_start_key = None
    while True:
        request = {
            "FilterExpression": (
                "#subscriber_type = :founder "
                "AND #tier = :founder "
                "AND founder_lifetime = :true "
                "AND payment_status = :paid "
                "AND access_status = :active "
                "AND (attribute_not_exists(synthetic_test) OR synthetic_test = :false)"
            ),
            "ProjectionExpression": (
                "lead_id, email, #name, #subscriber_type, #tier, founder_lifetime, "
                "payment_status, access_status, synthetic_test, founder_activated_at, "
                "founder_invite_status, founder_invite_token, founder_invite_issued_at, "
                "founder_invite_expires_at, founder_invite_invitee_lead_id, "
                "founder_invites_issued_count, founder_invites_converted_count"
            ),
            "ExpressionAttributeNames": {
                "#name": "name",
                "#subscriber_type": "subscriber_type",
                "#tier": "tier",
            },
            "ExpressionAttributeValues": {
                ":founder": "founder",
                ":true": True,
                ":paid": "paid",
                ":active": "active",
                ":false": False,
            },
        }
        if exclusive_start_key:
            request["ExclusiveStartKey"] = exclusive_start_key

        response = table.scan(**request)
        founders.extend(response.get("Items") or [])
        exclusive_start_key = response.get("LastEvaluatedKey")
        if not exclusive_start_key:
            return founders


def founder_due_decision(founder, config, now):
    activated_at = parse_iso(founder.get("founder_activated_at"))
    if not activated_at:
        return {"due": False, "reason": "missing_founder_activated_at"}

    first_due = activated_at + timedelta(hours=config["initial_delay_hours"])
    if now < first_due:
        return {"due": False, "reason": "before_initial_delay"}

    cycle_start, cycle_end = current_monthly_cycle(first_due, now)
    invite_issued_at = parse_iso(founder.get("founder_invite_issued_at"))
    if invite_issued_at and cycle_start <= invite_issued_at < cycle_end:
        return {"due": False, "reason": "already_issued_this_cycle"}

    invite_status = normalize_string(founder.get("founder_invite_status")).lower()
    invite_expires_at = parse_iso(founder.get("founder_invite_expires_at"))
    if invite_status == "active" and invite_expires_at and invite_expires_at > now:
        return {"due": False, "reason": "active_invite_not_expired"}

    return {
        "due": True,
        "cycle_start": isoformat(cycle_start),
        "cycle_end": isoformat(cycle_end),
    }


def current_monthly_cycle(first_due, now):
    months = (now.year - first_due.year) * 12 + (now.month - first_due.month)
    cycle_start = add_months_clamped(first_due, months)
    if cycle_start > now:
        months -= 1
        cycle_start = add_months_clamped(first_due, months)
    cycle_end = add_months_clamped(first_due, months + 1)
    return cycle_start, cycle_end


def add_months_clamped(value, months):
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def issue_invite(founder, token, issued_at, expires_at, decision):
    try:
        table.update_item(
            Key={"lead_id": founder["lead_id"]},
            UpdateExpression=(
                "SET founder_invite_token = :token, "
                "founder_invite_status = :active_invite, "
                "founder_invite_issued_at = :issued_at, "
                "founder_invite_expires_at = :expires_at, "
                "founder_invite_invitee_lead_id = :null_value, "
                "updated_at = :updated_at "
                "ADD founder_invites_issued_count :one"
            ),
            ConditionExpression=(
                "#subscriber_type = :founder "
                "AND #tier = :founder "
                "AND founder_lifetime = :true "
                "AND payment_status = :paid "
                "AND access_status = :active "
                "AND (attribute_not_exists(synthetic_test) OR synthetic_test = :false) "
                "AND (attribute_not_exists(founder_invite_issued_at) "
                "OR founder_invite_issued_at < :cycle_start) "
                "AND (attribute_not_exists(founder_invite_expires_at) "
                "OR founder_invite_expires_at <= :updated_at "
                "OR founder_invite_status <> :active_invite)"
            ),
            ExpressionAttributeNames={
                "#subscriber_type": "subscriber_type",
                "#tier": "tier",
            },
            ExpressionAttributeValues={
                ":token": token,
                ":active_invite": "active",
                ":issued_at": issued_at,
                ":expires_at": expires_at,
                ":null_value": None,
                ":updated_at": issued_at,
                ":one": Decimal(1),
                ":founder": "founder",
                ":true": True,
                ":paid": "paid",
                ":active": "active",
                ":false": False,
                ":cycle_start": decision["cycle_start"],
            },
        )
        return True
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return False
        raise


def send_founder_invitation_ready_email(founder):
    recipient = normalize_email(founder.get("email"))
    if not is_valid_email(recipient):
        raise RuntimeError(f"Founder record {founder.get('lead_id')} has no valid email")

    first_name = first_name_for_email(founder.get("name"), recipient)
    subject = "Your Founder invitation is ready"
    text_body = founder_invitation_ready_text(first_name)
    html_body = founder_invitation_ready_html(first_name)
    ses.send_email(
        Source=format_source(FOUNDER_EMAIL_FROM),
        ConfigurationSetName=SES_CONFIGURATION_SET,
        ReplyToAddresses=[FOUNDER_EMAIL_FROM],
        Destination={"ToAddresses": [recipient]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Text": {"Data": text_body, "Charset": "UTF-8"},
                "Html": {"Data": html_body, "Charset": "UTF-8"},
            },
        },
    )


def founder_invitation_ready_text(first_name):
    return "\n\n".join(
        [
            f"Dear {first_name},",
            "Your Founder invitation for this cycle is ready.",
            "You may put forward one person when the Founder invitation path is opened for this cycle. One invitation is active at a time, and unused invitations do not stack.",
            "There is nothing else you need to do in this message. We will keep the process quiet and personal.",
            "With our thanks,\nThe Founders' House",
        ]
    )


def founder_invitation_ready_html(first_name):
    paragraphs = [
        f"Dear {html.escape(first_name)},",
        "Your Founder invitation for this cycle is ready.",
        "You may put forward one person when the Founder invitation path is opened for this cycle. One invitation is active at a time, and unused invitations do not stack.",
        "There is nothing else you need to do in this message. We will keep the process quiet and personal.",
        "With our thanks,<br>The Founders' House",
    ]
    return founder_email_shell(
        subject="Your Founder invitation is ready",
        preheader="Your Founder invitation for this cycle is ready.",
        eyebrow="Founder invitation",
        headline="Your Founder invitation is ready",
        paragraphs=paragraphs,
    )


def founder_email_shell(subject, preheader, eyebrow, headline, paragraphs):
    paragraph_html = "\n".join(
        f'<p style="margin:0 0 20px 0;font-family:\'Source Serif Pro\',Georgia,serif;font-size:16px;line-height:26px;color:#0A0A0A;">{paragraph}</p>'
        for paragraph in paragraphs
    )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>{html.escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F2ED;font-family:'Source Serif Pro',Georgia,serif;color:#0A0A0A;">
  <div style="display:none;font-size:1px;color:#F5F2ED;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{html.escape(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F5F2ED;">
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#FBF9F4;">
          <tr>
            <td align="center" style="background-color:#000000;padding:36px 56px 28px 56px;">
              <img src="https://presttige.net/assets/images/presttige-p-lettering.png?v=4" alt="Presttige" width="220" height="49" style="display:block;margin:0 auto 14px auto;border:0;outline:none;text-decoration:none;max-width:220px;">
              <p style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">Private, Selective, Prestigious</p>
            </td>
          </tr>
          <tr>
            <td style="padding:48px 56px 40px 56px;">
              <p style="margin:0 0 24px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">{html.escape(eyebrow)}</p>
              <h1 style="margin:0 0 28px 0;font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:500;font-size:34px;line-height:42px;color:#0A0A0A;">{html.escape(headline)}</h1>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 32px 0;">
                <tr><td style="width:38px;border-top:1px solid #8C7040;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
              </table>
              {paragraph_html}
            </td>
          </tr>
          <tr>
            <td style="padding:0 56px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="border-top:1px solid #D9D2C5;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="background-color:#000000;padding:36px 56px;">
              <img src="https://presttige.net/assets/images/presttige-p-ring.png" alt="Presttige" width="64" height="64" style="display:block;margin:0 auto 16px auto;border:0;outline:none;text-decoration:none;">
              <p style="margin:0 0 12px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">New York, London, Dubai</p>
              <p style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:12px;color:#D9D2C5;">
                <a href="https://presttige.net" style="color:#D9D2C5;text-decoration:none;">www.presttige.net</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


def parse_iso(value):
    raw = normalize_string(value)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def utc_now():
    return datetime.now(timezone.utc)


def isoformat(value):
    return value.astimezone(timezone.utc).isoformat()


def normalize_string(value):
    if value is None:
        return ""
    return str(value).strip()


def normalize_email(value):
    return normalize_string(value).lower()


def is_valid_email(email):
    return (
        bool(email)
        and len(email) <= 254
        and "@" in email
        and "." in email.rsplit("@", 1)[-1]
        and not any(char.isspace() for char in email)
    )


def first_name_for_email(name, email):
    cleaned_name = normalize_string(name)
    if cleaned_name:
        return cleaned_name.split()[0]
    local_part = normalize_string(email).split("@", 1)[0]
    local_part = local_part.replace(".", " ").replace("_", " ").replace("-", " ").strip()
    return local_part.split()[0].title() if local_part else "there"


def json_default(value):
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    raise TypeError(f"Object of type {value.__class__.__name__} is not JSON serializable")
