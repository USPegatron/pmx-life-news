"""List flights missing aircraft_type."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")
url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track?select=airline_code,flight_number,flight_date,dep_airport,arr_airport,aircraft_type,airline_name&archived_at=is.null&order=flight_date&limit=30"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

r = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15)
data = r.json()
missing = [f for f in data if not f.get("aircraft_type")]
print(f"Total active: {len(data)}, missing aircraft_type: {len(missing)}")
for f in missing:
    print(f"  {f['flight_date']} {f['airline_code']}{f['flight_number']} {f['dep_airport']}->{f['arr_airport']} airline={f.get('airline_name','?')}")
