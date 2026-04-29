const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");
const path = require("path");

const ses = new SESClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const TABLE_NAME = "presttige-db";
const FROM = "committee@presttige.net";
const REPLY_TO = "committee@presttige.net";
const BCC = "committee@presttige.net";

function loadTemplate() {
  return fs.readFileSync(path.join(__dirname, "tier-select-email.html"), "utf8");
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : ""
  );
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
      return response(404, { error: "Lead not found" });
    }

    if (!lead.email) {
      return response(400, { error: "Lead email missing" });
    }

    if (!lead.magic_token) {
      return response(400, { error: "Magic token missing" });
    }

    if (lead.e3_sent_at) {
      return response(200, { already_sent: true });
    }

    const tierSelectUrl = `https://presttige.net/tier-select/${lead.magic_token}?lead_id=${encodeURIComponent(lead.lead_id)}`;
    const html = fill(loadTemplate(), {
      subject: "Welcome to Presttige — Choose your membership",
      preheader: "Your application has been approved. Choose your preferred tier to continue.",
      eyebrow: "WELCOME — APPLICATION APPROVED",
      headline: lead.name || "Presttige Member",
      body_copy:
        "Your application has been approved by the Presttige Committee. To activate your membership, please choose your preferred tier:",
      tier_select_url: tierSelectUrl,
      disclaimer:
        "This invitation is private and time-limited. The link above expires in 7 days. If you have questions, reply to this email.",
    });

    console.log("SES sender config", {
      from: FROM,
      reply_to: REPLY_TO,
      bcc: BCC,
      lead_id,
      recipient_email: lead.email,
    });

    await ses.send(
      new SendEmailCommand({
        Source: FROM,
        ReplyToAddresses: [REPLY_TO],
        Destination: {
          ToAddresses: [lead.email],
          BccAddresses: [BCC],
        },
        Message: {
          Subject: {
            Data: "Welcome to Presttige — Choose your membership",
            Charset: "UTF-8",
          },
          Body: {
            Html: {
              Data: html,
              Charset: "UTF-8",
            },
          },
        },
      })
    );

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id },
        UpdateExpression: "SET e3_sent_at = :sent_at, e3_variant = :variant",
        ExpressionAttributeValues: {
          ":sent_at": new Date().toISOString(),
          ":variant": "tier_select",
        },
      })
    );

    return response(200, { sent: true });
  } catch (error) {
    console.error("send-tier-select-email error", error);
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
