"""Delete the wrong AA6288 flight (LAX->TPE doesn't exist; AA6288 is actually LAX->ELP regional)."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

# Delete by exact match
r = requests.delete(
    url + "?airline_code=eq.AA&flight_number=eq.6288&flight_date=eq.2026-12-11",
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Prefer": "return=representation",
    },
    verify=ca,
    timeout=15,
)
print("DELETE status:", r.status_code)
print("deleted:", r.json())
