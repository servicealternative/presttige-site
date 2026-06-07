const { S3Client } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const s3 = new S3Client({ region: 'us-east-1' });
const ssm = new SSMClient({ region: 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

let cachedConfig = null;

async function loadConfig() {
  if (cachedConfig) return cachedConfig;

  const response = await ssm.send(new GetParametersByPathCommand({
    Path: '/presttige/photos/',
    Recursive: false
  }));

  const config = {};
  for (const param of response.Parameters || []) {
    const key = param.Name.split('/').pop();
    config[key] = param.Value;
  }

  cachedConfig = config;
  return config;
}

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png'
};

const MAX_SIZE = 10 * 1024 * 1024;

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { lead_id, content_type, file_size, is_test } = body;

    if (!lead_id || !content_type || !file_size) {
      return response(400, { error: 'Missing required fields: lead_id, content_type, file_size' });
    }

    if (!ALLOWED_TYPES[content_type]) {
      return response(400, {
        error: 'Unsupported content type. Browser must convert HEIC to JPEG before upload.',
        allowed: Object.keys(ALLOWED_TYPES)
      });
    }

    if (file_size > MAX_SIZE) {
      return response(400, { error: 'File too large', max_size: MAX_SIZE });
    }

    const config = await loadConfig();
    const photo_id = crypto.randomBytes(16).toString('hex');
    const extension = ALLOWED_TYPES[content_type];
    const key = `${lead_id}/original/${photo_id}${extension}`;
    const retention = is_test ? 'tester' : 'pending';
    const tagging = `<Tagging><TagSet><Tag><Key>retention</Key><Value>${retention}</Value></Tag><Tag><Key>lead_id</Key><Value>${lead_id}</Value></Tag><Tag><Key>photo_id</Key><Value>${photo_id}</Value></Tag></TagSet></Tagging>`;

    const presignedPost = await createPresignedPost(s3, {
      Bucket: config['originals-bucket'],
      Key: key,
      Conditions: [
        ['content-length-range', 0, MAX_SIZE],
        ['eq', '$Content-Type', content_type],
        ['eq', '$x-amz-server-side-encryption', 'aws:kms'],
        ['eq', '$x-amz-server-side-encryption-aws-kms-key-id', config['kms-key-arn']],
        ['eq', '$tagging', tagging]
      ],
      Fields: {
        'Content-Type': content_type,
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': config['kms-key-arn'],
        tagging
      },
      Expires: 300
    });

    // First ensure photo_uploads map exists, then set the specific key.
    // DynamoDB requires this 2-step pattern when the parent map may not exist yet.
    try {
      await ddb.send(new UpdateCommand({
        TableName: 'presttige-db',
        Key: { lead_id },
        UpdateExpression: 'SET photo_uploads = if_not_exists(photo_uploads, :empty)',
        ExpressionAttributeValues: { ':empty': {} }
      }));
    } catch (err) {
      // If the lead_id does not exist as a record, surface a clear error.
      if (err.name === 'ConditionalCheckFailedException' || err.name === 'ValidationException') {
        console.error('Lead record may not exist for lead_id', lead_id, err);
        return response(404, { error: 'Lead not found. Submit Step 2 form first.' });
      }
      throw err;
    }

    await ddb.send(new UpdateCommand({
      TableName: 'presttige-db',
      Key: { lead_id },
      UpdateExpression: 'SET photo_uploads.#pid = :photo_meta',
      ExpressionAttributeNames: { '#pid': photo_id },
      ExpressionAttributeValues: {
        ':photo_meta': {
          status: 'awaiting_upload',
          original_key: key,
          content_type,
          file_size,
          retention,
          created_at: new Date().toISOString()
        }
      }
    }));

    return response(200, {
      photo_id,
      upload_url: presignedPost.url,
      upload_fields: presignedPost.fields,
      key,
      expires_in: 300
    });
  } catch (err) {
    console.error('photo-upload-init error', err);
    return response(500, { error: 'Internal error', detail: err.message });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://presttige.net',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
  };
}
