(function () {
  'use strict';

  var STORAGE_KEY = 'presttige_consent_v1';
  var CONSENT_VERSION = '1';
  var GA_ID = 'G-H7BFLVL4F5';
  var analyticsLoaded = false;
  var modalKeydownHandler = null;
  var lastFocusedElement = null;

  window.gtag = window.gtag || function () {
    // No-op until explicit analytics consent is granted.
  };

  function safeParse(value) {
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  function getStoredConsent() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      var parsed = stored ? safeParse(stored) : null;

      if (!parsed || parsed.version !== CONSENT_VERSION) {
        return null;
      }

      if (typeof parsed.analytics !== 'boolean' || typeof parsed.marketing !== 'boolean') {
        return null;
      }

      return parsed;
    } catch (error) {
      return null;
    }
  }

  function saveConsent(preferences) {
    var consent = {
      version: CONSENT_VERSION,
      timestamp: new Date().toISOString(),
      analytics: Boolean(preferences.analytics),
      marketing: Boolean(preferences.marketing)
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
    } catch (error) {
      // If storage is unavailable, still apply preferences for this page view.
    }

    applyConsent(consent);
  }

  function applyConsent(consent) {
    if (consent && consent.analytics === true) {
      loadAnalytics();
    }
  }

  function loadAnalytics() {
    if (analyticsLoaded || document.querySelector('script[data-presttige-ga="true"]')) {
      analyticsLoaded = true;
      return;
    }

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
    script.setAttribute('data-presttige-ga', 'true');

    script.onload = function () {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () {
        window.dataLayer.push(arguments);
      };
      window.gtag('js', new Date());
      window.gtag('config', GA_ID);
      analyticsLoaded = true;
    };

    document.head.appendChild(script);
  }

  function ensureStyles() {
    if (document.getElementById('presttige-cookie-style')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'presttige-cookie-style';
    style.textContent = [
      '.presttige-cookie-banner, .presttige-cookie-modal {',
      '  font-family: Georgia, "Times New Roman", serif;',
      '}',
      '.presttige-cookie-banner {',
      '  position: fixed;',
      '  left: 0;',
      '  right: 0;',
      '  bottom: 0;',
      '  z-index: 9998;',
      '  background: rgba(10, 10, 10, 0.98);',
      '  color: #f5f5f5;',
      '  border-top: 1px solid rgba(209, 174, 114, 0.34);',
      '  box-shadow: 0 -18px 50px rgba(0, 0, 0, 0.45);',
      '  padding: 20px;',
      '}',
      '.presttige-cookie-banner__inner {',
      '  width: min(1120px, 100%);',
      '  margin: 0 auto;',
      '  display: grid;',
      '  grid-template-columns: 1fr auto;',
      '  gap: 18px;',
      '  align-items: center;',
      '}',
      '.presttige-cookie-title {',
      '  margin: 0 0 7px 0;',
      '  font-size: 18px;',
      '  line-height: 1.25;',
      '  color: #f4f1eb;',
      '}',
      '.presttige-cookie-message {',
      '  margin: 0;',
      '  max-width: 760px;',
      '  color: rgba(245, 245, 245, 0.74);',
      '  font-size: 14px;',
      '  line-height: 1.65;',
      '}',
      '.presttige-cookie-policy {',
      '  color: #d1ae72;',
      '  text-decoration: none;',
      '}',
      '.presttige-cookie-policy:hover {',
      '  opacity: 0.85;',
      '}',
      '.presttige-cookie-actions {',
      '  display: flex;',
      '  gap: 10px;',
      '  flex-wrap: wrap;',
      '  justify-content: flex-end;',
      '}',
      '.presttige-cookie-button {',
      '  min-width: 118px;',
      '  border: 1px solid rgba(209, 174, 114, 0.78);',
      '  border-radius: 999px;',
      '  background: rgba(209, 174, 114, 0.14);',
      '  color: #f4f1eb;',
      '  cursor: pointer;',
      '  font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;',
      '  padding: 12px 16px;',
      '  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;',
      '}',
      '.presttige-cookie-button:hover, .presttige-cookie-button:focus-visible {',
      '  background: rgba(209, 174, 114, 0.24);',
      '  border-color: #d1ae72;',
      '  outline: none;',
      '}',
      '.presttige-cookie-button:active {',
      '  transform: translateY(1px);',
      '}',
      '.presttige-cookie-modal {',
      '  position: fixed;',
      '  inset: 0;',
      '  z-index: 9999;',
      '  display: none;',
      '  align-items: center;',
      '  justify-content: center;',
      '  background: rgba(0, 0, 0, 0.72);',
      '  padding: 20px;',
      '}',
      '.presttige-cookie-modal.is-open {',
      '  display: flex;',
      '}',
      '.presttige-cookie-modal__panel {',
      '  width: min(620px, 100%);',
      '  max-height: min(760px, calc(100vh - 40px));',
      '  overflow-y: auto;',
      '  background: #0a0a0a;',
      '  color: #f5f5f5;',
      '  border: 1px solid rgba(209, 174, 114, 0.32);',
      '  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.55);',
      '  padding: 26px;',
      '}',
      '.presttige-cookie-modal h2 {',
      '  margin: 0 0 10px 0;',
      '  font-size: 24px;',
      '  line-height: 1.2;',
      '  color: #f4f1eb;',
      '}',
      '.presttige-cookie-modal p {',
      '  margin: 0;',
      '  color: rgba(245, 245, 245, 0.72);',
      '  font-size: 14px;',
      '  line-height: 1.65;',
      '}',
      '.presttige-cookie-category {',
      '  margin-top: 18px;',
      '  padding-top: 18px;',
      '  border-top: 1px solid rgba(245, 245, 245, 0.1);',
      '}',
      '.presttige-cookie-category__head {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 18px;',
      '}',
      '.presttige-cookie-category strong {',
      '  display: block;',
      '  color: #f4f1eb;',
      '  font: 700 14px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;',
      '}',
      '.presttige-cookie-category small {',
      '  display: block;',
      '  margin-top: 5px;',
      '  color: rgba(245, 245, 245, 0.62);',
      '  font: 400 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;',
      '}',
      '.presttige-cookie-toggle {',
      '  width: 46px;',
      '  height: 26px;',
      '  flex: 0 0 46px;',
      '}',
      '.presttige-cookie-modal__actions {',
      '  margin-top: 24px;',
      '  display: flex;',
      '  gap: 10px;',
      '  justify-content: flex-end;',
      '  flex-wrap: wrap;',
      '}',
      '@media (max-width: 720px) {',
      '  .presttige-cookie-banner__inner {',
      '    grid-template-columns: 1fr;',
      '  }',
      '  .presttige-cookie-actions, .presttige-cookie-modal__actions {',
      '    flex-direction: column;',
      '    align-items: stretch;',
      '  }',
      '  .presttige-cookie-button {',
      '    width: 100%;',
      '  }',
      '  .presttige-cookie-modal__panel {',
      '    padding: 22px;',
      '  }',
      '}'
    ].join('\n');

    document.head.appendChild(style);
  }

  function removeBanner() {
    var banner = document.getElementById('presttige-cookie-banner');
    if (banner) {
      banner.remove();
    }
  }

  function showBanner() {
    ensureStyles();

    if (document.getElementById('presttige-cookie-banner')) {
      return;
    }

    var banner = document.createElement('section');
    banner.id = 'presttige-cookie-banner';
    banner.className = 'presttige-cookie-banner';
    banner.setAttribute('aria-label', 'Cookie consent');
    banner.innerHTML = [
      '<div class="presttige-cookie-banner__inner">',
      '  <div>',
      '    <h2 class="presttige-cookie-title">Cookies &amp; Privacy</h2>',
      '    <p class="presttige-cookie-message">Presttige uses cookies for essential site function. With your consent, we also use analytics cookies to understand performance and improve the experience. <a class="presttige-cookie-policy" href="/cookies/">Read our Cookie Policy</a>.</p>',
      '  </div>',
      '  <div class="presttige-cookie-actions">',
      '    <button class="presttige-cookie-button" type="button" data-consent-action="accept">Accept All</button>',
      '    <button class="presttige-cookie-button" type="button" data-consent-action="reject">Reject All</button>',
      '    <button class="presttige-cookie-button" type="button" data-consent-action="customize">Customize</button>',
      '  </div>',
      '</div>'
    ].join('');

    banner.addEventListener('click', function (event) {
      var action = event.target && event.target.getAttribute('data-consent-action');
      if (!action) {
        return;
      }

      if (action === 'accept') {
        saveConsent({ analytics: true, marketing: true });
        removeBanner();
      }

      if (action === 'reject') {
        saveConsent({ analytics: false, marketing: false });
        removeBanner();
      }

      if (action === 'customize') {
        openPreferences();
      }
    });

    document.body.appendChild(banner);
  }

  function getFocusableElements(container) {
    return Array.prototype.slice.call(container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
  }

  function closeModal() {
    var modal = document.getElementById('presttige-cookie-modal');
    if (!modal) {
      return;
    }

    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');

    if (modalKeydownHandler) {
      document.removeEventListener('keydown', modalKeydownHandler);
      modalKeydownHandler = null;
    }

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  function openPreferences() {
    ensureStyles();
    lastFocusedElement = document.activeElement;

    var existingConsent = getStoredConsent() || { analytics: false, marketing: false };
    var modal = document.getElementById('presttige-cookie-modal');

    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'presttige-cookie-modal';
      modal.className = 'presttige-cookie-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-hidden', 'true');
      modal.setAttribute('aria-labelledby', 'presttige-cookie-modal-title');
      modal.innerHTML = [
        '<div class="presttige-cookie-modal__panel" role="document">',
        '  <h2 id="presttige-cookie-modal-title">Cookie Preferences</h2>',
        '  <p>Choose which optional cookies Presttige may use. Strictly necessary cookies are always active because they keep the site functioning securely.</p>',
        '  <div class="presttige-cookie-category">',
        '    <div class="presttige-cookie-category__head">',
        '      <div><strong>Strictly necessary</strong><small>Required for core site function, security, and form operation. Always on.</small></div>',
        '      <input class="presttige-cookie-toggle" type="checkbox" checked disabled aria-label="Strictly necessary cookies are always on">',
        '    </div>',
        '  </div>',
        '  <label class="presttige-cookie-category">',
        '    <div class="presttige-cookie-category__head">',
        '      <div><strong>Analytics</strong><small>Allows Google Analytics to help us understand performance and improve the Presttige experience.</small></div>',
        '      <input id="presttige-cookie-analytics" class="presttige-cookie-toggle" type="checkbox">',
        '    </div>',
        '  </label>',
        '  <label class="presttige-cookie-category">',
        '    <div class="presttige-cookie-category__head">',
        '      <div><strong>Marketing</strong><small>Reserved for future marketing or attribution tools. Off unless you choose otherwise.</small></div>',
        '      <input id="presttige-cookie-marketing" class="presttige-cookie-toggle" type="checkbox">',
        '    </div>',
        '  </label>',
        '  <div class="presttige-cookie-modal__actions">',
        '    <button class="presttige-cookie-button" type="button" data-modal-action="dismiss">Dismiss</button>',
        '    <button class="presttige-cookie-button" type="button" data-modal-action="save">Save Preferences</button>',
        '  </div>',
        '</div>'
      ].join('');

      modal.addEventListener('click', function (event) {
        var action = event.target && event.target.getAttribute('data-modal-action');
        if (!action) {
          return;
        }

        if (action === 'dismiss') {
          closeModal();
        }

        if (action === 'save') {
          saveConsent({
            analytics: document.getElementById('presttige-cookie-analytics').checked,
            marketing: document.getElementById('presttige-cookie-marketing').checked
          });
          removeBanner();
          closeModal();
        }
      });

      document.body.appendChild(modal);
    }

    document.getElementById('presttige-cookie-analytics').checked = existingConsent.analytics === true;
    document.getElementById('presttige-cookie-marketing').checked = existingConsent.marketing === true;

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');

    modalKeydownHandler = function (event) {
      if (event.key === 'Escape') {
        closeModal();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      var focusable = getFocusableElements(modal);
      if (!focusable.length) {
        return;
      }

      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', modalKeydownHandler);

    var firstFocusable = getFocusableElements(modal)[0];
    if (firstFocusable) {
      firstFocusable.focus();
    }
  }

  function init() {
    var consent = getStoredConsent();
    if (consent) {
      applyConsent(consent);
      return;
    }

    showBanner();
  }

  window.PresttigeCookies = {
    openPreferences: openPreferences,
    getConsent: getStoredConsent
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
