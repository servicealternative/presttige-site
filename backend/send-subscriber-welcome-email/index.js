const { SESClient, SendRawEmailCommand } = require("@aws-sdk/client-ses");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { SchedulerClient, CreateScheduleCommand } = require("@aws-sdk/client-scheduler");
const { ConditionalCheckFailedException } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");
const path = require("path");

const ses = new SESClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const scheduler = new SchedulerClient({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const FROM = "committee@presttige.net";
const REPLY_TO = "info@presttige.net";
const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || "presttige-deliverability-v1";
const UPDATES_UNSUBSCRIBE_MAILTO =
  "mailto:info@presttige.net?subject=Unsubscribe%20from%20Presttige%20updates";
const SCHEDULER_GROUP_NAME = process.env.TESTER_PURGE_SCHEDULER_GROUP || "default";
const TESTER_PURGE_DELAY_MINUTES = Math.max(1, Number(process.env.TESTER_PURGE_DELAY_MINUTES || "5"));
const TESTER_CLEANUP_FUNCTION_ARN =
  process.env.TESTER_CLEANUP_FUNCTION_ARN ||
  "arn:aws:lambda:us-east-1:343218208384:function:presttige-tester-cleanup";
const TESTER_CLEANUP_SCHEDULER_ROLE_ARN =
  process.env.TESTER_CLEANUP_SCHEDULER_ROLE_ARN ||
  "arn:aws:iam::343218208384:role/presttige-scheduler-invoke-tester-cleanup-role";
const TESTER_WHITELIST = new Set([
  "antoniompereira@me.com",
  "alternativeservice@gmail.com",
  "analuisasf@gmail.com",
]);

function loadTemplate() {
  return fs.readFileSync(path.join(__dirname, "subscriber-welcome-email.html"), "utf8");
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : ""
  );
}

function formatSource(address) {
  return `Presttige <${address}>`;
}

function sanitizeHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(value) {
  const clean = sanitizeHeader(value);
  return /^[\x00-\x7F]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function base64Mime(value) {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n")
    .trim();
}

function buildSubscriberPlainText(displayName, tierSelectUrl) {
  return [
    `Dear ${displayName || "Member"},`,
    "",
    "You are now a Subscriber to Presttige, approved by our committee, on our communications list, and free to upgrade whenever you choose.",
    "",
    "You'll hear from us about Patron seat availability, new add-on services, and major Presttige milestones.",
    "",
    "When you're ready to step into the network as a member, three tiers are open to you:",
    "",
    "- Club, $22.22 / month, $99.99 / 6 months, or $144.44 / year",
    "- Premier, $55.55 / month, $277.77 / 6 months, or $388.88 / year",
    "- Patron, $999 lifetime, until 31 December 2026 or while Patron remains available",
    "",
    "Until then, welcome to the conversation.",
    "",
    "The Presttige Committee",
    "",
    `Return to tier selection: ${tierSelectUrl}`,
    "",
    "https://presttige.net",
  ].join("\n");
}

function buildRawMultipartEmail({ to, subject, text, html, unsubscribeMailto }) {
  const boundary = `presttige-alt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const headers = [
    `From: ${formatSource(FROM)}`,
    `Reply-To: ${REPLY_TO}`,
    `To: ${sanitizeHeader(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `List-Unsubscribe: <${unsubscribeMailto}>`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];

  return Buffer.from(
    [
      headers.join("\r\n"),
      "",
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Mime(text),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      base64Mime(html),
      `--${boundary}--`,
      "",
    ].join("\r\n"),
    "utf8"
  );
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isTesterEmail(email) {
  return TESTER_WHITELIST.has(normalizeEmail(email));
}

function buildTesterCleanupScheduleName(leadId) {
  return `presttige-tester-cleanup-${String(leadId || "").trim()}`.slice(0, 64);
}

function buildAtExpression(date) {
  return `at(${date.toISOString().replace(/\.\d{3}Z$/, "")})`;
}

async function scheduleTesterCleanup(lead, trigger) {
  const leadId = String(lead?.lead_id || "").trim();
  const email = normalizeEmail(lead?.email);
  if (!leadId) {
    return { scheduled: false, reason: "missing_lead_id" };
  }

  const scheduleName =
    String(lead?.tester_cleanup_schedule_name || "").trim() || buildTesterCleanupScheduleName(leadId);
  const scheduledAt = new Date(Date.now() + TESTER_PURGE_DELAY_MINUTES * 60 * 1000);
  let alreadyScheduled = false;

  try {
    await scheduler.send(
      new CreateScheduleCommand({
        Name: scheduleName,
        GroupName: SCHEDULER_GROUP_NAME,
        ScheduleExpression: buildAtExpression(scheduledAt),
        FlexibleTimeWindow: { Mode: "OFF" },
        Target: {
          Arn: TESTER_CLEANUP_FUNCTION_ARN,
          RoleArn: TESTER_CLEANUP_SCHEDULER_ROLE_ARN,
          Input: JSON.stringify({
            body: JSON.stringify({
              lead_id: leadId,
              trigger,
            }),
          }),
        },
        ActionAfterCompletion: "DELETE",
      })
    );
  } catch (error) {
    const code = error?.name || error?.Code || error?.code || "";
    if (code !== "ConflictException") {
      throw error;
    }
    alreadyScheduled = true;
  }

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { lead_id: leadId },
      ConditionExpression: "attribute_exists(lead_id)",
      UpdateExpression: "SET tester_cleanup_schedule_name = :name, tester_cleanup_scheduled_at = :at",
      ExpressionAttributeValues: {
        ":name": scheduleName,
        ":at": scheduledAt.toISOString(),
      },
    })
  );

  console.log(
    `TESTER_CLEANUP_SCHEDULED trigger=${trigger} email=${email} lead_id=${leadId} ` +
      `schedule_name=${scheduleName} fire_at=${scheduledAt.toISOString()} ` +
      `delay_minutes=${TESTER_PURGE_DELAY_MINUTES} already_scheduled=${String(alreadyScheduled)}`
  );

  return {
    scheduled: true,
    alreadyScheduled,
    scheduleName,
    scheduledAt: scheduledAt.toISOString(),
    delayMinutes: TESTER_PURGE_DELAY_MINUTES,
  };
}

exports.handler = async (event) => {
  const { lead_id } = JSON.parse(event.body || "{}");
  if (!lead_id) {
    return response(400, { error: "Missing lead_id" });
  }

  try {
    const leadResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { lead_id },
      })
    );
    const lead = leadResult.Item;

    if (!lead) {
      return response(200, { already_gone: true, lead_id });
    }

    if (!lead.email || !lead.magic_token) {
      return response(400, { error: "Lead missing email or magic token" });
    }

    const testerLead = Boolean(lead.is_test) || isTesterEmail(lead.email);

    if (lead.subscriber_welcome_email_sent_at) {
      if (testerLead) {
        const cleanupSchedule = await scheduleTesterCleanup(lead, "e5_sub_sent");
        return response(200, { already_sent: true, tester_cleanup_scheduled: true, cleanup_schedule: cleanupSchedule });
      }
      return response(200, { already_sent: true });
    }

    const tierSelectUrl = `https://presttige.net/tier-select/${lead.magic_token}`;
    const displayName = lead.name || "Member";
    const subject = `Welcome to Presttige, ${displayName}`;
    const html = fill(loadTemplate(), {
      subject,
      headline: `Welcome, ${displayName}.`,
      tier_select_url: tierSelectUrl,
      name: displayName,
    });
    const text = buildSubscriberPlainText(displayName, tierSelectUrl);

    console.log("SES subscriber sender config", {
      from: FROM,
      reply_to: REPLY_TO,
      lead_id,
      recipient_email: lead.email,
    });

    await ses.send(
      new SendRawEmailCommand({
        Source: formatSource(FROM),
        Destinations: [lead.email],
        ConfigurationSetName: SES_CONFIGURATION_SET,
        RawMessage: {
          Data: buildRawMultipartEmail({
            to: lead.email,
            subject,
            text,
            html,
            unsubscribeMailto: UPDATES_UNSUBSCRIBE_MAILTO,
          }),
        },
      })
    );

    const sentAt = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id },
        UpdateExpression: "SET subscriber_welcome_email_sent_at = :sent_at",
        ConditionExpression: "attribute_exists(lead_id)",
        ExpressionAttributeValues: {
          ":sent_at": sentAt,
        },
      })
    );

    if (testerLead) {
      const cleanupSchedule = await scheduleTesterCleanup(
        {
          ...lead,
          subscriber_welcome_email_sent_at: sentAt,
        },
        "e5_sub_sent"
      );
      return response(200, { sent: true, tester_cleanup_scheduled: true, cleanup_schedule: cleanupSchedule });
    }

    return response(200, { sent: true });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || error?.name === "ConditionalCheckFailedException") {
      return response(200, { already_gone: true, lead_id });
    }
    console.error("send-subscriber-welcome-email error", error);
    return response(500, { error: "Internal", detail: error.message });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
