const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = require("@aws-sdk/client-s3");
const { SchedulerClient, DeleteScheduleCommand } = require("@aws-sdk/client-scheduler");
const { SESv2Client, GetSuppressedDestinationCommand, DeleteSuppressedDestinationCommand } = require("@aws-sdk/client-sesv2");
const { DynamoDBDocumentClient, GetCommand, DeleteCommand, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const s3 = new S3Client({ region: "us-east-1" });
const scheduler = new SchedulerClient({ region: "us-east-1" });
const sesv2 = new SESv2Client({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const ORIGINALS_BUCKET = process.env.PHOTOS_ORIGINALS_BUCKET || "presttige-applicant-photos";
const THUMBNAILS_BUCKET = process.env.PHOTOS_THUMBNAILS_BUCKET || "presttige-applicant-photos-thumbnails";
const SCHEDULER_GROUP_NAME = process.env.TESTER_PURGE_SCHEDULER_GROUP || "default";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
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

async function scanPreviewLeads() {
  let ExclusiveStartKey;
  const items = [];

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "preview_mode = :preview_mode",
        ExpressionAttributeValues: {
          ":preview_mode": true,
        },
        ExclusiveStartKey,
      })
    );

    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function purgeLeadRecord(lead, trigger) {
  const leadId = String(lead?.lead_id || "").trim();
  const email = normalizeEmail(lead?.email);

  const scheduleNames = [
    String(lead.e3_schedule_name || "").trim(),
    String(lead.tester_cleanup_schedule_name || "").trim(),
  ];
  let deletedSchedules = 0;
  for (const scheduleName of scheduleNames) {
    if (scheduleName && (await deleteScheduleIfPresent(scheduleName))) {
      deletedSchedules += 1;
    }
  }

  let deletedPhotos = 0;
  deletedPhotos += await deleteS3Prefix(ORIGINALS_BUCKET, `${leadId}/`);
  deletedPhotos += await deleteS3Prefix(THUMBNAILS_BUCKET, `${leadId}/`);

  let deletedRecord = false;
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
  const body = JSON.parse(event?.body || "{}");
  const leadId = String(body.lead_id || "").trim();
  const trigger = String(body.trigger || "scheduled_cleanup").trim();
  const action = String(body.action || "").trim().toLowerCase();
  const confirm = String(body.confirm || "").trim();

  if (action === "delete_preview_leads") {
    if (confirm !== "DELETE_PREVIEW_LEADS") {
      return response(400, { error: "Missing confirmation token for bulk preview cleanup." });
    }

    const previewLeads = await scanPreviewLeads();
    const deletedLeadIds = [];

    for (const previewLead of previewLeads) {
      const previewLeadId = String(previewLead?.lead_id || "").trim();
      if (!previewLeadId) {
        continue;
      }
      await purgeLeadRecord(previewLead, "bulk_preview_cleanup");
      deletedLeadIds.push(previewLeadId);
    }

    return response(200, {
      deleted_count: deletedLeadIds.length,
      deleted_lead_ids: deletedLeadIds,
    });
  }

  if (!leadId) {
    return response(400, { error: "Missing lead_id" });
  }

  const leadResult = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { lead_id: leadId },
    })
  );
  const lead = leadResult.Item;

  if (!lead) {
    console.log(
      `TESTER_PURGE_ON_FUNNEL_COMPLETE trigger=${trigger} email=unknown lead_id=${leadId} ` +
        "deleted_record=false deleted_schedules=0 deleted_photos=0 ses_suppression_removed=false already_gone=true"
    );
    return response(200, { already_gone: true, lead_id: leadId });
  }

  const cleanupEligible = Boolean(lead.is_test) && !Boolean(lead.preview_mode);
  if (!cleanupEligible) {
    return response(200, { skipped_real_user: true, lead_id: leadId });
  }

  return response(200, await purgeLeadRecord(lead, trigger));
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
