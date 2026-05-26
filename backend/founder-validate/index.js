"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const REGION = "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "presttige-db";
const APP_ORIGIN = process.env.APP_ORIGIN || "https://presttige.net";
const MAX_TOKEN_LENGTH = 256;
const MAGIC_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

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
    const token = normalizeToken(parseJsonBody(event).token);
    if (!isSupportedToken(token)) {
      return invalidResponse();
    }

    const lead = await findLeadByMagicToken(token);
    if (!isFounderGateValid(lead, token)) {
      return invalidResponse();
    }

    return response(200, {
      valid: true,
      tier: "founder",
      lead_id: lead.lead_id,
    });
  } catch (error) {
    console.error("founder-validate error", {
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

function normalizeToken(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function isSupportedToken(token) {
  return (
    token.length > 0 &&
    token.length <= MAX_TOKEN_LENGTH &&
    MAGIC_TOKEN_PATTERN.test(token)
  );
}

async function findLeadByMagicToken(token) {
  let ExclusiveStartKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "magic_token = :token",
        ExpressionAttributeValues: {
          ":token": token,
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

function isFounderGateValid(lead, providedToken) {
  if (!lead) {
    return false;
  }

  if (normalizeString(lead.magic_token) !== providedToken) {
    return false;
  }

  if (normalizeString(lead.review_status).toLowerCase() !== "approved") {
    return false;
  }

  if (normalizeString(lead.magic_token_status).toLowerCase() !== "active") {
    return false;
  }

  const expiresAt = parseIsoDate(lead.magic_token_expires_at);
  if (!expiresAt || expiresAt.getTime() <= Date.now()) {
    return false;
  }

  if (!isTruthy(lead.founder_eligible)) {
    return false;
  }

  if (normalizeString(lead.founder_gate_status).toLowerCase() !== "confirmed") {
    return false;
  }

  if (normalizeString(lead.tier_intent).toLowerCase() !== "founder") {
    return false;
  }

  return true;
}

function normalizeString(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
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

function parseIsoDate(value) {
  const input = normalizeString(value);
  if (!input) {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}
