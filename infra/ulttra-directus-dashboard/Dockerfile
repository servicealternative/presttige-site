FROM directus/directus:11

USER root

COPY patches /directus/ulttra-patches
COPY extensions/directus-extension-ulttra-dashboard-module /directus/extensions/directus-extension-ulttra-dashboard-module
COPY extensions/directus-extension-ulttra-dashboard-endpoint /directus/extensions/directus-extension-ulttra-dashboard-endpoint

RUN set -eux; \
    admin_index="$(find /directus/node_modules -path '*/@directus/app/dist/index.html' -type f | head -n 1)"; \
    entry_js="$(find /directus/node_modules -path '*/@directus/app/dist/assets/index.*.entry.js' -type f | head -n 1)"; \
    test -n "$admin_index"; \
    test -n "$entry_js"; \
    node /directus/ulttra-patches/patch-visible-directus-wording.mjs "$admin_index" "$entry_js"

RUN cd /directus/extensions/directus-extension-ulttra-dashboard-endpoint \
    && npm install --omit=dev --no-audit --no-fund \
    && chown -R node:node /directus/extensions

USER node
