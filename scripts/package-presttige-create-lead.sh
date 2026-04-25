#!/bin/zsh
set -euo pipefail

ROOT="/Users/antonio/Desktop/presttige-site"
BUILD_DIR="/tmp/presttige-create-lead-package"
ZIP_PATH="/tmp/presttige-create-lead-package.zip"

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/backend/email" "$BUILD_DIR/shared"

cp "$ROOT/backend/lambdas/create-lead/lambda.py" "$BUILD_DIR/lambda.py"
cp "$ROOT/backend/email_utils.py" "$BUILD_DIR/email_utils.py"
cp "$ROOT/backend/email/signature.html" "$BUILD_DIR/backend/email/signature.html"
cp "$ROOT/backend/email/presttige_transactional_email.html" "$BUILD_DIR/backend/email/presttige_transactional_email.html"
cp "$ROOT/backend/email/presttige_transactional_email.txt" "$BUILD_DIR/backend/email/presttige_transactional_email.txt"
cp "$ROOT/shared/__init__.py" "$BUILD_DIR/shared/__init__.py"
cp "$ROOT/shared/testers.py" "$BUILD_DIR/shared/testers.py"

cd "$BUILD_DIR"
zip -qr "$ZIP_PATH" .
echo "$ZIP_PATH"
