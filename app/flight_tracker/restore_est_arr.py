"""Restore estimated actual_arr for BR12 & BR16."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")
url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

fixes = [
    ("12", "2026-11-17", "2026-11-17T23:23:00+00:00"),
    ("16", "2026-11-17", "2026-11-18T03:34:00+00:00"),
]
for fn, fdate, arr_val in fixes:
    r = requests.get(
        url + f"?select=id&airline_code=eq.BR&flight_number=eq.{fn}&flight_date=eq.{fdate}",
        headers=headers, verify=ca, timeout=15
    )
    for f in r.json():
        patch_r = requests.patch(
            f"{url}?id=eq.{f['id']}",
            headers=headers, json={"actual_arr": arr_val}, verify=ca, timeout=15
        )
        print(f"BR{fn}: actual_arr -> {arr_val} ({patch_r.status_code})")
