import html
import json
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE_NAME = os.environ.get("TABLE_NAME", "presttige-db")
MIRROR_TABLE_NAME = os.environ.get("MIRROR_TABLE_NAME", "presttige-eligible-inviters")
FOUNDER_EMAIL_FROM = os.environ.get("FOUNDER_EMAIL_FROM", "committee@presttige.net")
DIRECTUS_URL = os.environ.get("DIRECTUS_URL", "https://crm.ulttra.net").rstrip("/")
DIRECTUS_TOKEN_PARAMETER = os.environ.get("DIRECTUS_TOKEN_PARAMETER", "/ulttra/directus/codex-token")
TEST_DELAY_PARAMETER = os.environ.get(
    "TEST_DELAY_PARAMETER",
    "/presttige/founder-invite/test-delay-minutes",
)
SCHEDULER_GROUP_NAME = os.environ.get("SCHEDULER_GROUP_NAME", "default")
SCHEDULER_ROLE_ARN = os.environ.get("SCHEDULER_ROLE_ARN", "")
TEST_SCHEDULE_PREFIX = os.environ.get("TEST_SCHEDULE_PREFIX", "presttige-founder-test-")
TEST_HARNESS_NAME = "founder_b6"

BASE_ALLOWED_EMAILS = {
    "antoniompereira@icloud.com",
    "fq@freequenza.net",
}
DIRECTUS_RESET_EMAILS = {
    "fq@freequenza.net",
}

dynamodb = boto3.resource("dynamodb", region_name=REGION)
leads_table = dynamodb.Table(TABLE_NAME)
mirror_table = dynamodb.Table(MIRROR_TABLE_NAME)
ses = boto3.client("ses", region_name=REGION)
ssm = boto3.client("ssm", region_name=REGION)
scheduler = boto3.client("scheduler", region_name=REGION)


def lambda_handler(event, context):
    try:
        payload = parse_payload(event)
        action = normalize_string(payload.get("action")).lower()

        if action in {"dry_check", "dry-check", "check"}:
            return response(200, dry_check())
        if action in {"welcome", "trigger_welcome", "trigger-welcome"}:
            return response(200, trigger_welcome(payload))
        if action in {"schedule_invite", "schedule-invite", "invite_5min", "invite-5min"}:
            return response(200, schedule_invite(payload, context))
        if action in {"send_invite", "send-invite"}:
            return response(200, send_invite(payload))
        if action == "reset":
            return response(200, reset_test_state(payload))

        return response(
            400,
            {
                "ok": False,
                "error": "unsupported_action",
                "supported_actions": ["dry_check", "welcome", "schedule_invite", "reset"],
            },
        )
    except HarnessError as exc:
        return response(409, {"ok": False, "error": exc.code, "message": exc.message})


def parse_payload(event):
    if not isinstance(event, dict):
        return {}
    body = event.get("body")
    if body:
        if isinstance(body, str):
            try:
                parsed = json.loads(body)
                return parsed if isinstance(parsed, dict) else {}
            except json.JSONDecodeError:
                return {}
        if isinstance(body, dict):
            return body
    return event


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=decimal_default),
    }


def dry_check():
    return {
        "ok": True,
        "mode": "dry_check",
        "no_send": True,
        "no_write": True,
        "commands": ["welcome", "schedule_invite", "reset"],
        "internal_action": "send_invite",
        "allowed_emails": sorted(BASE_ALLOWED_EMAILS),
        "icloud_alias_rule": "antoniompereira+*@icloud.com",
        "test_delay_minutes": load_test_delay_minutes(),
        "production_scheduler_unchanged": True,
        "production_scheduler_excludes_synthetic_test": True,
        "safety": {
            "requires_synthetic_test": True,
            "requires_antonio_controlled_email": True,
            "reset_requires_confirmation": "RESET_FOUNDER_TEST",
            "ses_suppression_untouched": True,
        },
    }


