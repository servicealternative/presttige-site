#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../backend/send-committee-email"
rm -f dist.zip
zip -r dist.zip index.js committee-email.html package.json node_modules
echo "Package created at $(pwd)/dist.zip"
ls -lh dist.zip
echo "SHA256 (hex): $(shasum -a 256 dist.zip | awk '{print $1}')"
echo "SHA256 (base64): $(shasum -a 256 dist.zip | awk '{print $1}' | xxd -r -p | base64)"
