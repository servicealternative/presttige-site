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
          renderParagraphs([
            "You could be one of our Founders. To be a Founder is to belong to the origin of Presttige.",
            "This is a lifetime and permanent position, reserved for those who were invited and whose path has been confirmed. It is not bought, not requested, not advertised. It is received.",
            "Those who enter at this early stage hold, forever, a combination of privileges that can never be replicated. It is a private tier, by invitation only, limited in time and in the number of Founders. When it closes, it closes for good.",
          ]),
          '<section class="detail-section">',
            '<h3>The privileges of those who arrive first</h3>',
            '<p class="note"><em>These privileges will never be within reach of those who come later.</em></p>',
            renderFeatureList([
              {
                title: "Founder Council",
                body: "A voice at the heart of Presttige, reserved for Founders.",
              },
              {
                title: "Annual retreat",
                body: "An exclusive gathering of Founders, once a year. Not in any ordinary destination, but in places that were never within your horizon, opened to you for the first time.",
              },
              {
                title: "Business at the highest level",
                body: "A seat at exclusive business gatherings, with direct access to those who decide. Doors that do not open from the outside.",
              },
              {
                title: "Your dedicated Premium Concierge",
                body: "A human line that is yours alone, 24 hours a day, wherever you are in the world. From the table that can no longer be reserved to the access no one else can secure, your concierge opens what is closed and gives you back your rarest possession, your time. The word dedicated belongs, at Presttige, to the Founder alone.",
              },
              {
                title: "Presttige in your city",
                body: "The opportunity to personally host private Presttige events where you live, as well as invitations in other cities.",
              },
              {
                title: "Founder artefact",
                body: "An annual physical object, numbered and personalised, a book, a design piece or a curated artefact, exclusive to the Founders who enter from the very beginning. Reserved for those who maintain an active presence at Presttige.",
              },
              {
                title: "A voice in what comes next",
                body: "The first shape the decisions. Those who come later find a world already built.",
              },
            ]),
          '</section>',
          '<button class="founder-step-button" type="button" data-founder-step-next>Become a Founder</button>',
        '</article>',
        '<aside class="detail-card" data-founder-payment-step hidden>',
          '<h2>Your Founding membership</h2>',
          renderParagraphs([
            "To become a Founder is a lifetime commitment, and everything it holds was designed to match it. Here is what you receive.",
          ]),
          renderFeatureList([
            {
              title: "Your Premium Concierge, without hours and without borders",
              body: [
                "A human line that is yours alone, 24 hours a day, 365 days a year, wherever you are in the world.",
                "It is not a support service. It is someone who knows your name and your tastes, and who makes possible what seemed beyond reach: the table that no longer has reservations at a Michelin starred restaurant, the front row at a Formula 1 Grand Prix, reserved access to Art Basel or to fashion week, the jet that departs when you need it, the door that opens only to those who are introduced.",
                "Your concierge opens what is closed, and gives you back your rarest possession, your time. The word dedicated belongs, at Presttige, to the Founder alone.",
              ],
            },
            {
              title: "Business, within the network and beyond",
              body: "Access to exclusive business gatherings, workshops and real opportunities, created both within Presttige and outside it. You sit at the table with those who decide, where the right conversations happen before they reach the world.",
            },
            {
              title: "To see without being seen",
              body: "The privilege of observing the network without exposing your presence, and of making direct contact, without restriction, with whomever you choose. The discretion is yours, and so is the initiative.",
            },
            {
              title: "The directory, fully within your reach",
              body: "Unlimited connection requests and advanced filters that no one else holds. The entire network, navigable on your terms.",
            },
            {
              title: "Every benefit, brought together",
              body: "Founding membership brings together, in one place, all that the other tiers offer, and adds what only the Founder holds.",
            },
            {
              title: "Founder Circles",
              body: "Private circles, reserved for Founders, where they meet among peers.",
            },
            {
              title: "Private dinners",
              body: "Closed tables, in an intimate setting, in the right company.",
            },
            {
              title: "Your Founder mark",
              body: "The Founding Member inscription, permanent, yours forever, even if one day you step away and return.",
            },
            {
              title: "The right to present a Founder",
              body: "As a Founder, you may put forward someone you judge worthy of joining this circle. Your introduction is not one suggestion among many, it carries your name, and with it the trust that brought you here. Your introductions receive priority review, and your word weighs in the approval.",
            },
          ]),
          '<section class="detail-section">',
            '<h3>Founder</h3>',
            '<p class="price">USD 9,999</p>',
            '<p class="note">One time payment. Lifetime access.</p>',
          '</section>',
          '<p class="next-step">Next step, consent and payment</p>',
          '<p class="note">Verified email: ' + escapeHtml(context.email || "") + '</p>',
          '<form class="founder-consent" data-founder-consent-form novalidate>',
            '<label class="founder-consent__label" for="founder-consent-checkbox">',
              '<input id="founder-consent-checkbox" type="checkbox" data-founder-consent-checkbox required>',
              '<span>I confirm that I am accepting the Founder lifetime invitation and consent to proceed to the USD 9,999 Founder payment step.</span>',
            '</label>',
            '<p class="founder-consent__legal-note">Founding membership is a one-time lifetime payment. By proceeding, you acknowledge that, once access is granted, this payment is non-refundable, and you expressly request immediate access, waiving the statutory withdrawal period (Article 16(m)).</p>',
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

  function renderParagraphs(paragraphs) {
    return paragraphs.map(function (paragraph) {
      return '<p>' + escapeHtml(paragraph) + '</p>';
    }).join("");
  }

  function renderFeatureList(items) {
    return [
      '<ul class="detail-list">',
        items.map(function (item) {
          var body = Array.isArray(item.body) ? item.body : [item.body];
          return [
            '<li>',
              '<strong>' + escapeHtml(item.title) + '</strong>',
              body.map(function (paragraph) {
                return '<span> ' + escapeHtml(paragraph) + '</span>';
              }).join(""),
            '</li>',
          ].join("");
        }).join(""),
      '</ul>',
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
