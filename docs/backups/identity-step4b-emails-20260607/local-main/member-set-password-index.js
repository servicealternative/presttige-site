"use strict";

const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const {
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
} = require("@aws-sdk/client-cognito-identity-provider");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "presttige-db";
const CHECKOUT_TOKEN_INDEX_NAME =
  process.env.CHECKOUT_TOKEN_INDEX_NAME || "checkout-token-index";
const MEMBER_USER_POOL_ID =
  process.env.MEMBER_USER_POOL_ID || "us-east-1_hpwdNFGss";
const MEMBER_COGNITO_POOL_NAME =
  process.env.MEMBER_COGNITO_POOL_NAME || "presttige-members";
const APP_ORIGINS = new Set([
  "https://presttige.net",
  "https://www.presttige.net",
]);
const ACCOUNT_STATUS_PASSWORD_PENDING = "password_pending";
const ACCOUNT_STATUS_PASSWORD_SETTING = "password_setting";
const ACCOUNT_STATUS_ACTIVE = "active";
const PASSWORD_SETUP_USED = "used";
const PASSWORD_SETUP_FAILED = "failed";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const cognito = new CognitoIdentityProviderClient({ region: REGION });

function corsHeaders(event) {
  const origin = event?.headers?.origin || event?.headers?.Origin || "";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": APP_ORIGINS.has(origin)
      ? origin
      : "https://presttige.net",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function response(event, statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(event),
    body: JSON.stringify(body),
  };
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function hashIdentifier(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function safeErrorType(error) {
  return normalizeText(error?.name || error?.code || error?.constructor?.name || "Error");
}

function parseBody(event) {
  if (!event?.body) {
    return {};
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  return JSON.parse(raw || "{}");
}

function parseDate(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function passwordErrors(password) {
  const value = String(password || "");
  const errors = [];
  if (value.length < 14) {
    errors.push("length");
  }
  if (!/[A-Z]/.test(value)) {
    errors.push("uppercase");
  }
  if (!/[a-z]/.test(value)) {
    errors.push("lowercase");
  }
  if (!/[0-9]/.test(value)) {
    errors.push("number");
  }
  if (!/[^A-Za-z0-9]/.test(value)) {
    errors.push("symbol");
  }
  return errors;
}

async function findLeadByCheckoutToken(token) {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: CHECKOUT_TOKEN_INDEX_NAME,
      KeyConditionExpression: "checkout_token = :token",
      ExpressionAttributeValues: {
        ":token": token,
      },
      Limit: 2,
    })
  );

  if (!result.Items?.length) {
    return null;
  }

  if (result.Items.length > 1) {
    throw new Error("Checkout token lookup returned multiple records");
  }

  return result.Items[0];
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

async function findLeadByToken(token) {
  const checkoutLead = await findLeadByCheckoutToken(token);
  if (checkoutLead) {
    return { lead: checkoutLead, tokenType: "checkout" };
  }

  const magicLead = await findLeadByMagicToken(token);
  if (magicLead) {
    return { lead: magicLead, tokenType: "magic" };
  }

  return null;
}

function tokenError(lead, tokenType) {
  if (normalizeText(lead.review_status).toLowerCase() !== "approved") {
    return {
      statusCode: 403,
      code: "not_approved",
      message: "This membership is not ready for activation.",
    };
  }

  if (!normalizeText(lead.cognito_sub) || normalizeText(lead.cognito_pool) !== MEMBER_COGNITO_POOL_NAME) {
    return {
      statusCode: 409,
      code: "account_not_ready",
      message: "This membership account is not ready yet.",
    };
  }

  if (tokenType === "checkout") {
    const status = normalizeText(lead.checkout_token_status).toLowerCase();
    if (status && status !== "active") {
      return {
        statusCode: 410,
        code: "token_inactive",
        message: "This activation link is no longer active.",
      };
    }
    const expiresAt = parseDate(lead.checkout_token_expires_at);
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      return {
        statusCode: 410,
        code: "token_expired",
        message: "This activation link has expired.",
      };
    }
  }

  if (tokenType === "magic") {
    const status = normalizeText(lead.magic_token_status).toLowerCase();
    if (status && status !== "active") {
      return {
        statusCode: 410,
        code: "token_inactive",
        message: "This activation link is no longer active.",
      };
    }
    const expiresAt = parseDate(lead.magic_token_expires_at);
    if (expiresAt && expiresAt.getTime() < Date.now()) {
      return {
        statusCode: 410,
        code: "token_expired",
        message: "This activation link has expired.",
      };
    }
  }

  return null;
}

function publicStatus(lead, tokenType) {
  const accountStatus = normalizeText(lead.account_status).toLowerCase();
  const passwordSetAt = normalizeText(lead.password_set_at);
  const accountReady = accountStatus === ACCOUNT_STATUS_ACTIVE && Boolean(passwordSetAt);
  const passwordReady =
    accountStatus === ACCOUNT_STATUS_PASSWORD_PENDING && !passwordSetAt;

  return {
    email: normalizeEmail(lead.email),
    name: normalizeText(lead.name),
    account_status: accountStatus || null,
    password_ready: passwordReady,
    account_ready: accountReady,
    password_set_at: passwordSetAt || null,
    token_type: tokenType,
    tier: normalizeText(lead.simulated_tier || lead.tier || lead.selected_tier).toLowerCase() || null,
  };
}

function getUserAttribute(user, name) {
  return (user?.UserAttributes || []).find((attribute) => attribute.Name === name)?.Value || "";
}

async function getCognitoUser(username) {
  if (!username) {
    return null;
  }
  try {
    return await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: MEMBER_USER_POOL_ID,
        Username: username,
      })
    );
  } catch (error) {
    if (error?.name === "UserNotFoundException") {
      return null;
    }
    throw error;
  }
}

