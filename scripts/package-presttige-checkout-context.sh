#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../backend/checkout-context"
rm -rf lib
mkdir -p lib
cp ../lib/stripe-tier-contract.js lib/stripe-tier-contract.js
trap 'rm -rf lib' EXIT
rm -f dist.zip
zip -r dist.zip index.js package.json lib
echo "Package created at $(pwd)/dist.zip"
ls -lh dist.zip
echo "SHA256 (hex): $(shasum -a 256 dist.zip | awk '{print $1}')"
echo "SHA256 (base64): $(shasum -a 256 dist.zip | awk '{print $1}' | xxd -r -p | base64)"
