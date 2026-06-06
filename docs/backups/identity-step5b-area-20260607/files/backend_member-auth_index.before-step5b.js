"use strict";

const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const {
  AdminInitiateAuthCommand,
  ConfirmForgotPasswordCommand,
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
  GetUserCommand,
  InitiateAuthCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "presttige-db";
const COGNITO_SUB_INDEX_NAME = process.env.COGNITO_SUB_INDEX_NAME || "cognito_sub-index";
const EMAIL_INDEX_NAME = process.env.EMAIL_INDEX_NAME || "email-index";
const MEMBER_USER_POOL_ID = process.env.MEMBER_USER_POOL_ID || "us-east-1_hpwdNFGss";
const MEMBER_CLIENT_ID = process.env.MEMBER_CLIENT_ID || "3gdek6k48cm6oirccodgrub2k1";
const MEMBER_COGNITO_POOL_NAME = process.env.MEMBER_COGNITO_POOL_NAME || "presttige-members";
const SESSION_COOKIE_MAX_AGE_SECONDS = Number(process.env.SESSION_COOKIE_MAX_AGE_SECONDS || 3600);
const REFRESH_COOKIE_MAX_AGE_SECONDS = Number(process.env.REFRESH_COOKIE_MAX_AGE_SECONDS || 2592000);
const SES_CONFIGURATION_SET = process.env.SES_CONFIGURATION_SET || "presttige-deliverability-v1";
const MEMBER_EMAIL_FROM = process.env.MEMBER_EMAIL_FROM || "private@presttige.net";
const MEMBER_EMAIL_REPLY_TO = process.env.MEMBER_EMAIL_REPLY_TO || "info@presttige.net";
const TEST_SEND_RECIPIENT = normalizeEmail(process.env.TEST_SEND_RECIPIENT || "fq@freequenza.net");
const MEMBER_HOME_URL = process.env.MEMBER_HOME_URL || "https://presttige.net/member/";

const APP_ORIGINS = new Set([
  "https://presttige.net",
  "https://www.presttige.net",
  "https://dh6banfgh3wmi.amplifyapp.com",
]);

const COOKIE_ACCESS = "__Host-pp_member_access";
const COOKIE_ID = "__Host-pp_member_id";
const COOKIE_REFRESH = "__Host-pp_member_refresh";
const ACTIVE_ACCOUNT_STATUS = "active";
const PASSWORD_PENDING_STATUS = "password_pending";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const cognito = new CognitoIdentityProviderClient({ region: REGION });
const ses = new SESClient({ region: REGION });

exports.handler = async (event) => {
  try {
    if (event?.requestContext?.http?.method === "OPTIONS") {
      return response(event, 204, {}, []);
    }

    const route = routeName(event);
    if (route === "login") {
      return handleLogin(event);
    }
    if (route === "session") {
      return handleSession(event);
    }
    if (route === "logout") {
      return handleLogout(event);
    }
    if (route === "forgot") {
      return handleForgotPassword(event);
    }
    if (route === "confirm-reset") {
      return handleConfirmReset(event);
    }

    return response(event, 404, { ok: false, status: "NOT_FOUND" }, []);
  } catch (error) {
    console.error("member-auth error", {
      action: routeName(event),
      error_type: safeErrorType(error),
    });
    return response(event, 500, {
      ok: false,
      status: "ERROR",
      message: "Member authentication is unavailable right now.",
    }, []);
  }
};

async function handleLogin(event) {
  const body = parseBody(event);
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");

  if (!email || !password) {
    logAuth("login", "missing_input", { email_hash: hashIdentifier(email) });
    return response(event, 400, {
      ok: false,
      status: "INVALID_REQUEST",
      message: "Sign-in could not be completed.",
    }, clearSessionCookies());
  }

  let authResult;
  try {
    authResult = await cognito.send(
      new AdminInitiateAuthCommand({
        UserPoolId: MEMBER_USER_POOL_ID,
        ClientId: MEMBER_CLIENT_ID,
        AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      })
    );
  } catch (error) {
    logAuth("login", "failed", {
      email_hash: hashIdentifier(email),
      error_type: safeErrorType(error),
    });
    return response(event, 401, {
      ok: false,
      status: "AUTH_FAILED",
      message: "Sign-in could not be completed.",
    }, clearSessionCookies());
  }

  if (authResult.ChallengeName) {
    logAuth("login", "challenge", {
      email_hash: hashIdentifier(email),
      challenge_hash: hashIdentifier(authResult.ChallengeName),
    });
    return response(event, 409, {
      ok: false,
      status: "SET_PASSWORD_REQUIRED",
      message: "Your account setup is not complete yet.",
    }, clearSessionCookies());
  }

  const tokens = authResult.AuthenticationResult || {};
  const session = await sessionFromAccessToken(tokens.AccessToken);
  if (!session.ok) {
    logAuth("login", session.status || "not_ready", {
      email_hash: hashIdentifier(email),
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, session.statusCode || 403, session, clearSessionCookies());
  }

  logAuth("login", "success", {
    lead_hash: hashIdentifier(session.member.lead_id),
    sub_hash: hashIdentifier(session.member.cognito_sub),
  });

  return response(event, 200, {
    ok: true,
    status: "ACTIVE",
    member: publicMember(session.member),
  }, sessionCookies(tokens));
}

async function handleSession(event) {
  const cookies = parseCookies(event);
  let accessToken = cookies[COOKIE_ACCESS] || "";
  const refreshToken = cookies[COOKIE_REFRESH] || "";
  let refreshedTokens = null;

  if (!accessToken && refreshToken) {
    refreshedTokens = await refreshFromToken(refreshToken);
    accessToken = refreshedTokens?.AccessToken || "";
  }

  let session = await sessionFromAccessToken(accessToken);
  if (!session.ok && refreshToken) {
    refreshedTokens = await refreshFromToken(refreshToken);
    accessToken = refreshedTokens?.AccessToken || "";
    session = await sessionFromAccessToken(accessToken);
  }

  if (!session.ok) {
    logAuth("session", session.status || "invalid", {
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, session.statusCode || 401, session, clearSessionCookies());
  }

  logAuth("session", "active", {
    lead_hash: hashIdentifier(session.member.lead_id),
    sub_hash: hashIdentifier(session.member.cognito_sub),
  });

  const cookiesToSet = refreshedTokens
    ? sessionCookies({ ...refreshedTokens, RefreshToken: refreshToken })
    : [];

  return response(event, 200, {
    ok: true,
    status: "ACTIVE",
    member: publicMember(session.member),
  }, cookiesToSet);
}

async function handleLogout(event) {
  logAuth("logout", "cleared", {});
  return response(event, 200, {
    ok: true,
    status: "SIGNED_OUT",
    message: "Signed out.",
  }, clearSessionCookies());
}

async function handleForgotPassword(event) {
  const body = parseBody(event);
  const email = normalizeEmail(body.email);
  if (!email) {
    return neutralForgotResponse(event);
  }

  const lead = await findLeadByEmail(email);
  const emailHash = hashIdentifier(email);

  if (lead?.synthetic_test === true) {
    await sendSyntheticResetNotice(lead);
    logAuth("forgot", "test_routed", {
      email_hash: emailHash,
      lead_hash: hashIdentifier(lead.lead_id),
    });
    return neutralForgotResponse(event);
  }

  try {
    await cognito.send(
      new ForgotPasswordCommand({
        ClientId: MEMBER_CLIENT_ID,
        Username: email,
      })
    );
    logAuth("forgot", "requested", { email_hash: emailHash });
  } catch (error) {
    logAuth("forgot", "neutralized", {
      email_hash: emailHash,
      error_type: safeErrorType(error),
    });
  }

  return neutralForgotResponse(event);
}

async function handleConfirmReset(event) {
  const body = parseBody(event);
  const email = normalizeEmail(body.email);
  const code = normalizeText(body.code);
  const password = String(body.password || "");
  const errors = passwordErrors(password);

  if (!email || !code || errors.length) {
    return response(event, 400, {
      ok: false,
      status: "INVALID_REQUEST",
      message: "Password reset could not be completed.",
    }, []);
  }

  const lead = await findLeadByEmail(email);
  if (lead?.synthetic_test === true) {
    logAuth("reset", "test_not_confirmed", {
      lead_hash: hashIdentifier(lead.lead_id),
    });
    return response(event, 400, {
      ok: false,
      status: "TEST_RESET_NOTICE_ONLY",
      message: "Use the activation password flow for tester password changes.",
    }, []);
  }

  try {
    await cognito.send(
      new ConfirmForgotPasswordCommand({
        ClientId: MEMBER_CLIENT_ID,
        Username: email,
        ConfirmationCode: code,
        Password: password,
      })
    );
    logAuth("reset", "confirmed", { email_hash: hashIdentifier(email) });
    return response(event, 200, {
      ok: true,
      status: "RESET_CONFIRMED",
      message: "Password reset complete.",
    }, []);
  } catch (error) {
    logAuth("reset", "failed", {
      email_hash: hashIdentifier(email),
      error_type: safeErrorType(error),
    });
    return response(event, 400, {
      ok: false,
      status: "RESET_FAILED",
      message: "Password reset could not be completed.",
    }, []);
  }
}

async function sessionFromAccessToken(accessToken) {
  if (!accessToken) {
    return {
      ok: false,
      statusCode: 401,
      status: "NO_SESSION",
      message: "No active member session.",
    };
  }

  let user;
  try {
    user = await cognito.send(new GetUserCommand({ AccessToken: accessToken }));
  } catch (error) {
    return {
      ok: false,
      statusCode: 401,
      status: "NO_SESSION",
      message: "No active member session.",
      error_type: safeErrorType(error),
    };
  }

  const attributes = Object.fromEntries(
    (user.UserAttributes || []).map((item) => [item.Name, item.Value])
  );
  const cognitoSub = normalizeText(attributes.sub);
  const lead = await findLeadByCognitoSub(cognitoSub);
  const readiness = memberReadiness(lead);

  if (!readiness.ok) {
    return {
      ok: false,
      statusCode: readiness.statusCode,
      status: readiness.status,
      message: readiness.message,
      activation_url: readiness.activation_url || null,
      cognito_sub: cognitoSub,
    };
  }

  return {
    ok: true,
    member: lead,
  };
}

function memberReadiness(lead) {
  if (!lead) {
    return {
      ok: false,
      statusCode: 403,
      status: "MEMBER_NOT_READY",
      message: "This member account is not ready.",
    };
  }

  if (normalizeText(lead.cognito_pool) !== MEMBER_COGNITO_POOL_NAME) {
    return {
      ok: false,
      statusCode: 403,
      status: "MEMBER_NOT_READY",
      message: "This member account is not ready.",
    };
  }

  const accountStatus = normalizeText(lead.account_status).toLowerCase();
  if (accountStatus === PASSWORD_PENDING_STATUS) {
    return {
      ok: false,
      statusCode: 403,
      status: "PASSWORD_PENDING",
      message: "Your account setup is not complete yet.",
      activation_url: activationUrlForLead(lead),
    };
  }

  if (accountStatus !== ACTIVE_ACCOUNT_STATUS || !normalizeText(lead.password_set_at)) {
    return {
      ok: false,
      statusCode: 403,
      status: "MEMBER_NOT_READY",
      message: "This member account is not ready.",
    };
  }

  return { ok: true };
}

async function refreshFromToken(refreshToken) {
  if (!refreshToken) {
    return null;
  }
  try {
    const result = await cognito.send(
      new InitiateAuthCommand({
        ClientId: MEMBER_CLIENT_ID,
        AuthFlow: "REFRESH_TOKEN_AUTH",
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      })
    );
    return result.AuthenticationResult || null;
  } catch (error) {
    logAuth("refresh", "failed", { error_type: safeErrorType(error) });
    return null;
  }
}

async function findLeadByCognitoSub(cognitoSub) {
  const sub = normalizeText(cognitoSub);
  if (!sub) {
    return null;
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: COGNITO_SUB_INDEX_NAME,
      KeyConditionExpression: "cognito_sub = :sub",
      ExpressionAttributeValues: {
        ":sub": sub,
      },
      Limit: 2,
    })
  );

  if (!result.Items?.length || result.Items.length > 1) {
    return null;
  }
  return result.Items[0];
}

async function findLeadByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: EMAIL_INDEX_NAME,
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": normalized,
      },
      Limit: 2,
    })
  );
  if (!result.Items?.length || result.Items.length > 1) {
    return null;
  }
  return result.Items[0];
}

