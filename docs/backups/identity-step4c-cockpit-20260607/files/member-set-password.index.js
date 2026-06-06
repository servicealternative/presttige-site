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
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE_NAME = process.env.TABLE_NAME || "presttige-db";
const CHECKOUT_TOKEN_INDEX_NAME =
  process.env.CHECKOUT_TOKEN_INDEX_NAME || "checkout-token-index";
const MEMBER_USER_POOL_ID =
  process.env.MEMBER_USER_POOL_ID || "us-east-1_hpwdNFGss";
const MEMBER_COGNITO_POOL_NAME =
  process.env.MEMBER_COGNITO_POOL_NAME || "presttige-members";
const SES_CONFIGURATION_SET =
  process.env.SES_CONFIGURATION_SET || "presttige-deliverability-v1";
const MEMBER_EMAIL_FROM = process.env.MEMBER_EMAIL_FROM || "private@presttige.net";
const MEMBER_EMAIL_REPLY_TO =
  process.env.MEMBER_EMAIL_REPLY_TO || "info@presttige.net";
const TEST_SEND_RECIPIENT = String(
  process.env.TEST_SEND_RECIPIENT || "fq@freequenza.net"
)
  .trim()
  .toLowerCase();
const MEMBER_LOGIN_URL =
  process.env.MEMBER_LOGIN_URL ||
  "https://presttige-members.auth.us-east-1.amazoncognito.com/login?client_id=3gdek6k48cm6oirccodgrub2k1&response_type=code&scope=email+openid+profile&redirect_uri=https%3A%2F%2Fpresttige.net%2Fmember%2F";
const APP_ORIGINS = new Set([
  "https://presttige.net",
  "https://www.presttige.net",
]);
const ACCOUNT_STATUS_PASSWORD_PENDING = "password_pending";
const ACCOUNT_STATUS_PASSWORD_SETTING = "password_setting";
const ACCOUNT_STATUS_ACTIVE = "active";
const PASSWORD_SETUP_USED = "used";
const PASSWORD_SETUP_FAILED = "failed";
const EMAIL_STATUS_SENDING = "sending";
const EMAIL_STATUS_SENT = "sent";
const EMAIL_STATUS_FAILED = "failed";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const cognito = new CognitoIdentityProviderClient({ region: REGION });
const ses = new SESClient({ region: REGION });

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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function canonicalTier(lead) {
  return (
    normalizeText(lead.simulated_tier || lead.tier || lead.selected_tier || lead.subscriber_type)
      .toLowerCase() || "free"
  );
}

function tierLabel(tier) {
  const labels = {
    founder: "Founder",
    patron: "Patron",
    premier: "Premier",
    club: "Club",
    free: "Subscriber",
    subscriber: "Subscriber",
    tester: "Tester",
  };
  return labels[normalizeText(tier).toLowerCase()] || "Member";
}

function isFounderMember(lead) {
  return canonicalTier(lead) === "founder" || lead.founder_lifetime === true;
}

function recipientName(lead) {
  return normalizeText(lead.first_name || lead.name).split(/\s+/)[0] || "Member";
}

function formatSource(address) {
  return `Presttige <${address}>`;
}

function activationLink(token, tokenType) {
  const encoded = encodeURIComponent(token);
  if (tokenType === "checkout") {
    return `https://presttige.net/welcome/${encoded}`;
  }
  return `https://presttige.net/subscriber-activated/${encoded}`;
}

function deliveryForLead(lead) {
  if (lead.synthetic_test === true) {
    return {
      email: TEST_SEND_RECIPIENT,
      recipientType: "test_fq",
    };
  }

  return {
    email: normalizeEmail(lead.email),
    recipientType: "member",
  };
}

function emailFields(kind) {
  if (kind === "welcome") {
    return {
      sentAt: "welcome_email_sent_at",
      status: "welcome_email_status",
      startedAt: "welcome_email_started_at",
      failedAt: "welcome_email_failed_at",
      messageId: "welcome_email_message_id",
      recipientHash: "welcome_email_recipient_hash",
    };
  }

  return {
    sentAt: "activation_email_sent_at",
    status: "activation_email_status",
    startedAt: "activation_email_started_at",
    failedAt: "activation_email_failed_at",
    messageId: "activation_email_message_id",
    recipientHash: "activation_email_recipient_hash",
  };
}

