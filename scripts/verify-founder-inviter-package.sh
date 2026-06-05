#!/bin/bash
set -euo pipefail

ZIP_PATH="${1:?Package zip path is required}"
LAMBDA_NAME="${2:?Lambda name is required}"

fail() {
  echo "Founder inviter package guard failed for ${LAMBDA_NAME}: $*" >&2
  exit 1
}

require_zip_entry() {
  local entry="$1"
  if ! unzip -Z1 "$ZIP_PATH" | grep -qx "$entry"; then
    fail "missing ${entry}"
  fi
}

if [ ! -f "$ZIP_PATH" ]; then
  fail "package zip not found at ${ZIP_PATH}"
fi

case "$LAMBDA_NAME" in
  presttige-checkout-context|presttige-create-checkout-session)
    require_zip_entry "index.js"
    require_zip_entry "lib/founder-inviter-eligibility.js"

    INDEX_CONTENT="$(unzip -p "$ZIP_PATH" index.js)"
    HELPER_CONTENT="$(unzip -p "$ZIP_PATH" lib/founder-inviter-eligibility.js)"

    printf "%s" "$INDEX_CONTENT" | grep -q "loadFounderInviterEligibilityModule" \
      || fail "index.js does not load the shared Founder inviter helper"
    printf "%s" "$INDEX_CONTENT" | grep -q "isEligibleFounderInviter" \
      || fail "index.js does not call isEligibleFounderInviter"
    printf "%s" "$HELPER_CONTENT" | grep -q "async function isEligibleFounderInviter" \
      || fail "helper does not export the expected Founder inviter function"

    if printf "%s" "$INDEX_CONTENT" | grep -q "normalizeString(invitedRecord.inviter_lead_id) !== normalizeString(inviterRecord.lead_id)"; then
      fail "old inviter_lead_id equality gate is present"
    fi
    ;;
  *)
    echo "Founder inviter package guard skipped for ${LAMBDA_NAME}"
    exit 0
    ;;
esac

echo "Founder inviter package guard passed for ${LAMBDA_NAME}"
