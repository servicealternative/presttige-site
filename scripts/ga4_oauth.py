#!/usr/bin/env python3
import argparse
import html
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL.*")
warnings.filterwarnings("ignore", message="Boto3 will no longer support Python 3.9.*")
import boto3


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.lib import ga4_oauth_client


REGION = os.environ.get("AWS_REGION", "us-east-1")
CLIENT_ID = ga4_oauth_client.CLIENT_ID
CLIENT_SECRET_PARAMETER = ga4_oauth_client.CLIENT_SECRET_PARAMETER
REFRESH_TOKEN_PARAMETER = ga4_oauth_client.REFRESH_TOKEN_PARAMETER
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = ga4_oauth_client.TOKEN_URL
SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
DEFAULT_REDIRECT_HOST = "127.0.0.1"
DEFAULT_REDIRECT_PORT = 8765
DEFAULT_REDIRECT_PATH = "/oauth2callback"


ssm = boto3.client("ssm", region_name=REGION)


def main():
    parser = argparse.ArgumentParser(description="Ulttra GA4 OAuth setup and read test")
    subparsers = parser.add_subparsers(dest="command", required=True)

    authorize = subparsers.add_parser("authorize", help="Run the one-time installed-app OAuth flow")
    authorize.add_argument("--host", default=DEFAULT_REDIRECT_HOST)
    authorize.add_argument("--port", type=int, default=DEFAULT_REDIRECT_PORT)
    authorize.add_argument("--path", default=DEFAULT_REDIRECT_PATH)

    test = subparsers.add_parser("test", help="Run a minimal GA4 Data API report")
    test.add_argument("--property-id", default="530348665")

    exchange_code_command = subparsers.add_parser(
        "exchange-code",
        help="Exchange a manually copied authorization code and store the refresh token",
    )
    exchange_code_command.add_argument("--code", required=True)
    exchange_code_command.add_argument(
        "--redirect-uri",
        default=(
            f"http://{DEFAULT_REDIRECT_HOST}:{DEFAULT_REDIRECT_PORT}"
            f"{DEFAULT_REDIRECT_PATH}"
        ),
    )

    args = parser.parse_args()
    if args.command == "authorize":
        run_authorize(args.host, args.port, args.path)
    elif args.command == "test":
        run_test(args.property_id)
    elif args.command == "exchange-code":
        run_exchange_code(args.code, args.redirect_uri)


def run_authorize(host, port, path):
    client_secret = read_parameter(CLIENT_SECRET_PARAMETER)
    redirect_uri = f"http://{host}:{port}{path}"
    state = os.urandom(24).hex()
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "false",
        "state": state,
    }
    url = AUTH_URL + "?" + urllib.parse.urlencode(params)
    callback = CallbackState(expected_state=state, path=path)

    server = HTTPServer((host, port), make_handler(callback))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        print("Open this URL as alternativeservice@gmail.com:")
        print(url)
        print()
        print(f"Waiting for Google to redirect back to {redirect_uri} ...")
        while not callback.done:
            time.sleep(0.2)
    finally:
        server.shutdown()
        thread.join(timeout=3)

    if callback.error:
        raise SystemExit(f"OAuth error: {callback.error}")
    if not callback.code:
        raise SystemExit("OAuth flow ended without an authorization code")

    token_payload = exchange_code(callback.code, client_secret, redirect_uri)
    refresh_token = token_payload.get("refresh_token")
    if not refresh_token:
        raise SystemExit(
            "Google did not return a refresh token. Re-run authorize with the same command, "
            "or remove the app's prior access from the Google account and approve again."
        )

    ssm.put_parameter(
        Name=REFRESH_TOKEN_PARAMETER,
        Type="SecureString",
        Value=refresh_token,
        Overwrite=True,
    )
    print(f"Stored refresh token in SSM: {REFRESH_TOKEN_PARAMETER}")
    print("Refresh token value was not printed.")


def run_test(property_id):
    try:
        report = ga4_oauth_client.run_report(
            property_id=property_id,
            date_ranges=[{"startDate": "7daysAgo", "endDate": "today"}],
            metrics=[{"name": "activeUsers"}],
        )
    except Exception as exc:
        raise SystemExit(f"GA4 read test failed: {exc}") from exc
    rows = report.get("rows") or []
    sample = {
        "rowCount": report.get("rowCount", len(rows)),
        "metricHeaders": report.get("metricHeaders"),
        "rows": rows[:3],
    }
    print(json.dumps(sample, indent=2))


def run_exchange_code(code, redirect_uri):
    client_secret = read_parameter(CLIENT_SECRET_PARAMETER)
    token_payload = exchange_code(code, client_secret, redirect_uri)
    refresh_token = token_payload.get("refresh_token")
    if not refresh_token:
        raise SystemExit("Google did not return a refresh token for this authorization code.")
    ssm.put_parameter(
        Name=REFRESH_TOKEN_PARAMETER,
        Type="SecureString",
        Value=refresh_token,
        Overwrite=True,
    )
    print(f"Stored refresh token in SSM: {REFRESH_TOKEN_PARAMETER}")
    print("Refresh token value was not printed.")


def exchange_code(code, client_secret, redirect_uri):
    body = urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Token exchange failed: HTTP {exc.code}, {detail}") from exc


def read_parameter(name):
    try:
        response = ssm.get_parameter(Name=name, WithDecryption=True)
        return response["Parameter"]["Value"]
    except Exception as exc:
        raise SystemExit(f"Could not read SSM parameter {name}: {exc}") from exc


class CallbackState:
    def __init__(self, expected_state, path):
        self.expected_state = expected_state
        self.path = path
        self.done = False
        self.code = None
        self.error = None


def make_handler(callback):
    class OAuthCallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path != callback.path:
                self.send_response(404)
                self.end_headers()
                return

            query = urllib.parse.parse_qs(parsed.query)
            state = first(query.get("state"))
            code = first(query.get("code"))
            error = first(query.get("error"))

            if state != callback.expected_state:
                callback.error = "state_mismatch"
            elif error:
                callback.error = error
            else:
                callback.code = code

            callback.done = True
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            if callback.error:
                body = f"<p>OAuth failed: {html.escape(callback.error)}</p>"
            else:
                body = "<p>Authorization received. You can close this tab and return to Codex.</p>"
            self.wfile.write(body.encode("utf-8"))

        def log_message(self, format, *args):
            return

    return OAuthCallbackHandler


def first(values):
    return values[0] if values else None


if __name__ == "__main__":
    main()