def trigger_welcome(payload):
    dry_run = bool(payload.get("dry_run") or payload.get("dryRun"))
    email = normalize_email(payload.get("email") or "antoniompereira@icloud.com")
    name = normalize_string(payload.get("name")) or "Antonio"
    lead = get_or_prepare_synthetic_founder(
        email=email,
        name=name,
        lead_id=normalize_string(payload.get("lead_id")),
        dry_run=dry_run,
    )
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "would_activate": True,
            "would_send_welcome": True,
            "lead_id": lead["lead_id"],
            "email": email,
        }

    welcome = send_founder_welcome_email_if_needed(lead)
    return {
        "ok": True,
        "action": "welcome",
        "lead_id": lead["lead_id"],
        "email": email,
        "synthetic_test": True,
        "welcome": welcome,
    }


def schedule_invite(payload, context):
    dry_run = bool(payload.get("dry_run") or payload.get("dryRun"))
    email = normalize_email(payload.get("email"))
    lead_id = normalize_string(payload.get("lead_id"))
    lead = resolve_synthetic_test_lead(email=email, lead_id=lead_id)
    ensure_synthetic_founder(lead)

    delay_minutes = load_test_delay_minutes()
    scheduled_for = utc_now() + timedelta(minutes=delay_minutes)
    schedule_name = build_invite_schedule_name(lead["lead_id"])
    target_arn = normalize_string(getattr(context, "invoked_function_arn", "")) or normalize_string(
        payload.get("function_arn")
    )
    if not target_arn:
        raise HarnessError("missing_function_arn", "Cannot create the one-off test schedule without a function ARN.")
    if not SCHEDULER_ROLE_ARN:
        raise HarnessError("missing_scheduler_role", "SCHEDULER_ROLE_ARN is not configured.")

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "would_create_schedule": True,
            "lead_id": lead["lead_id"],
            "email": lead["email"],
            "schedule_name": schedule_name,
            "scheduled_for": isoformat(scheduled_for),
            "delay_minutes": delay_minutes,
        }

    delete_schedule_if_present(schedule_name)
    scheduler.create_schedule(
        Name=schedule_name,
        GroupName=SCHEDULER_GROUP_NAME,
        ScheduleExpression=at_expression(scheduled_for),
        ScheduleExpressionTimezone="UTC",
        FlexibleTimeWindow={"Mode": "OFF"},
        Target={
            "Arn": target_arn,
            "RoleArn": SCHEDULER_ROLE_ARN,
            "Input": json.dumps(
                {
                    "action": "send_invite",
                    "lead_id": lead["lead_id"],
                    "email": lead["email"],
                    "test_schedule_name": schedule_name,
                }
            ),
        },
        ActionAfterCompletion="DELETE",
    )
    leads_table.update_item(
        Key={"lead_id": lead["lead_id"]},
        ConditionExpression="synthetic_test = :true AND email = :email",
        UpdateExpression=(
            "SET founder_test_invite_schedule_name = :name, "
            "founder_test_invite_scheduled_at = :scheduled_at, "
            "updated_at = :updated_at"
        ),
        ExpressionAttributeValues={
            ":true": True,
            ":email": lead["email"],
            ":name": schedule_name,
            ":scheduled_at": isoformat(scheduled_for),
            ":updated_at": now_iso(),
        },
    )
    return {
        "ok": True,
        "action": "schedule_invite",
        "lead_id": lead["lead_id"],
        "email": lead["email"],
        "schedule_name": schedule_name,
        "scheduled_for": isoformat(scheduled_for),
        "delay_minutes": delay_minutes,
    }


