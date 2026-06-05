#!/bin/bash
set -euo pipefail

LAMBDA_NAME="${1:?Lambda name is required}"
REGION="${AWS_REGION:-us-east-1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ZIP_PATH="$TMP_DIR/${LAMBDA_NAME}.zip"
CODE_URL="$(aws lambda get-function \
  --function-name "$LAMBDA_NAME" \
  --region "$REGION" \
  --query 'Code.Location' \
  --output text)"

curl -sS -L "$CODE_URL" -o "$ZIP_PATH"
bash "$SCRIPT_DIR/verify-founder-inviter-package.sh" "$ZIP_PATH" "$LAMBDA_NAME"

CODE_SHA="$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_NAME" \
  --region "$REGION" \
  --query 'CodeSha256' \
  --output text)"

echo "Live Founder inviter guard passed for ${LAMBDA_NAME}, CodeSha256 ${CODE_SHA}"
