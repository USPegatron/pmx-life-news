"""Fix BR12 arrival date: Nov 18 -> Nov 17 (15:20 PST = 23:20 UTC same day)."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Find BR12 Nov 17 flights with wrong arrival date
r = requests.get(
    url + "?select=id,scheduled_arr,actual_arr&airline_code=eq.BR&flight_number=eq.12&flight_date=eq.2026-11-17",
    headers=headers, verify=ca, timeout=15
)
flights = r.json()
print(f"Found {len(flights)} BR12 Nov17 flights")

for f in flights:
    print(f"  id={f['id']} sched_arr={f['scheduled_arr']} actual_arr={f['actual_arr']}")
    # Fix: Nov 18 -> Nov 17 for both
    new_sched = f["scheduled_arr"].replace("2026-11-18", "2026-11-17") if f["scheduled_arr"] else None
    new_actual = f["actual_arr"].replace("2026-11-18", "2026-11-17") if f["actual_arr"] else None
    print(f"    -> sched_arr={new_sched} actual_arr={new_actual}")
    
    payload = {}
    if new_sched:
        payload["scheduled_arr"] = new_sched
    if new_actual:
        payload["actual_arr"] = new_actual
    
    if payload:
        patch_r = requests.patch(
            f"{url}?id=eq.{f['id']}",
            headers=headers, json=payload, verify=ca, timeout=15
        )
        print(f"    PATCH status: {patch_r.status_code} {patch_r.text[:100]}")