def send_invite(payload):
    email = normalize_email(payload.get("email"))
    lead_id = normalize_string(payload.get("lead_id"))
    lead = resolve_synthetic_test_lead(email=email, lead_id=lead_id)
    ensure_synthetic_founder(lead)

    delay_minutes = load_test_delay_minutes()
    activated_at = parse_iso(lead.get("founder_activated_at"))
    if not activated_at:
        raise HarnessError("missing_founder_activated_at", "Synthetic Founder has no founder_activated_at.")
    due_at = activated_at + timedelta(minutes=delay_minutes)
    now = utc_now()
    if now < due_at:
        return {
            "ok": True,
            "sent": False,
            "reason": "before_test_delay",
            "due_at": isoformat(due_at),
        }

    if normalize_string(lead.get("founder_invite_status")).lower() == "active":
        expires_at = parse_iso(lead.get("founder_invite_expires_at"))
        if expires_at and expires_at > now:
            return {
                "ok": True,
                "sent": False,
                "reason": "active_invite_already_exists",
                "lead_id": lead["lead_id"],
            }

    token = "fdi_test_" + secrets.token_urlsafe(18)
    issued_at = isoformat(now)
    expires_at = isoformat(now + timedelta(days=30))
    update_response = leads_table.update_item(
        Key={"lead_id": lead["lead_id"]},
        ConditionExpression=(
            "synthetic_test = :true "
            "AND email = :email "
            "AND #subscriber_type = :founder "
            "AND #tier = :founder "
            "AND founder_lifetime = :true "
            "AND payment_status = :paid "
            "AND access_status = :active"
        ),
        UpdateExpression=(
            "SET founder_invite_token = :token, "
            "founder_invite_status = :active_invite, "
            "founder_invite_issued_at = :issued_at, "
            "founder_invite_expires_at = :expires_at, "
            "founder_invite_invitee_lead_id = :null_value, "
            "updated_at = :updated_at "
            "REMOVE founder_test_invite_schedule_name, founder_test_invite_scheduled_at "
            "ADD founder_invites_issued_count :one"
        ),
        ExpressionAttributeNames={
            "#subscriber_type": "subscriber_type",
            "#tier": "tier",
        },
        ExpressionAttributeValues={
            ":true": True,
            ":email": lead["email"],
            ":founder": "founder",
            ":paid": "paid",
            ":active": "active",
            ":active_invite": "active",
            ":token": token,
            ":issued_at": issued_at,
            ":expires_at": expires_at,
            ":null_value": None,
            ":updated_at": issued_at,
            ":one": Decimal(1),
        },
        ReturnValues="ALL_NEW",
    )
    updated = update_response.get("Attributes") or lead
    send_founder_invitation_ready_email(updated)
    return {
        "ok": True,
        "action": "send_invite",
        "lead_id": updated["lead_id"],
        "email": updated["email"],
        "sent": True,
        "issued_at": issued_at,
        "expires_at": expires_at,
    }


