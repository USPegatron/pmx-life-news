"""E2E test: insert test flight, call /api/flights/check-now, verify, delete."""
import os, json, requests
from datetime import datetime, timezone
from dotenv import load_dotenv
import urllib.request, urllib.error

load_dotenv("app/crawler/.env")
url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

# 1. Insert 1 test flight
payload = [{
    "flight_date": today,
    "dep_airport": "ELP",
    "arr_airport": "LAX",
    "airline_code": "WN",
    "flight_number": "756",
    "status": "scheduled",
    "updated_by": "test",
}]
r = requests.post(url,
    headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"},
    json=payload, verify=ca, timeout=15)
print(f"INSERT: HTTP {r.status_code}")

# 2. List BEFORE
r2 = requests.get(url + "?select=id,flight_date,airline_code,flight_number,status,last_checked_at,aircraft_type,notes,updated_by&order=flight_date.asc",
    headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15)
print("BEFORE:")
for f in r2.json():
    print(f"  {f['airline_code']}{f['flight_number']} {f['flight_date']} status={f['status']} chkd={f.get('last_checked_at')} type={f.get('aircraft_type')}")

# 3. Call the Vercel API endpoint
print("\nCalling POST https://pmx-life-news.vercel.app/api/flights/check-now (max=3)...")
api_resp = requests.post("https://pmx-life-news.vercel.app/api/flights/check-now",
    json={"max": 3}, verify=ca, timeout=60)
print(f"  HTTP {api_resp.status_code}: {api_resp.text[:300]}")

# 4. List AFTER
r3 = requests.get(url + "?select=id,flight_date,airline_code,flight_number,status,last_checked_at,aircraft_type,notes,updated_by&order=flight_date.asc",
    headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15)
print("\nAFTER:")
for f in r3.json():
    print(f"  {f['airline_code']}{f['flight_number']} {f['flight_date']} status={f['status']} chkd={f.get('last_checked_at')} type={f.get('aircraft_type')} updated_by={f['updated_by']}")
    print(f"    notes: {(f.get('notes') or '')[:200]}")

# 5. Cleanup: delete the test flight
print("\nCleaning up...")
r4 = requests.delete(url + f"?airline_code=eq.WN&flight_number=eq.756&flight_date=eq.{today}",
    headers={"apikey": key, "Authorization": f"Bearer {key}", "Prefer": "return=minimal"},
    verify=ca, timeout=15)
print(f"  DELETE: HTTP {r4.status_code}")