async function sendSyntheticResetNotice(lead) {
  const html = [
    "<!doctype html><html><body>",
    "<p>Presttige tester password reset was requested.</p>",
    "<p>This is a controlled tester notice routed to FQ. No real member was contacted.</p>",
    "</body></html>",
  ].join("");
  const text = [
    "Presttige tester password reset was requested.",
    "This is a controlled tester notice routed to FQ. No real member was contacted.",
  ].join("\n");

  await ses.send(
    new SendEmailCommand({
      Source: `Presttige <${MEMBER_EMAIL_FROM}>`,
      ConfigurationSetName: SES_CONFIGURATION_SET,
      ReplyToAddresses: [MEMBER_EMAIL_REPLY_TO],
      Destination: {
        ToAddresses: [TEST_SEND_RECIPIENT],
      },
      Message: {
        Subject: {
          Data: "Presttige tester password reset",
          Charset: "UTF-8",
        },
        Body: {
          Text: {
            Data: text,
            Charset: "UTF-8",
          },
          Html: {
            Data: html,
            Charset: "UTF-8",
          },
        },
      },
    })
  );
  logAuth("forgot", "test_notice_sent", {
    lead_hash: hashIdentifier(lead?.lead_id),
    recipient_type: "test_fq",
  });
}

function neutralForgotResponse(event) {
  return response(event, 200, {
    ok: true,
    status: "RESET_REQUESTED",
    message: "If this account can be reset, instructions have been sent.",
  }, []);
}