def reset_test_state(payload):
    dry_run = bool(payload.get("dry_run") or payload.get("dryRun"))
    if not dry_run and normalize_string(payload.get("confirm")) != "RESET_FOUNDER_TEST":
        raise HarnessError(
            "confirmation_required",
            "Reset requires confirm=RESET_FOUNDER_TEST.",
        )

    emails = requested_allowed_emails(payload)
    matching_leads = list_matching_leads(emails)
    synthetic_leads = [lead for lead in matching_leads if lead.get("synthetic_test") is True]
    skipped_leads = [
        {"lead_id": lead.get("lead_id"), "email": lead.get("email"), "reason": "not_synthetic_test"}
        for lead in matching_leads
        if lead.get("synthetic_test") is not True
    ]
    schedules = list_test_schedules()
    mirror_before = list_existing_mirror_rows(emails)
    directus_before = directus_matching_state()

    deleted_leads = []
    deleted_schedules = []
    deleted_mirror = []
    directus_result = {"skipped": dry_run, "people_deleted": [], "people_projects_deleted": []}

    if not dry_run:
        for schedule_name in schedules:
            if delete_schedule_if_present(schedule_name):
                deleted_schedules.append(schedule_name)
        for lead in synthetic_leads:
            leads_table.delete_item(
                Key={"lead_id": lead["lead_id"]},
                ConditionExpression="synthetic_test = :true",
                ExpressionAttributeValues={":true": True},
            )
            deleted_leads.append({"lead_id": lead["lead_id"], "email": lead.get("email")})
        for email in mirror_before:
            mirror_table.delete_item(Key={"email": email})
            deleted_mirror.append(email)
        directus_result = reset_directus_test_people()

    after_leads = list_matching_leads(emails)
    after_synthetic = [lead for lead in after_leads if lead.get("synthetic_test") is True]
    mirror_after = list_existing_mirror_rows(emails)
    directus_after = directus_matching_state() if not dry_run else directus_before

    return {
        "ok": True,
        "action": "reset",
        "dry_run": dry_run,
        "emails": emails,
        "before": {
            "matching_leads": len(matching_leads),
            "synthetic_leads": len(synthetic_leads),
            "test_schedules": len(schedules),
            "mirror_rows": len(mirror_before),
            "directus_people": len(directus_before["people"]),
            "directus_people_projects": len(directus_before["people_projects"]),
        },
        "cleared": {
            "leads": deleted_leads,
            "schedules": deleted_schedules,
            "mirror_rows": deleted_mirror,
            "directus": directus_result,
            "ses_suppression": "untouched",
        },
        "after": {
            "matching_leads": len(after_leads),
            "synthetic_leads": len(after_synthetic),
            "mirror_rows": len(mirror_after),
            "directus_people": len(directus_after["people"]),
            "directus_people_projects": len(directus_after["people_projects"]),
        },
        "skipped": skipped_leads,
    }


def get_or_prepare_synthetic_founder(email, name, lead_id, dry_run=False):
    ensure_allowed_email(email)
    existing = list_matching_leads([email])
    real_matches = [lead for lead in existing if lead.get("synthetic_test") is not True]
    if real_matches:
        raise HarnessError("real_record_exists", "Refusing to run against a non-synthetic record.")

    lead = None
    if lead_id:
        current = leads_table.get_item(Key={"lead_id": lead_id}).get("Item")
        if current:
            ensure_allowed_email(current.get("email"))
            if current.get("synthetic_test") is not True:
                raise HarnessError("not_synthetic_test", "Refusing to run against a non-synthetic lead_id.")
            lead = current
    if not lead and existing:
        lead = existing[0]

    now = now_iso()
    if not lead:
        lead = {
            "lead_id": lead_id or build_test_lead_id(email),
            "email": email,
            "name": name,
            "created_at": now,
        }
    activated_at = now
    prepared = {
        **lead,
        "email": email,
        "name": normalize_string(lead.get("name")) or name,
        "synthetic_test": True,
        "is_test": True,
        "test_harness": TEST_HARNESS_NAME,
        "subscriber_type": "founder",
        "tier": "founder",
        "selected_tier": "founder",
        "selected_tier_billing": "lifetime",
        "selected_contract_key": "founder_lifetime",
        "payment_status": "paid",
        "payment_status_reason": "synthetic_founder_test_activation",
        "subscription_status": "none",
        "access_status": "active",
        "founder_lifetime": True,
        "founder_activated_at": lead.get("founder_activated_at") or activated_at,
        "updated_at": now,
    }
    if dry_run:
        return prepared

    leads_table.update_item(
        Key={"lead_id": prepared["lead_id"]},
        UpdateExpression=(
            "SET email = :email, #name = :name, created_at = if_not_exists(created_at, :created_at), "
            "synthetic_test = :true, is_test = :true, test_harness = :test_harness, "
            "subscriber_type = :founder, tier = :founder, selected_tier = :founder, "
            "selected_tier_billing = :lifetime, selected_contract_key = :contract_key, "
            "payment_status = :paid, payment_status_reason = :reason, subscription_status = :none, "
            "access_status = :active, founder_lifetime = :true, "
            "founder_activated_at = if_not_exists(founder_activated_at, :activated_at), "
            "updated_at = :updated_at"
        ),
        ConditionExpression=(
            "attribute_not_exists(lead_id) "
            "OR (synthetic_test = :true AND email = :email)"
        ),
        ExpressionAttributeNames={"#name": "name"},
        ExpressionAttributeValues={
            ":email": email,
            ":name": prepared["name"],
            ":created_at": now,
            ":true": True,
            ":test_harness": TEST_HARNESS_NAME,
            ":founder": "founder",
            ":lifetime": "lifetime",
            ":contract_key": "founder_lifetime",
            ":paid": "paid",
            ":reason": "synthetic_founder_test_activation",
            ":none": "none",
            ":active": "active",
            ":activated_at": activated_at,
            ":updated_at": now,
        },
    )
    return leads_table.get_item(Key={"lead_id": prepared["lead_id"]}).get("Item") or prepared


