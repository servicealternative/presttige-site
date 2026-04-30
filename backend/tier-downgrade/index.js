"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  SchedulerClient,
  DeleteScheduleCommand,
} = require("@aws-sdk/client-scheduler");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.LEADS_TABLE_NAME || "presttige-db";
const SCHEDULER_GROUP_NAME = process.env.DOWNGRADE_SCHEDULER_GROUP || "default";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const scheduler = new SchedulerClient({ region: REGION });

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function normalizeString(value) {
  return String(value || "").trim();
}

function parsePayload(event) {
  if (event?.body) {
    try {
      return JSON.parse(event.body);
    } catch (error) {
      throw new Error("Event body must be valid JSON");
    }
  }
  return event || {};
}

function parseDueAt(lead) {
  const value =
    lead?.subscription_current_period_end ||
    lead?.cancel_scheduled_at ||
    lead?.current_period_end;

  if (!value) {
    return null;
  }

  if (typeof value === "number") {
    return new Date(value * 1000);
  }

  const raw = normalizeString(value);
  if (/^\d+$/.test(raw)) {
    return new Date(Number(raw) * 1000);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
      throw error;
    }
    return false;
  }
}

exports.handler = async (event) => {
  let payload;
  try {
    payload = parsePayload(event);
  } catch (error) {
    return response(400, { error: "invalid_payload", message: error.message });
  }

  const leadId = normalizeString(payload.lead_id);
  const reason = normalizeString(payload.reason) || "subscription_cancelled";

  if (!leadId) {
    return response(400, { error: "missing_lead_id" });
  }

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { lead_id: leadId },
    })
  );
  const lead = result.Item;

  if (!lead) {
    console.log(
      JSON.stringify({
        message: "tier_downgrade_lead_missing",
        lead_id: leadId,
        reason,
      })
    );
    return response(200, { skipped: true, reason: "lead_missing", lead_id: leadId });
  }

  const cancelAtPeriodEnd =
    lead.cancel_at_period_end === true ||
    lead.subscription_cancel_at_period_end === true;
  if (!cancelAtPeriodEnd) {
    return response(200, {
      skipped: true,
      reason: "cancel_at_period_end_not_set",
      lead_id: leadId,
    });
  }

  const dueAt = parseDueAt(lead);
  if (!dueAt || dueAt.getTime() > Date.now()) {
    return response(200, {
      skipped: true,
      reason: "period_not_ended",
      lead_id: leadId,
      due_at: dueAt ? dueAt.toISOString() : null,
    });
  }

  const scheduleName =
    normalizeString(payload.schedule_name) || normalizeString(lead.downgrade_schedule_name);
  const now = new Date().toISOString();

  const update = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { lead_id: leadId },
      ConditionExpression: "attribute_exists(lead_id)",
      UpdateExpression: `
        SET tier = :subscriber,
            selected_tier = :subscriber,
            subscription_status = :ended,
            payment_status = :payment_status,
            payment_status_reason = :payment_status_reason,
            access_status = :subscriber,
            cancel_at_period_end = :false,
            subscription_cancel_at_period_end = :false,
            downgraded_to_subscriber_at = :now,
            updated_at = :now
        REMOVE cancel_scheduled_at, downgrade_schedule_name
      `,
      ExpressionAttributeValues: {
        ":subscriber": "subscriber",
        ":ended": "ended",
        ":payment_status": "downgraded_to_subscriber",
        ":payment_status_reason": reason,
        ":false": false,
        ":now": now,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  const scheduleDeleted = await deleteScheduleIfPresent(scheduleName);
  const newState = {
    tier: update.Attributes?.tier || null,
    subscription_status: update.Attributes?.subscription_status || null,
    payment_status: update.Attributes?.payment_status || null,
    schedule_deleted: scheduleDeleted,
  };

  console.log(
    JSON.stringify({
      message: "tier_downgrade_completed",
      lead_id: leadId,
      reason,
      schedule_name: scheduleName || null,
      new_state: newState,
      timestamp: now,
    })
  );

  return response(200, {
    downgraded: true,
    lead_id: leadId,
    new_state: newState,
  });
};
