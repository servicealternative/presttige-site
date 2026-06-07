"use strict";

const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { InvokeCommand, LambdaClient } = require("@aws-sdk/client-lambda");
const { DeleteObjectCommand, GetObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AdminSetUserMFAPreferenceCommand,
  AssociateSoftwareTokenCommand,
  ConfirmForgotPasswordCommand,
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
  GetUserCommand,
  InitiateAuthCommand,
  VerifySoftwareTokenCommand,
} = require("@aws-sdk/client-cognito-identity-provider");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "presttige-db";
const AUDIT_TABLE_NAME = process.env.AUDIT_TABLE_NAME || "presttige-review-audit";
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
const PHOTO_UPLOAD_INIT_FUNCTION = process.env.PHOTO_UPLOAD_INIT_FUNCTION || "presttige-photo-upload-init";
const PHOTO_ORIGINALS_BUCKET = process.env.PHOTO_ORIGINALS_BUCKET || "presttige-applicant-photos";
const PHOTO_THUMBNAILS_BUCKET = process.env.PHOTO_THUMBNAILS_BUCKET || "presttige-applicant-photos-thumbnails";
const DSAR_ERASURE_CONFIRMATION = "ERASE MY ACCOUNT";
const FOUNDER_TOTP_LABEL = "Presttige, Founder";
const FOUNDER_TOTP_COOKIE_MAX_AGE_SECONDS = Number(process.env.FOUNDER_TOTP_COOKIE_MAX_AGE_SECONDS || 600);
const FOUNDER_TOTP_RECOVERY_CODE_COUNT = 8;

const APP_ORIGINS = new Set([
  "https://presttige.net",
  "https://www.presttige.net",
  "https://dh6banfgh3wmi.amplifyapp.com",
]);

