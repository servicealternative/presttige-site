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
          '<button class="founder-step-button" type="button" data-founder-step-next>Become a Founder</button>',
        '</article>',
        '<aside class="detail-card" data-founder-payment-step hidden>',
          '<h2>Founder tier</h2>',
          '<p class="price">9,999 USD</p>',
          '<p class="note">One-time lifetime payment. Consent is required before the private payment step opens.</p>',
          '<p class="next-step">Next step, consent and payment</p>',
          '<p class="note">Verified email: ' + escapeHtml(context.email || "") + '</p>',
          '<form class="founder-consent" data-founder-consent-form novalidate>',
            '<label class="founder-consent__label" for="founder-consent-checkbox">',
              '<input id="founder-consent-checkbox" type="checkbox" data-founder-consent-checkbox required>',
              '<span>I confirm that I am accepting the Founder lifetime invitation and consent to proceed to the $9,999 Founder payment step.</span>',
            '</label>',
            '<button class="founder-consent__button" type="submit" data-founder-consent-button disabled>Proceed to payment</button>',
            '<p class="founder-consent__message" data-founder-consent-message role="status" aria-live="polite"></p>',
          '</form>',
        '</aside>',
      '</div>',
    ].join("");

    bindFounderStep(root);
    bindFounderConsent(root, context);
  }

  function bindFounderStep(root) {
    var nextButton = root.querySelector("[data-founder-step-next]");
    var paymentStep = root.querySelector("[data-founder-payment-step]");

    if (!nextButton || !paymentStep) {
      return;
    }

    nextButton.addEventListener("click", function () {
      paymentStep.hidden = false;
      nextButton.hidden = true;
      paymentStep.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function bindFounderConsent(root, context) {
    var form = root.querySelector("[data-founder-consent-form]");
    var checkbox = root.querySelector("[data-founder-consent-checkbox]");
    var button = root.querySelector("[data-founder-consent-button]");
    var message = root.querySelector("[data-founder-consent-message]");

    if (!form || !checkbox || !button || !message) {
      return;
    }

    checkbox.addEventListener("change", function () {
      button.disabled = !checkbox.checked;
      message.textContent = "";
    });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!checkbox.checked || button.disabled) {
        message.textContent = "Please confirm consent before proceeding.";
        return;
      }

      button.disabled = true;
      button.textContent = "Opening payment";
      message.textContent = "";

      try {
        var apiBase = String(context.apiBase || "").replace(/\/$/, "");
        var result = await postJson(apiBase + "/checkout-context", {
          contract_key: "founder_lifetime",
          invited_email: context.email,
          inviter_email: context.inviterEmail,
          checkbox_consent_accepted: true
        });

        if (!result || !result.checkoutToken) {
          throw new Error("Founder checkout token was not returned.");
        }

        window.location.assign(
          "/checkout/founder/founder_lifetime?token=" + encodeURIComponent(result.checkoutToken)
        );
      } catch (error) {
        button.disabled = !checkbox.checked;
        button.textContent = "Proceed to payment";
        message.textContent = error.message || "Unable to open payment right now.";
      }
    });
  }

  async function postJson(url, body) {
    var response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    var data = await response.json().catch(function () {
      return {};
    });

    if (!response.ok) {
      var message = data && data.error && data.error.message
        ? data.error.message
        : "Request failed.";
      throw new Error(message);
    }

    return data;
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
