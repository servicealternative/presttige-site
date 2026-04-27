import json
from datetime import datetime, timezone


COOKIE_NAME = "presttige_cookie_consent"
LEGACY_STORAGE_KEY = "presttige_consent_v1"
SESSION_STORAGE_KEY = "presttige_cookie_consent_session"


def parse_cookie_header(raw_cookie_header):
    parsed = {}
    if not raw_cookie_header:
        return parsed

    for part in raw_cookie_header.split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        parsed[key.strip()] = value.strip()
    return parsed


def lambda_handler(event, context):
    headers = event.get("headers") or {}
    cookie_header = headers.get("cookie") or headers.get("Cookie") or ""
    parsed_cookies = parse_cookie_header(cookie_header)

    body = {
        "ok": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "method": event.get("requestContext", {}).get("http", {}).get("method"),
        "path": event.get("rawPath") or event.get("path"),
        "host": headers.get("host") or headers.get("Host"),
        "origin": headers.get("origin") or headers.get("Origin"),
        "referer": headers.get("referer") or headers.get("Referer"),
        "user_agent": headers.get("user-agent") or headers.get("User-Agent"),
        "cookie_header": cookie_header,
        "parsed_cookies": parsed_cookies,
        "consent_cookie_present": COOKIE_NAME in parsed_cookies,
        "suggested_local_storage_probe": (
            "JSON.stringify({"
            "cookie: document.cookie,"
            f"stored: localStorage.getItem('{COOKIE_NAME}'),"
            f"legacy: localStorage.getItem('{LEGACY_STORAGE_KEY}'),"
            f"session: sessionStorage.getItem('{SESSION_STORAGE_KEY}')"
            "}, null, 2)"
        ),
    }

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "Access-Control-Allow-Origin": "https://presttige.net",
        },
        "body": json.dumps(body),
    }
