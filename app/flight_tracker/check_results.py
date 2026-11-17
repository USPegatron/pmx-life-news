"""Check what the tracker wrote to DB."""
import os, json, sys
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track?select=id,flight_date,status,delay_minutes,last_checked_at,notes,updated_by&order=flight_date.asc"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

r = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15)
data = r.json()
for f in data:
    print(f"== {f['flight_date']} {f['status']:>10} delay={f['delay_minutes']} by={f['updated_by']} ==")
    print("  notes :", (f.get("notes") or "")[:400])
    print("  chkd  :", f.get("last_checked_at"))
    print()
