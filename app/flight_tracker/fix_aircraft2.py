"""Delete WN342 + fill found aircraft types."""
import os
from dotenv import load_dotenv
import requests

load_dotenv(r"D:\00_OneDrive\OneDrive - PEGATRON CORPORATION\00_PEGAAi\Project\PMX - Life News\app\crawler\.env")
SUPA = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

# 1. Delete WN342
r = requests.delete(
    f"{SUPA}/rest/v1/flights_to_track",
    params={"airline_code": "eq.WN", "flight_number": "eq.342", "flight_date": "eq.2026-11-17"},
    headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"},
    verify=ca, timeout=10)
print(f"Delete WN342: {r.status_code}")

# 2. Fill aircraft types found from API
fills = [
    ("WN", "873", "2026-11-17", "B738"),
    ("WN", "2469", "2026-11-17", "B737"),
    ("HU", "7608", "2026-11-29", "A333"),
]
for ac, fn, date, acft in fills:
    r = requests.patch(
        f"{SUPA}/rest/v1/flights_to_track",
        params={"airline_code": f"eq.{ac}", "flight_number": f"eq.{fn}", "flight_date": f"eq.{date}"},
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        json={"aircraft_type": acft},
        verify=ca, timeout=10)
    print(f"  {ac}{fn} = {acft}: {r.status_code}")
