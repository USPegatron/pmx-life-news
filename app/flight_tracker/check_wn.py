import os
from dotenv import load_dotenv
import requests
load_dotenv("app/crawler/.env")
url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
r = requests.get(
    f"{url}/rest/v1/flights_to_track?select=airline_code,flight_number,dep_airport,arr_airport,scheduled_dep,scheduled_arr&updated_by=eq.import&flight_date=eq.2026-11-17&order=airline_code,flight_number",
    headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15
)
for f in r.json():
    print(f"  {f['airline_code']}{f['flight_number']} {f['dep_airport']}->{f['arr_airport']}  dep={f['scheduled_dep']}  arr={f['scheduled_arr']}")
