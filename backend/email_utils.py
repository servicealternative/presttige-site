from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parent
SIGNATURE_PATH = BACKEND_ROOT / "email" / "signature.html"


def render_email_signature():
    return SIGNATURE_PATH.read_text(encoding="utf-8").strip()


def build_email_html(title, greeting_name, body_html, cta_label=None, cta_url=None, footer_note=None):
    formatted_body_html = (
        body_html
        .replace("<p>", '<p style="margin:0;">')
        .replace("<ul>", '<ul style="margin:0 0 16px 20px;padding:0;">')
        .replace("<ol>", '<ol style="margin:0 0 16px 20px;padding:0;">')
    )

    cta_html = ""
    if cta_label and cta_url:
        cta_html = f"""
        <div style="margin:34px 0 26px 0;">
          <a href="{cta_url}"
             style="display:inline-block;padding:13px 22px;background:#d1ae72;color:#171717;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;line-height:1;">
            {cta_label}
          </a>
        </div>
        """

    footer_html = ""
    if footer_note:
        footer_html = f"""
        <p style="margin:0;font-size:16px;line-height:1.75;color:#6f6f6f;">
          {footer_note}
        </p>
        """

    return f"""
    <div style="margin:0;padding:0;background:#f4f1eb;color:#2b2b2b;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f1eb;color:#2b2b2b;font-family:Arial,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
        <tr>
          <td align="center" style="padding:36px 18px 0 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;">
              <tr>
                <td style="padding-top:0;">
                  <p style="margin:0;font-size:16px;font-weight:600;line-height:1.5;color:#171717;">Hello {greeting_name},</p>
                </td>
              </tr>
              <tr>
                <td style="padding-top:20px;font-size:16px;line-height:1.75;color:#2b2b2b;">
                  {formatted_body_html}
                </td>
              </tr>
              <tr>
                <td>
                  {cta_html}
                </td>
              </tr>
              <tr>
                <td style="padding:2px 0 36px 0;">
                  {footer_html}
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#050505;padding:0 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;margin:0 auto;">
              <tr>
                <td style="padding:28px 0 30px 0;">
                  {render_email_signature()}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
    """
