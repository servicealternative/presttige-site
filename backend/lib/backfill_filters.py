from __future__ import annotations

from collections import Counter
from typing import Dict, Iterable, List, Optional

TESTER_WHITELIST = {
    "antoniompereira@me.com",
    "alternativeservice@gmail.com",
    "analuisasf@gmail.com",
}

TERMINAL_REVIEW_STATUSES = {"approved", "rejected", "standby"}


def normalize_text(value: object) -> str:
    return str(value or "").strip()


def normalize_email(value: object) -> str:
    return normalize_text(value).lower()


def normalize_review_status(value: object) -> str:
    return normalize_text(value).lower()


def is_eligible_for_backfill(record: Dict[str, object]) -> bool:
    return not get_backfill_ineligibility_reasons(record)


def get_backfill_ineligibility_reasons(
    record: Dict[str, object],
    *,
    tester_whitelist: Optional[Iterable[str]] = None,
) -> List[str]:
    reasons: List[str] = []
    whitelist = {normalize_email(email) for email in (tester_whitelist or TESTER_WHITELIST)}

    email = normalize_email(record.get("email"))
    review_status = normalize_review_status(record.get("review_status"))

    if normalize_text(record.get("email_status")).lower() != "verified":
        reasons.append("email_status_not_verified")

    if normalize_text(record.get("profile_status")).lower() != "complete":
        reasons.append("profile_status_not_complete")

    if record.get("application_received_email_sent_at"):
        reasons.append("application_received_email_already_sent")

    if record.get("e2_sent_at") or record.get("committee_notification_sent_at"):
        reasons.append("committee_notification_already_sent")

    if bool(record.get("is_test")):
        reasons.append("is_test")

    if email and email in whitelist:
        reasons.append("tester_whitelist")

    if review_status and review_status != "pending":
        reasons.append(f"review_status_non_pending:{review_status}")

    return reasons


def summarize_reasons(records: Iterable[Dict[str, object]]) -> Dict[str, int]:
    counter: Counter[str] = Counter()
    for record in records:
        for reason in get_backfill_ineligibility_reasons(record):
            counter[reason] += 1
    return dict(sorted(counter.items()))
