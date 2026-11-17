"""Fill airline_name for all flights from IATA code mapping."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

# Same IATA->name map as app/webui/src/lib/utils.ts AIRLINE_NAMES (subset for PMX flights)
AIRLINE_NAMES = {
    "WN": "Southwest Airlines",
    "BR": "EVA Air",
    "AA": "American Airlines",
}

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

r = requests.get(
    url + "?select=id,airline_code,airline_name",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
    verify=ca,
    timeout=15,
)
flights = r.json()
print(f"Found {len(flights)} flights")
updated = 0
for f in flights:
    code = (f.get("airline_code") or "").strip().upper()
    name = AIRLINE_NAMES.get(code)
    if not name:
        print(f"  skip {f['id'][:8]}.. ({code}) — unknown IATA")
        continue
    if f.get("airline_name") == name:
        continue
    pr = requests.patch(
        url + f"?id=eq.{f['id']}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        json={"airline_name": name},
        verify=ca,
        timeout=15,
    )
    if pr.ok:
        updated += 1
        print(f"  ✓ {f['id'][:8]}.. {code} -> {name}")
    else:
        print(f"  ✗ {f['id'][:8]}.. {pr.status_code} {pr.text[:120]}")

print(f"\nUpdated {updated} flights")
