"""One-off: backfill actual_dep/actual_arr for flights that should have already departed/arrived."""
import os
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv("app/crawler/.env")
url = os.environ["SUPABASE_URL"].rstrip("/")
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Get all non-archived flights
r = requests.get(
    f"{url}/rest/v1/flights_to_track?select=*&archived_at=is.null&order=flight_date,scheduled_dep",
    headers=headers, verify=ca, timeout=15,
)
flights = r.json()
now = datetime.now(timezone.utc)
print(f"Current UTC: {now.isoformat()}")
print(f"Total active flights: {len(flights)}")
print()

updates = []
for f in flights:
    dep = f.get("scheduled_dep")
    arr = f.get("scheduled_arr")
    if not dep:
        continue
    dep_dt = datetime.fromisoformat(dep)
    arr_dt = datetime.fromisoformat(arr) if arr else None
    label = f"{f['airline_code']}{f['flight_number']} {f['dep_airport']}->{f['arr_airport']} {f['flight_date']}"

    if f.get("actual_dep"):
        print(f"  SKIP {label} (already has actual_dep)")
        continue

    if now >= dep_dt:
        arrived = arr_dt is not None and now >= arr_dt
        updates.append({
            "id": f["id"],
            "actual_dep": dep,
            "actual_arr": arr if arrived else None,
            "status": "arrived" if arrived else "departed",
        })
        status_str = "arrived" if arrived else "in-transit"
        print(f"  SET  {label} dep={dep} -> {status_str}")
    else:
        print(f"  WAIT {label} (dep={dep} not yet)")

print(f"\nTotal to update: {len(updates)}")
if updates:
    for u in updates:
        payload = {k: v for k, v in u.items() if k != "id"}
        r = requests.patch(
            f"{url}/rest/v1/flights_to_track?id=eq.{u['id']}",
            json=payload, headers=headers, verify=ca, timeout=15,
        )
        print(f"  PATCH {u['id']}: {r.status_code}")
    print("Done.")
