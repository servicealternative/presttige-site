"use strict";

const path = require("node:path");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

function loadFounderInviterEligibilityModule() {
  const candidates = [
    path.join(__dirname, "..", "lib", "founder-inviter-eligibility.js"),
    path.join(__dirname, "lib", "founder-inviter-eligibility.js"),
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") {
        throw error;
      }
    }
  }

  throw new Error("Founder inviter eligibility module not found");
}

const { isEligibleFounderInviter } = loadFounderInviterEligibilityModule();

const REGION = "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "presttige-db";
const APP_ORIGIN = process.env.APP_ORIGIN || "https://presttige.net";
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    if (!isSupportedEmail(invitedEmail)) {
      return invalidResponse();
    }

    const invitedRecord = await findLeadByEmail(invitedEmail);
    const inviterEmail = normalizeEmail(invitedRecord?.inviter_email);

    if (!isSupportedEmail(inviterEmail)) {
      return invalidResponse();
    }

    if (!(await isFounderGateValid(invitedRecord, inviterEmail))) {
      return invalidResponse();
    }

    return response(200, {
      valid: true,
      tier: "founder",
      inviter_email: inviterEmail,
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

async function findLeadByEmail(email) {
  let ExclusiveStartKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": email,
        },
        ExclusiveStartKey,
      })
    );

    if (result.Items?.length) {
      return result.Items[0];
    }

    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return null;
}

async function isFounderGateValid(invitedRecord, inviterEmail) {
  if (!invitedRecord) {
    return false;
  }

  if (normalizeString(invitedRecord.subscriber_type).toLowerCase() !== "founder_invited") {
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

  const inviterRecord = await findLeadByEmail(inviterEmail);
  return isEligibleFounderInviter(inviterEmail, {
    logger: console,
    inviterRecord,
    inviterLeadId: invitedRecord.inviter_lead_id,
    invitedLeadId: invitedRecord.lead_id,
    allowLeadIdLookup: false,
  });
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