function buildEmailHtml({
  eyebrow,
  headline,
  paragraphs,
  ctaLabel,
  ctaUrl,
  signOffName,
  signOffTitle,
}) {
  const body = paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 20px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:16px;line-height:26px;color:#4A4A4A;">${escapeHtml(
          paragraph
        )}</p>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    @media (hover:hover){.presttige-cta:hover{background:#8C7040!important;color:#FBF9F4!important;cursor:pointer!important;}}
  </style>
</head>
<body style="margin:0;padding:0;background-color:#F5F2ED;font-family:'Source Serif Pro',Georgia,serif;color:#0A0A0A;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F2ED;margin:0;padding:0;">
    <tr>
      <td align="center" style="padding:40px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#FBF9F4;border:1px solid #D9D2C5;">
          <tr>
            <td style="padding:42px 40px 20px 40px;text-align:center;border-bottom:1px solid #D9D2C5;">
              <p style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">Private, Selective, Prestigious</p>
            </td>
          </tr>
          <tr>
            <td style="padding:44px 40px 32px 40px;">
              <p style="margin:0 0 24px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">${escapeHtml(
                eyebrow
              )}</p>
              <h1 style="margin:0 0 28px 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:36px;line-height:42px;font-weight:400;color:#0A0A0A;">${escapeHtml(
                headline
              )}</h1>
              ${body}
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:32px 0;">
                <tr>
                  <td>
                    <a href="${escapeHtml(
                      ctaUrl
                    )}" class="presttige-cta" style="display:inline-block;padding:15px 30px;background:#0A0A0A;color:#FBF9F4;font-family:'Source Serif Pro',Georgia,serif;font-size:12px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;text-decoration:none;">${escapeHtml(
                      ctaLabel
                    )}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:16px;line-height:26px;color:#4A4A4A;">With our regards,</p>
              <p style="margin:0 0 4px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:14px;font-weight:600;color:#0A0A0A;">${escapeHtml(
                signOffName
              )}</p>
              <p style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">${escapeHtml(
                signOffTitle
              )}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 40px 36px 40px;background:#0A0A0A;text-align:center;">
              <p style="margin:0 0 12px 0;font-family:'Source Serif Pro',Georgia,serif;font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:#8C7040;">New York, London, Dubai</p>
              <p style="margin:0;font-family:'Source Serif Pro',Georgia,serif;font-size:12px;line-height:18px;color:#D9D2C5;">Presttige private member services. For support, reply to this email or write to info@presttige.net.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText({ name, headline, paragraphs, ctaLabel, ctaUrl, signOffName }) {
  return [
    `Dear ${name},`,
    "",
    headline,
    "",
    ...paragraphs.flatMap((paragraph) => [paragraph, ""]),
    `${ctaLabel}: ${ctaUrl}`,
    "",
    "With our regards,",
    signOffName,
    "",
    "Presttige private member services. For support, reply to this email or write to info@presttige.net.",
  ].join("\n");
}

function buildActivationEmail(lead, token, tokenType) {
  const tier = canonicalTier(lead);
  const founder = isFounderMember(lead);
  const label = tierLabel(tier);
  const name = recipientName(lead);
  const url = activationLink(token, tokenType);
  const signOffName = founder ? "The Founders House" : "Presttige Private Office";
  const signOffTitle = founder ? "FOUNDERS HOUSE" : "MEMBER SERVICES";
  const paragraphs = founder
    ? [
        "Your Founder account is ready for you to complete.",
        "Use the private link below to set your password and activate access. This link is personal to your Presttige record.",
        "Once your password is set, your account will be ready.",
      ]
    : [
        `Your ${label} account is ready for you to complete.`,
        "Use the private link below to set your password and activate access. This link is personal to your Presttige record.",
        "Once your password is set, your account will be ready.",
      ];

  return {
    subject: "Complete your Presttige account",
    html: buildEmailHtml({
      eyebrow: "Account activation",
      headline: `Complete your account, ${name}`,
      paragraphs,
      ctaLabel: "Set password",
      ctaUrl: url,
      signOffName,
      signOffTitle,
    }),
    text: buildEmailText({
      name,
      headline: "Complete your Presttige account",
      paragraphs,
      ctaLabel: "Set password",
      ctaUrl: url,
      signOffName,
    }),
  };
}

