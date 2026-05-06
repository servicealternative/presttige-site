(function () {
  "use strict";

  const TEXT =
    "PREVIEW MODE · No payment was processed · This journey will not appear in member records";

  function ensureBanner() {
    const body = document.body;
    if (!body) {
      return null;
    }

    if (body.dataset.previewModeActive === "true") {
      return document.querySelector(".presttige-preview-banner");
    }

    const banner = document.createElement("div");
    banner.className = "presttige-preview-banner";
    banner.textContent = TEXT;
    body.insertBefore(banner, body.firstChild);
    body.dataset.previewModeActive = "true";
    return banner;
  }

  function syncFromQuery(paramName) {
    const params = new URLSearchParams(window.location.search);
    if (params.get(paramName || "preview") === "1") {
      ensureBanner();
      return true;
    }
    return false;
  }

  window.PresttigePreview = {
    text: TEXT,
    enable: ensureBanner,
    syncFromQuery,
  };
})();
