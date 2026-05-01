const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { getSignedUrl } = require("@aws-sdk/cloudfront-signer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ses = new SESClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const sm = new SecretsManagerClient({ region: "us-east-1" });

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;
const CLOUDFRONT_KEY_PAIR_ID = process.env.CLOUDFRONT_KEY_PAIR_ID;
const REVIEW_BASE_URL = process.env.REVIEW_BASE_URL || "https://presttige.net/review";
const FROM_ADDRESS = "office@presttige.net";
const REPLY_TO = "info@presttige.net";
const TO_ADDRESS = "committee@presttige.net";
const { getBackfillResendIneligibilityReason } = loadBackfillFilters();

let cachedSecrets = null;
let cachedTemplate = null;

async function loadSecrets() {
  if (cachedSecrets) return cachedSecrets;

  const [tokenRes, signKeyRes] = await Promise.all([
    sm.send(new GetSecretValueCommand({ SecretId: "presttige-review-token-secret" })),
    sm.send(new GetSecretValueCommand({ SecretId: "presttige-cloudfront-signing-key" })),
  ]);

  cachedSecrets = {
    tokenSecret: tokenRes.SecretString,
    cfPrivateKey: signKeyRes.SecretString,
  };

  return cachedSecrets;
}

function loadTemplate() {
  if (!cachedTemplate) {
    cachedTemplate = fs.readFileSync(path.join(__dirname, "committee-email.html"), "utf8");
  }
  return cachedTemplate;
}

function generateReviewToken(leadId, attemptId, secret) {
  return crypto.createHmac("sha256", secret).update(`${leadId}|${attemptId}`).digest("hex");
}

function signThumbnailUrl(thumbKey, privateKey) {
  const url = `https://${CLOUDFRONT_DOMAIN}/${thumbKey}`;
  const dateLessThan = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return getSignedUrl({
    url,
    keyPairId: CLOUDFRONT_KEY_PAIR_ID,
    dateLessThan,
    privateKey,
  });
}

function fillTemplate(template, variables) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : ""
  );
}

function loadBackfillFilters() {
  try {
    return require("../lib/backfill-filters");
  } catch (error) {
    return require("./lib/backfill-filters");
  }
}

function esc(value) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildProfileRows(lead) {
  const rows = [
    ["Age", lead.age],
    ["Country", lead.country],
    ["City", lead.city],
    ["Occupation", lead.occupation],
    ["Company", lead.company],
    ["Instagram", lead.instagram],
    ["LinkedIn", lead.linkedin],
    ["Website", lead.website],
  ];

  return rows
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;width:140px;font-family:'Source Serif Pro',Georgia,serif;font-size:13px;line-height:20px;color:#8C7040;vertical-align:top;">${esc(
          label
        )}</td><td style="padding:6px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:15px;line-height:22px;color:#0A0A0A;">${esc(
          value
        )}</td></tr>`
    )
    .join("");
}

function buildPhotoBlocks(readyPhotos, privateKey) {
  if (readyPhotos.length === 0) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td style="padding:8px;font-style:italic;color:#4A4A4A;">No photos uploaded for this candidate.</td></tr></table>';
  }

  const cells = readyPhotos.slice(0, 3).map((photo) => {
    const thumbKey = photo[1]?.thumbnails?.["400"];
    if (!thumbKey) return "";

    const signedUrl = signThumbnailUrl(thumbKey, privateKey);
    return `<td style="padding:8px;"><img src="${signedUrl}" alt="Applicant photo" width="160" height="160" style="display:block;width:160px;height:160px;object-fit:cover;border-radius:4px;"></td>`;
  });

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>${cells.join("")}</tr></table>`;
}

function normalizePhotoIds(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
  }

  if (typeof value === "string") {
    return normalizePhotoIds(value.split(","));
  }

  return [];
}

function selectReadyPhotos(lead, requestedPhotoIds) {
  const readyById = new Map(
    Object.entries(lead.photo_uploads || {}).filter(([, photo]) => photo?.status === "ready")
  );
  const submittedPhotoIds = normalizePhotoIds(lead.submitted_photo_ids);
  const selectedIds = requestedPhotoIds.length > 0 ? requestedPhotoIds : submittedPhotoIds;

  if (selectedIds.length > 0) {
    return selectedIds
      .map((photoId) => [photoId, readyById.get(photoId)])
      .filter(([, photo]) => Boolean(photo));
  }

  return Array.from(readyById.entries());
}

