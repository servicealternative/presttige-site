(function () {
  "use strict";

  window.PRESTTIGE_ACCESS_DETAIL = {
    render: render,
  };

  function render(root, context) {
    root.innerHTML = [
      '<div class="detail-grid">',
        '<article class="detail-copy">',
          '<span class="detail-kicker">Invitation confirmed</span>',
          '<h1 class="detail-title">Founder</h1>',
          '<p class="detail-lede">Founder is a permanent lifetime position within Presttige, reserved for invited candidates whose referral and review path has been confirmed.</p>',
          renderSection("Position", [
            "Invitation-only access through a qualifying referral and committee review.",
            "A lifetime Founder tier in the Presttige network.",
            "Recognition as part of the founding class of the programme.",
          ]),
          renderSection("Includes", [
            "Full network communications.",
            "Permanent Founder communications and welcome materials.",
            "Invitations to events, workshops, and programming as the platform grows.",
            "A direct path into the private Founder payment and activation flow.",
          ]),
        '</article>',
        '<aside class="detail-card">',
          '<h2>Founder tier</h2>',
          '<p class="price">$9,999</p>',
          '<p class="note">One-time lifetime payment. Consent, payment, and activation are handled in the next funnel step.</p>',
          '<p class="next-step">Next step, consent and payment</p>',
          '<p class="note">Verified email: ' + escapeHtml(context.email || "") + '</p>',
        '</aside>',
      '</div>',
    ].join("");
  }

  function renderSection(title, items) {
    return [
      '<section class="detail-section">',
        '<h3>' + escapeHtml(title) + '</h3>',
        '<ul class="detail-list">',
          items.map(function (item) {
            return '<li>' + escapeHtml(item) + '</li>';
          }).join(""),
        '</ul>',
      '</section>',
    ].join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
