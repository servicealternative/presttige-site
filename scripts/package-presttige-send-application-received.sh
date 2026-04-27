#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../backend/send-application-received"
rm -rf lib
mkdir -p lib
cp ../lib/backfill-filters.js lib/backfill-filters.js
trap 'rm -rf lib' EXIT
rm -f dist.zip
zip -r dist.zip index.js application-received-email.html package.json lib
echo "SHA256: $(shasum -a 256 dist.zip | awk '{print $1}' | xxd -r -p | base64)"
