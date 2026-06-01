"use strict";

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { GetParameterCommand, SSMClient } = require("@aws-sdk/client-ssm");
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const LEADS_TABLE_NAME =
  process.env.TABLE_NAME || process.env.LEADS_TABLE_NAME || "presttige-db";
const ELIGIBLE_INVITERS_TABLE_NAME =
  process.env.ELIGIBLE_INVITERS_TABLE_NAME || "presttige-eligible-inviters";
const DIRECTUS_BASE_URL = process.env.DIRECTUS_BASE_URL || "https://crm.ulttra.net";
const DIRECTUS_SYNC_TOKEN_PARAMETER =
  process.env.DIRECTUS_SYNC_TOKEN_PARAMETER || "/presttige/ulttra-sync/directus-token";
const CHAIRMAN_EMAIL = normalizeEmail(process.env.CHAIRMAN_EMAIL || "apereira@presttige.net");
const CHAIRMAN_PERSON_ID = normalizeString(process.env.CHAIRMAN_PERSON_ID || "4");
const CHAIRMAN_TYPE = "chairman";
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INTERNAL_INVITER_ROLES = new Set([
  "admin",
  "team",
  "ambassador",
  "business_partner",
  "influencer",
]);
const BLOCKED_SUBSCRIBER_TYPES = new Set([
  "subscriber",
  "club",
  "premier",
  "patron",
]);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const ssm = new SSMClient({ region: REGION });
let cachedDirectusSyncToken = null;

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

function normalizeRole(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

async function findInternalMirrorRecord(email, options = {}) {
  const client = options.ddbClient || ddb;
  const tableName = options.tableName || ELIGIBLE_INVITERS_TABLE_NAME;
  const result = await client.send(
    new GetCommand({
      TableName: tableName,
      Key: { email },
    })
  );

  return result.Item || null;
}

async function findLeadByLeadId(leadId, options = {}) {
  const normalizedLeadId = normalizeString(leadId);
  if (!normalizedLeadId) {
    return null;
  }

  const client = options.ddbClient || ddb;
  const tableName = options.leadsTableName || LEADS_TABLE_NAME;
  const result = await client.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "lead_id = :lead_id",
      ExpressionAttributeValues: {
        ":lead_id": normalizedLeadId,
      },
      Limit: 1,
    })
  );

  return result.Items?.[0] || null;
}

async function loadDirectusSyncToken(options = {}) {
  if (options.directusToken) {
    return options.directusToken;
  }

  if (cachedDirectusSyncToken) {
    return cachedDirectusSyncToken;
  }

  const client = options.ssmClient || ssm;
  const parameterName = options.directusTokenParameter || DIRECTUS_SYNC_TOKEN_PARAMETER;
  const result = await client.send(
    new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    })
  );
  const token = normalizeString(result.Parameter?.Value);
  if (!token) {
    throw new Error("Directus sync token is empty.");
  }
  cachedDirectusSyncToken = token;
  return token;
}