async function resolveCognitoUsername(lead) {
  const byEmail = await getCognitoUser(normalizeEmail(lead.email));
  if (byEmail) {
    return byEmail.Username;
  }

  const bySub = await getCognitoUser(normalizeText(lead.cognito_sub));
  if (bySub) {
    const sub = getUserAttribute(bySub, "sub");
    if (sub === normalizeText(lead.cognito_sub)) {
      return bySub.Username;
    }
  }

  throw new Error("Cognito user not found for member record");
}

async function reservePasswordSetup(lead, tokenType, tokenHash) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 15 * 60 * 1000).toISOString();

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { lead_id: lead.lead_id },
      ConditionExpression: [
        "cognito_sub = :cognito_sub",
        "attribute_not_exists(password_set_at)",
        "(account_status = :pending OR (account_status = :setting AND password_setup_started_at < :stale_before))",
      ].join(" AND "),
      UpdateExpression: [
        "SET account_status = :setting",
        "password_setup_token_status = :setting",
        "password_setup_started_at = :now",
        "password_setup_token_type = :token_type",
        "password_setup_token_hash = :token_hash",
        "updated_at = :now",
      ].join(", "),
      ExpressionAttributeValues: {
        ":cognito_sub": lead.cognito_sub,
        ":pending": ACCOUNT_STATUS_PASSWORD_PENDING,
        ":setting": ACCOUNT_STATUS_PASSWORD_SETTING,
        ":stale_before": staleBefore,
        ":now": now.toISOString(),
        ":token_type": tokenType,
        ":token_hash": tokenHash,
      },
    })
  );
}

async function finalizePasswordSetup(lead, tokenType, tokenHash) {
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { lead_id: lead.lead_id },
      ConditionExpression: [
        "cognito_sub = :cognito_sub",
        "account_status = :setting",
        "password_setup_token_hash = :token_hash",
      ].join(" AND "),
      UpdateExpression: [
        "SET account_status = :active",
        "password_set_at = :now",
        "password_setup_token_status = :used",
        "password_setup_completed_at = :now",
        "password_setup_token_type = :token_type",
        "updated_at = :now",
      ].join(", "),
      ExpressionAttributeValues: {
        ":cognito_sub": lead.cognito_sub,
        ":setting": ACCOUNT_STATUS_PASSWORD_SETTING,
        ":active": ACCOUNT_STATUS_ACTIVE,
        ":token_hash": tokenHash,
        ":used": PASSWORD_SETUP_USED,
        ":token_type": tokenType,
        ":now": now,
      },
    })
  );
  return now;
}

