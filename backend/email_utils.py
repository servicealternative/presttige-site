from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parent
SIGNATURE_PATH = BACKEND_ROOT / "email" / "signature.html"


def render_email_signature():
    return SIGNATURE_PATH.read_text(encoding="utf-8").strip()


def build_email_html(title, greeting_name, body_html, cta_label=None, cta_url=None, footer_note=None):
    cta_html = ""
    if cta_label and cta_url:
        cta_html = f"""
        <div style="margin:32px 0;">
          <a href="{cta_url}"
             style="display:inline-block;padding:14px 24px;background:#d1ae72;color:#0d0d0d;text-decoration:none;border-radius:999px;font-weight:600;">
            {cta_label}
          </a>
        </div>
        """

    footer_html = ""
    if footer_note:
        footer_html = f"""
        <p style="font-size:14px;opacity:0.7;">
          {footer_note}
        </p>
        """

    return f"""
    <div style="background:#050505;color:#f4f1eb;padding:40px;font-family:Arial,sans-serif;">
      <div style="max-width:620px;margin:0 auto;">
        <h2 style="margin-bottom:16px;">{title}</h2>

        <p>Hello {greeting_name},</p>

        {body_html}

        {cta_html}

        {footer_html}

        {render_email_signature()}
      </div>
    </div>
    """
