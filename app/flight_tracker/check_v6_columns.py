"""Verify the v6 columns exist on flights_to_track."""
import os, json
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

r = requests.get(
    url + "?select=airline_name,aircraft_type,departure_delay_minutes,archived_at&limit=1",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
    verify=ca,
    timeout=15,
)
print("SELECT v6-columns status:", r.status_code)
print("body:", r.text[:300])

# Also try POST a row that uses them (will fail 400 if columns missing, 201 if they exist)
test_body = {
    "flight_date": "2026-11-16",
    "dep_airport": "X",
    "arr_airport": "X",
    "airline_code": "XX",
    "flight_number": "9999",
    "status": "scheduled",
    "updated_by": "test",
    "airline_name": "Test Air",
    "aircraft_type": "TestCraft 737",
    "departure_delay_minutes": 0,
    "archived_at": None,
}
r2 = requests.post(
    url,
    headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"},
    json=test_body,
    verify=ca,
    timeout=15,
)
print("INSERT v6-columns status:", r2.status_code)
print("body:", r2.text[:400])
if r2.status_code == 201:
    requests.delete(
        url + "?airline_code=eq.XX&flight_number=eq.9999",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        verify=ca,
        timeout=15,
    )
    print("cleanup OK")
