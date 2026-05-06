const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

const lambda = new LambdaClient({ region: "us-east-1" });
const ses = new SESClient({ region: "us-east-1" });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const TABLE_NAME = "presttige-db";
const UPGRADE_ELIGIBLE_UNTIL = "2026-12-31T23:59:59Z";
const SEND_SUBSCRIBER_WELCOME_FUNCTION_NAME =
  process.env.SEND_SUBSCRIBER_WELCOME_FUNCTION_NAME || "presttige-send-subscriber-welcome-email";
const SEND_WELCOME_FUNCTION_NAME =
  process.env.SEND_WELCOME_FUNCTION_NAME || "presttige-send-welcome-email";
const RECEIPT_FROM = "office@presttige.net";
const RECEIPT_REPLY_TO = "info@presttige.net";
const PREVIEW_BANNER_TEXT =
  "PREVIEW MODE · No payment was processed · This journey will not appear in member records";
const PREVIEW_BANNER_HTML =
  '<div style="margin:0 0 28px 0;padding:10px 14px;background:#353535;color:#D7D3CC;font-family:Georgia,serif;font-size:13px;line-height:1.5;font-style:italic;">' +
  PREVIEW_BANNER_TEXT +
  "</div>";

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

async function invokeWelcomeEmail(leadId) {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: SEND_WELCOME_FUNCTION_NAME,
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
    console.error("activate-subscriber welcome invoke error", error);
    return false;
  }
}

function redirectUrl(token) {
  return `https://presttige.net/subscriber/${token}?status=confirmed`;
}

function previewSubscriberRedirectUrl(token) {
  return `https://presttige.net/subscriber/${token}?status=confirmed&preview=1`;
}

function previewSuccessRedirectUrl(token, tier) {
  const query = new URLSearchParams({
    token,
    tier,
    preview: "1",
  });
  return `https://presttige.net/preview/success/?${query.toString()}`;
}

function normalizeTier(value) {
  return String(value || "").trim().toLowerCase();
}

