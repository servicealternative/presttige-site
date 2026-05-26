"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "presttige-db";
const APP_ORIGIN = process.env.APP_ORIGIN || "https://presttige.net";
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_PAYMENT_STATUSES = new Set([
  "paid",
  "free",
  "subscription_active",
  "preview_paid",
]);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || "POST";

  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (method !== "POST") {
    return invalidResponse();
  }

  try {
    const body = parseJsonBody(event);
    const invitedEmail = normalizeEmail(
      body.invited_email || body.founder_email || body.email
    );
    const inviterEmail = normalizeEmail(body.inviter_email);

    if (!isSupportedEmail(invitedEmail) || !isSupportedEmail(inviterEmail)) {
      return invalidResponse();
    }

    const records = await findLeadsByEmails([invitedEmail, inviterEmail]);
    const invitedRecord = records.find(
      (record) => normalizeEmail(record.email) === invitedEmail
    );
    const inviterRecord = records.find(
      (record) => normalizeEmail(record.email) === inviterEmail
    );

    if (!isFounderGateValid(invitedRecord, inviterRecord, inviterEmail)) {
      return invalidResponse();
    }

    return response(200, {
      valid: true,
      tier: "founder",
    });
  } catch (error) {
    console.error("founder-gate error", {
      name: error?.name || "Error",
      message: error?.message || "Unknown error",
    });
    return invalidResponse();
  }
};

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function invalidResponse() {
  return response(200, { valid: false });
}

function parseJsonBody(event) {
  if (!event?.body) {
    return {};
  }

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    const parsed = JSON.parse(rawBody);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (_error) {
    return {};
  }
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function normalizeEmail(value) {
  return normalizeString(value).toLowerCase();
}

function isSupportedEmail(email) {
  return (
    email.length > 0 &&
    email.length <= MAX_EMAIL_LENGTH &&
    EMAIL_PATTERN.test(email)
  );
}

async function findLeadsByEmails(emails) {
  const wantedEmails = Array.from(new Set(emails));
  const found = [];
  let ExclusiveStartKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "email IN (:email0, :email1)",
        ExpressionAttributeValues: {
          ":email0": wantedEmails[0],
          ":email1": wantedEmails[1],
        },
        ExclusiveStartKey,
      })
    );

    if (result.Items?.length) {
      found.push(...result.Items);
    }

    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return found;
}

function isFounderGateValid(invitedRecord, inviterRecord, inviterEmail) {
  if (!invitedRecord || !inviterRecord) {
    return false;
  }

  if (normalizeString(invitedRecord.founder_token_status).toLowerCase() !== "active") {
    return false;
  }

  if (!isTruthy(invitedRecord.founder_eligible)) {
    return false;
  }

  if (normalizeString(invitedRecord.founder_gate_status).toLowerCase() !== "confirmed") {
    return false;
  }

  if (normalizeString(invitedRecord.tier_intent).toLowerCase() !== "founder") {
    return false;
  }

  if (normalizeEmail(invitedRecord.inviter_email) !== inviterEmail) {
    return false;
  }

  if (normalizeString(invitedRecord.inviter_lead_id) !== normalizeString(inviterRecord.lead_id)) {
    return false;
  }

  if (normalizeString(inviterRecord.review_status).toLowerCase() !== "approved") {
    return false;
  }

  if (!hasActiveAccountMarker(inviterRecord)) {
    return false;
  }

  return true;
}

function hasActiveAccountMarker(record) {
  return (
    isTruthy(record.account_active) ||
    normalizeString(record.access_status).toLowerCase() === "active" ||
    ACTIVE_PAYMENT_STATUSES.has(normalizeString(record.payment_status).toLowerCase())
  );
}

function isTruthy(value) {
  if (value === true) {
    return true;
  }
  if (value === false || value === undefined || value === null) {
    return false;
  }

  const normalized = normalizeString(value).toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}