def send_founder_welcome_email_if_needed(lead):
    if lead.get("founder_welcome_email_sent_at"):
        return {"sent": False, "skipped": True, "reason": "already_sent"}
    ensure_synthetic_founder(lead)

    member_name = normalize_string(lead.get("name")) or "Member"
    text_body = "\n\n".join(
        [
            f"Dear {member_name},",
            "Your membership is confirmed. Welcome to Presttige.",
            (
                "You now belong to a small, deliberately limited circle of Founding "
                "Members, a distinction that remains yours for life."
            ),
            (
                "In the days ahead you will receive your first invitation to introduce "
                "someone to Presttige, a privilege reserved for Founders."
            ),
            "We are honoured to have you with us.",
            "The Presttige Committee",
        ]
    )
    ses_response = ses.send_email(
        Source=FOUNDER_EMAIL_FROM,
        ReplyToAddresses=[FOUNDER_EMAIL_FROM],
        Destination={"ToAddresses": [lead["email"]]},
        Message={
            "Subject": {"Data": "Welcome to Presttige", "Charset": "UTF-8"},
            "Body": {"Text": {"Data": text_body, "Charset": "UTF-8"}},
        },
    )
    sent_at = now_iso()
    try:
        leads_table.update_item(
            Key={"lead_id": lead["lead_id"]},
            ConditionExpression=(
                "synthetic_test = :true "
                "AND email = :email "
                "AND attribute_not_exists(founder_welcome_email_sent_at)"
            ),
            UpdateExpression="SET founder_welcome_email_sent_at = :sent_at, updated_at = :sent_at",
            ExpressionAttributeValues={
                ":true": True,
                ":email": lead["email"],
                ":sent_at": sent_at,
            },
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return {"sent": False, "skipped": True, "reason": "already_sent"}
        raise
    return {
        "sent": True,
        "skipped": False,
        "sent_at": sent_at,
        "message_id": ses_response.get("MessageId"),
    }


def send_founder_invitation_ready_email(founder):
    ensure_synthetic_founder(founder)
    first_name = first_name_for_email(founder.get("name"), founder["email"])
    subject = "Your Founder invitation is ready"
    text_body = founder_invitation_ready_text(first_name)
    html_body = founder_invitation_ready_html(first_name)
    ses.send_email(
        Source=FOUNDER_EMAIL_FROM,
        ReplyToAddresses=[FOUNDER_EMAIL_FROM],
        Destination={"ToAddresses": [founder["email"]]},
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
            "With our thanks,\nThe Presttige Committee",
        ]
    )