const COOKIE_ACCESS = "__Host-pp_member_access";
const COOKIE_ID = "__Host-pp_member_id";
const COOKIE_REFRESH = "__Host-pp_member_refresh";
const COOKIE_FOUNDER_TOTP_ENROLL_ACCESS = "__Host-pp_founder_totp_enroll_access";
const COOKIE_FOUNDER_TOTP_ENROLL_ID = "__Host-pp_founder_totp_enroll_id";
const COOKIE_FOUNDER_TOTP_ENROLL_REFRESH = "__Host-pp_founder_totp_enroll_refresh";
const COOKIE_FOUNDER_TOTP_CHALLENGE_SESSION = "__Host-pp_founder_totp_challenge_session";
const ACTIVE_ACCOUNT_STATUS = "active";
const PASSWORD_PENDING_STATUS = "password_pending";
const VALIDATED_STATUS = "validated";
const NORMAL_MEMBER_PHOTO_REQUIRED_COUNT = 6;
const INTERNAL_SEEDED_PHOTO_COUNT = 2;
const MEMBER_PHOTO_SLOT_MIN = 3;
const MEMBER_PHOTO_SLOT_MAX = 6;
const FOUNDER_PHOTO_MIN_COUNT = 1;
const FOUNDER_PHOTO_MAX_COUNT = 6;
const FOUNDER_PHOTO_SLOT_MIN = 1;
const FOUNDER_PHOTO_SLOT_MAX = 6;
const MEMBER_PHOTO_MAX_SIZE = 10 * 1024 * 1024;
const MEMBER_PHOTO_TYPES = new Set(["image/jpeg", "image/png"]);
const VALIDATION_REQUIRED_ACTIONS = new Set([
  "profile",
  "photos",
  "founder",
]);

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const cognito = new CognitoIdentityProviderClient({ region: REGION });
const ses = new SESClient({ region: REGION });
const lambda = new LambdaClient({ region: REGION });
const s3 = new S3Client({ region: REGION });

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
    if (route === "totp-verify") {
      return handleFounderTotpVerify(event);
    }
    if (route === "totp-challenge") {
      return handleFounderTotpChallenge(event);
    }
    if (route === "totp-recover") {
      return handleFounderTotpRecover(event);
    }
    if (route === "member-action") {
      return handleMemberAction(event);
    }
    if (route === "profile") {
      return handleProfileSave(event);
    }
    if (route === "photos") {
      return handleMemberPhotos(event);
    }
    if (route === "photo-thumbnail") {
      return handleMemberPhotoThumbnail(event);
    }
    if (route === "dsar") {
      return handleMemberDsar(event);
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
    if (authResult.ChallengeName === "SOFTWARE_TOKEN_MFA") {
      const lead = await findLeadByEmail(email);
      if (isFounderMember(lead)) {
        logAuth("login", "founder_totp_challenge", {
          lead_hash: hashIdentifier(lead.lead_id),
          challenge_hash: hashIdentifier(authResult.ChallengeName),
        });
        return response(event, 200, {
          ok: true,
          status: "FOUNDER_TOTP_REQUIRED",
          message: "Enter the authenticator code for your Founder access.",
        }, founderTotpChallengeCookies(authResult.Session));
      }
    }
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
  const session = await sessionFromAccessToken(tokens.AccessToken, { allowFounderTotpPending: true });
  if (!session.ok) {
    logAuth("login", session.status || "not_ready", {
      email_hash: hashIdentifier(email),
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, session.statusCode || 403, session, clearSessionCookies());
  }

  if (isFounderMember(session.member)) {
    if (!isFounderTotpEnabled(session.member)) {
      return startFounderTotpEnrollment(event, session.member, tokens);
    }
    logAuth("login", "founder_totp_not_challenged", {
      lead_hash: hashIdentifier(session.member.lead_id),
    });
    return response(event, 403, {
      ok: false,
      status: "FOUNDER_TOTP_REQUIRED",
      message: "Founder sign-in requires authenticator verification.",
    }, clearAllAuthCookies());
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

async function startFounderTotpEnrollment(event, member, tokens) {
  let association;
  try {
    association = await cognito.send(new AssociateSoftwareTokenCommand({
      AccessToken: tokens.AccessToken,
    }));
  } catch (error) {
    logAuth("founder_totp", "associate_failed", {
      lead_hash: hashIdentifier(member.lead_id),
      error_type: safeErrorType(error),
    });
    return response(event, 500, {
      ok: false,
      status: "FOUNDER_TOTP_UNAVAILABLE",
      message: "Founder authenticator setup is unavailable right now.",
    }, clearAllAuthCookies());
  }

  const secretCode = normalizeText(association.SecretCode);
  const otpauthUrl = founderTotpOtpauthUrl(secretCode);
  await writeMemberAudit(member, "member_founder_totp_enrollment_started", {
    category: "founder_totp",
    label_hash: hashIdentifier(FOUNDER_TOTP_LABEL),
  });
  logAuth("founder_totp", "enrollment_started", {
    lead_hash: hashIdentifier(member.lead_id),
  });
  return response(event, 200, {
    ok: true,
    status: "FOUNDER_TOTP_ENROLL_REQUIRED",
    label: FOUNDER_TOTP_LABEL,
    secret_code: secretCode,
    otpauth_url: otpauthUrl,
    message: "Founder access requires authenticator setup.",
  }, founderTotpEnrollmentCookies(tokens));
}

async function handleFounderTotpVerify(event) {
  const body = parseBody(event);
  const code = normalizeTotpCode(body.code);
  const cookies = parseCookies(event);
  const accessToken = cookies[COOKIE_FOUNDER_TOTP_ENROLL_ACCESS] || "";
  const idToken = cookies[COOKIE_FOUNDER_TOTP_ENROLL_ID] || "";
  const refreshToken = cookies[COOKIE_FOUNDER_TOTP_ENROLL_REFRESH] || "";

  if (!accessToken || !idToken || !refreshToken || !code) {
    logAuth("founder_totp", "verify_missing", {});
    return response(event, 400, {
      ok: false,
      status: "FOUNDER_TOTP_INVALID",
      message: "Authenticator setup could not be completed.",
    }, clearFounderTotpCookies());
  }

  const session = await sessionFromAccessToken(accessToken, { allowFounderTotpPending: true });
  if (!session.ok || !isFounderMember(session.member)) {
    logAuth("founder_totp", "verify_invalid_session", {
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, 401, {
      ok: false,
      status: "NO_SESSION",
      message: "No active Founder setup session.",
    }, clearFounderTotpCookies());
  }

  let verifyResult;
  try {
    verifyResult = await cognito.send(new VerifySoftwareTokenCommand({
      AccessToken: accessToken,
      UserCode: code,
      FriendlyDeviceName: FOUNDER_TOTP_LABEL,
    }));
  } catch (error) {
    logAuth("founder_totp", "verify_failed", {
      lead_hash: hashIdentifier(session.member.lead_id),
      error_type: safeErrorType(error),
    });
    return response(event, 400, {
      ok: false,
      status: "FOUNDER_TOTP_INVALID",
      message: "Authenticator setup could not be completed.",
    }, []);
  }

  if (normalizeText(verifyResult.Status).toUpperCase() !== "SUCCESS") {
    logAuth("founder_totp", "verify_rejected", {
      lead_hash: hashIdentifier(session.member.lead_id),
    });
    return response(event, 400, {
      ok: false,
      status: "FOUNDER_TOTP_INVALID",
      message: "Authenticator setup could not be completed.",
    }, []);
  }

  await cognito.send(new AdminSetUserMFAPreferenceCommand({
    UserPoolId: MEMBER_USER_POOL_ID,
    Username: normalizeEmail(session.member.email),
    SoftwareTokenMfaSettings: {
      Enabled: true,
      PreferredMfa: true,
    },
  }));

  const recovery = generateFounderRecoveryCodes();
  const updated = await saveFounderTotpEnabled(session.member, recovery.hashes);
  await writeMemberAudit(updated, "member_founder_totp_enabled", {
    category: "founder_totp",
    recovery_code_count: recovery.codes.length,
  });
  logAuth("founder_totp", "enabled", {
    lead_hash: hashIdentifier(updated.lead_id),
  });

  return response(event, 200, {
    ok: true,
    status: "FOUNDER_TOTP_ENABLED",
    member: publicMember(updated),
    recovery_codes: recovery.codes,
    message: "Founder authenticator is enabled.",
  }, [
    ...sessionCookies({
      AccessToken: accessToken,
      IdToken: idToken,
      RefreshToken: refreshToken,
    }),
    ...clearFounderTotpCookies(),
  ]);
}

async function handleFounderTotpChallenge(event) {
  const body = parseBody(event);
  const email = normalizeEmail(body.email);
  const code = normalizeTotpCode(body.code);
  const challengeSession = parseCookies(event)[COOKIE_FOUNDER_TOTP_CHALLENGE_SESSION] || "";

  if (!email || !code || !challengeSession) {
    logAuth("founder_totp", "challenge_missing", {
      email_hash: hashIdentifier(email),
    });
    return response(event, 400, {
      ok: false,
      status: "FOUNDER_TOTP_INVALID",
      message: "Founder sign-in could not be completed.",
    }, clearFounderTotpChallengeCookies());
  }

  const lead = await findLeadByEmail(email);
  if (!isFounderMember(lead) || !isFounderTotpEnabled(lead)) {
    logAuth("founder_totp", "challenge_invalid_member", {
      email_hash: hashIdentifier(email),
    });
    return response(event, 401, {
      ok: false,
      status: "AUTH_FAILED",
      message: "Founder sign-in could not be completed.",
    }, clearFounderTotpChallengeCookies());
  }

  let authResult;
  try {
    authResult = await cognito.send(new AdminRespondToAuthChallengeCommand({
      UserPoolId: MEMBER_USER_POOL_ID,
      ClientId: MEMBER_CLIENT_ID,
      ChallengeName: "SOFTWARE_TOKEN_MFA",
      Session: challengeSession,
      ChallengeResponses: {
        USERNAME: email,
        SOFTWARE_TOKEN_MFA_CODE: code,
      },
    }));
  } catch (error) {
    logAuth("founder_totp", "challenge_failed", {
      lead_hash: hashIdentifier(lead.lead_id),
      error_type: safeErrorType(error),
    });
    return response(event, 401, {
      ok: false,
      status: "FOUNDER_TOTP_INVALID",
      message: "Founder sign-in could not be completed.",
    }, []);
  }

  const tokens = authResult.AuthenticationResult || {};
  const session = await sessionFromAccessToken(tokens.AccessToken);
  if (!session.ok) {
    logAuth("founder_totp", "challenge_not_ready", {
      lead_hash: hashIdentifier(lead.lead_id),
      status_hash: hashIdentifier(session.status),
    });
    return response(event, 403, session, clearAllAuthCookies());
  }

  await writeMemberAudit(session.member, "member_founder_totp_login", {
    category: "founder_totp",
  });
  logAuth("founder_totp", "challenge_success", {
    lead_hash: hashIdentifier(session.member.lead_id),
  });
  return response(event, 200, {
    ok: true,
    status: "ACTIVE",
    member: publicMember(session.member),
  }, [
    ...sessionCookies(tokens),
    ...clearFounderTotpChallengeCookies(),
  ]);
}

async function handleFounderTotpRecover(event) {
  const body = parseBody(event);
  const email = normalizeEmail(body.email);
  const recoveryCode = normalizeRecoveryCode(body.recovery_code);
  const challengeSession = parseCookies(event)[COOKIE_FOUNDER_TOTP_CHALLENGE_SESSION] || "";

  if (!email || !recoveryCode || !challengeSession) {
    logAuth("founder_totp", "recovery_missing", {
      email_hash: hashIdentifier(email),
    });
    return response(event, 400, {
      ok: false,
      status: "FOUNDER_TOTP_RECOVERY_INVALID",
      message: "Founder recovery could not be completed.",
    }, clearFounderTotpChallengeCookies());
  }

  const lead = await findLeadByEmail(email);
  if (!isFounderMember(lead) || !isFounderTotpEnabled(lead)) {
    logAuth("founder_totp", "recovery_invalid_member", {
      email_hash: hashIdentifier(email),
    });
    return response(event, 401, {
      ok: false,
      status: "FOUNDER_TOTP_RECOVERY_INVALID",
      message: "Founder recovery could not be completed.",
    }, clearFounderTotpChallengeCookies());
  }

  const matched = findMatchingRecoveryCode(lead, recoveryCode);
  if (!matched) {
    logAuth("founder_totp", "recovery_rejected", {
      lead_hash: hashIdentifier(lead.lead_id),
    });
    return response(event, 401, {
      ok: false,
      status: "FOUNDER_TOTP_RECOVERY_INVALID",
      message: "Founder recovery could not be completed.",
    }, []);
  }

  await cognito.send(new AdminSetUserMFAPreferenceCommand({
    UserPoolId: MEMBER_USER_POOL_ID,
    Username: normalizeEmail(lead.email),
    SoftwareTokenMfaSettings: {
      Enabled: false,
      PreferredMfa: false,
    },
  }));

  const updated = await saveFounderTotpRecoveryReset(lead, matched);
  await writeMemberAudit(updated, "member_founder_totp_recovery_reset", {
    category: "founder_totp",
    recovery_code_id_hash: hashIdentifier(matched.id),
  });
  logAuth("founder_totp", "recovery_reset", {
    lead_hash: hashIdentifier(updated.lead_id),
  });
  return response(event, 200, {
    ok: true,
    status: "FOUNDER_TOTP_RESET_COMPLETE",
    message: "Founder authenticator was reset. Sign in again to set up a new authenticator.",
  }, [
    ...clearSessionCookies(),
    ...clearFounderTotpCookies(),
  ]);
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

async function handleMemberPhotos(event) {
  const body = parseBody(event);
  const mode = normalizeText(body.mode || "list").toLowerCase();
  const { session, refreshedTokens, refreshToken } = await memberSessionFromEvent(event);

  if (!session.ok) {
    logAuth("member_photos", session.status || "invalid", {
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, session.statusCode || 401, session, clearSessionCookies());
  }

  const cookiesToSet = refreshedTokens
    ? sessionCookies({ ...refreshedTokens, RefreshToken: refreshToken })
    : [];

  if (!canUseMemberPhotos(session.member)) {
    logAuth("member_photos", "unavailable", {
      lead_hash: hashIdentifier(session.member.lead_id),
      mode_hash: hashIdentifier(mode),
    });
    return response(event, 403, {
      ok: false,
      status: "ACTION_UNAVAILABLE",
    }, cookiesToSet);
  }

  if (mode === "list") {
    logAuth("member_photos", "listed", {
      lead_hash: hashIdentifier(session.member.lead_id),
    });
    return response(event, 200, {
      ok: true,
      status: "PHOTOS_READY",
      photos: publicPhotosForMember(session.member),
    }, cookiesToSet);
  }

  if (mode === "init-upload") {
    const normalized = normalizePhotoUploadRequest(session.member, body);
    if (normalized.errors.length) {
      logAuth("member_photos", "invalid_upload", {
        lead_hash: hashIdentifier(session.member.lead_id),
        error_count: normalized.errors.length,
      });
      return response(event, 400, {
        ok: false,
        status: "INVALID_PHOTO",
        errors: normalized.errors,
      }, cookiesToSet);
    }

    const result = await createMemberPhotoUpload(session.member, normalized);
    logAuth("member_photos", "upload_ready", {
      lead_hash: hashIdentifier(result.member.lead_id),
      photo_hash: hashIdentifier(result.upload.photo_id),
    });
    return response(event, 200, {
      ok: true,
      status: "PHOTO_UPLOAD_READY",
      photos: publicPhotosForMember(result.member),
      upload: result.upload,
    }, cookiesToSet);
  }

  if (mode === "set-face") {
    const photoId = normalizeText(body.photo_id);
    const updated = await setMemberFacePhoto(session.member, photoId);
    if (!updated) {
      logAuth("member_photos", "invalid_face", {
        lead_hash: hashIdentifier(session.member.lead_id),
        photo_hash: hashIdentifier(photoId),
      });
      return response(event, 400, {
        ok: false,
        status: "INVALID_FACE_PHOTO",
      }, cookiesToSet);
    }

    logAuth("member_photos", "face_set", {
      lead_hash: hashIdentifier(updated.lead_id),
      photo_hash: hashIdentifier(photoId),
    });
    return response(event, 200, {
      ok: true,
      status: "FACE_PHOTO_SET",
      photos: publicPhotosForMember(updated),
    }, cookiesToSet);
  }

  if (mode === "remove") {
    const photoId = normalizeText(body.photo_id);
    const updated = await removeMemberPhoto(session.member, photoId);
    if (!updated) {
      logAuth("member_photos", "invalid_remove", {
        lead_hash: hashIdentifier(session.member.lead_id),
        photo_hash: hashIdentifier(photoId),
      });
      return response(event, 400, {
        ok: false,
        status: "INVALID_PHOTO_REMOVE",
      }, cookiesToSet);
    }

    logAuth("member_photos", "removed", {
      lead_hash: hashIdentifier(updated.lead_id),
      photo_hash: hashIdentifier(photoId),
    });
    return response(event, 200, {
      ok: true,
      status: "PHOTO_REMOVED",
      photos: publicPhotosForMember(updated),
    }, cookiesToSet);
  }

  return response(event, 400, {
    ok: false,
    status: "INVALID_PHOTO_ACTION",
  }, cookiesToSet);
}

async function handleMemberPhotoThumbnail(event) {
  const { session, refreshedTokens, refreshToken } = await memberSessionFromEvent(event);

  if (!session.ok) {
    logAuth("member_photo_thumbnail", session.status || "invalid", {
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, session.statusCode || 401, session, clearSessionCookies());
  }

  const cookiesToSet = refreshedTokens
    ? sessionCookies({ ...refreshedTokens, RefreshToken: refreshToken })
    : [];

  if (!canUseMemberPhotos(session.member)) {
    logAuth("member_photo_thumbnail", "unavailable", {
      lead_hash: hashIdentifier(session.member.lead_id),
    });
    return response(event, 403, {
      ok: false,
      status: "ACTION_UNAVAILABLE",
    }, cookiesToSet);
  }

  const photoId = normalizeText(
    event?.queryStringParameters?.photo_id ||
    safeParseBody(event).photo_id
  );
  const thumbKey = thumbnailKeyForMemberPhoto(session.member, photoId);
  if (!thumbKey) {
    logAuth("member_photo_thumbnail", "not_found", {
      lead_hash: hashIdentifier(session.member.lead_id),
      photo_hash: hashIdentifier(photoId),
    });
    return response(event, 404, {
      ok: false,
      status: "PHOTO_NOT_FOUND",
    }, cookiesToSet);
  }

  const object = await s3.send(new GetObjectCommand({
    Bucket: PHOTO_THUMBNAILS_BUCKET,
    Key: thumbKey,
  }));
  const buffer = Buffer.concat(await streamToChunks(object.Body));
  logAuth("member_photo_thumbnail", "served", {
    lead_hash: hashIdentifier(session.member.lead_id),
    photo_hash: hashIdentifier(photoId),
  });

  return binaryResponse(event, 200, buffer, object.ContentType || "image/jpeg", cookiesToSet);
}

async function handleMemberDsar(event) {
  const body = parseBody(event);
  const mode = normalizeText(body.mode || "export").toLowerCase();
  const { session, refreshedTokens, refreshToken } = await memberSessionFromEvent(event);

  if (!session.ok) {
    logAuth("member_dsar", session.status || "invalid", {
      sub_hash: hashIdentifier(session.cognito_sub),
    });
    return response(event, session.statusCode || 401, session, clearSessionCookies());
  }

  const cookiesToSet = refreshedTokens
    ? sessionCookies({ ...refreshedTokens, RefreshToken: refreshToken })
    : [];

  if (mode === "export") {
    const audit = await writeMemberAudit(session.member, "member_dsar_export", {
      category: "access_export",
    });
    const exportPayload = buildMemberDataExport(session.member, audit);

    logAuth("member_dsar", "exported", {
      lead_hash: hashIdentifier(session.member.lead_id),
      audit_hash: hashIdentifier(audit.audit_id),
    });
    return response(event, 200, {
      ok: true,
      status: "DSAR_EXPORT_READY",
      generated_at: exportPayload.generated_at,
      format: "json",
      export: exportPayload,
    }, cookiesToSet);
  }

  if (mode === "erase") {
    if (body.confirmed !== true || normalizeText(body.confirmation) !== DSAR_ERASURE_CONFIRMATION) {
      logAuth("member_dsar", "erase_confirmation_missing", {
        lead_hash: hashIdentifier(session.member.lead_id),
      });
      return response(event, 400, {
        ok: false,
        status: "ERASURE_CONFIRMATION_REQUIRED",
        confirmation_phrase: DSAR_ERASURE_CONFIRMATION,
      }, cookiesToSet);
    }

    const result = await eraseMemberData(session.member);
    logAuth("member_dsar", "erased", {
      lead_hash: hashIdentifier(session.member.lead_id),
      audit_hash: hashIdentifier(result.audit_id),
      deleted_objects: result.deleted_objects,
    });
    return response(event, 200, {
      ok: true,
      status: "ERASURE_COMPLETED",
      erased_at: result.erased_at,
      deleted_photo_objects: result.deleted_objects,
      retained: {
        legal_financial_audit_minimum: true,
        backups_retained_until_expiry: true,
        ulttra_crm_follow_up_required: true,
      },
      message: "Your Presttige member account has been erased where the law allows. Minimum legal, financial, and audit records are retained.",
    }, clearSessionCookies());
  }

  return response(event, 400, {
    ok: false,
    status: "INVALID_DSAR_ACTION",
  }, cookiesToSet);
}

async function handleLogout(event) {
  logAuth("logout", "cleared", {});
  return response(event, 200, {
    ok: true,
    status: "SIGNED_OUT",
    message: "Signed out.",
  }, clearAllAuthCookies());
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

async function sessionFromAccessToken(accessToken, options = {}) {
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
  const readiness = memberReadiness(lead, options);

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

function memberReadiness(lead, options = {}) {
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

  if (isFounderMember(lead) && !options.allowFounderTotpPending && !isFounderTotpEnabled(lead)) {
    return {
      ok: false,
      statusCode: 403,
      status: "FOUNDER_TOTP_ENROLL_REQUIRED",
      message: "Founder authenticator setup is required.",
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
    photos: publicPhotosForMember(lead),
    security: {
      founder_totp_required: isFounderMember(lead),
      founder_totp_enabled: isFounderTotpEnabled(lead),
      founder_totp_label: isFounderMember(lead) ? FOUNDER_TOTP_LABEL : "",
    },
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

function buildMemberDataExport(lead, audit) {
  const generatedAt = new Date().toISOString();
  return {
    schema_version: 1,
    generated_at: generatedAt,
    export_audit_id: audit.audit_id,
    subject: {
      lead_id: normalizeText(lead.lead_id),
      name: normalizeText(lead.name),
      email: normalizeEmail(lead.email),
    },
    membership: pickExistingFields(lead, [
      "subscriber_type",
      "tier",
      "selected_tier",
      "effective_tier",
      "simulated_tier",
      "test_tier",
      "account_status",
      "account_active",
      "access_status",
      "validation_status",
      "profile_status",
      "review_status",
      "payment_status",
      "signup_path",
      "founder_lifetime",
      "created_at",
      "updated_at",
      "account_created_at",
      "password_set_at",
    ]),
    identity: pickExistingFields(lead, [
      "cognito_pool",
      "cognito_sub",
    ]),
    contact_and_profile: publicProfile(lead),
    interests: publicInterests(lead),
    photos: exportMemberPhotoReferences(lead),
    consents: collectFieldsByName(lead, [
      "consent",
      "privacy",
      "terms",
      "gdpr",
      "marketing",
      "refund",
      "article_16",
      "article16",
    ]),
    legal_financial_references: pickExistingFields(lead, [
      "stripe_customer_id",
      "stripe_subscription_id",
      "stripe_session_id",
      "stripe_payment_intent_id",
      "payment_status",
      "paid_at",
      "subscription_status",
      "subscription_current_period_end",
    ]),
    notes: {
      scope: "This export contains the authenticated member record held by Presttige for this account.",
      urls: "No file link, upload link, security token, or secret is included.",
      correction: "Rectification is handled through the Profile section where validation permits edits, and by contacting Presttige for fixed identity fields.",
      erasure: "Erasure can be requested from the Privacy section. Legal, financial, and audit minimum records may be retained where required.",
      ulttra_crm: "Ulttra CRM copies are identified as a follow-up integration item and are not erased by this member self-service endpoint yet.",
      backups: "Backups remain until their configured retention expiry.",
    },
  };
}

function pickExistingFields(source, keys) {
  return Object.fromEntries(
    keys
      .filter((key) => Object.prototype.hasOwnProperty.call(source || {}, key))
      .map((key) => [key, source[key]])
  );
}

function collectFieldsByName(source, fragments) {
  const lowered = fragments.map((fragment) => normalizeText(fragment).toLowerCase()).filter(Boolean);
  return Object.fromEntries(
    Object.entries(source || {})
      .filter(([key]) => {
        const loweredKey = normalizeText(key).toLowerCase();
        return lowered.some((fragment) => loweredKey.includes(fragment));
      })
      .map(([key, value]) => [key, value])
  );
}

function exportMemberPhotoReferences(lead) {
  const photos = normalizePhotosForMember(lead);
  return {
    schema_version: photos.schema_version,
    photo_model: normalizeText(photos.photo_model || "normal_always_six"),
    required_count: photos.required_count,
    min_count: photos.min_count,
    max_count: photos.max_count,
    seeded_internal_count: photos.seeded_internal_count,
    visible_required_count: photos.visible_required_count,
    face_photo_id: normalizeText(photos.face_photo_id),
    visible_slots: photos.visible_slots.map((slot) => {
      const photoId = normalizeText(slot.photo_id);
      const photoMeta = photoId ? (lead.photo_uploads?.[photoId] || {}) : {};
      return {
        slot: slot.slot,
        status: normalizeText(photoMeta.status || slot.status).toLowerCase() || "empty",
        photo_id: photoId,
        is_face: Boolean(photoId && photoId === photos.face_photo_id),
        content_type: normalizeText(slot.content_type || photoMeta.content_type),
        file_size: Number(slot.file_size || photoMeta.file_size || 0),
        uploaded_at: normalizeText(photoMeta.uploaded_at || slot.created_at),
        processed_at: normalizeText(photoMeta.processed_at || slot.updated_at),
        thumbnail_status: photoMeta.thumbnails?.["400"] ? "ready" : "not_available",
      };
    }),
    updated_at: photos.updated_at,
  };
}

async function eraseMemberData(lead) {
  const requestedAudit = await writeMemberAudit(lead, "member_dsar_erasure_requested", {
    category: "erasure",
  });
  const erasedAt = new Date().toISOString();
  const photoDeletion = await deleteMemberPhotoObjects(lead);
  const cognitoResult = await eraseCognitoUser(lead);
  const updated = await markMemberErased(lead, {
    audit_id: requestedAudit.audit_id,
    erased_at: erasedAt,
    deleted_objects: photoDeletion.deleted,
    cognito_status: cognitoResult.status,
  });
  const completedAudit = await writeMemberAudit(updated, "member_dsar_erasure_completed", {
    category: "erasure",
    requested_audit_id: requestedAudit.audit_id,
    deleted_photo_objects: photoDeletion.deleted,
    cognito_status: cognitoResult.status,
  });
  await sendErasureConfirmation(lead, erasedAt);

  return {
    audit_id: completedAudit.audit_id,
    erased_at: erasedAt,
    deleted_objects: photoDeletion.deleted,
  };
}

async function writeMemberAudit(lead, action, metadata) {
  const timestamp = new Date().toISOString();
  const item = {
    audit_id: crypto.randomUUID(),
    timestamp,
    action,
    actor_type: "member_self_service",
    actor_id: normalizeText(lead?.lead_id),
    lead_id: normalizeText(lead?.lead_id),
    target_lead_id: normalizeText(lead?.lead_id),
    metadata: sanitizeAuditMetadata(metadata || {}),
  };

  await ddb.send(new PutCommand({
    TableName: AUDIT_TABLE_NAME,
    Item: item,
    ConditionExpression: "attribute_not_exists(audit_id)",
  }));
  return item;
}

function sanitizeAuditMetadata(metadata) {
  const safe = {};
  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (typeof value === "number" || typeof value === "boolean") {
      safe[key] = value;
      return;
    }
    safe[key] = normalizeText(value);
  });
  return safe;
}

async function deleteMemberPhotoObjects(lead) {
  const objects = memberPhotoObjectsForDeletion(lead);
  let deleted = 0;
  for (const object of objects) {
    await s3.send(new DeleteObjectCommand({
      Bucket: object.bucket,
      Key: object.key,
    }));
    deleted += 1;
  }
  return { deleted };
}

function memberPhotoObjectsForDeletion(lead) {
  const objects = new Map();
  const addObject = (bucket, key) => {
    const normalizedKey = normalizeText(key);
    if (!bucket || !normalizedKey) {
      return;
    }
    objects.set(`${bucket}/${normalizedKey}`, { bucket, key: normalizedKey });
  };

  normalizeMemberPhotos(lead).visible_slots.forEach((slot) => {
    addObject(PHOTO_ORIGINALS_BUCKET, slot.original_key);
  });

  Object.values(lead?.photo_uploads || {}).forEach((upload) => {
    addObject(PHOTO_ORIGINALS_BUCKET, upload.original_key);
    Object.values(upload.thumbnails || {}).forEach((thumbnailKey) => {
      addObject(PHOTO_THUMBNAILS_BUCKET, thumbnailKey);
    });
  });

  return Array.from(objects.values());
}

async function eraseCognitoUser(lead) {
  const username = normalizeEmail(lead?.email);
  if (!username) {
    return { status: "not_available" };
  }

  try {
    await cognito.send(new AdminDisableUserCommand({
      UserPoolId: MEMBER_USER_POOL_ID,
      Username: username,
    }));
  } catch (error) {
    if (safeErrorType(error) !== "UserNotFoundException") {
      throw error;
    }
  }

  try {
    await cognito.send(new AdminDeleteUserCommand({
      UserPoolId: MEMBER_USER_POOL_ID,
      Username: username,
    }));
    return { status: "deleted" };
  } catch (error) {
    if (safeErrorType(error) === "UserNotFoundException") {
      return { status: "already_deleted" };
    }
    throw error;
  }
}

async function markMemberErased(lead, erasure) {
  const subjectRef = hashIdentifier(`${normalizeText(lead.lead_id)}:${normalizeEmail(lead.email)}`);
  const pseudonymousEmail = `erased-${subjectRef}@erased.presttige.local`;
  const fields = {
    name: "Erased member",
    email: pseudonymousEmail,
    account_status: "erased",
    account_active: false,
    access_status: "erased",
    email_status: "erased",
    profile_status: "erased",
    validation_status: "erased",
    marketing_consent: false,
    marketing_opt_out_at: erasure.erased_at,
    synthetic_test: lead.synthetic_test === true,
    erased: true,
    erasure_status: "completed",
    erased_at: erasure.erased_at,
    erasure_audit_id: erasure.audit_id,
    erasure_contact_hash: hashIdentifier(lead.email),
    erasure_subject_ref: subjectRef,
    erasure_deleted_photo_objects: Number(erasure.deleted_objects || 0),
    erasure_cognito_status: normalizeText(erasure.cognito_status),
    dsar_backups_retained_until_expiry: true,
    dsar_legal_financial_audit_retained: true,
    updated_at: erasure.erased_at,
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

  const removeFields = [
    "cognito_sub",
    "phone_country",
    "phone",
    "phone_full",
    "phone_number",
    "age",
    "country",
    "city",
    "occupation",
    "company",
    "website",
    "linkedin",
    "instagram",
    "tiktok",
    "bio",
    "short_introduction",
    "member_interests",
    "member_interests_updated_at",
    "member_photos",
    "member_photos_updated_at",
    "photo_uploads",
    "photos",
    "avatar",
    "profile_photo",
    "password_set_at",
    "password_setup_token_hash",
    "password_setup_token_status",
    "password_setup_started_at",
    "password_setup_completed_at",
    "welcome_email_sent_at",
    "activation_email_sent_at",
    "checkout_token",
    "magic_token",
    "review_token",
    "founder_token",
    "founder_magic_token",
    "lead_ip",
    "ip_address",
    "user_agent",
  ];
  removeFields.forEach((key) => {
    names[`#remove_${key}`] = key;
  });

  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      lead_id: normalizeText(lead.lead_id),
    },
    UpdateExpression: `SET ${assignments.join(", ")} REMOVE ${removeFields.map((key) => `#remove_${key}`).join(", ")}`,
    ConditionExpression: "lead_id = :lead_id AND cognito_sub = :cognito_sub",
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW",
  }));

  return result.Attributes || { ...lead, ...fields };
}

async function sendErasureConfirmation(lead, erasedAt) {
  const isTest = lead?.synthetic_test === true;
  const toAddress = isTest ? TEST_SEND_RECIPIENT : normalizeEmail(lead?.email);
  if (!toAddress) {
    return;
  }

  const html = [
    "<!doctype html><html><body>",
    "<p>Presttige has completed the erasure request for your member account where the law allows.</p>",
    "<p>Minimum legal, financial, and audit records may be retained. Backups remain until their configured retention expiry.</p>",
    isTest ? "<p>This controlled tester notice was routed to FQ. No real member was contacted.</p>" : "",
    "</body></html>",
  ].join("");
  const text = [
    "Presttige has completed the erasure request for your member account where the law allows.",
    "Minimum legal, financial, and audit records may be retained. Backups remain until their configured retention expiry.",
    isTest ? "This controlled tester notice was routed to FQ. No real member was contacted." : "",
  ].filter(Boolean).join("\n");

  await ses.send(new SendEmailCommand({
    Source: `Presttige <${MEMBER_EMAIL_FROM}>`,
    ConfigurationSetName: SES_CONFIGURATION_SET,
    ReplyToAddresses: [MEMBER_EMAIL_REPLY_TO],
    Destination: {
      ToAddresses: [toAddress],
    },
    Message: {
      Subject: {
        Data: "Presttige data erasure confirmation",
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
  }));
  logAuth("member_dsar", "erasure_confirmation_sent", {
    lead_hash: hashIdentifier(lead?.lead_id),
    recipient_type: isTest ? "test_fq" : "member",
    erased_hash: hashIdentifier(erasedAt),
  });
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

function isFounderMember(lead) {
  if (!lead) {
    return false;
  }
  const values = [
    canonicalTier(lead),
    lead.signup_path,
    lead.tier,
    lead.selected_tier,
    lead.effective_tier,
    lead.simulated_tier,
    lead.subscriber_type,
  ].map((value) => normalizeText(value).toLowerCase());
  return values.some((value) => value === "founder" || value === "paid_founder");
}

function isFounderTotpEnabled(lead) {
  return normalizeText(lead?.founder_totp_status).toLowerCase() === "enabled" &&
    Boolean(normalizeText(lead?.founder_totp_enabled_at));
}

function founderTotpOtpauthUrl(secretCode) {
  const label = encodeURIComponent(FOUNDER_TOTP_LABEL);
  const issuer = encodeURIComponent(FOUNDER_TOTP_LABEL);
  return `otpauth://totp/${label}?secret=${encodeURIComponent(secretCode)}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

async function saveFounderTotpEnabled(lead, recoveryCodeHashes) {
  const now = new Date().toISOString();
  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      lead_id: normalizeText(lead.lead_id),
    },
    UpdateExpression: [
      "SET founder_totp_status = :status",
      "founder_totp_enabled_at = :now",
      "founder_totp_label = :label",
      "founder_totp_recovery_codes = :codes",
      "founder_totp_recovery_codes_generated_at = :now",
      "updated_at = :now",
      "REMOVE founder_totp_reset_at, founder_totp_reset_reason",
    ].join(", ").replace(", REMOVE", " REMOVE"),
    ConditionExpression: "lead_id = :lead_id AND cognito_sub = :cognito_sub",
    ExpressionAttributeValues: {
      ":lead_id": normalizeText(lead.lead_id),
      ":cognito_sub": normalizeText(lead.cognito_sub),
      ":status": "enabled",
      ":now": now,
      ":label": FOUNDER_TOTP_LABEL,
      ":codes": recoveryCodeHashes,
    },
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes || lead;
}

async function saveFounderTotpRecoveryReset(lead, matched) {
  const now = new Date().toISOString();
  const recoveryCodes = (Array.isArray(lead.founder_totp_recovery_codes)
    ? lead.founder_totp_recovery_codes
    : []
  ).map((item) => {
    if (normalizeText(item.id) !== matched.id) {
      return item;
    }
    return {
      ...item,
      used_at: now,
    };
  });
  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE_NAME,
    Key: {
      lead_id: normalizeText(lead.lead_id),
    },
    UpdateExpression: [
      "SET founder_totp_status = :status",
      "founder_totp_reset_at = :now",
      "founder_totp_reset_reason = :reason",
      "founder_totp_recovery_codes = :codes",
      "updated_at = :now",
      "REMOVE founder_totp_enabled_at",
    ].join(", ").replace(", REMOVE", " REMOVE"),
    ConditionExpression: "lead_id = :lead_id AND cognito_sub = :cognito_sub",
    ExpressionAttributeValues: {
      ":lead_id": normalizeText(lead.lead_id),
      ":cognito_sub": normalizeText(lead.cognito_sub),
      ":status": "reset_required",
      ":now": now,
      ":reason": "recovery_code",
      ":codes": recoveryCodes,
    },
    ReturnValues: "ALL_NEW",
  }));
  return result.Attributes || lead;
}

function generateFounderRecoveryCodes() {
  const codes = [];
  const hashes = [];
  for (let index = 0; index < FOUNDER_TOTP_RECOVERY_CODE_COUNT; index += 1) {
    const code = `PP-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const salt = crypto.randomBytes(16).toString("hex");
    codes.push(code);
    hashes.push({
      id: crypto.randomUUID(),
      salt,
      hash: recoveryCodeHash(code, salt),
      created_at: new Date().toISOString(),
    });
  }
  return { codes, hashes };
}

function findMatchingRecoveryCode(lead, recoveryCode) {
  const normalized = normalizeRecoveryCode(recoveryCode);
  if (!normalized) {
    return null;
  }
  const codes = Array.isArray(lead?.founder_totp_recovery_codes)
    ? lead.founder_totp_recovery_codes
    : [];
  return codes.find((item) => {
    if (normalizeText(item.used_at)) {
      return false;
    }
    const salt = normalizeText(item.salt);
    const expected = normalizeText(item.hash);
    return salt && expected && recoveryCodeHash(normalized, salt) === expected;
  }) || null;
}

function recoveryCodeHash(code, salt) {
  return crypto.createHash("sha256")
    .update(`${normalizeText(salt)}:${normalizeRecoveryCode(code)}`)
    .digest("hex");
}

function normalizeTotpCode(value) {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  return /^[0-9]{6}$/.test(normalized) ? normalized : "";
}

function normalizeRecoveryCode(value) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
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

function canUseNormalMemberPhotos(lead) {
  return isMemberValidated(lead) && canonicalTier(lead) !== "founder";
}

function canUseMemberPhotos(lead) {
  return isMemberValidated(lead);
}

function publicPhotosForMember(lead) {
  if (!canUseMemberPhotos(lead)) {
    return lockedPhotosForMember(lead);
  }
  return isFounderMember(lead) ? publicFounderPhotos(lead) : publicMemberPhotos(lead);
}

function lockedPhotosForMember(lead) {
  return isFounderMember(lead) ? lockedFounderPhotos() : lockedMemberPhotos();
}

function normalizePhotoUploadRequest(lead, body) {
  const founder = isFounderMember(lead);
  const slotMin = founder ? FOUNDER_PHOTO_SLOT_MIN : MEMBER_PHOTO_SLOT_MIN;
  const slotMax = founder ? FOUNDER_PHOTO_SLOT_MAX : MEMBER_PHOTO_SLOT_MAX;
  const slot = Number(body.slot);
  const contentType = normalizeText(body.content_type).toLowerCase();
  const fileSize = Number(body.file_size || 0);
  const errors = [];

  if (!Number.isInteger(slot) || slot < slotMin || slot > slotMax) {
    errors.push("slot");
  }
  if (!MEMBER_PHOTO_TYPES.has(contentType)) {
    errors.push("content_type");
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MEMBER_PHOTO_MAX_SIZE) {
    errors.push("file_size");
  }
  if (founder && !errors.includes("slot")) {
    const photos = normalizeFounderPhotos(lead);
    const replacing = photos.visible_slots.some((item) => item.slot === slot && item.photo_id);
    if (!replacing && photos.visible_slots.length >= FOUNDER_PHOTO_MAX_COUNT) {
      errors.push("max_count");
    }
  }

  return {
    slot,
    content_type: contentType,
    file_size: fileSize,
    errors,
  };
}

async function createMemberPhotoUpload(lead, normalized) {
  const upload = await invokePhotoUploadInit(lead, normalized);
  const updated = await recordMemberPhotoSlot(lead, {
    slot: normalized.slot,
    photo_id: normalizeText(upload.photo_id),
    original_key: normalizeText(upload.key),
    content_type: normalized.content_type,
    file_size: normalized.file_size,
  });

  return {
    member: updated,
    upload: {
      photo_id: normalizeText(upload.photo_id),
      upload_url: normalizeText(upload.upload_url),
      upload_fields: upload.upload_fields || {},
      expires_in: Number(upload.expires_in || 300),
    },
  };
}

async function invokePhotoUploadInit(lead, normalized) {
  const payload = {
    body: JSON.stringify({
      lead_id: normalizeText(lead.lead_id),
      content_type: normalized.content_type,
      file_size: normalized.file_size,
      is_test: lead.synthetic_test === true,
    }),
  };
  const result = await lambda.send(new InvokeCommand({
    FunctionName: PHOTO_UPLOAD_INIT_FUNCTION,
    InvocationType: "RequestResponse",
    Payload: Buffer.from(JSON.stringify(payload)),
  }));
  const lambdaPayload = JSON.parse(Buffer.from(result.Payload || []).toString("utf8") || "{}");
  const statusCode = Number(lambdaPayload.statusCode || 500);
  const body = JSON.parse(lambdaPayload.body || "{}");

  if (statusCode < 200 || statusCode >= 300 || !body.photo_id || !body.upload_url || !body.upload_fields) {
    const error = new Error("Photo upload initialization failed");
    error.name = "PhotoUploadInitError";
    throw error;
  }

  return body;
}

async function recordMemberPhotoSlot(lead, photo) {
  if (isFounderMember(lead)) {
    return recordFounderPhotoSlot(lead, photo);
  }

  const now = new Date().toISOString();
  const photos = normalizeMemberPhotos(lead);
  const previousSlot = photos.visible_slots.find((slot) => slot.slot === photo.slot);
  const wasFace = previousSlot?.photo_id && previousSlot.photo_id === photos.face_photo_id;
  const visibleSlots = photos.visible_slots.map((slot) => {
    if (slot.slot !== photo.slot) {
      return slot;
    }
    return {
      slot: photo.slot,
      source: "member_upload",
      photo_id: photo.photo_id,
      original_key: photo.original_key,
      content_type: photo.content_type,
      file_size: photo.file_size,
      status: "awaiting_upload",
      created_at: slot.created_at || now,
      updated_at: now,
    };
  });
  const currentFaceExists = visibleSlots.some((slot) => slot.photo_id === photos.face_photo_id);
  const facePhotoId = wasFace || !photos.face_photo_id || !currentFaceExists
    ? photo.photo_id
    : photos.face_photo_id;
  const updatedPhotos = {
    schema_version: 1,
    required_count: NORMAL_MEMBER_PHOTO_REQUIRED_COUNT,
    seeded_internal_count: INTERNAL_SEEDED_PHOTO_COUNT,
    visible_required_count: NORMAL_MEMBER_PHOTO_REQUIRED_COUNT - INTERNAL_SEEDED_PHOTO_COUNT,
    face_photo_id: facePhotoId,
    visible_slots: visibleSlots,
    updated_at: now,
  };

  return saveMemberPhotos(lead, updatedPhotos);
}

async function recordFounderPhotoSlot(lead, photo) {
  const now = new Date().toISOString();
  const photos = normalizeFounderPhotos(lead);
  const previousSlot = photos.visible_slots.find((slot) => slot.slot === photo.slot);
  const wasFace = previousSlot?.photo_id && previousSlot.photo_id === photos.face_photo_id;
  const visibleSlots = [
    ...photos.visible_slots.filter((slot) => slot.slot !== photo.slot),
    {
      slot: photo.slot,
      source: "founder_upload",
      photo_id: photo.photo_id,
      original_key: photo.original_key,
      content_type: photo.content_type,
      file_size: photo.file_size,
      status: "awaiting_upload",
      created_at: previousSlot?.created_at || now,
      updated_at: now,
    },
  ].sort((left, right) => left.slot - right.slot);
  const currentFaceExists = visibleSlots.some((slot) => slot.photo_id === photos.face_photo_id);
  const facePhotoId = wasFace || !photos.face_photo_id || !currentFaceExists
    ? photo.photo_id
    : photos.face_photo_id;
  return saveMemberPhotos(lead, founderPhotosPayload({
    ...photos,
    face_photo_id: facePhotoId,
    visible_slots: visibleSlots,
    updated_at: now,
  }));
}

async function setMemberFacePhoto(lead, photoId) {
  const id = normalizeText(photoId);
  if (!id) {
    return null;
  }
  const photos = normalizePhotosForMember(lead);
  const ownsPhoto = photos.visible_slots.some((slot) => slot.photo_id === id);
  const photoMeta = lead.photo_uploads?.[id] || {};
  if (!ownsPhoto || photoMeta.status !== "ready") {
    return null;
  }

  const updatedPhotos = {
    ...photos,
    face_photo_id: id,
    updated_at: new Date().toISOString(),
  };
  return saveMemberPhotos(lead, updatedPhotos);
}

async function removeMemberPhoto(lead, photoId) {
  if (!isFounderMember(lead)) {
    return null;
  }
  const id = normalizeText(photoId);
  if (!id) {
    return null;
  }
  const photos = normalizeFounderPhotos(lead);
  const activeSlots = photos.visible_slots.filter((slot) => slot.photo_id);
  const target = activeSlots.find((slot) => slot.photo_id === id);
  if (!target || activeSlots.length <= FOUNDER_PHOTO_MIN_COUNT) {
    return null;
  }

  const remaining = activeSlots.filter((slot) => slot.photo_id !== id);
  if (remaining.length < FOUNDER_PHOTO_MIN_COUNT) {
    return null;
  }

  const currentFaceExists = remaining.some((slot) => slot.photo_id === photos.face_photo_id);
  const facePhotoId = currentFaceExists ? photos.face_photo_id : remaining[0].photo_id;
  const updatedPhotos = founderPhotosPayload({
    ...photos,
    face_photo_id: facePhotoId,
    visible_slots: remaining,
    updated_at: new Date().toISOString(),
  });

  if (!lead.photo_uploads?.[id]) {
    return saveMemberPhotos(lead, updatedPhotos);
  }
  return saveMemberPhotosWithRemovedUpload(lead, updatedPhotos, id);
}

async function saveMemberPhotos(lead, photos) {
  const now = new Date().toISOString();
  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        lead_id: normalizeText(lead.lead_id),
      },
      UpdateExpression: "SET member_photos = :photos, member_photos_updated_at = :now, updated_at = :now",
      ConditionExpression: "lead_id = :lead_id AND cognito_sub = :cognito_sub",
      ExpressionAttributeValues: {
        ":lead_id": normalizeText(lead.lead_id),
        ":cognito_sub": normalizeText(lead.cognito_sub),
        ":photos": photos,
        ":now": now,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes || lead;
}

async function saveMemberPhotosWithRemovedUpload(lead, photos, photoId) {
  const now = new Date().toISOString();
  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        lead_id: normalizeText(lead.lead_id),
      },
      UpdateExpression: [
        "SET member_photos = :photos",
        "member_photos_updated_at = :now",
        "updated_at = :now",
        "photo_uploads.#pid.#status = :removed",
        "photo_uploads.#pid.removed_at = :now",
        "photo_uploads.#pid.selected_for_committee = :selected",
      ].join(", "),
      ConditionExpression: "lead_id = :lead_id AND cognito_sub = :cognito_sub",
      ExpressionAttributeNames: {
        "#pid": photoId,
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":lead_id": normalizeText(lead.lead_id),
        ":cognito_sub": normalizeText(lead.cognito_sub),
        ":photos": photos,
        ":now": now,
        ":removed": "removed",
        ":selected": false,
      },
      ReturnValues: "ALL_NEW",
    })
  );

  return result.Attributes || lead;
}

function normalizePhotosForMember(lead) {
  return isFounderMember(lead) ? normalizeFounderPhotos(lead) : normalizeMemberPhotos(lead);
}

function normalizeMemberPhotos(lead) {
  const raw = lead?.member_photos && typeof lead.member_photos === "object"
    ? lead.member_photos
    : {};
  const existingSlots = Array.isArray(raw.visible_slots)
    ? raw.visible_slots
    : [];
  const slotsByNumber = new Map(
    existingSlots
      .filter((slot) => Number.isInteger(Number(slot.slot)))
      .map((slot) => [Number(slot.slot), slot])
  );
  const visibleSlots = [];

  for (let slot = MEMBER_PHOTO_SLOT_MIN; slot <= MEMBER_PHOTO_SLOT_MAX; slot += 1) {
    const existing = slotsByNumber.get(slot) || {};
    const photoId = normalizeText(existing.photo_id);
    const uploadStatus = photoId
      ? normalizeText(lead?.photo_uploads?.[photoId]?.status).toLowerCase()
      : "";
    visibleSlots.push({
      slot,
      source: "member_upload",
      photo_id: photoId,
      original_key: normalizeText(existing.original_key),
      content_type: normalizeText(existing.content_type),
      file_size: Number(existing.file_size || 0),
      status: uploadStatus || normalizeText(existing.status || "empty").toLowerCase() || "empty",
      created_at: normalizeText(existing.created_at),
      updated_at: normalizeText(existing.updated_at),
    });
  }

  const facePhotoId = normalizeText(raw.face_photo_id);
  return {
    schema_version: 1,
    required_count: NORMAL_MEMBER_PHOTO_REQUIRED_COUNT,
    seeded_internal_count: INTERNAL_SEEDED_PHOTO_COUNT,
    visible_required_count: NORMAL_MEMBER_PHOTO_REQUIRED_COUNT - INTERNAL_SEEDED_PHOTO_COUNT,
    face_photo_id: facePhotoId,
    visible_slots: visibleSlots,
    updated_at: normalizeText(raw.updated_at),
  };
}

function normalizeFounderPhotos(lead) {
  const raw = lead?.member_photos && typeof lead.member_photos === "object"
    ? lead.member_photos
    : {};
  const existingSlots = Array.isArray(raw.visible_slots)
    ? raw.visible_slots
    : [];
  const slotsByNumber = new Map();

  existingSlots.forEach((slot) => {
    const slotNumber = Number(slot.slot);
    if (!Number.isInteger(slotNumber) || slotNumber < FOUNDER_PHOTO_SLOT_MIN || slotNumber > FOUNDER_PHOTO_SLOT_MAX) {
      return;
    }
    const photoId = normalizeText(slot.photo_id);
    if (!photoId) {
      return;
    }
    const uploadStatus = normalizeText(lead?.photo_uploads?.[photoId]?.status).toLowerCase();
    if (uploadStatus === "removed") {
      return;
    }
    slotsByNumber.set(slotNumber, {
      slot: slotNumber,
      source: "founder_upload",
      photo_id: photoId,
      original_key: normalizeText(slot.original_key),
      content_type: normalizeText(slot.content_type),
      file_size: Number(slot.file_size || 0),
      status: uploadStatus || normalizeText(slot.status || "empty").toLowerCase() || "empty",
      created_at: normalizeText(slot.created_at),
      updated_at: normalizeText(slot.updated_at),
    });
  });

  const visibleSlots = Array.from(slotsByNumber.values()).sort((left, right) => left.slot - right.slot);
  const facePhotoId = normalizeText(raw.face_photo_id);
  const faceExists = visibleSlots.some((slot) => slot.photo_id === facePhotoId);
  const fallbackFace = visibleSlots.find((slot) => slot.status === "ready")?.photo_id || visibleSlots[0]?.photo_id || "";
  return founderPhotosPayload({
    face_photo_id: faceExists ? facePhotoId : fallbackFace,
    visible_slots: visibleSlots,
    updated_at: normalizeText(raw.updated_at),
  });
}

function founderPhotosPayload(value) {
  return {
    schema_version: 1,
    photo_model: "founder_optional",
    required_count: FOUNDER_PHOTO_MIN_COUNT,
    min_count: FOUNDER_PHOTO_MIN_COUNT,
    max_count: FOUNDER_PHOTO_MAX_COUNT,
    seeded_internal_count: 0,
    visible_required_count: FOUNDER_PHOTO_MIN_COUNT,
    face_photo_id: normalizeText(value.face_photo_id),
    visible_slots: Array.isArray(value.visible_slots)
      ? value.visible_slots
          .filter((slot) => normalizeText(slot.photo_id))
          .slice(0, FOUNDER_PHOTO_MAX_COUNT)
      : [],
    updated_at: normalizeText(value.updated_at),
  };
}

function publicMemberPhotos(lead) {
  const photos = normalizeMemberPhotos(lead);
  const slots = photos.visible_slots.map((slot) => publicMemberPhotoSlot(lead, photos, slot));
  const readyVisibleCount = slots.filter((slot) => slot.status === "ready").length;
  const faceReady = slots.some((slot) => slot.photo_id && slot.photo_id === photos.face_photo_id && slot.status === "ready");

  return {
    photo_model: "normal_always_six",
    required_count: photos.required_count,
    seeded_internal_count: photos.seeded_internal_count,
    visible_required_count: photos.visible_required_count,
    complete_count: photos.seeded_internal_count + readyVisibleCount,
    is_complete: readyVisibleCount === photos.visible_required_count && faceReady,
    face_photo_id: faceReady ? photos.face_photo_id : "",
    internal_slots: [
      { slot: 1, status: "internal_seeded" },
      { slot: 2, status: "internal_seeded" },
    ],
    visible_slots: slots,
    updated_at: photos.updated_at,
  };
}

function publicFounderPhotos(lead) {
  const photos = normalizeFounderPhotos(lead);
  const slots = photos.visible_slots.map((slot) => publicMemberPhotoSlot(lead, photos, slot));
  const readySlots = slots.filter((slot) => slot.status === "ready");
  const faceReady = readySlots.some((slot) => slot.photo_id === photos.face_photo_id);
  const nextAvailableSlot = nextFounderPhotoSlot(photos);

  return {
    photo_model: "founder_optional",
    required_count: FOUNDER_PHOTO_MIN_COUNT,
    min_count: FOUNDER_PHOTO_MIN_COUNT,
    max_count: FOUNDER_PHOTO_MAX_COUNT,
    seeded_internal_count: 0,
    visible_required_count: FOUNDER_PHOTO_MIN_COUNT,
    complete_count: readySlots.length,
    is_complete: readySlots.length >= FOUNDER_PHOTO_MIN_COUNT && faceReady,
    face_photo_id: faceReady ? photos.face_photo_id : "",
    can_add: Boolean(nextAvailableSlot),
    next_available_slot: nextAvailableSlot,
    can_remove: slots.length > FOUNDER_PHOTO_MIN_COUNT,
    internal_slots: [],
    visible_slots: slots,
    updated_at: photos.updated_at,
  };
}

function nextFounderPhotoSlot(photos) {
  const used = new Set(photos.visible_slots.map((slot) => Number(slot.slot)));
  for (let slot = FOUNDER_PHOTO_SLOT_MIN; slot <= FOUNDER_PHOTO_SLOT_MAX; slot += 1) {
    if (!used.has(slot)) {
      return slot;
    }
  }
  return 0;
}

function lockedMemberPhotos() {
  const visibleSlots = [];
  for (let slot = MEMBER_PHOTO_SLOT_MIN; slot <= MEMBER_PHOTO_SLOT_MAX; slot += 1) {
    visibleSlots.push({
      slot,
      status: "locked",
      photo_id: "",
      is_face: false,
      thumbnail_url: "",
      updated_at: "",
    });
  }
  return {
    photo_model: "normal_always_six",
    required_count: NORMAL_MEMBER_PHOTO_REQUIRED_COUNT,
    seeded_internal_count: INTERNAL_SEEDED_PHOTO_COUNT,
    visible_required_count: NORMAL_MEMBER_PHOTO_REQUIRED_COUNT - INTERNAL_SEEDED_PHOTO_COUNT,
    complete_count: INTERNAL_SEEDED_PHOTO_COUNT,
    is_complete: false,
    face_photo_id: "",
    internal_slots: [
      { slot: 1, status: "internal_seeded" },
      { slot: 2, status: "internal_seeded" },
    ],
    visible_slots: visibleSlots,
    updated_at: "",
  };
}

function lockedFounderPhotos() {
  return {
    photo_model: "founder_optional",
    required_count: FOUNDER_PHOTO_MIN_COUNT,
    min_count: FOUNDER_PHOTO_MIN_COUNT,
    max_count: FOUNDER_PHOTO_MAX_COUNT,
    seeded_internal_count: 0,
    visible_required_count: FOUNDER_PHOTO_MIN_COUNT,
    complete_count: 0,
    is_complete: false,
    face_photo_id: "",
    can_add: false,
    next_available_slot: 0,
    can_remove: false,
    internal_slots: [],
    visible_slots: [],
    updated_at: "",
  };
}

function publicMemberPhotoSlot(lead, photos, slot) {
  const photoId = normalizeText(slot.photo_id);
  const photoMeta = photoId ? (lead.photo_uploads?.[photoId] || {}) : {};
  const status = photoId ? normalizeText(photoMeta.status || slot.status).toLowerCase() : "empty";
  const thumbKey = status === "ready"
    ? normalizeText(photoMeta.thumbnails?.["400"])
    : "";

  return {
    slot: slot.slot,
    status: status || "empty",
    photo_id: photoId,
    is_face: Boolean(photoId && photoId === photos.face_photo_id && status === "ready"),
    thumbnail_url: thumbKey ? `/member-api/photo-thumbnail?photo_id=${encodeURIComponent(photoId)}&v=${encodeURIComponent(normalizeText(photoMeta.processed_at || slot.updated_at))}` : "",
    updated_at: normalizeText(photoMeta.processed_at || slot.updated_at),
  };
}

function thumbnailKeyForMemberPhoto(lead, photoId) {
  const id = normalizeText(photoId);
  if (!id) {
    return "";
  }
  const photos = normalizePhotosForMember(lead);
  const ownsPhoto = photos.visible_slots.some((slot) => slot.photo_id === id);
  if (!ownsPhoto) {
    return "";
  }
  return normalizeText(lead.photo_uploads?.[id]?.thumbnails?.["400"]);
}

async function streamToChunks(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return chunks;
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

function founderTotpEnrollmentCookies(tokens) {
  const cookies = [];
  if (tokens.AccessToken) {
    cookies.push(makeCookie(COOKIE_FOUNDER_TOTP_ENROLL_ACCESS, tokens.AccessToken, FOUNDER_TOTP_COOKIE_MAX_AGE_SECONDS));
  }
  if (tokens.IdToken) {
    cookies.push(makeCookie(COOKIE_FOUNDER_TOTP_ENROLL_ID, tokens.IdToken, FOUNDER_TOTP_COOKIE_MAX_AGE_SECONDS));
  }
  if (tokens.RefreshToken) {
    cookies.push(makeCookie(COOKIE_FOUNDER_TOTP_ENROLL_REFRESH, tokens.RefreshToken, FOUNDER_TOTP_COOKIE_MAX_AGE_SECONDS));
  }
  return cookies;
}

function founderTotpChallengeCookies(challengeSession) {
  if (!challengeSession) {
    return clearFounderTotpChallengeCookies();
  }
  return [
    makeCookie(COOKIE_FOUNDER_TOTP_CHALLENGE_SESSION, challengeSession, FOUNDER_TOTP_COOKIE_MAX_AGE_SECONDS),
  ];
}

function clearSessionCookies() {
  return [
    makeCookie(COOKIE_ACCESS, "", 0),
    makeCookie(COOKIE_ID, "", 0),
    makeCookie(COOKIE_REFRESH, "", 0),
  ];
}

function clearFounderTotpCookies() {
  return [
    makeCookie(COOKIE_FOUNDER_TOTP_ENROLL_ACCESS, "", 0),
    makeCookie(COOKIE_FOUNDER_TOTP_ENROLL_ID, "", 0),
    makeCookie(COOKIE_FOUNDER_TOTP_ENROLL_REFRESH, "", 0),
    ...clearFounderTotpChallengeCookies(),
  ];
}

function clearFounderTotpChallengeCookies() {
  return [
    makeCookie(COOKIE_FOUNDER_TOTP_CHALLENGE_SESSION, "", 0),
  ];
}

function clearAllAuthCookies() {
  return [
    ...clearSessionCookies(),
    ...clearFounderTotpCookies(),
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

function binaryResponse(event, statusCode, buffer, contentType, cookies = []) {
  const origin = event?.headers?.origin || event?.headers?.Origin || "";
  const allowedOrigin = APP_ORIGINS.has(origin) ? origin : "https://presttige.net";
  return {
    statusCode,
    headers: {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Methods": "POST,GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "private, max-age=120",
    },
    cookies,
    isBase64Encoded: true,
    body: Buffer.from(buffer || "").toString("base64"),
  };
}

function routeName(event) {
  const path = normalizeText(event?.rawPath || event?.requestContext?.http?.path);
  const segment = path.split("/").filter(Boolean).pop() || "";
  if (["login", "session", "logout", "forgot", "confirm-reset", "totp-verify", "totp-challenge", "totp-recover", "member-action", "profile", "photos", "photo-thumbnail", "dsar"].includes(segment)) {
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
