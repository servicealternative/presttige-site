import json
import os
import urllib.parse
import urllib.request
import warnings

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL.*")
warnings.filterwarnings("ignore", message="Boto3 will no longer support Python 3.9.*")
import boto3


REGION = os.environ.get("AWS_REGION", "us-east-1")
CLIENT_ID = os.environ.get(
    "GA4_OAUTH_CLIENT_ID",
    "430778007708-uerfhfgt42k4qfbgcobb9f0cpqi6om9e.apps.googleusercontent.com",
)
CLIENT_SECRET_PARAMETER = os.environ.get(
    "GA4_OAUTH_CLIENT_SECRET_PARAMETER",
    "/ulttra/ga/oauth-client-secret",
)
REFRESH_TOKEN_PARAMETER = os.environ.get(
    "GA4_OAUTH_REFRESH_TOKEN_PARAMETER",
    "/ulttra/ga/oauth-refresh-token",
)
TOKEN_URL = "https://oauth2.googleapis.com/token"
GA4_DATA_URL = "https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport"


ssm = boto3.client("ssm", region_name=REGION)


def run_report(property_id, date_ranges=None, metrics=None, dimensions=None):
    access_token = get_access_token()
    payload = {
        "dateRanges": date_ranges or [{"startDate": "7daysAgo", "endDate": "today"}],
        "metrics": metrics or [{"name": "activeUsers"}],
    }
    if dimensions:
        payload["dimensions"] = dimensions

    request = urllib.request.Request(
        GA4_DATA_URL.format(property_id=property_id),
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def get_access_token():
    client_secret = read_secure_parameter(CLIENT_SECRET_PARAMETER)
    refresh_token = read_secure_parameter(REFRESH_TOKEN_PARAMETER)
    body = urllib.parse.urlencode(
        {
            "client_id": CLIENT_ID,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["access_token"]


def read_secure_parameter(name):
    response = ssm.get_parameter(Name=name, WithDecryption=True)
    return response["Parameter"]["Value"]