function buildWelcomeEmail(lead) {
  const tier = canonicalTier(lead);
  const founder = isFounderMember(lead);
  const label = tierLabel(tier);
  const name = recipientName(lead);
  const signOffName = founder ? "The Founders House" : "Presttige Private Office";
  const signOffTitle = founder ? "FOUNDERS HOUSE" : "MEMBER SERVICES";
  const paragraphs = founder
    ? [
        "Your password is set and your Founder access is active.",
        "You can now log in with your email and password. Founder-specific identity steps will follow in the next phase.",
      ]
    : [
        `Your password is set and your ${label} account is active.`,
        "You can now log in with your email and password.",
      ];

  return {
    subject: "Your Presttige account is ready",
    html: buildEmailHtml({
      eyebrow: "Account ready",
      headline: `Your account is ready, ${name}`,
      paragraphs,
      ctaLabel: "Log in",
      ctaUrl: MEMBER_LOGIN_URL,
      signOffName,
      signOffTitle,
    }),
    text: buildEmailText({
      name,
      headline: "Your Presttige account is ready",
      paragraphs,
      ctaLabel: "Log in",
      ctaUrl: MEMBER_LOGIN_URL,
      signOffName,
    }),
  };
}

async function reserveEmailSend(lead, kind) {
  const fields = emailFields(kind);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const staleBefore = new Date(nowDate.getTime() - 15 * 60 * 1000).toISOString();

  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id: lead.lead_id },
        ConditionExpression:
          "attribute_exists(lead_id) AND attribute_not_exists(#sentAt) AND (attribute_not_exists(#status) OR #status <> :sending OR #startedAt < :staleBefore)",
        UpdateExpression:
          "SET #status = :sending, #startedAt = :now, updated_at = :now",
        ExpressionAttributeNames: {
          "#sentAt": fields.sentAt,
          "#status": fields.status,
          "#startedAt": fields.startedAt,
        },
        ExpressionAttributeValues: {
          ":sending": EMAIL_STATUS_SENDING,
          ":staleBefore": staleBefore,
          ":now": now,
        },
      })
    );
  } catch (error) {
    if (error?.name === "ConditionalCheckFailedException") {
      return { reserved: false, reason: "already_sent_or_processing" };
    }
    throw error;
  }

  return { reserved: true, fields };
}

async function markEmailSent(lead, fields, messageId, recipientHash) {
  const now = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { lead_id: lead.lead_id },
      ConditionExpression: "attribute_exists(lead_id) AND attribute_not_exists(#sentAt)",
      UpdateExpression:
        "SET #sentAt = :now, #status = :sent, #messageId = :messageId, #recipientHash = :recipientHash, updated_at = :now",
      ExpressionAttributeNames: {
        "#sentAt": fields.sentAt,
        "#status": fields.status,
        "#messageId": fields.messageId,
        "#recipientHash": fields.recipientHash,
      },
      ExpressionAttributeValues: {
        ":now": now,
        ":sent": EMAIL_STATUS_SENT,
        ":messageId": normalizeText(messageId),
        ":recipientHash": recipientHash,
      },
    })
  );
  return now;
}

async function markEmailFailed(lead, fields) {
  const now = new Date().toISOString();
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id: lead.lead_id },
        UpdateExpression:
          "SET #status = :failed, #failedAt = :now, updated_at = :now",
        ExpressionAttributeNames: {
          "#status": fields.status,
          "#failedAt": fields.failedAt,
        },
        ExpressionAttributeValues: {
          ":failed": EMAIL_STATUS_FAILED,
          ":now": now,
        },
      })
    );
  } catch (error) {
    console.error("member-email-failed-mark", {
      status: "failed",
      error_type: safeErrorType(error),
    });
  }
}

