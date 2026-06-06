#!/usr/bin/env python3
"""Sanitize AWS backup JSON/text so presigned URLs and token material are not stored."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


REDACTED_URL = "[REDACTED_PRESIGNED_AWS_URL]"
REDACTED_SECRET = "[REDACTED_AWS_TOKEN_MATERIAL]"

PRESIGNED_MARKERS = (
    "X-Amz-Signature=",
    "X-Amz-Security-Token=",
    "X-Amz-Credential=",
)

AWS_ACCESS_KEY_RE = re.compile(r"\b(AKIA|ASIA)[A-Z0-9]{16}\b")
PRESIGNED_URL_RE = re.compile(
    r"https?://[^\s\"'<>]+X-Amz-(?:Signature|Security-Token|Credential)=[^\s\"'<>]+",
    re.IGNORECASE,
)

SENSITIVE_KEYS = {
    "accesskeyid",
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_session_token",
    "secretaccesskey",
    "sessiontoken",
}


def sanitize_string(value: str) -> str:
    if any(marker in value for marker in PRESIGNED_MARKERS):
        return REDACTED_URL
    value = PRESIGNED_URL_RE.sub(REDACTED_URL, value)
    value = AWS_ACCESS_KEY_RE.sub(lambda match: f"{match.group(1)}[REDACTED]", value)
    return value


def sanitize_json(value: Any, key: str | None = None) -> Any:
    normalized_key = (key or "").replace("-", "").replace("_", "").lower()
    if normalized_key in SENSITIVE_KEYS:
        return REDACTED_SECRET
    if isinstance(value, dict):
        return {item_key: sanitize_json(item_value, item_key) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [sanitize_json(item_value, key) for item_value in value]
    if isinstance(value, str):
        return sanitize_string(value)
    return value


def sanitize_text(text: str) -> str:
    text = PRESIGNED_URL_RE.sub(REDACTED_URL, text)
    text = AWS_ACCESS_KEY_RE.sub(lambda match: f"{match.group(1)}[REDACTED]", text)
    text = re.sub(
        r'("(?:secretAccessKey|sessionToken|aws_secret_access_key|aws_session_token)"\s*:\s*")[^"]+"',
        rf"\1{REDACTED_SECRET}\"",
        text,
        flags=re.IGNORECASE,
    )
    return text


def sanitize_document(text: str) -> str:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return sanitize_text(text)
    sanitized = sanitize_json(parsed)
    return json.dumps(sanitized, indent=2, sort_keys=True) + "\n"


def sanitize_path(path: Path, in_place: bool) -> str:
    text = path.read_text(errors="ignore")
    sanitized = sanitize_document(text)
    if in_place:
        path.write_text(sanitized)
        return ""
    return sanitized


def main() -> int:
    parser = argparse.ArgumentParser(description="Sanitize AWS backup outputs before storing them.")
    parser.add_argument("paths", nargs="*", help="Files to sanitize. Reads stdin when omitted.")
    parser.add_argument("--in-place", action="store_true", help="Rewrite the supplied files in place.")
    args = parser.parse_args()

    if not args.paths:
        sys.stdout.write(sanitize_document(sys.stdin.read()))
        return 0

    for raw_path in args.paths:
        output = sanitize_path(Path(raw_path), args.in_place)
        if output:
            sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
