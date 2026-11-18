"""Fill missing aircraft_type + airline_name via AviationStack."""
import os, time
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")
SUPA = os.environ["SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
AVIA_KEY = os.environ.get("AVIATIONSTACK_API_KEY", "d7b77b1b5892141bc3b613ec296fec56")
ca = os.environ.get("REQUESTS_CA_BUNDLE")

# Flights missing aircraft_type
flights = [
    ("WN", "342", "2026-11-17"),
    ("WN", "324", "2026-11-17"),
    ("WN", "873", "2026-11-17"),
    ("WN", "2469", "2026-11-17"),
    ("HU", "7925", "2026-11-29"),
    ("HU", "7608", "2026-11-29"),
    ("AM", "113", "2026-11-30"),
    ("AA", "6288", "2026-12-11"),
    ("PR", "113", "2026-12-18"),
    ("WN", "1903", "2026-12-18"),
    ("WN", "3993", "2027-01-14"),
    ("WN", "4846", "2027-01-14"),
    ("PR", "112", "2027-01-14"),
]

for ac, fn, date in flights:
    target = f"{ac}{fn}"
    try:
        r = requests.get("http://api.aviationstack.com/v1/flights",
            params={"access_key": AVIA_KEY, "airline_code": ac, "flight_number": fn, "date": date},
            verify=ca, timeout=10)
        j = r.json()
        match = None
        for f in j.get("data", []):
            if f.get("flight", {}).get("iata") == target:
                match = f
                break
        if not match:
            print(f"  {target} {date}: NOT FOUND in API")
            continue

        acft = match.get("aircraft", {}).get("iata") or None
        acft_desc = match.get("aircraft", {}).get("registration") or None
        airline_name = match.get("airline", {}).get("name") or None

        updates = {}
        if acft:
            updates["aircraft_type"] = acft
        if airline_name:
            updates["airline_name"] = airline_name

        if updates:
            # PATCH via Supabase
            pr = requests.patch(
                f"{SUPA}/rest/v1/flights_to_track",
                params={"airline_code": f"eq.{ac}", "flight_number": f"eq.{fn}", "flight_date": f"eq.{date}"},
                headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                         "Content-Type": "application/json", "Prefer": "return=minimal"},
                json=updates, verify=ca, timeout=10)
            status = "OK" if pr.status_code == 204 else f"FAIL({pr.status_code})"
            print(f"  {target} {date}: {updates} → {status}")
        else:
            print(f"  {target} {date}: no data to update")
    except Exception as e:
        print(f"  {target} {date}: ERROR {e}")
    time.sleep(1.2)  # rate limit
