const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { getSignedUrl } = require("@aws-sdk/cloudfront-signer");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const sm = new SecretsManagerClient({ region: "us-east-1" });

const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;
const CLOUDFRONT_KEY_PAIR_ID = process.env.CLOUDFRONT_KEY_PAIR_ID;

let cachedKey = null;

async function loadSigningKey() {
  if (cachedKey) return cachedKey;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: "presttige-cloudfront-signing-key" }));
  cachedKey = res.SecretString;
  return cachedKey;
}

function signUrl(key, privateKey) {
  return getSignedUrl({
    url: `https://${CLOUDFRONT_DOMAIN}/${key}`,
    keyPairId: CLOUDFRONT_KEY_PAIR_ID,
    dateLessThan: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    privateKey,
  });
}

exports.handler = async (event) => {
  const token = event?.queryStringParameters?.token;
  if (!token) {
    return response(400, { error: "Missing token" });
  }

  try {
    const lead = await findLeadByToken(token);
    if (!lead) {
      return response(404, { error: "Token not found or invalid" });
    }

    const privateKey = await loadSigningKey();
    const photos = selectReviewPhotos(lead).map(([photoId, photo]) => ({
      photo_id: photoId,
      thumb_400: signUrl(photo.thumbnails["400"], privateKey),
      thumb_1200: signUrl(photo.thumbnails["1200"], privateKey),
    }));

    const candidate = buildCandidate(lead, photos);
    const review = buildReviewState(lead);

    return response(200, {
      lead_id: lead.lead_id,
      candidate,
      decision: review.decision,
      decided_at: review.reviewed_at,
      decided_by: review.reviewed_by,
      is_read_only: review.locked,
      profile: candidate,
      photos,
      submitted_at: lead.created_at,
      review,
    });
  } catch (err) {
    console.error("review-fetch error", err);
    return response(500, { error: "Internal error", detail: err.message });
  }
};

async function findLeadByToken(token) {
  let ExclusiveStartKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: "presttige-db",
        FilterExpression: "review_token = :token",
        ExpressionAttributeValues: { ":token": token },
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

function buildReviewState(lead) {
  const decision = normalizeDecision(lead.review_status);
  const isRecorded = Boolean(decision);

  return {
    token_status: lead.review_token_status || "active",
    decision,
    reviewed_at: lead.reviewed_at || lead.review_token_used_at || null,
    reviewed_by: lead.reviewed_by || null,
    note: lead.review_note || null,
    locked: isRecorded,
    state: isRecorded ? "recorded" : "pending",
  };
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

function selectReviewPhotos(lead) {
  const readyById = new Map(
    Object.entries(lead.photo_uploads || {}).filter(
      ([, photo]) => photo?.status === "ready" && photo?.thumbnails?.["400"] && photo?.thumbnails?.["1200"]
    )
  );
  const submittedPhotoIds = normalizePhotoIds(lead.submitted_photo_ids);

  if (submittedPhotoIds.length > 0) {
    return submittedPhotoIds
      .map((photoId) => [photoId, readyById.get(photoId)])
      .filter(([, photo]) => Boolean(photo));
  }

  return Array.from(readyById.entries());
}

function buildCandidate(lead, photos) {
  return {
    name: lead.name || null,
    age: lead.age || null,
    country: lead.country || null,
    city: lead.city || null,
    email: lead.email || null,
    phone_country: lead.phone_country || null,
    phone: lead.phone || null,
    occupation: lead.occupation || null,
    company: lead.company || null,
    short_introduction: lead.short_introduction || lead.bio || null,
    why_presttige: lead.why_presttige || lead.why || null,
    instagram: lead.instagram || null,
    linkedin: lead.linkedin || null,
    tiktok: lead.tiktok || null,
    website: lead.website || null,
    photos,
  };
}

function normalizeDecision(reviewStatus) {
  const value = String(reviewStatus || "").trim().toLowerCase();
  return ["approved", "rejected", "standby"].includes(value) ? value : null;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "https://presttige.net",
    },
    body: JSON.stringify(body),
  };
}