function buildBodyVariables(lead, token, readyPhotos, privateKey) {
  const reviewUrl = `${REVIEW_BASE_URL}/${token}`;
  const displayName = lead.name || "Anonymous";
  const shortIntroduction = lead.short_introduction || lead.bio || "—";
  const whyPresttige = lead.why_presttige || lead.why || "";

  return {
    subject: `New application — ${displayName}`,
    preheader: `Committee review requested for ${displayName}.`,
    eyebrow: "NEW APPLICATION — COMMITTEE REVIEW",
    headline: esc(displayName),
    profile_rows: buildProfileRows(lead),
    short_introduction: esc(shortIntroduction),
    why_presttige: esc(whyPresttige),
    photo_blocks: buildPhotoBlocks(readyPhotos, privateKey),
    review_url_approve: `${reviewUrl}?action=approve`,
    review_url_reject: `${reviewUrl}?action=reject`,
    review_url_standby: `${reviewUrl}?action=standby`,
    review_url_view: reviewUrl,
  };
}

function assertNoReviewTokenExpiryWrite(updateExpression) {
  if (String(updateExpression || "").includes("review_token_expires_at")) {
    throw new Error("review tokens must not write review_token_expires_at");
  }
}

exports.handler = async (event) => {
  const body = JSON.parse(event?.body || "{}");
  const leadId = body.lead_id;
  const allowNoPhotos = Boolean(body.allow_no_photos);
  const requestedPhotoIds = normalizePhotoIds(body.photo_ids);

  if (!leadId) {
    return response(400, { error: "Missing lead_id" });
  }

  try {
    const result = await ddb.send(new GetCommand({ TableName: "presttige-db", Key: { lead_id: leadId } }));
    const lead = result.Item;

    if (!lead) {
      return response(404, { error: "Lead not found" });
    }

    const backfillGuardReason = getBackfillResendIneligibilityReason(lead);
    if (backfillGuardReason) {
      console.log("Backfill resend blocked for committee email", {
        lead_id: leadId,
        review_status: lead.review_status || null,
        reason: backfillGuardReason,
      });
      return response(200, {
        skipped: true,
        reason: backfillGuardReason,
        review_status: lead.review_status || null,
      });
    }

    if (lead.e2_sent_at) {
      console.log("Committee email already sent", { lead_id: leadId, e2_sent_at: lead.e2_sent_at });
      return response(200, { already_sent: true, sent_at: lead.e2_sent_at });
    }

    const readyPhotos = selectReadyPhotos(lead, requestedPhotoIds);
    if (readyPhotos.length < 2 && !allowNoPhotos) {
      console.log("Committee email skipped until enough photos are ready", {
        lead_id: leadId,
        ready_count: readyPhotos.length,
        requested_photo_ids: requestedPhotoIds,
        submitted_photo_ids: normalizePhotoIds(lead.submitted_photo_ids),
        allow_no_photos: allowNoPhotos,
      });
      return response(425, { error: "Photos not ready", ready: readyPhotos.length });
    }

    const secrets = await loadSecrets();
    const attemptId = crypto.randomBytes(8).toString("hex");
    const token = generateReviewToken(leadId, attemptId, secrets.tokenSecret);
    const html = fillTemplate(loadTemplate(), buildBodyVariables(lead, token, readyPhotos, secrets.cfPrivateKey));

    console.log("SES sender config", {
      from: FROM_ADDRESS,
      reply_to: REPLY_TO,
      to: TO_ADDRESS,
      lead_id: leadId,
    });

    await ses.send(
      new SendEmailCommand({
        Source: FROM_ADDRESS,
        ReplyToAddresses: [REPLY_TO],
        Destination: { ToAddresses: [TO_ADDRESS] },
        Message: {
          Subject: { Data: `New application — ${lead.name || "Anonymous"}`, Charset: "UTF-8" },
          Body: {
            Html: { Data: html, Charset: "UTF-8" },
          },
        },
      })
    );

    const updateExpression =
      "SET e2_sent_at = :ts, review_token = :tok, review_token_status = :status, review_attempt_id = :attempt, updated_at = :updated_at";
    assertNoReviewTokenExpiryWrite(updateExpression);

    await ddb.send(
      new UpdateCommand({
        TableName: "presttige-db",
        Key: { lead_id: leadId },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: {
          ":ts": new Date().toISOString(),
          ":tok": token,
          ":status": "active",
          ":attempt": attemptId,
          ":updated_at": new Date().toISOString(),
        },
      })
    );

    return response(200, { sent: true, token_first8: token.substring(0, 8) });
  } catch (err) {
    console.error("send-committee-email error", err);
    return response(500, { error: "Internal error", detail: err.message });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
