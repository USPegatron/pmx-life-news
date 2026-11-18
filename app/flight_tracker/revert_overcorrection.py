"""Revert the over-correction: my fix script added offsets to ALL imported flights,
but BR flights were ALREADY correct UTC. Revert by subtracting the offset back.
Then re-apply ONLY to the 4 WN flights that were truly wrong (AviationStack local-as-UTC).
"""
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Flights that were ALREADY correct (manually enriched) — REVERT my fix on these
# airport → offset I added (need to subtract to revert)
REVERT = {
    # (airline, flight#, flight_date) → (dep_offset_hours, arr_offset_hours)
    ("BR", "12", "2026-11-17"): (-8, 8),    # TPE(-8), LAX(+8)
    ("BR", "16", "2026-11-17"): (-8, 8),
    ("BR", "11", "2026-11-17"): (8, -8),    # LAX(+8), TPE(-8)
    ("BR", "15", "2026-11-17"): (8, -8),
    ("BR", "5",  "2026-11-17"): (8, -8),
    ("BR", "5",  "2026-11-27"): (8, -8),
    ("BR", "12", "2026-12-11"): (-8, 8),
    ("AA", "6427", "2026-11-27"): (7, 8),   # ELP(+7), LAX(+8)
    ("AA", "6288", "2026-12-12"): (8, 7),   # LAX(+8), ELP(+7)
    ("WN", "1903", "2026-12-18"): (7, 8),   # ELP(+7), LAX(+8)
    ("PR", "113", "2026-12-18"): (8, 0),    # LAX(+8), MNL(0 - not in map, no arr change)
    ("WN", "3993", "2027-01-14"): (8, 7),   # LAX(+8), ELP(+7)
    ("WN", "4846", "2027-01-14"): (8, 7),
    ("PR", "112", "2027-01-14"): (0, 8),    # MNL(0), LAX(+8)
}

# The 4 WN flights that were TRULY wrong (AviationStack local-as-UTC) — KEEP my fix
KEEP_FIXED = {
    ("WN", "2469", "2026-11-17"),
    ("WN", "873",  "2026-11-17"),
    ("WN", "324",  "2026-11-17"),
    ("WN", "342",  "2026-11-17"),
}

def shift_iso(iso: str, hours: int) -> str:
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    return (dt + timedelta(hours=hours)).isoformat().replace("+00:00", "Z")

r = requests.get(
    f"{url}/rest/v1/flights_to_track?select=id,airline_code,flight_number,flight_date,scheduled_dep,scheduled_arr&updated_by=eq.import&order=flight_date",
    headers=headers, verify=ca, timeout=15
)
flights = r.json()

reverted = 0
for f in flights:
    key_tuple = (f["airline_code"], f["flight_number"], f["flight_date"])
    
    if key_tuple in KEEP_FIXED:
        print(f"  KEEP  {f['airline_code']}{f['flight_number']} {f['flight_date']} (AviationStack fix is correct)")
        continue
    
    if key_tuple not in REVERT:
        print(f"  SKIP  {f['airline_code']}{f['flight_number']} {f['flight_date']} (not in revert list)")
        continue
    
    dep_off, arr_off = REVERT[key_tuple]
    update = {}
    
    if f["scheduled_dep"] and dep_off != 0:
        update["scheduled_dep"] = shift_iso(f["scheduled_dep"], -dep_off)
    if f["scheduled_arr"] and arr_off != 0:
        update["scheduled_arr"] = shift_iso(f["scheduled_arr"], -arr_off)
    
    if update:
        print(f"  REVERT {f['airline_code']}{f['flight_number']} {f['flight_date']}: {update}")
        resp = requests.patch(
            f"{url}/rest/v1/flights_to_track?id=eq.{f['id']}",
            headers=headers, json=update, verify=ca, timeout=10
        )
        if resp.ok:
            reverted += 1
        else:
            print(f"    ERROR: {resp.status_code}")

print(f"\nReverted {reverted} flights")