async function sendMemberEmailIfNeeded({ lead, kind, token, tokenType }) {
  const reserve = await reserveEmailSend(lead, kind);
  if (!reserve.reserved) {
    return { sent: false, reason: reserve.reason };
  }

  const delivery = deliveryForLead(lead);
  const content =
    kind === "activation"
      ? buildActivationEmail(lead, token, tokenType)
      : buildWelcomeEmail(lead);

  try {
    const result = await ses.send(
      new SendEmailCommand({
        Source: formatSource(MEMBER_EMAIL_FROM),
        ConfigurationSetName: SES_CONFIGURATION_SET,
        ReplyToAddresses: [MEMBER_EMAIL_REPLY_TO],
        Destination: {
          ToAddresses: [delivery.email],
        },
        Message: {
          Subject: {
            Data: content.subject,
            Charset: "UTF-8",
          },
          Body: {
            Text: {
              Data: content.text,
              Charset: "UTF-8",
            },
            Html: {
              Data: content.html,
              Charset: "UTF-8",
            },
          },
        },
      })
    );

    const sentAt = await markEmailSent(
      lead,
      reserve.fields,
      result.MessageId,
      hashIdentifier(delivery.email)
    );

    console.log("member-email-send", {
      status: "sent",
      kind,
      lead_hash: hashIdentifier(lead.lead_id),
      recipient_type: delivery.recipientType,
      message_hash: hashIdentifier(result.MessageId),
    });

    return {
      sent: true,
      kind,
      recipient_type: delivery.recipientType,
      sent_at: sentAt,
    };
  } catch (error) {
    await markEmailFailed(lead, reserve.fields);
    console.error("member-email-send", {
      status: "failed",
      kind,
      lead_hash: hashIdentifier(lead.lead_id),
      recipient_type: delivery.recipientType,
      error_type: safeErrorType(error),
    });
    return { sent: false, kind, reason: "send_failed" };
  }
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

async function handleActivation(event, token) {
  const context = await loadContext(event, token);
  if (context.error) {
    return context.error;
  }

  const current = publicStatus(context.lead, context.tokenType);
  if (current.account_ready) {
    return response(event, 200, {
      activation_email: { sent: false, reason: "account_already_active" },
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

  const activationEmail = await sendMemberEmailIfNeeded({
    lead: context.lead,
    kind: "activation",
    token,
    tokenType: context.tokenType,
  });

  return response(event, 200, {
    activation_email: activationEmail,
    ...current,
  });
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
    const welcomeEmail = await sendMemberEmailIfNeeded({
      lead: context.lead,
      kind: "welcome",
    });
    return response(event, 409, {
      error: "already_set",
      message: "This account password has already been set.",
      welcome_email: welcomeEmail,
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

  let passwordSetAt;
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

    passwordSetAt = await finalizePasswordSetup(
      context.lead,
      context.tokenType,
      tokenHash
    );
  } catch (error) {
    await markPasswordSetupFailed(context.lead, tokenHash);
    throw error;
  }

  const updatedLead = {
    ...context.lead,
    account_status: ACCOUNT_STATUS_ACTIVE,
    password_set_at: passwordSetAt,
  };
  const welcomeEmail = await sendMemberEmailIfNeeded({
    lead: updatedLead,
    kind: "welcome",
  });

  return response(event, 200, {
    email: current.email,
    name: current.name,
    account_status: ACCOUNT_STATUS_ACTIVE,
    account_ready: true,
    password_ready: false,
    password_set_at: passwordSetAt,
    token_type: context.tokenType,
    tier: current.tier,
    welcome_email: welcomeEmail,
  });
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

    if (["activation", "send_activation", "left_before_password"].includes(action)) {
      return handleActivation(event, token);
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
