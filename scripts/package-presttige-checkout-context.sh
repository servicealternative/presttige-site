#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend/checkout-context"
BUILD_DIR="$(mktemp -d)"
ZIP_PATH="$(pwd)/dist.zip"
trap 'rm -rf "$BUILD_DIR"' EXIT

mkdir -p "$BUILD_DIR/lib"
cp index.js package.json "$BUILD_DIR/"
cp ../lib/stripe-tier-contract.js "$BUILD_DIR/lib/stripe-tier-contract.js"
cp ../lib/founder-inviter-eligibility.js "$BUILD_DIR/lib/founder-inviter-eligibility.js"
find "$BUILD_DIR" -type f -exec touch -t 202001010000 {} +

rm -f "$ZIP_PATH"
(
  cd "$BUILD_DIR"
  find index.js package.json lib -type f | LC_ALL=C sort | zip -X -q "$ZIP_PATH" -@
)
bash "$ROOT/scripts/verify-founder-inviter-package.sh" "$ZIP_PATH" presttige-checkout-context
echo "Package created at $(pwd)/dist.zip"
ls -lh "$ZIP_PATH"
echo "SHA256 (hex): $(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
echo "SHA256 (base64): $(shasum -a 256 "$ZIP_PATH" | awk '{print $1}' | xxd -r -p | base64)"
