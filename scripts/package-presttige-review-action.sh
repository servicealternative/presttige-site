#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAMBDA_NAME="presttige-review-action"
BUILD_DIR="/tmp/${LAMBDA_NAME}-package"
ZIP_PATH="/tmp/${LAMBDA_NAME}-package.zip"

rm -rf "$BUILD_DIR" "$ZIP_PATH"
mkdir -p "$BUILD_DIR"

cp "$ROOT/backend/lambdas/review-action/lambda_function.py" "$BUILD_DIR/lambda_function.py"

find "$BUILD_DIR" -exec touch -t 202001010000 {} +

(
  cd "$BUILD_DIR"
  find . -type f | LC_ALL=C sort | zip -X -q "$ZIP_PATH" -@
)

if command -v sha256sum >/dev/null 2>&1; then
  PACKAGE_SHA="$(sha256sum "$ZIP_PATH" | cut -d' ' -f1)"
else
  PACKAGE_SHA="$(shasum -a 256 "$ZIP_PATH" | cut -d' ' -f1)"
fi

echo "Package SHA256: $PACKAGE_SHA"
echo "Package path: $ZIP_PATH"
