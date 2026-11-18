"""Fix flights whose scheduled_dep/arr were stored as local time (no offset)
by AviationStack enrichment. The stored value is 'local time treated as UTC',
so we need to add back the airport's UTC offset to get the true UTC instant.

E.g. WN2469 ELP: stored 16:20 UTC, should be 23:20 UTC (16:20 MST + 7h).
"""
import os
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

# Airport IANA tz → UTC offset for November 2026 (standard time)
# offset_hours is how much to ADD to the stored (wrong) UTC value
AIRPORT_OFFSET_HOURS = {
    "ELP": 7,    # MST = UTC-7 → add 7h
    "LAX": 8,    # PST = UTC-8 → add 8h
    "PHX": 7,    # MST (no DST) = UTC-7 → add 7h
    "DAL": 6,    # CST = UTC-6 → add 6h
    "LAS": 8,    # PST = UTC-8 → add 8h
    "DEN": 7,    # MST = UTC-7 → add 7h
    "TPE": -8,   # CST = UTC+8 → subtract 8h
    "SEA": 8,    # PST = UTC-8 → add 8h
    "SFO": 8,    # PST = UTC-8 → add 8h
    "ORD": 5,    # CST = UTC-5 → add 5h
}

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Find all flights that were enriched by AviationStack (import source, Nov 17)
r = requests.get(
    f"{url}/rest/v1/flights_to_track?select=id,airline_code,flight_number,dep_airport,arr_airport,scheduled_dep,scheduled_arr,updated_by&updated_by=eq.import&order=flight_date",
    headers=headers, verify=ca, timeout=15
)
flights = r.json()
print(f"Found {len(flights)} imported flights")

fixed = 0
for f in flights:
    if not f["scheduled_dep"]:
        continue
    
    dep_hours = AIRPORT_OFFSET_HOURS.get(f["dep_airport"], 0)
    arr_hours = AIRPORT_OFFSET_HOURS.get(f["arr_airport"], 0)
    
    if dep_hours == 0 and arr_hours == 0:
        continue
    
    update = {}
    
    # Fix scheduled_dep
    if f["scheduled_dep"] and dep_hours != 0:
        dt = datetime.fromisoformat(f["scheduled_dep"].replace("Z", "+00:00"))
        corrected = dt + timedelta(hours=dep_hours)
        update["scheduled_dep"] = corrected.isoformat().replace("+00:00", "Z")
    
    # Fix scheduled_arr
    if f["scheduled_arr"] and arr_hours != 0:
        dt = datetime.fromisoformat(f["scheduled_arr"].replace("Z", "+00:00"))
        corrected = dt + timedelta(hours=arr_hours)
        update["scheduled_arr"] = corrected.isoformat().replace("+00:00", "Z")
    
    if update:
        old_dep = f["scheduled_dep"]
        old_arr = f["scheduled_arr"]
        new_dep = update.get("scheduled_dep", old_dep)
        new_arr = update.get("scheduled_arr", old_arr)
        print(f"  {f['airline_code']}{f['flight_number']} {f['dep_airport']}->{f['arr_airport']}:")
        print(f"    dep: {old_dep} -> {new_dep}")
        print(f"    arr: {old_arr} -> {new_arr}")
        
        resp = requests.patch(
            f"{url}/rest/v1/flights_to_track?id=eq.{f['id']}",
            headers=headers, json=update, verify=ca, timeout=10
        )
        if resp.ok:
            fixed += 1
        else:
            print(f"    ERROR: {resp.status_code} {resp.text[:100]}")

print(f"\nFixed {fixed} flights")
