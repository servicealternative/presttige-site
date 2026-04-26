#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAMBDA_NAME="presttige-gateway"
LAMBDA_DIR="$ROOT/backend/lambdas/gateway"
BUILD_DIR="/tmp/${LAMBDA_NAME}-package"
ZIP_PATH="/tmp/${LAMBDA_NAME}-package.zip"

rm -rf "$BUILD_DIR" "$ZIP_PATH"
mkdir -p "$BUILD_DIR/shared"

python3 -m pip install -r "$LAMBDA_DIR/requirements.txt" -t "$BUILD_DIR" --no-cache-dir --quiet

cp "$LAMBDA_DIR/lambda_function.py" "$BUILD_DIR/lambda_function.py"
cp "$ROOT/shared/__init__.py" "$BUILD_DIR/shared/__init__.py"
cp "$ROOT/shared/testers.py" "$BUILD_DIR/shared/testers.py"

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
