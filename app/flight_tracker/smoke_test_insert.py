"""One-off smoke: insert one test flight into Supabase via service_role REST."""
import os, json, sys
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, "crawler", ".env"))

# Read CA bundle from one of the standard env vars (set earlier in the shell),
# fall back to the known path. Also force-set both env vars so urllib3 picks them up.
ca = (
    os.environ.get("REQUESTS_CA_BUNDLE")
    or os.environ.get("SSL_CERT_FILE")
    or os.environ.get("CURL_CA_BUNDLE")
    or r"C:\Users\Jacky2_Wang\.config\opencode\skills\pega-oa-network-proxy\scripts\cacert.pem"
)
os.environ["REQUESTS_CA_BUNDLE"] = ca
os.environ["SSL_CERT_FILE"] = ca
print("CA bundle:", ca, "exists=", os.path.exists(ca), "size=", os.path.getsize(ca) if os.path.exists(ca) else "n/a")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
print("SUPABASE_URL:", url[:60], "...")
print("key len:", len(key))

today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")

payload = [
    {
        "flight_date": today,
        "dep_airport": "ELP",
        "arr_airport": "LAX",
        "airline_code": "WN",
        "flight_number": "756",
        "status": "scheduled",
        "updated_by": "import",
    },
    {
        "flight_date": tomorrow,
        "dep_airport": "ELP",
        "arr_airport": "LAX",
        "airline_code": "WN",
        "flight_number": "756",
        "status": "scheduled",
        "updated_by": "import",
    },
]

r = requests.post(
    url,
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    },
    json=payload,
    verify=ca,
    timeout=15,
)
print("INSERT status:", r.status_code)
print("INSERT body:", r.text[:1000])
print()
r2 = requests.get(
    url + "?select=id,flight_date,dep_airport,arr_airport,airline_code,flight_number,status,last_checked_at&order=flight_date.asc&limit=10",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
    verify=ca,
    timeout=15,
)
print("LIST status:", r2.status_code)
print("LIST body:", json.dumps(r2.json(), indent=2, ensure_ascii=False))
