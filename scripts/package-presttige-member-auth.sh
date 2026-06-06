#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAMBDA_NAME="presttige-member-auth"
LAMBDA_DIR="$ROOT/backend/member-auth"
BUILD_DIR="/tmp/${LAMBDA_NAME}-package"
ZIP_PATH="/tmp/${LAMBDA_NAME}-package.zip"

rm -rf "$BUILD_DIR" "$ZIP_PATH"
mkdir -p "$BUILD_DIR"

cp "$LAMBDA_DIR/index.js" "$BUILD_DIR/index.js"
cp "$LAMBDA_DIR/package.json" "$BUILD_DIR/package.json"

find "$BUILD_DIR" -exec touch -t 202001010000 {} +

(
  cd "$BUILD_DIR"
  find . -type f | LC_ALL=C sort | zip -X -q "$ZIP_PATH" -@
)

echo "Package created at $ZIP_PATH"
ls -lh "$ZIP_PATH"
echo "SHA256 (hex): $(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
echo "SHA256 (base64): $(shasum -a 256 "$ZIP_PATH" | awk '{print $1}' | xxd -r -p | base64)"