def founder_invitation_ready_html(first_name):
    paragraphs = [
        f"Dear {html.escape(first_name)},",
        "Your Founder invitation for this cycle is ready.",
        "You may put forward one person when the Founder invitation path is opened for this cycle. One invitation is active at a time, and unused invitations do not stack.",
        "There is nothing else you need to do in this message. We will keep the process quiet and personal.",
        "With our thanks,<br>The Presttige Committee",
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


def resolve_synthetic_test_lead(email="", lead_id=""):
    if lead_id:
        lead = leads_table.get_item(Key={"lead_id": lead_id}).get("Item")
        if not lead:
            raise HarnessError("lead_not_found", "Synthetic Founder test lead was not found.")
        ensure_allowed_email(lead.get("email"))
        return lead
    if not email:
        raise HarnessError("target_required", "Provide email or lead_id.")
    ensure_allowed_email(email)
    leads = [lead for lead in list_matching_leads([email]) if lead.get("synthetic_test") is True]
    if not leads:
        raise HarnessError("synthetic_lead_not_found", "No synthetic Founder test lead exists for that email.")
    return leads[0]


def ensure_synthetic_founder(lead):
    if not lead:
        raise HarnessError("lead_not_found", "Lead was not found.")
    email = normalize_email(lead.get("email"))
    ensure_allowed_email(email)
    checks = {
        "synthetic_test": lead.get("synthetic_test") is True,
        "subscriber_type": normalize_string(lead.get("subscriber_type")).lower() == "founder",
        "tier": normalize_string(lead.get("tier")).lower() == "founder",
        "founder_lifetime": lead.get("founder_lifetime") is True,
        "payment_status": normalize_string(lead.get("payment_status")).lower() == "paid",
        "access_status": normalize_string(lead.get("access_status")).lower() == "active",
    }
    failed = [key for key, ok in checks.items() if not ok]
    if failed:
        raise HarnessError("synthetic_founder_required", f"Refusing test action, failed checks: {', '.join(failed)}.")


def requested_allowed_emails(payload):
    raw = payload.get("emails")
    if raw is None:
        emails = sorted(BASE_ALLOWED_EMAILS)
    elif isinstance(raw, list):
        emails = [normalize_email(item) for item in raw]
    else:
        emails = [normalize_email(raw)]
    for email in emails:
        ensure_allowed_email(email)
    return sorted(set(emails))


def ensure_allowed_email(email):
    normalized = normalize_email(email)
    if normalized in BASE_ALLOWED_EMAILS:
        return
    local_part, separator, domain = normalized.partition("@")
    if separator == "@" and domain == "icloud.com" and local_part.startswith("antoniompereira+"):
        return
    raise HarnessError("address_not_allowed", "Founder test harness only allows Antonio-controlled test addresses.")


def list_matching_leads(emails):
    leads = []
    seen = set()
    for email in emails:
        result = leads_table.query(
            IndexName="email-index",
            KeyConditionExpression=Key("email").eq(email),
        )
        for item in result.get("Items") or []:
            lead_id = item.get("lead_id")
            if lead_id and lead_id not in seen:
                leads.append(item)
                seen.add(lead_id)
    return leads


def list_existing_mirror_rows(emails):
    rows = []
    for email in emails:
        item = mirror_table.get_item(Key={"email": email}).get("Item")
        if item:
            rows.append(email)
    return rows


def list_test_schedules():
    names = []
    next_token = None
    while True:
        request = {
            "GroupName": SCHEDULER_GROUP_NAME,
            "NamePrefix": TEST_SCHEDULE_PREFIX,
            "MaxResults": 100,
        }
        if next_token:
            request["NextToken"] = next_token
        result = scheduler.list_schedules(**request)
        names.extend(item["Name"] for item in result.get("Schedules") or [])
        next_token = result.get("NextToken")
        if not next_token:
            return names


def delete_schedule_if_present(schedule_name):
    if not schedule_name:
        return False
    try:
        scheduler.delete_schedule(Name=schedule_name, GroupName=SCHEDULER_GROUP_NAME)
        return True
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"ResourceNotFoundException", "ValidationException"}:
            return False
        raise


