"use strict";

const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
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
const VALIDATED_STATUS = "validated";
const VALIDATION_REQUIRED_ACTIONS = new Set([
  "profile",
  "photos",
  "privacy",
  "founder",
]);

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
    if (route === "member-action") {
      return handleMemberAction(event);
    }
    if (route === "profile") {
      return handleProfileSave(event);
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
  const { session, refreshedTokens, refreshToken } = await memberSessionFromEvent(event);

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

async function handleMemberAction(event) {
  const body = parseBody(event);
  const section = normalizeText(body.section).toLowerCase();
  const { session, refreshedTokens, refreshToken } = await memberSessionFromEvent(event);

  if (!session.ok) {
    logAuth("member_action", session.status || "invalid", {
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, session.statusCode || 401, session, clearSessionCookies());
  }

  const actionHash = hashIdentifier(section);
  if (!VALIDATION_REQUIRED_ACTIONS.has(section)) {
    logAuth("member_action", "unknown", {
      lead_hash: hashIdentifier(session.member.lead_id),
      action_hash: actionHash,
    });
    return response(event, 404, {
      ok: false,
      status: "ACTION_UNAVAILABLE",
    }, []);
  }

  const cookiesToSet = refreshedTokens
    ? sessionCookies({ ...refreshedTokens, RefreshToken: refreshToken })
    : [];

  if (!isMemberValidated(session.member)) {
    logAuth("member_action", "unavailable", {
      lead_hash: hashIdentifier(session.member.lead_id),
      action_hash: actionHash,
    });
    return response(event, 403, {
      ok: false,
      status: "ACTION_UNAVAILABLE",
    }, cookiesToSet);
  }

  logAuth("member_action", "available", {
    lead_hash: hashIdentifier(session.member.lead_id),
    action_hash: actionHash,
  });
  return response(event, 200, {
    ok: true,
    status: "ACTION_AVAILABLE",
    section,
  }, cookiesToSet);
}

async function handleProfileSave(event) {
  const body = parseBody(event);
  const { session, refreshedTokens, refreshToken } = await memberSessionFromEvent(event);

  if (!session.ok) {
    logAuth("profile_save", session.status || "invalid", {
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, session.statusCode || 401, session, clearSessionCookies());
  }

  const cookiesToSet = refreshedTokens
    ? sessionCookies({ ...refreshedTokens, RefreshToken: refreshToken })
    : [];

  if (!isMemberValidated(session.member)) {
    logAuth("profile_save", "unavailable", {
      lead_hash: hashIdentifier(session.member.lead_id),
    });
    return response(event, 403, {
      ok: false,
      status: "ACTION_UNAVAILABLE",
    }, cookiesToSet);
  }

  const normalized = normalizeProfilePayload(body);
  if (normalized.errors.length) {
    logAuth("profile_save", "invalid", {
      lead_hash: hashIdentifier(session.member.lead_id),
      error_count: normalized.errors.length,
    });
    return response(event, 400, {
      ok: false,
      status: "INVALID_PROFILE",
      errors: normalized.errors,
    }, cookiesToSet);
  }

  const updated = await saveMemberProfile(session.member, normalized);
  logAuth("profile_save", "saved", {
    lead_hash: hashIdentifier(updated.lead_id),
  });

  return response(event, 200, {
    ok: true,
    status: "PROFILE_SAVED",
    member: publicMember(updated),
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

async function memberSessionFromEvent(event) {
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

  return { session, refreshedTokens, refreshToken };
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
    validation: {
      is_validated: isMemberValidated(lead),
    },
    profile: publicProfile(lead),
    interests: publicInterests(lead),
    member_area_ready: true,
  };
}

function publicProfile(lead) {
  return {
    name: normalizeText(lead.name),
    email: normalizeEmail(lead.email),
    phone_country: normalizeText(lead.phone_country),
    phone: normalizeText(lead.phone || lead.phone_full),
    age: normalizeText(lead.age),
    country: normalizeText(lead.country),
    city: normalizeText(lead.city),
    occupation: normalizeText(lead.occupation),
    company: normalizeText(lead.company),
    website: normalizeText(lead.website),
    linkedin: normalizeText(lead.linkedin),
    instagram: normalizeText(lead.instagram),
    tiktok: normalizeText(lead.tiktok),
    bio: normalizeText(lead.bio || lead.short_introduction),
  };
}

function publicInterests(lead) {
  const stored = lead.member_interests && typeof lead.member_interests === "object"
    ? lead.member_interests
    : {};
  return normalizeInterests(stored);
}

function isMemberValidated(lead) {
  return normalizeText(lead?.validation_status).toLowerCase() === VALIDATED_STATUS;
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

function normalizeProfilePayload(body) {
  const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
  const interests = body.interests && typeof body.interests === "object" ? body.interests : {};
  const normalizedProfile = {
    phone_country: trimToLimit(profile.phone_country, 12),
    phone: trimToLimit(profile.phone, 40),
    age: trimToLimit(profile.age, 8),
    country: trimToLimit(profile.country, 120),
    city: trimToLimit(profile.city, 120),
    occupation: trimToLimit(profile.occupation, 160),
    company: trimToLimit(profile.company, 160),
    website: trimToLimit(profile.website, 240),
    linkedin: trimToLimit(profile.linkedin, 240),
    instagram: trimToLimit(profile.instagram, 160),
    tiktok: trimToLimit(profile.tiktok, 160),
    bio: trimToLimit(profile.bio, 1200),
  };
  const normalizedInterests = normalizeInterests(interests);
  const errors = [];

  for (const field of ["phone_country", "phone", "age", "country", "city", "instagram", "bio"]) {
    if (!normalizedProfile[field]) {
      errors.push(field);
    }
  }

  if (normalizedProfile.bio && normalizedProfile.bio.length < 50) {
    errors.push("bio_length");
  }

  for (const field of ["website", "linkedin"]) {
    if (normalizedProfile[field] && !isHttpUrl(normalizedProfile[field])) {
      errors.push(`${field}_url`);
    }
  }

  return {
    profile: normalizedProfile,
    interests: normalizedInterests,
    errors,
  };
}

function normalizeInterests(value) {
  return {
    lifestyle: trimToLimit(value.lifestyle, 400),
    business: trimToLimit(value.business, 400),
    travel: trimToLimit(value.travel, 400),
    culture: trimToLimit(value.culture, 400),
    wellbeing: trimToLimit(value.wellbeing, 400),
    notes: trimToLimit(value.notes, 600),
  };
}

async function saveMemberProfile(lead, normalized) {
  const now = new Date().toISOString();
  const fields = {
    ...normalized.profile,
    member_interests: normalized.interests,
    profile_updated_at: now,
    member_interests_updated_at: now,
    updated_at: now,
  };
  const names = {};
  const values = {
    ":lead_id": normalizeText(lead.lead_id),
    ":cognito_sub": normalizeText(lead.cognito_sub),
  };
  const assignments = [];

  Object.entries(fields).forEach(([key, value]) => {
    names[`#${key}`] = key;
    values[`:${key}`] = value;
    assignments.push(`#${key} = :${key}`);
  });

  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        lead_id: normalizeText(lead.lead_id),
      },
      UpdateExpression: `SET ${assignments.join(", ")}`,
      ConditionExpression: "lead_id = :lead_id AND cognito_sub = :cognito_sub",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes || lead;
}

function trimToLimit(value, maxLength) {
  const normalized = normalizeText(value).replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }
  return normalized.slice(0, maxLength);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (error) {
    return false;
  }
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
  if (["login", "session", "logout", "forgot", "confirm-reset", "member-action", "profile"].includes(segment)) {
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