function publicMember(lead) {
  return {
    lead_id: normalizeText(lead.lead_id),
    name: normalizeText(lead.name),
    email: normalizeEmail(lead.email),
    tier: canonicalTier(lead),
    account_status: normalizeText(lead.account_status).toLowerCase(),
    validation_status: normalizeText(lead.validation_status).toLowerCase() || "not_started",
    member_area_ready: false,
  };
}

function canonicalTier(lead) {
  return (
    normalizeText(lead.simulated_tier || lead.tier || lead.selected_tier || lead.subscriber_type)
      .toLowerCase() || "free"
  );
}

function activationUrlForLead(lead) {
  const checkoutToken = normalizeText(lead.checkout_token);
  if (checkoutToken) {
    return `/welcome/${encodeURIComponent(checkoutToken)}`;
  }

  const magicToken = normalizeText(lead.magic_token);
  if (magicToken) {
    return `/subscriber-activated/${encodeURIComponent(magicToken)}`;
  }

  return null;
}

function sessionCookies(tokens) {
  const cookies = [];
  if (tokens.AccessToken) {
    cookies.push(makeCookie(COOKIE_ACCESS, tokens.AccessToken, SESSION_COOKIE_MAX_AGE_SECONDS));
  }
  if (tokens.IdToken) {
    cookies.push(makeCookie(COOKIE_ID, tokens.IdToken, SESSION_COOKIE_MAX_AGE_SECONDS));
  }
  if (tokens.RefreshToken) {
    cookies.push(makeCookie(COOKIE_REFRESH, tokens.RefreshToken, REFRESH_COOKIE_MAX_AGE_SECONDS));
  }
  return cookies;
}