def directus_matching_state():
    token = load_directus_token()
    people = directus_get(token, "/items/people", {"limit": "-1", "fields": "id,email,type,name"})
    matched_people = [
        item
        for item in people.get("data", [])
        if normalize_email(item.get("email")) in DIRECTUS_RESET_EMAILS
    ]
    person_ids = {str(item.get("id")) for item in matched_people if item.get("id")}
    projects = directus_get(token, "/items/people_projects", {"limit": "-1", "fields": "id,person,project,status,invite_permission"})
    matched_projects = [
        item
        for item in projects.get("data", [])
        if directus_relation_id(item.get("person")) in person_ids
    ]
    return {
        "people": matched_people,
        "people_projects": matched_projects,
    }


def reset_directus_test_people():
    token = load_directus_token()
    state = directus_matching_state()
    deleted_projects = []
    deleted_people = []

    for row in state["people_projects"]:
        row_id = row.get("id")
        if row_id:
            directus_delete(token, f"/items/people_projects/{urllib.parse.quote(str(row_id), safe='')}")
            deleted_projects.append(str(row_id))
    for person in state["people"]:
        person_id = person.get("id")
        email = normalize_email(person.get("email"))
        if person_id and email in DIRECTUS_RESET_EMAILS:
            directus_delete(token, f"/items/people/{urllib.parse.quote(str(person_id), safe='')}")
            deleted_people.append({"id": str(person_id), "email": email})

    return {
        "people_deleted": deleted_people,
        "people_projects_deleted": deleted_projects,
    }


def directus_relation_id(value):
    if isinstance(value, dict):
        return str(value.get("id") or "")
    return str(value or "")


def load_directus_token():
    return ssm.get_parameter(Name=DIRECTUS_TOKEN_PARAMETER, WithDecryption=True)["Parameter"]["Value"]


def directus_get(token, path, params):
    return directus_request("GET", path, token, params=params)


def directus_delete(token, path):
    return directus_request("DELETE", path, token)


def directus_request(method, path, token, params=None):
    query = f"?{urllib.parse.urlencode(params)}" if params else ""
    request = urllib.request.Request(
        f"{DIRECTUS_URL}{path}{query}",
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response_obj:
            body = response_obj.read().decode("utf-8")
            return json.loads(body) if body else {"data": None}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HarnessError("directus_request_failed", f"Directus {method} {path} failed with {exc.code}: {detail[:500]}")


def load_test_delay_minutes():
    try:
        raw = ssm.get_parameter(Name=TEST_DELAY_PARAMETER, WithDecryption=False)["Parameter"]["Value"]
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ParameterNotFound":
            return 5
        raise
    value = int(normalize_string(raw))
    if value <= 0 or value > 60:
        raise HarnessError("invalid_test_delay", "Test delay must be between 1 and 60 minutes.")
    return value


def build_test_lead_id(email):
    normalized = normalize_email(email)
    safe = "".join(char if char.isalnum() else "_" for char in normalized.split("@", 1)[0])
    return f"fdm_founder_test_{safe}"[:64]


def build_invite_schedule_name(lead_id):
    return f"{TEST_SCHEDULE_PREFIX}invite-{lead_id}"[:64]


def at_expression(value):
    return f"at({value.strftime('%Y-%m-%dT%H:%M:%S')})"


def parse_iso(value):
    raw = normalize_string(value)
    if not raw:
        return None
    return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)


def utc_now():
    return datetime.now(timezone.utc)


def now_iso():
    return isoformat(utc_now())


def isoformat(value):
    return value.astimezone(timezone.utc).isoformat()


def first_name_for_email(name, email):
    cleaned = normalize_string(name)
    if cleaned:
        return cleaned.split()[0]
    local_part = normalize_string(email).split("@", 1)[0]
    local_part = local_part.replace(".", " ").replace("_", " ").replace("-", " ").strip()
    return local_part.split()[0].title() if local_part else "there"


def normalize_string(value):
    if value is None:
        return ""
    return str(value).strip()


def normalize_email(value):
    return normalize_string(value).lower()


def decimal_default(value):
    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)
    raise TypeError(f"Object of type {value.__class__.__name__} is not JSON serializable")


class HarnessError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message
