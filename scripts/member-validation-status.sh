#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
TABLE_NAME="${TABLE_NAME:-presttige-db}"
AUDIT_TABLE_NAME="${AUDIT_TABLE_NAME:-presttige-review-audit}"
EMAIL=""
STATUS=""
ACTOR_ID="chairman"
ALLOW_REAL="false"

usage() {
  cat <<'USAGE'
Usage:
  scripts/member-validation-status.sh --email <member-email> --status <not_started|pending|validated> [--actor <actor-id>] [--allow-real]

Notes:
  - Default mode refuses non-synthetic records.
  - Use --allow-real only for a deliberate production operation by Antonio.
  - The script writes an append-only audit row before the member record update.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --status)
      STATUS="${2:-}"
      shift 2
      ;;
    --actor)
      ACTOR_ID="${2:-}"
      shift 2
      ;;
    --allow-real)
      ALLOW_REAL="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

EMAIL="$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]' | xargs)"
STATUS="$(printf '%s' "$STATUS" | tr '[:upper:]' '[:lower:]' | xargs)"

case "$STATUS" in
  not_started|pending|validated)
    ;;
  *)
    usage
    exit 2
    ;;
esac

if [[ -z "$EMAIL" || -z "$ACTOR_ID" ]]; then
  usage
  exit 2
fi

read -r LEAD_ID SYNTHETIC PREVIOUS_STATUS < <(
  aws dynamodb query \
    --table-name "$TABLE_NAME" \
    --index-name email-index \
    --key-condition-expression 'email = :email' \
    --expression-attribute-values "{\":email\":{\"S\":\"$EMAIL\"}}" \
    --region "$REGION" \
    --query 'Items[0].[lead_id.S, synthetic_test.BOOL, validation_status.S]' \
    --output text
)

if [[ -z "${LEAD_ID:-}" || "$LEAD_ID" == "None" ]]; then
  echo "Member record not found." >&2
  exit 1
fi

if [[ "$SYNTHETIC" != "True" && "$ALLOW_REAL" != "true" ]]; then
  echo "Refusing non-synthetic record without --allow-real." >&2
  exit 1
fi

if [[ "$PREVIOUS_STATUS" == "None" ]]; then
  PREVIOUS_STATUS="not_started"
fi

if [[ "$SYNTHETIC" == "True" ]]; then
  SYNTHETIC_PY="True"
else
  SYNTHETIC_PY="False"
fi

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
AUDIT_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
TMP_JSON="$(mktemp)"
trap 'rm -f "$TMP_JSON"' EXIT

python3 - "$TMP_JSON" <<PY
import json
import sys

target = sys.argv[1]
payload = [
    {
        "Put": {
            "TableName": "${AUDIT_TABLE_NAME}",
            "Item": {
                "audit_id": {"S": "${AUDIT_ID}"},
                "timestamp": {"S": "${TIMESTAMP}"},
                "lead_id": {"S": "${LEAD_ID}"},
                "target_lead_id": {"S": "${LEAD_ID}"},
                "action": {"S": "member_validation_status_update"},
                "actor_id": {"S": "${ACTOR_ID}"},
                "reviewer_id": {"S": "${ACTOR_ID}"},
                "previous_state": {
                    "M": {
                        "validation_status": {"S": "${PREVIOUS_STATUS}"}
                    }
                },
                "new_state": {
                    "M": {
                        "validation_status": {"S": "${STATUS}"}
                    }
                },
                "metadata": {
                    "M": {
                        "component": {"S": "scripts/member-validation-status.sh"},
                        "source": {"S": "operations_cli"},
                        "synthetic_test": {"BOOL": ${SYNTHETIC_PY}}
                    }
                },
                "is_test": {"BOOL": ${SYNTHETIC_PY}}
            },
            "ConditionExpression": "attribute_not_exists(audit_id)"
        }
    },
    {
        "Update": {
            "TableName": "${TABLE_NAME}",
            "Key": {
                "lead_id": {"S": "${LEAD_ID}"}
            },
            "UpdateExpression": "SET validation_status = :status, validation_status_updated_at = :ts, validation_status_updated_by = :actor",
            "ConditionExpression": "attribute_exists(lead_id)",
            "ExpressionAttributeValues": {
                ":status": {"S": "${STATUS}"},
                ":ts": {"S": "${TIMESTAMP}"},
                ":actor": {"S": "${ACTOR_ID}"}
            }
        }
    }
]
with open(target, "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
PY

aws dynamodb transact-write-items \
  --transact-items "file://${TMP_JSON}" \
  --region "$REGION" >/dev/null

echo "validation_status updated."
echo "lead_id=${LEAD_ID}"
echo "status=${STATUS}"
echo "audit_id=${AUDIT_ID}"
