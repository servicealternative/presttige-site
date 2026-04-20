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
        <div style="margin:32px 0 24px 0;">
          <a href="{cta_url}"
             style="display:inline-block;padding:13px 22px;background:#d1ae72;color:#0d0d0d;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;">
            {cta_label}
          </a>
        </div>
        """

    footer_html = ""
    if footer_note:
        footer_html = f"""
        <p style="margin:0;font-size:14px;line-height:1.6;opacity:0.7;">
          {footer_note}
        </p>
        """

    return f"""
    <div style="background:#050505;color:#f4f1eb;padding:40px;font-family:Arial,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
      <div style="max-width:560px;margin:0 auto;">
        <h2 style="margin:0 0 18px 0;line-height:1.2;">{title}</h2>

        <p style="margin:0 0 20px 0;font-weight:600;line-height:1.5;">Hello {greeting_name},</p>

        <div style="margin-top:0;font-size:16px;line-height:1.75;color:#f4f1eb;">
          {formatted_body_html}
        </div>

        {cta_html}

        <div style="margin-top:2px;">
          {footer_html}
        </div>

        {render_email_signature()}
      </div>
    </div>
    """
