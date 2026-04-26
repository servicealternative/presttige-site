const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");
const path = require("path");

const ses = new SESClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const FROM = "committee@presttige.net";
const REPLY_TO = "committee@presttige.net";

function loadTemplate() {
  return fs.readFileSync(path.join(__dirname, "application-received-email.html"), "utf8");
}

function fill(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : ""
  );
}

exports.handler = async (event) => {
  const { lead_id, force_resend } = JSON.parse(event.body || "{}");

  if (!lead_id) {
    return resp(400, { error: "Missing lead_id" });
  }

  try {
    const lead = (
      await ddb.send(new GetCommand({ TableName: "presttige-db", Key: { lead_id } }))
    ).Item;

    if (!lead) {
      return resp(404, { error: "Lead not found" });
    }

    if (!lead.email) {
      return resp(400, { error: "Lead has no email" });
    }

    if (lead.application_received_email_sent_at && !force_resend) {
      console.log("Already sent for", lead_id);
      return resp(200, { already_sent: true });
    }

    const html = fill(loadTemplate(), {
      name: lead.name || "there",
    });

    console.log("SES sender config", {
      from: FROM,
      reply_to: REPLY_TO,
      lead_id,
      recipient_email: lead.email,
      force_resend: Boolean(force_resend),
    });

    await ses.send(
      new SendEmailCommand({
        Source: FROM,
        ReplyToAddresses: [REPLY_TO],
        Destination: { ToAddresses: [lead.email] },
        Message: {
          Subject: { Data: "Your application is with us", Charset: "UTF-8" },
          Body: { Html: { Data: html, Charset: "UTF-8" } },
        },
      })
    );

    await ddb.send(
      new UpdateCommand({
        TableName: "presttige-db",
        Key: { lead_id },
        UpdateExpression: "SET application_received_email_sent_at = :ts",
        ExpressionAttributeValues: { ":ts": new Date().toISOString() },
      })
    );

    return resp(200, { sent: true, to: lead.email });
  } catch (err) {
    console.error("send-application-received error", err);
    return resp(500, { error: "Internal", detail: err.message });
  }
};

function resp(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
