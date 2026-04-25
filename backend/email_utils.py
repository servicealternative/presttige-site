from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parent
SIGNATURE_PATH = BACKEND_ROOT / "email" / "signature.html"
TRANSACTIONAL_TEMPLATE_PATH = BACKEND_ROOT / "email" / "presttige_transactional_email.html"
TRANSACTIONAL_PLAINTEXT_TEMPLATE_PATH = BACKEND_ROOT / "email" / "presttige_transactional_email.txt"


def render_email_signature():
    return SIGNATURE_PATH.read_text(encoding="utf-8").strip()


def render_transactional_email_template(context):
    template = TRANSACTIONAL_TEMPLATE_PATH.read_text(encoding="utf-8")

    if context.get("cta_url"):
        cta_block_start = template.index("{{#cta_url}}")
        cta_block_end = template.index("{{/cta_url}}") + len("{{/cta_url}}")
        cta_block = template[cta_block_start:cta_block_end]
        template = template.replace(cta_block, cta_block.replace("{{#cta_url}}", "").replace("{{/cta_url}}", ""))
    else:
        start = template.index("{{#cta_url}}")
        end = template.index("{{/cta_url}}") + len("{{/cta_url}}")
        template = template[:start] + template[end:]

    if context.get("disclaimer"):
        disclaimer_start = template.index("{{#disclaimer}}")
        disclaimer_end = template.index("{{/disclaimer}}") + len("{{/disclaimer}}")
        disclaimer_block = template[disclaimer_start:disclaimer_end]
        template = template.replace(
            disclaimer_block,
            disclaimer_block.replace("{{#disclaimer}}", "").replace("{{/disclaimer}}", ""),
        )
    else:
        start = template.index("{{#disclaimer}}")
        end = template.index("{{/disclaimer}}") + len("{{/disclaimer}}")
        template = template[:start] + template[end:]

    template = template.replace("{{{body_html}}}", context.get("body_html", ""))

    for key, value in context.items():
        template = template.replace(f"{{{{{key}}}}}", value or "")

    return template


def render_transactional_email_plaintext_template(context):
    template = TRANSACTIONAL_PLAINTEXT_TEMPLATE_PATH.read_text(encoding="utf-8")

    for key, value in context.items():
        template = template.replace(f"{{{{{key}}}}}", value or "")

    return template


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
