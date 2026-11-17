"""Inspect what the FlightsView UI actually fetches."""
import os, json
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
anon = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"] or ""
ca = os.environ.get("REQUESTS_CA_BUNDLE")

# Try with the anon key (same as the WebUI uses)
r = requests.get(
    url + "?select=id,flight_date,dep_airport,arr_airport,airline_code,airline_name,aircraft_type,flight_number,status&order=flight_date.asc&limit=10",
    headers={"apikey": anon, "Authorization": f"Bearer {anon}"},
    verify=ca,
    timeout=15,
)
print("anon GET status:", r.status_code)
print(json.dumps(r.json(), indent=2, ensure_ascii=False)[:2000])
