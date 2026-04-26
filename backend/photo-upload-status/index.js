const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN;

exports.handler = async (event) => {
  try {
    const lead_id = event.queryStringParameters?.lead_id;
    const photo_id = event.queryStringParameters?.photo_id;

    if (!lead_id || !photo_id) {
      return response(400, { error: 'Missing lead_id or photo_id' });
    }

    const result = await ddb.send(new GetCommand({
      TableName: 'presttige-db',
      Key: { lead_id },
      ProjectionExpression: 'photo_uploads.#pid',
      ExpressionAttributeNames: { '#pid': photo_id }
    }));

    const photoMeta = result.Item?.photo_uploads?.[photo_id];
    if (!photoMeta) {
      return response(404, { error: 'Photo not found' });
    }

    const thumbnail_url = photoMeta.thumbnails?.['400']
      ? `https://${CLOUDFRONT_DOMAIN}/${photoMeta.thumbnails['400']}`
      : null;

    return response(200, {
      photo_id,
      status: photoMeta.status,
      thumbnail_url,
      original_key: photoMeta.original_key
    });
  } catch (err) {
    console.error('photo-upload-status error', err);
    return response(500, { error: 'Internal error', detail: err.message });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://presttige.net'
    },
    body: JSON.stringify(body)
  };
}
