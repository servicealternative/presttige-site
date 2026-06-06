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
const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || "presttige-deliverability-v1";

function formatSource(address) {
  return `Presttige <${address}>`;
}

function loadTemplate() {
  return fs.readFileSync(path.join(__dirname, "tier-select-email.html"), "utf8");
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : ""
  );
}

function buildPlainText({ name, bodyCopy, tierSelectUrl, disclaimer }) {
  return [
    `Dear ${name || "Presttige Member"},`,
    "",
    "Welcome to Presttige. Your application has been approved.",
    "",
    bodyCopy,
    "",
    `Choose your tier: ${tierSelectUrl}`,
    "",
    disclaimer,
    "",
    "Member Services",
    "PRESTTIGE PRIVATE OFFICE",
  ].join("\n");
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
    const bodyCopy =
      "Your application has been approved by the Presttige Committee. To activate your membership, please choose your preferred tier:";
    const disclaimer =
      "This invitation is private and time-limited. The link above expires in 7 days. If you have questions, reply to this email.";
    const html = fill(loadTemplate(), {
      subject: "Welcome to Presttige — Choose your membership",
      preheader: "Your application has been approved. Choose your preferred tier to continue.",
      eyebrow: "WELCOME — APPLICATION APPROVED",
      headline: lead.name || "Presttige Member",
      body_copy: bodyCopy,
      tier_select_url: tierSelectUrl,
      disclaimer,
    });
    const text = buildPlainText({
      name: lead.name,
      bodyCopy,
      tierSelectUrl,
      disclaimer,
    });

    console.log("SES sender config", {
      from: FROM,
      reply_to: REPLY_TO,
      to: [lead.email],
      cc: [],
      bcc: [],
      lead_id,
      recipient_email: lead.email,
    });

    const sesResponse = await ses.send(
      new SendEmailCommand({
        Source: formatSource(FROM),
        ConfigurationSetName: SES_CONFIGURATION_SET,
        ReplyToAddresses: [REPLY_TO],
        Destination: {
          ToAddresses: [lead.email],
        },
        Message: {
          Subject: {
            Data: "Welcome to Presttige — Choose your membership",
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: text,
              Charset: "UTF-8",
            },
            Html: {
              Data: html,
              Charset: "UTF-8",
            },
          },
        },
      })
    );
    console.log("SES tier-select email sent", {
      lead_id,
      recipient_email: lead.email,
      message_id: sesResponse?.MessageId || null,
      to_count: 1,
      cc_count: 0,
      bcc_count: 0,
    });

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
