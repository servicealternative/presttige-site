const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");
const path = require("path");

const ses = new SESClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const TABLE_NAME = "presttige-db";
const FROM = "private@presttige.net";
const REPLY_TO = "info@presttige.net";
const BCC = "committee@presttige.net";

function loadTemplate() {
  return fs.readFileSync(path.join(__dirname, "welcome-email.html"), "utf8");
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : ""
  );
}

function tierLabel(tier) {
  const mapping = {
    patron: "Patron",
    tier2: "Associate",
    tier3: "Affiliate",
    free: "Complimentary",
  };
  return mapping[tier] || "Presttige Membership";
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

    if (!lead.email || !lead.magic_token) {
      return response(400, { error: "Lead missing email or magic token" });
    }

    if (lead.welcome_sent_at) {
      return response(200, { already_sent: true });
    }

    const welcomeLink = `https://presttige.net/welcome/${lead.magic_token}`;
    const selectedTier = lead.selected_tier || "free";
    const effectiveTier = lead.effective_tier || selectedTier;
    const effectiveTierLabel = tierLabel(effectiveTier);
    const upgradeSentence =
      effectiveTier !== selectedTier
        ? ` As an annual subscriber, you have full ${effectiveTierLabel} access for the next twelve months.`
        : "";
    const html = fill(loadTemplate(), {
      subject: "Welcome to Presttige",
      preheader: "Your membership is active. Enter Presttige.",
      eyebrow: "MEMBERSHIP ACTIVATED",
      headline: `Welcome to Presttige, ${lead.name || "Member"}`,
      body_copy: `Your ${effectiveTierLabel} membership is active. Click below to access your account.${upgradeSentence}`,
      welcome_url: welcomeLink,
      disclaimer:
        "This link is private. If you did not expect this email, please reply to info@presttige.net immediately.",
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
            Data: "Welcome to Presttige",
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
        UpdateExpression: "SET welcome_sent_at = :sent_at, welcome_variant = :variant",
        ExpressionAttributeValues: {
          ":sent_at": new Date().toISOString(),
          ":variant": "membership_active",
        },
      })
    );

    return response(200, { sent: true });
  } catch (error) {
    console.error("send-welcome-email error", error);
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
