#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from collections import Counter
from pathlib import Path
from typing import Dict, List

import boto3

REPO_ROOT = Path(__file__).resolve().parents[1]
FILTERS_PATH = REPO_ROOT / "backend" / "lib" / "backfill_filters.py"
REFERENCE_COHORT_PATH = REPO_ROOT / "docs" / "C7A-V2-RE-ENGAGEMENT-LEADS-2026-04-27.json"
TABLE_NAME = "presttige-db"


def load_filters():
    spec = importlib.util.spec_from_file_location("backfill_filters", FILTERS_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def scan_all_records(table) -> List[Dict[str, object]]:
    items: List[Dict[str, object]] = []
    scan_kwargs: Dict[str, object] = {}

    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))
        if "LastEvaluatedKey" not in response:
            break
        scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    return items


def main() -> None:
    filters = load_filters()
    ddb = boto3.resource("dynamodb", region_name="us-east-1")
    table = ddb.Table(TABLE_NAME)

    all_records = scan_all_records(table)
    complete_verified = [
        record
        for record in all_records
        if filters.normalize_text(record.get("email_status")).lower() == "verified"
        and filters.normalize_text(record.get("profile_status")).lower() == "complete"
    ]

    eligible: List[Dict[str, object]] = []
    excluded: List[Dict[str, object]] = []
    reason_counter: Counter[str] = Counter()

    for record in complete_verified:
        reasons = filters.get_backfill_ineligibility_reasons(record)
        if reasons:
            excluded.append(
                {
                    "lead_id": record.get("lead_id"),
                    "email": record.get("email"),
                    "review_status": record.get("review_status"),
                    "application_received_email_sent_at": record.get("application_received_email_sent_at"),
                    "e2_sent_at": record.get("e2_sent_at") or record.get("committee_notification_sent_at"),
                    "reasons": reasons,
                }
            )
            reason_counter.update(reasons)
        else:
            eligible.append(
                {
                    "lead_id": record.get("lead_id"),
                    "email": record.get("email"),
                    "review_status": record.get("review_status"),
                }
            )

    reference_records = json.loads(REFERENCE_COHORT_PATH.read_text())
    reference_by_id = {record["lead_id"]: record for record in complete_verified}
    reference_evaluation = []
    for record in reference_records:
        live_record = reference_by_id.get(record["lead_id"])
        reasons = filters.get_backfill_ineligibility_reasons(live_record or {})
        reference_evaluation.append(
            {
                "lead_id": record["lead_id"],
                "email": record["email"],
                "review_status": (live_record or {}).get("review_status"),
                "reasons": reasons,
            }
        )

    summary = {
        "total_scanned": len(all_records),
        "verified_complete_records": len(complete_verified),
        "eligible_count": len(eligible),
        "excluded_count": len(excluded),
        "reason_breakdown": dict(sorted(reason_counter.items())),
        "eligible_records": eligible,
        "excluded_records": excluded,
        "reference_cohort_count": len(reference_records),
        "reference_cohort_blocked_by_review_guard": sum(
            1
            for record in reference_evaluation
            if any(reason.startswith("review_status_non_pending:") for reason in record["reasons"])
        ),
        "reference_cohort_evaluation": reference_evaluation,
    }

    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