function clearSessionCookies() {
  return [
    makeCookie(COOKIE_ACCESS, "", 0),
    makeCookie(COOKIE_ID, "", 0),
    makeCookie(COOKIE_REFRESH, "", 0),
  ];
}

function makeCookie(name, value, maxAge) {
  return [
    `${name}=${encodeURIComponent(value || "")}`,
    "Path=/",
    `Max-Age=${Math.max(0, Number(maxAge) || 0)}`,
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
  ].join("; ");
}

function response(event, statusCode, body, cookies = []) {
  const origin = event?.headers?.origin || event?.headers?.Origin || "";
  const allowedOrigin = APP_ORIGINS.has(origin) ? origin : "https://presttige.net";
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    cookies,
    body: statusCode === 204 ? "" : JSON.stringify(body),
  };
}

function routeName(event) {
  const path = normalizeText(event?.rawPath || event?.requestContext?.http?.path);
  const segment = path.split("/").filter(Boolean).pop() || "";
  if (["login", "session", "logout", "forgot", "confirm-reset"].includes(segment)) {
    return segment;
  }
  const body = safeParseBody(event);
  return normalizeText(body.action).toLowerCase();
}

function parseCookies(event) {
  const cookieHeader = [
    ...(event?.cookies || []),
    event?.headers?.cookie || event?.headers?.Cookie || "",
  ]
    .filter(Boolean)
    .join("; ");

  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index < 0) {
          return [part, ""];
        }
        const name = part.slice(0, index);
        const value = part.slice(index + 1);
        return [name, decodeURIComponent(value || "")];
      })
  );
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

function safeParseBody(event) {
  try {
    return parseBody(event);
  } catch (error) {
    return {};
  }
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

function passwordErrors(password) {
  const value = String(password || "");
  const errors = [];
  if (value.length < 14) errors.push("length");
  if (!/[A-Z]/.test(value)) errors.push("uppercase");
  if (!/[a-z]/.test(value)) errors.push("lowercase");
  if (!/[0-9]/.test(value)) errors.push("number");
  if (!/[^A-Za-z0-9]/.test(value)) errors.push("symbol");
  return errors;
}

function logAuth(action, status, extra) {
  console.info("member-auth", {
    action,
    status,
    ...extra,
  });
}
