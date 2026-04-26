#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../backend/send-application-received"
rm -f dist.zip
zip dist.zip index.js application-received-email.html package.json
echo "SHA256: $(shasum -a 256 dist.zip | awk '{print $1}' | xxd -r -p | base64)"
