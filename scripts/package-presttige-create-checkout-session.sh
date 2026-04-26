#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../backend/create-checkout-session"
rm -f dist.zip
zip dist.zip index.js package.json
echo "Package created at $(pwd)/dist.zip"
ls -lh dist.zip
echo "SHA256 (hex): $(shasum -a 256 dist.zip | awk '{print $1}')"
echo "SHA256 (base64): $(shasum -a 256 dist.zip | awk '{print $1}' | xxd -r -p | base64)"
