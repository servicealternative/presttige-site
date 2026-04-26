const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { SchedulerClient, DeleteScheduleCommand } = require("@aws-sdk/client-scheduler");
const { SESv2Client, GetSuppressedDestinationCommand, DeleteSuppressedDestinationCommand } = require("@aws-sdk/client-sesv2");
const { ConditionalCheckFailedException } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } = require("@aws-sdk/lib-dynamodb");
const fs = require("fs");
const path = require("path");

const ses = new SESClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const s3 = new S3Client({ region: "us-east-1" });
const scheduler = new SchedulerClient({ region: "us-east-1" });
const sesv2 = new SESv2Client({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const FROM = "private@presttige.net";
const REPLY_TO = "info@presttige.net";
const BCC = "committee@presttige.net";
const ORIGINALS_BUCKET = process.env.PHOTOS_ORIGINALS_BUCKET || "presttige-applicant-photos";
const THUMBNAILS_BUCKET = process.env.PHOTOS_THUMBNAILS_BUCKET || "presttige-applicant-photos-thumbnails";
const SCHEDULER_GROUP_NAME = process.env.TESTER_PURGE_SCHEDULER_GROUP || "default";
const TESTER_WHITELIST = new Set([
  "antoniompereira@me.com",
  "alternativeservice@gmail.com",
]);

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

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isTesterEmail(email) {
  return TESTER_WHITELIST.has(normalizeEmail(email));
}

async function deleteScheduleIfPresent(scheduleName) {
  if (!scheduleName) {
    return false;
  }

  try {
    await scheduler.send(
      new DeleteScheduleCommand({
        Name: scheduleName,
        GroupName: SCHEDULER_GROUP_NAME,
      })
    );
    return true;
  } catch (error) {
    const code = error?.name || error?.Code || error?.code || "";
    if (!["ResourceNotFoundException", "ValidationException"].includes(code)) {
      console.log(`TESTER_PURGE_WARN schedule_delete_failed name=${scheduleName} error=${code || error.message}`);
    }
    return false;
  }
}

async function deleteS3Prefix(bucket, prefix) {
  if (!bucket || !prefix) {
    return 0;
  }

  let deleted = 0;
  let continuationToken;

  while (true) {
    let listResponse;
    try {
      listResponse = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        })
      );
    } catch (error) {
      console.log(`TESTER_PURGE_WARN s3_list_failed bucket=${bucket} prefix=${prefix} error=${error.name || error.message}`);
      break;
    }

    const objects = (listResponse.Contents || [])
      .map((item) => item.Key)
      .filter(Boolean)
      .map((Key) => ({ Key }));

    if (objects.length) {
      try {
        const deleteResponse = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: objects,
              Quiet: true,
            },
          })
        );
        deleted += (deleteResponse.Deleted || []).length;
      } catch (error) {
        console.log(`TESTER_PURGE_WARN s3_delete_failed bucket=${bucket} prefix=${prefix} error=${error.name || error.message}`);
      }
    }

    if (!listResponse.IsTruncated) {
      break;
    }
    continuationToken = listResponse.NextContinuationToken;
  }

  return deleted;
}

async function removeSesSuppressionIfPresent(email) {
  if (!email) {
    return false;
  }

  try {
    await sesv2.send(
      new GetSuppressedDestinationCommand({
        EmailAddress: email,
      })
    );
  } catch (error) {
    const code = error?.name || error?.Code || error?.code || "";
    if (["NotFoundException", "BadRequestException"].includes(code)) {
      return false;
    }
    console.log(`TESTER_PURGE_WARN ses_get_suppression_failed email=${email} error=${code || error.message}`);
    return false;
  }

  try {
    await sesv2.send(
      new DeleteSuppressedDestinationCommand({
        EmailAddress: email,
      })
    );
    return true;
  } catch (error) {
    const code = error?.name || error?.Code || error?.code || "";
    console.log(`TESTER_PURGE_WARN ses_delete_suppression_failed email=${email} error=${code || error.message}`);
    return false;
  }
}

async function purgeTesterLead(lead, trigger) {
  const leadId = String(lead?.lead_id || "").trim();
  const email = normalizeEmail(lead?.email);
  const scheduleName = String(lead?.e3_schedule_name || "").trim();

  const deletedSchedules = (await deleteScheduleIfPresent(scheduleName)) ? 1 : 0;
  let deletedPhotos = 0;
  let deletedRecord = false;

  if (leadId) {
    deletedPhotos += await deleteS3Prefix(ORIGINALS_BUCKET, `${leadId}/`);
    deletedPhotos += await deleteS3Prefix(THUMBNAILS_BUCKET, `${leadId}/`);
    try {
      await ddb.send(
        new DeleteCommand({
          TableName: TABLE_NAME,
          Key: { lead_id: leadId },
        })
      );
      deletedRecord = true;
    } catch (error) {
      console.log(`TESTER_PURGE_WARN delete_record_failed lead_id=${leadId} error=${error.message}`);
    }
  }

  const sesSuppressionRemoved = await removeSesSuppressionIfPresent(email);

  console.log(
    `TESTER_PURGE_ON_FUNNEL_COMPLETE trigger=${trigger} email=${email} lead_id=${leadId} ` +
      `deleted_record=${String(deletedRecord)} deleted_schedules=${deletedSchedules} ` +
      `deleted_photos=${deletedPhotos} ses_suppression_removed=${String(sesSuppressionRemoved)}`
  );

  return {
    deletedRecord,
    deletedSchedules,
    deletedPhotos,
    sesSuppressionRemoved,
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

    if (lead.welcome_sent_at) {
      if (testerLead) {
        const purgeResult = await purgeTesterLead(lead, "e5_sent");
        return response(200, { already_sent: true, tester_purged: true, purge_result: purgeResult });
      }
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
        ConditionExpression: "attribute_exists(lead_id)",
        ExpressionAttributeValues: {
          ":sent_at": new Date().toISOString(),
          ":variant": "membership_active",
        },
      })
    );

    if (testerLead) {
      const purgeResult = await purgeTesterLead(lead, "e5_sent");
      return response(200, { sent: true, tester_purged: true, purge_result: purgeResult });
    }

    return response(200, { sent: true });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException || error?.name === "ConditionalCheckFailedException") {
      return response(200, { already_gone: true, lead_id });
    }
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