function titleCase(value) {
  return String(value || "")
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function receiptAmountLabel(tier) {
  const byTier = {
    club: "$144.44 / year",
    premier: "$388.88 / year",
    patron: "$999 / year",
  };
  return byTier[tier] || "";
}

function buildPreviewReceiptEmail(lead, tier) {
  const tierLabel = titleCase(tier);
  const amountLabel = receiptAmountLabel(tier);
  const name = String(lead?.name || "Member").trim();
  const subject = `Preview receipt — ${tierLabel} membership`;
  const html = `
<!DOCTYPE html>
<html lang="en" class="notranslate">
<head>
  <meta name="google" content="notranslate">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body translate="no" style="margin:0;padding:0;background:#F5F2ED;color:#0A0A0A;font-family:Georgia,serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F2ED;">
    <tr>
      <td align="center" style="padding:0 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FBF9F4;">
          <tr>
            <td style="padding:48px 56px 40px 56px;">
              ${PREVIEW_BANNER_HTML}
              <p style="margin:0 0 24px 0;color:#8A7544;font-size:11px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;">Membership · Preview receipt</p>
              <h1 style="margin:0 0 24px 0;font-size:34px;font-weight:500;line-height:1.15;">Preview receipt</h1>
              <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;color:#4A4A4A;">${name}, your ${tierLabel} membership journey has been completed in preview mode.</p>
              <p style="margin:0 0 18px 0;font-size:16px;line-height:1.7;color:#4A4A4A;">Membership selected: ${tierLabel}${amountLabel ? ` · ${amountLabel}` : ""}</p>
              <p style="margin:0;font-size:16px;line-height:1.7;color:#4A4A4A;">No payment was processed, no Stripe object was created, and this record is excluded from member counts and revenue reporting.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
  const text = [
    PREVIEW_BANNER_TEXT,
    "",
    "Preview receipt",
    "",
    `${name}, your ${tierLabel} membership journey has been completed in preview mode.`,
    `Membership selected: ${tierLabel}${amountLabel ? ` · ${amountLabel}` : ""}`,
    "No payment was processed, no Stripe object was created, and this record is excluded from member counts and revenue reporting.",
  ].join("\n");

  return { subject, html, text };
}

async function sendPreviewReceiptEmail(lead, tier) {
  if (!lead?.email) {
    return false;
  }

  try {
    const receipt = buildPreviewReceiptEmail(lead, tier);
    await ses.send(
      new SendEmailCommand({
        Source: RECEIPT_FROM,
        ReplyToAddresses: [RECEIPT_REPLY_TO],
        Destination: {
          ToAddresses: [lead.email],
        },
        Message: {
          Subject: {
            Data: receipt.subject,
            Charset: "UTF-8",
          },
          Body: {
            Html: {
              Data: receipt.html,
              Charset: "UTF-8",
            },
            Text: {
              Data: receipt.text,
              Charset: "UTF-8",
            },
          },
        },
      })
    );
    return true;
  } catch (error) {
    console.error("activate-subscriber preview receipt error", error);
    return false;
  }
}

exports.handler = async (event) => {
  const body = JSON.parse(event.body || "{}");
  const token = String(body.token || "").trim();
  const previewTier = normalizeTier(body.preview_tier || body.tier);
  const selectedContractKey = String(body.contract_key || body.contractKey || "").trim();

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

    if (["club", "premier", "patron"].includes(previewTier)) {
      if (!lead.preview_mode) {
        return response(403, { error: "Preview mode is not enabled for this membership." });
      }

      if (lead.account_active && normalizeTier(lead.selected_tier) === previewTier) {
        return response(200, {
          activated: true,
          preview_mode: true,
          selected_tier: previewTier,
          welcome_triggered: Boolean(lead.welcome_sent_at),
          receipt_sent: Boolean(lead.preview_receipt_sent_at),
          redirect_url: previewSuccessRedirectUrl(token, previewTier),
        });
      }

      const now = new Date().toISOString();
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { lead_id: lead.lead_id },
          UpdateExpression: `
            SET selected_tier = :tier,
                selected_tier_billing = :billing,
                selected_contract_key = :contract_key,
                selected_checkout_mode = :checkout_mode,
                payment_status = :payment_status,
                payment_status_reason = :payment_status_reason,
                founding_rate_locked = :founding_rate_locked,
                founding_rate_expires_at = :founding_rate_expires_at,
                upgrade_eligible_until = :upgrade_eligible_until,
                preview_mode_completed_at = :preview_mode_completed_at,
                preview_receipt_sent_at = :preview_receipt_sent_at,
                account_active = :account_active,
                onboarded_at = if_not_exists(onboarded_at, :onboarded_at),
                updated_at = :updated_at
            REMOVE selected_periodicity, effective_tier, effective_tier_until, stripe_session_id, stripe_checkout_started_at, selected_price_id
          `,
          ExpressionAttributeValues: {
            ":tier": previewTier,
            ":billing": "yearly",
            ":contract_key": selectedContractKey || `${previewTier}_yearly`,
            ":checkout_mode": "preview",
            ":payment_status": "preview_paid",
            ":payment_status_reason": "preview_mode_completed",
            ":founding_rate_locked": false,
            ":founding_rate_expires_at": null,
            ":upgrade_eligible_until": UPGRADE_ELIGIBLE_UNTIL,
            ":preview_mode_completed_at": now,
            ":preview_receipt_sent_at": null,
            ":account_active": true,
            ":onboarded_at": now,
            ":updated_at": now,
          },
        })
      );

      const welcomeTriggered = await invokeWelcomeEmail(lead.lead_id);
      const receiptSent = await sendPreviewReceiptEmail(lead, previewTier);

      if (receiptSent) {
        await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { lead_id: lead.lead_id },
            UpdateExpression: "SET preview_receipt_sent_at = :sent_at",
            ExpressionAttributeValues: {
              ":sent_at": new Date().toISOString(),
            },
          })
        );
      }

      return response(200, {
        activated: true,
        preview_mode: true,
        selected_tier: previewTier,
        welcome_triggered: welcomeTriggered,
        receipt_sent: receiptSent,
        redirect_url: previewSuccessRedirectUrl(token, previewTier),
      });
    }

    if (lead.payment_status === "paid" || lead.account_active) {
      return response(409, { error: "Membership already activated" });
    }

    const now = new Date().toISOString();
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { lead_id: lead.lead_id },
        UpdateExpression: `
          SET selected_tier = :tier,
              selected_tier_billing = :billing,
              founding_rate_locked = :founding_rate_locked,
              founding_rate_expires_at = :founding_rate_expires_at,
              upgrade_eligible_until = :upgrade_eligible_until,
              subscriber_activated_at = if_not_exists(subscriber_activated_at, :subscriber_activated_at)
          REMOVE selected_periodicity, effective_tier, effective_tier_until, stripe_session_id, stripe_checkout_started_at, selected_price_id
        `,
        ExpressionAttributeValues: {
          ":tier": "subscriber",
          ":billing": null,
          ":founding_rate_locked": false,
          ":founding_rate_expires_at": null,
          ":upgrade_eligible_until": UPGRADE_ELIGIBLE_UNTIL,
          ":subscriber_activated_at": now,
        },
      })
    );

    const welcomeTriggered = await invokeSubscriberWelcomeEmail(lead.lead_id);

    return response(200, {
      activated: true,
      preview_mode: Boolean(lead.preview_mode),
      selected_tier: "subscriber",
      subscriber_welcome_triggered: welcomeTriggered,
      redirect_url: lead.preview_mode ? previewSubscriberRedirectUrl(token) : redirectUrl(token),
    });
  } catch (error) {
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
