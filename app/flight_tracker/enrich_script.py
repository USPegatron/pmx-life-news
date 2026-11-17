"""List current flights in DB for enrichment."""
import os, json
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track?select=id,flight_date,dep_airport,arr_airport,airline_code,flight_number,airline_name,aircraft_type,scheduled_dep,scheduled_arr&order=flight_date.asc"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

r = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15)
data = r.json()
print(f"Total flights: {len(data)}\n")
for f in data:
    print(f"id={f['id'][:8]}.. {f['flight_date']} {f['airline_code']}{f['flight_number']} {f['dep_airport']}->{f['arr_airport']} airline={f.get('airline_name')} aircraft={f.get('aircraft_type')} sched_dep={f.get('scheduled_dep')} sched_arr={f.get('scheduled_arr')}")
