"""Backfill scheduled_dep, scheduled_arr, aircraft_type from local lookup results.

Source data: lookup results from websearch (FlightAware/Flightradar24/Trip.com).
AA6288 was flagged NOT_FOUND — user may have wrong flight number. Skipping.
Times stored as full ISO 8601 with original UTC offset to preserve timezone.
"""
import os
from datetime import datetime, timezone
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

# Lookup data: keyed by (date, airline_code, flight_number)
# Times stored as ISO with original offset (e.g. -07:00 for MST).
LOOKUPS = {
    ("2026-11-17", "WN", "957"):  {"scheduled_dep": "2026-11-17T09:05:00-07:00", "scheduled_arr": "2026-11-17T10:15:00-07:00", "aircraft_type": "B738"},
    ("2026-11-17", "WN", "2915"): {"scheduled_dep": "2026-11-17T07:30:00-08:00", "scheduled_arr": "2026-11-17T10:25:00-07:00", "aircraft_type": "B738"},
    ("2026-11-17", "BR", "12"):   {"scheduled_dep": "2026-11-17T19:40:00+08:00", "scheduled_arr": "2026-11-18T15:20:00-08:00", "aircraft_type": "B773"},
    ("2026-11-17", "BR", "16"):   {"scheduled_dep": "2026-11-17T23:55:00+08:00", "scheduled_arr": "2026-11-18T19:35:00-08:00", "aircraft_type": "B77W"},
    ("2026-11-17", "BR", "5"):    {"scheduled_dep": "2026-11-17T10:40:00-08:00", "scheduled_arr": "2026-11-18T17:20:00+08:00", "aircraft_type": "B77W"},
    ("2026-11-17", "BR", "11"):   {"scheduled_dep": "2026-11-17T22:35:00-08:00", "scheduled_arr": "2026-11-18T05:15:00+08:00", "aircraft_type": "B77W"},
    ("2026-11-17", "BR", "15"):   {"scheduled_dep": "2026-11-17T23:00:00-08:00", "scheduled_arr": "2026-11-18T05:40:00+08:00", "aircraft_type": "B77W"},
    ("2026-11-27", "AA", "6427"): {"scheduled_dep": "2026-11-27T06:00:00-07:00", "scheduled_arr": "2026-11-27T07:23:00-08:00", "aircraft_type": "CRJ7"},
    ("2026-11-27", "BR", "5"):    {"scheduled_dep": "2026-11-27T10:40:00-08:00", "scheduled_arr": "2026-11-28T17:20:00+08:00", "aircraft_type": "B77W"},
    ("2026-12-11", "BR", "12"):   {"scheduled_dep": "2026-12-11T19:40:00+08:00", "scheduled_arr": "2026-12-12T15:20:00-08:00", "aircraft_type": "B773"},
    # AA6288 2026-12-11 LAX->TPE: NOT FOUND (likely wrong flight number; AA6288 is LAX->ELP regional). Skipped.
}

# Fetch all flights
r = requests.get(
    url + "?select=id,flight_date,airline_code,flight_number",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
    verify=ca, timeout=15,
)
flights = r.json()
print(f"Found {len(flights)} flights in DB")

updated = 0
skipped = 0
for f in flights:
    key_t = (f["flight_date"], f["airline_code"], f["flight_number"])
    info = LOOKUPS.get(key_t)
    if not info:
        skipped += 1
        print(f"  skip {f['id'][:8]}.. {key_t[0]} {key_t[1]}{key_t[2]} — no lookup data")
        continue
    pr = requests.patch(
        url + f"?id=eq.{f['id']}",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json=info,
        verify=ca, timeout=15,
    )
    if pr.ok:
        updated += 1
        print(f"  ✓ {f['id'][:8]}.. {key_t[0]} {key_t[1]}{key_t[2]} -> {info['aircraft_type']} {info['scheduled_dep']} -> {info['scheduled_arr']}")
    else:
        print(f"  ✗ {f['id'][:8]}.. {pr.status_code} {pr.text[:120]}")

print(f"\nUpdated {updated}, skipped {skipped}")
