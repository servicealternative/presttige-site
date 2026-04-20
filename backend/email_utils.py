from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parent
SIGNATURE_PATH = BACKEND_ROOT / "email" / "signature.html"


def render_email_signature():
    return SIGNATURE_PATH.read_text(encoding="utf-8").strip()


def build_email_html(title, greeting_name, body_html, cta_label=None, cta_url=None, footer_note=None):
    formatted_body_html = (
        body_html
        .replace("<p>", '<p style="margin:0 0 16px 0;">')
        .replace("<ul>", '<ul style="margin:0 0 16px 20px;padding:0;">')
        .replace("<ol>", '<ol style="margin:0 0 16px 20px;padding:0;">')
    )

    cta_html = ""
    if cta_label and cta_url:
        cta_html = f"""
        <div style="margin:34px 0 26px 0;">
          <a href="{cta_url}"
             style="display:inline-block;padding:13px 22px;background:#d1ae72;color:#0d0d0d;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;line-height:1;">
            {cta_label}
          </a>
        </div>
        """

    footer_html = ""
    if footer_note:
        footer_html = f"""
        <p style="margin:0;font-size:14px;line-height:1.6;color:#6f6f6f;">
          {footer_note}
        </p>
        """

    return f"""
    <div style="margin:0;padding:0;background:#ffffff;color:#171717;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#ffffff;color:#171717;font-family:Arial,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
        <tr>
          <td align="center" style="padding:34px 18px 40px 18px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;">
              <tr>
                <td style="padding:0 0 4px 0;">
                  <h2 style="margin:0;font-size:32px;font-weight:600;line-height:1.15;letter-spacing:-0.02em;color:#171717;">{title}</h2>
                </td>
              </tr>
              <tr>
                <td style="padding-top:24px;">
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
                <td style="padding-top:2px;">
                  {footer_html}
                </td>
              </tr>
              <tr>
                <td>
                  {render_email_signature()}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
    """