async function markPasswordSetupFailed(lead, tokenHash) {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id: lead.lead_id },
        ConditionExpression:
          "account_status = :setting AND password_setup_token_hash = :token_hash",
        UpdateExpression:
          "SET account_status = :pending, password_setup_token_status = :failed, password_setup_failed_at = :now, updated_at = :now",
        ExpressionAttributeValues: {
          ":setting": ACCOUNT_STATUS_PASSWORD_SETTING,
          ":pending": ACCOUNT_STATUS_PASSWORD_PENDING,
          ":failed": PASSWORD_SETUP_FAILED,
          ":token_hash": tokenHash,
          ":now": now,
        },
      })
    );
  } catch (error) {
    console.error("member-set-password rollback", {
      status: "failed",
      error_type: safeErrorType(error),
    });
  }
}

async function loadContext(event, token) {
  const lookup = await findLeadByToken(token);
  if (!lookup) {
    return {
      error: response(event, 404, {
        error: "token_not_found",
        message: "This activation link could not be found.",
      }),
    };
  }

  const baseError = tokenError(lookup.lead, lookup.tokenType);
  if (baseError) {
    return {
      error: response(event, baseError.statusCode, {
        error: baseError.code,
        message: baseError.message,
      }),
    };
  }

  return lookup;
}

async function handleStatus(event, token) {
  const context = await loadContext(event, token);
  if (context.error) {
    return context.error;
  }

  return response(event, 200, publicStatus(context.lead, context.tokenType));
}

async function handleSet(event, token, password) {
  const errors = passwordErrors(password);
  if (errors.length) {
    return response(event, 400, {
      error: "password_policy",
      message: "Password does not meet the member security policy.",
      requirements: errors,
    });
  }

  const context = await loadContext(event, token);
  if (context.error) {
    return context.error;
  }

  const current = publicStatus(context.lead, context.tokenType);
  if (current.account_ready) {
    return response(event, 409, {
      error: "already_set",
      message: "This account password has already been set.",
      ...current,
    });
  }

  if (!current.password_ready) {
    return response(event, 409, {
      error: "not_password_pending",
      message: "This account is not waiting for a password.",
      ...current,
    });
  }

  const tokenHash = hashIdentifier(token);
  try {
    await reservePasswordSetup(context.lead, context.tokenType, tokenHash);
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      return response(event, 409, {
        error: "already_set_or_processing",
        message: "This password setup is already complete or in progress.",
      });
    }
    throw error;
  }

  try {
    const username = await resolveCognitoUsername(context.lead);
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: MEMBER_USER_POOL_ID,
        Username: username,
        Password: password,
        Permanent: true,
      })
    );

    const passwordSetAt = await finalizePasswordSetup(
      context.lead,
      context.tokenType,
      tokenHash
    );

    return response(event, 200, {
      email: current.email,
      name: current.name,
      account_status: ACCOUNT_STATUS_ACTIVE,
      account_ready: true,
      password_ready: false,
      password_set_at: passwordSetAt,
      token_type: context.tokenType,
      tier: current.tier,
    });
  } catch (error) {
    await markPasswordSetupFailed(context.lead, tokenHash);
    throw error;
  }
}

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(event),
      body: "",
    };
  }

  try {
    const body = parseBody(event);
    const token = normalizeText(body.token);
    const action = normalizeText(body.action || "status").toLowerCase();

    if (!token) {
      return response(event, 400, {
        error: "missing_token",
        message: "Missing activation token.",
      });
    }

    if (action === "status") {
      return handleStatus(event, token);
    }

    if (action === "set") {
      return handleSet(event, token, String(body.password || ""));
    }

    return response(event, 400, {
      error: "unknown_action",
      message: "Unknown password setup action.",
    });
  } catch (error) {
    console.error("member-set-password error", {
      status: "failed",
      error_type: safeErrorType(error),
    });
    return response(event, 500, {
      error: "internal_error",
      message: "Unable to update the member account right now.",
    });
  }
};
