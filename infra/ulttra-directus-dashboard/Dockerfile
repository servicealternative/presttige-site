FROM directus/directus:11

USER root

COPY extensions/directus-extension-ulttra-dashboard-module /directus/extensions/directus-extension-ulttra-dashboard-module
COPY extensions/directus-extension-ulttra-dashboard-endpoint /directus/extensions/directus-extension-ulttra-dashboard-endpoint

RUN cd /directus/extensions/directus-extension-ulttra-dashboard-endpoint \
    && npm install --omit=dev --no-audit --no-fund \
    && chown -R node:node /directus/extensions

USER node