async function readDirectusChairmanPerson(email, options = {}) {
  const expectedEmail = normalizeEmail(email);
  if (expectedEmail !== CHAIRMAN_EMAIL) {
    return null;
  }

  const directusBaseUrl = normalizeString(options.directusBaseUrl || DIRECTUS_BASE_URL)
    .replace(/\/+$/, "");
  const url = new URL(`${directusBaseUrl}/items/people/${encodeURIComponent(CHAIRMAN_PERSON_ID)}`);
  url.searchParams.set("fields", "id,email,type,status,synthetic_test");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${await loadDirectusSyncToken(options)}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Directus Chairman lookup failed: ${response.status}`);
  }

  const payload = await response.json();
  const person = payload?.data || null;
  if (
    normalizeString(person?.id) === CHAIRMAN_PERSON_ID &&
    normalizeEmail(person?.email) === CHAIRMAN_EMAIL &&
    normalizeRole(person?.type) === CHAIRMAN_TYPE &&
    normalizeString(person?.status).toLowerCase() === "active" &&
    !isTruthy(person?.synthetic_test)
  ) {
    return person;
  }

  return null;
}

async function isChairmanInviter(email, options = {}) {
  if (email !== CHAIRMAN_EMAIL) {
    return false;
  }

  const person = options.chairmanPerson || await readDirectusChairmanPerson(email, options);
  return Boolean(person);
}

async function resolveFounderRecord(email, options = {}) {
  const hasInviterRecord = Object.prototype.hasOwnProperty.call(options, "inviterRecord");
  if (hasInviterRecord && options.inviterRecord) {
    return options.inviterRecord;
  }

  if (options.inviterLeadId && options.allowLeadIdLookup !== false) {
    return findLeadByLeadId(options.inviterLeadId, options);
  }

  if (hasInviterRecord) {
    return null;
  }

  return null;
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
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isGenuineActiveFounder(record, email) {
  if (!record || normalizeEmail(record.email) !== email) {
    return false;
  }

  if (isTruthy(record.synthetic_test)) {
    return false;
  }

  const subscriberType = normalizeString(record.subscriber_type).toLowerCase();
  const tier = normalizeString(record.tier).toLowerCase();
  const selectedTier = normalizeString(record.selected_tier).toLowerCase();

  if (
    BLOCKED_SUBSCRIBER_TYPES.has(subscriberType) ||
    BLOCKED_SUBSCRIBER_TYPES.has(tier) ||
    BLOCKED_SUBSCRIBER_TYPES.has(selectedTier)
  ) {
    return false;
  }

  return (
    subscriberType === "founder" &&
    (tier === "founder" || selectedTier === "founder") &&
    isTruthy(record.founder_lifetime) &&
    normalizeString(record.payment_status).toLowerCase() === "paid" &&
    normalizeString(record.access_status).toLowerCase() === "active"
  );
}

function hasUsableFounderInvite(record, options = {}) {
  if (normalizeString(record.founder_invite_status).toLowerCase() !== "active") {
    return false;
  }

  if (!normalizeString(record.founder_invite_token)) {
    return false;
  }

  const expiresAt = parseIsoDate(record.founder_invite_expires_at);
  const now = options.now instanceof Date ? options.now : new Date();
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) {
    return false;
  }

  const boundInviteeLeadId = normalizeString(record.founder_invite_invitee_lead_id);
  const presentedInviteeLeadId = normalizeString(options.invitedLeadId);
  if (boundInviteeLeadId) {
    return Boolean(presentedInviteeLeadId && boundInviteeLeadId === presentedInviteeLeadId);
  }

  return options.allowUnboundFounderInvite === true;
}

async function isEligibleFounderInviter(inviterEmail, options = {}) {
  const email = normalizeEmail(inviterEmail);
  if (!isSupportedEmail(email)) {
    return false;
  }

  if (email === CHAIRMAN_EMAIL) {
    try {
      return await isChairmanInviter(email, options);
    } catch (error) {
      if (options.logger && typeof options.logger.error === "function") {
        options.logger.error("founder_inviter_chairman_lookup_failed", {
          name: error?.name || "Error",
          message: error?.message || "Unknown error",
        });
      }
      return false;
    }
  }

  try {
    const mirrorRecord = await findInternalMirrorRecord(email, options);
    if (mirrorRecord) {
      const mirrorEmail = normalizeEmail(mirrorRecord.email || email);
      const role = normalizeRole(mirrorRecord.role);
      return mirrorEmail === email && INTERNAL_INVITER_ROLES.has(role);
    }
  } catch (error) {
    if (options.logger && typeof options.logger.error === "function") {
      options.logger.error("founder_inviter_eligibility_lookup_failed", {
        name: error?.name || "Error",
        message: error?.message || "Unknown error",
      });
    }
    return false;
  }

  try {
    const founderRecord = await resolveFounderRecord(email, options);
    return (
      isGenuineActiveFounder(founderRecord, email) &&
      hasUsableFounderInvite(founderRecord, options)
    );
  } catch (error) {
    if (options.logger && typeof options.logger.error === "function") {
      options.logger.error("founder_inviter_founder_lookup_failed", {
        name: error?.name || "Error",
        message: error?.message || "Unknown error",
      });
    }
    return false;
  }
}

module.exports = {
  INTERNAL_INVITER_ROLES,
  BLOCKED_SUBSCRIBER_TYPES,
  isEligibleFounderInviter,
  isChairmanInviter,
  normalizeEmail,
  normalizeRole,
};
