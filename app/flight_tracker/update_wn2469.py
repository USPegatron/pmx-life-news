"""Enrich WN2469 ELP->DAL with scheduled times."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")
url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}

patch = {
    "scheduled_dep": "2026-11-17T16:20:00-07:00",
    "scheduled_arr": "2026-11-17T19:00:00-06:00",
    "airline_name": "Southwest Airlines",
    "aircraft_type": "B737",
}

r = requests.patch(
    url + "?airline_code=eq.WN&flight_number=eq.2469&flight_date=eq.2026-11-17",
    headers=headers, json=patch, verify=ca, timeout=15,
)
print(f"PATCH {r.status_code}: {r.text[:200]}")
