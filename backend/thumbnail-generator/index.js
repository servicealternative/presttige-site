const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const sharp = require("sharp");

const s3 = new S3Client({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const lambda = new LambdaClient({ region: "us-east-1" });

const ORIGINALS_BUCKET = "presttige-applicant-photos";
const THUMBS_BUCKET = "presttige-applicant-photos-thumbnails";
const KMS_KEY_ARN = "arn:aws:kms:us-east-1:343218208384:key/723bb788-9911-4c49-bf1d-792b73685e7c";
const COMMITTEE_EMAIL_FUNCTION = "presttige-send-committee-email";
const APPLICATION_RECEIVED_FUNCTION = "presttige-send-application-received";
const { isEligibleForBackfillResend, getBackfillResendIneligibilityReason } = loadBackfillFilters();

exports.handler = async (event) => {
  for (const record of event.Records || []) {
    try {
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
      console.log("Processing", key);

      const parts = key.split("/");
      if (parts.length !== 3 || parts[1] !== "original") {
        console.log("Skipping non-original key", key);
        continue;
      }

      const lead_id = parts[0];
      const filename = parts[2];
      const photo_id = filename.split(".")[0];

      const obj = await s3.send(new GetObjectCommand({ Bucket: ORIGINALS_BUCKET, Key: key }));
      const buffer = Buffer.concat(await streamToChunks(obj.Body));
      const sizes = [
        { suffix: "400", size: 400 },
        { suffix: "1200", size: 1200 },
      ];
      const thumbnailKeys = {};

      for (const { suffix, size } of sizes) {
        const thumbBuffer = await sharp(buffer)
          .rotate()
          .resize(size, size, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85, progressive: true })
          .toBuffer();

        const thumbKey = `${lead_id}/thumbnails/${photo_id}-${suffix}.jpg`;

        await s3.send(new PutObjectCommand({
          Bucket: THUMBS_BUCKET,
          Key: thumbKey,
          Body: thumbBuffer,
          ContentType: "image/jpeg",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: KMS_KEY_ARN,
          Tagging: `lead_id=${lead_id}&photo_id=${photo_id}&size=${suffix}`,
        }));

        thumbnailKeys[suffix] = thumbKey;
      }

      await ddb.send(new UpdateCommand({
        TableName: 'presttige-db',
        Key: { lead_id },
        UpdateExpression: "SET photo_uploads.#pid.#status = :status, photo_uploads.#pid.thumbnails = :thumbs, photo_uploads.#pid.processed_at = :ts",
        ExpressionAttributeNames: {
          '#pid': photo_id,
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': 'ready',
          ':thumbs': thumbnailKeys,
          ':ts': new Date().toISOString(),
        },
      }));

      const lead = await getLead(lead_id);
      const photoUploads = lead.photo_uploads || {};
      const expectedCount = Object.keys(photoUploads).length;
      const readyCount = Object.values(photoUploads).filter((photo) => photo?.status === "ready").length;
      const backfillEligible = isEligibleForBackfillResend(lead);
      const backfillGuardReason = backfillEligible ? null : getBackfillResendIneligibilityReason(lead);

      if (
        lead.profile_status === "profile_submitted" &&
        !lead.e2_sent_at &&
        readyCount >= 2 &&
        backfillEligible
      ) {
        await invokeLambdaAsync(COMMITTEE_EMAIL_FUNCTION, { lead_id });
        console.log("Triggered committee email send after thumbnails became ready", { lead_id, readyCount });
      } else if (lead.profile_status === "profile_submitted" && !lead.e2_sent_at && readyCount >= 2 && backfillGuardReason) {
        console.log("Backfill resend blocked for committee fallback after thumbnails became ready", {
          lead_id,
          review_status: lead.review_status || null,
          reason: backfillGuardReason,
        });
      }

      if (
        lead.profile_status === "profile_submitted" &&
        readyCount >= 2 &&
        readyCount === expectedCount &&
        !lead.application_received_email_sent_at &&
        backfillEligible
      ) {
        await invokeLambdaAsync(APPLICATION_RECEIVED_FUNCTION, { lead_id });
        console.log("Triggered application received email after all expected photos became ready", {
          lead_id,
          readyCount,
          expectedCount,
        });
      } else if (
        lead.profile_status === "profile_submitted" &&
        readyCount >= 2 &&
        readyCount === expectedCount &&
        !lead.application_received_email_sent_at &&
        backfillGuardReason
      ) {
        console.log("Backfill resend blocked for application received fallback after thumbnails became ready", {
          lead_id,
          review_status: lead.review_status || null,
          reason: backfillGuardReason,
        });
      }

      console.log("Thumbnails created for", photo_id);
    } catch (err) {
      console.error("Error processing record", record, err);
    }
  }

  return { statusCode: 200 };
};

async function streamToChunks(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

async function getLead(lead_id) {
  const result = await ddb.send(new GetCommand({ TableName: "presttige-db", Key: { lead_id } }));
  return result.Item || {};
}

async function invokeLambdaAsync(functionName, payload) {
  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ body: JSON.stringify(payload) })),
    })
  );
}

function loadBackfillFilters() {
  try {
    return require("../lib/backfill-filters");
  } catch (error) {
    return require("./lib/backfill-filters");
  }
}
