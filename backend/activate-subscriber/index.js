const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} = require("@aws-sdk/client-cognito-identity-provider");
const crypto = require("crypto");

const lambda = new LambdaClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));
const cognito = new CognitoIdentityProviderClient({ region: "us-east-1" });

const TABLE_NAME = "presttige-db";
const UPGRADE_ELIGIBLE_UNTIL = "2026-12-31T23:59:59Z";
const MEMBER_USER_POOL_ID = process.env.MEMBER_USER_POOL_ID || "us-east-1_hpwdNFGss";
const MEMBER_COGNITO_POOL_NAME = process.env.MEMBER_COGNITO_POOL_NAME || "presttige-members";
const FREE_MEMBER_GROUP = "free";
const ACCOUNT_STATUS_PASSWORD_PENDING = "password_pending";
const VALIDATION_STATUS_NOT_STARTED = "not_started";
const SEND_SUBSCRIBER_WELCOME_FUNCTION_NAME =
  process.env.SEND_SUBSCRIBER_WELCOME_FUNCTION_NAME || "presttige-send-subscriber-welcome-email";

async function findLeadByMagicToken(token) {
  let ExclusiveStartKey;

  do {
    const result = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "magic_token = :token",
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

async function invokeSubscriberWelcomeEmail(leadId) {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: SEND_SUBSCRIBER_WELCOME_FUNCTION_NAME,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({
            body: JSON.stringify({ lead_id: leadId }),
          })
        ),
      })
    );
    return true;
  } catch (error) {
    console.error("activate-subscriber invoke error", error);
    return false;
  }
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function getUserAttribute(user, name) {
  return (user?.UserAttributes || user?.Attributes || []).find((attribute) => attribute.Name === name)?.Value || "";
}

function buildTemporaryPassword() {
  return `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
}

async function getCognitoUserByEmail(email) {
  try {
    return await cognito.send(
      new AdminGetUserCommand({
        UserPoolId: MEMBER_USER_POOL_ID,
        Username: email,
      })
    );
  } catch (error) {
    if (error?.name === "UserNotFoundException") {
      return null;
    }
    throw error;
  }
}

async function addUserToFreeGroup(username) {
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: MEMBER_USER_POOL_ID,
      Username: username,
      GroupName: FREE_MEMBER_GROUP,
    })
  );
}

async function createOrReuseFreeMemberUser(lead) {
  const email = normalizeEmail(lead.email);
  if (!email) {
    throw new Error("Lead missing email");
  }

  let user = await getCognitoUserByEmail(email);
  let created = false;

  if (!user) {
    const displayName = normalizeText(lead.name) || email;
    user = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: MEMBER_USER_POOL_ID,
        Username: email,
        MessageAction: "SUPPRESS",
        TemporaryPassword: buildTemporaryPassword(),
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
          { Name: "name", Value: displayName },
        ],
      })
    );
    created = true;
  }

  const username = user.Username || user.User?.Username || email;
  await addUserToFreeGroup(username);

  const sub = getUserAttribute(user, "sub") || getUserAttribute(user.User, "sub");
  if (!sub) {
    throw new Error("Cognito user sub missing");
  }

  return { sub, username, created };
}

function redirectUrl(token) {
  return `https://presttige.net/subscriber-activated/${token}`;
}

exports.handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const token = String(body.token || "").trim();

  if (!token) {
    return response(400, { error: "Missing token" });
  }

  try {
    const lead = await findLeadByMagicToken(token);
    if (!lead) {
      return response(404, { error: "Token not found" });
    }

    if (lead.magic_token_expires_at && new Date(lead.magic_token_expires_at) < new Date()) {
      return response(410, { error: "Token expired" });
    }

    if (normalizeText(lead.review_status).toLowerCase() !== "approved") {
      return response(403, {
        activated: false,
        account_created: false,
        error: "not_approved",
        message: "Membership is not ready for activation.",
      });
    }

    if (lead.payment_status === "paid") {
      return response(409, { error: "Membership already activated through a paid path" });
    }

    const now = new Date().toISOString();
    const identity = lead.cognito_sub
      ? { sub: lead.cognito_sub, username: normalizeEmail(lead.email), created: false, idempotent: true }
      : await createOrReuseFreeMemberUser(lead);

    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id: lead.lead_id },
        UpdateExpression: `
          SET selected_tier = :tier,
              selected_tier_billing = :billing,
              #member_tier = :member_tier,
              effective_tier = :member_tier,
              founding_rate_locked = :founding_rate_locked,
              founding_rate_expires_at = :founding_rate_expires_at,
              upgrade_eligible_until = :upgrade_eligible_until,
              subscriber_activated_at = if_not_exists(subscriber_activated_at, :subscriber_activated_at),
              account_active = :account_active,
              cognito_sub = if_not_exists(cognito_sub, :cognito_sub),
              cognito_pool = :cognito_pool,
              account_status = :account_status,
              validation_status = if_not_exists(validation_status, :validation_status),
              signup_path = :signup_path,
              account_created_at = if_not_exists(account_created_at, :account_created_at),
              cognito_linked_at = if_not_exists(cognito_linked_at, :cognito_linked_at),
              updated_at = :updated_at
          REMOVE selected_periodicity, effective_tier_until, stripe_session_id, stripe_checkout_started_at, selected_price_id
        `,
        ConditionExpression: "review_status = :approved",
        ExpressionAttributeNames: {
          "#member_tier": "tier",
        },
        ExpressionAttributeValues: {
          ":tier": "subscriber",
          ":member_tier": "free",
          ":billing": null,
          ":founding_rate_locked": false,
          ":founding_rate_expires_at": null,
          ":upgrade_eligible_until": UPGRADE_ELIGIBLE_UNTIL,
          ":subscriber_activated_at": now,
          ":account_active": true,
          ":cognito_sub": identity.sub,
          ":cognito_pool": MEMBER_COGNITO_POOL_NAME,
          ":account_status": ACCOUNT_STATUS_PASSWORD_PENDING,
          ":validation_status": VALIDATION_STATUS_NOT_STARTED,
          ":signup_path": "free",
          ":account_created_at": now,
          ":cognito_linked_at": now,
          ":updated_at": now,
          ":approved": "approved",
        },
      })
    );

    const welcomeTriggered = lead.synthetic_test === true
      ? false
      : await invokeSubscriberWelcomeEmail(lead.lead_id);

    return response(200, {
      activated: true,
      selected_tier: "subscriber",
      tier: "free",
      account_created: identity.created,
      account_status: ACCOUNT_STATUS_PASSWORD_PENDING,
      cognito_pool: MEMBER_COGNITO_POOL_NAME,
      cognito_sub: identity.sub,
      idempotent: Boolean(identity.idempotent),
      subscriber_welcome_triggered: welcomeTriggered,
      redirect_url: redirectUrl(token),
    });
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      return response(403, {
        activated: false,
        account_created: false,
        error: "not_approved",
        message: "Membership is not ready for activation.",
      });
    }
    console.error("activate-subscriber error", error);
    return response(500, { error: "Internal", detail: error.message });
  }
};

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
