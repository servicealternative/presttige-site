(function () {
  var script = document.currentScript;
  var variant = (script && script.getAttribute("data-variant")) || "home";
  var isHome = variant === "home";

  var headerMarkup =
    '<header class="topbar"' + (isHome ? ' id="topbar"' : "") + ">" +
      '<div class="topbar-inner">' +
        '<a href="' + (isHome ? "#top" : "/") + '" aria-label="Presttige" class="topbar-logo">' +
          '<img src="/assets/images/presttige-p-ring-no-fund.svg" alt="Presttige">' +
        "</a>" +
        (isHome
          ? '<nav class="topbar-nav" aria-label="Primary">' +
              '<a href="#presence" class="topbar-link">Presence</a>' +
              '<a href="#how-it-works" class="topbar-link">How it works</a>' +
              '<a href="#belonging" class="topbar-link">Belonging</a>' +
            "</nav>" +
            '<button class="topbar-cta" id="openApplyModalTop" type="button">Express interest</button>'
          : "") +
      "</div>" +
    "</header>";

  document.write(headerMarkup);
})();
