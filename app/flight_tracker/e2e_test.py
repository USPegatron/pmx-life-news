"""End-to-end test: OpenSky provider + manual WebUI update flow."""
import json, os, sys
from datetime import datetime, timezone
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

URL = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CA = os.environ.get("REQUESTS_CA_BUNDLE")

def sb(method, path="", **kw):
    return requests.request(
        method,
        URL + path,
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "Prefer": "return=representation"},
        verify=CA, timeout=15, **kw,
    )

def show(rows, label):
    print(f"=== {label} ===")
    for f in rows:
        print(f"  {f['flight_date']} {f['airline_code']}{f['flight_number']} {f['dep_airport']}->{f['arr_airport']} status={f['status']} delay={f['delay_minutes']} updated_by={f['updated_by']}")
        if f.get("notes"):
            n = f["notes"][:120]
            print(f"    notes: {n}")
        if f.get("last_checked_at"):
            print(f"    last_checked_at: {f['last_checked_at']}")
    print()

# Step 1: reset
import os
print("=== STEP 1: reset both test flights ===")
sb("PATCH", "?id=in.(7baf43ed-5eb0-472e-a011-c2cca0938756,279ba33a-df8b-47a1-9e81-bea2d740fadf)",
   json={"last_checked_at": None, "notes": None, "status": "scheduled", "actual_dep": None, "actual_arr": None, "delay_minutes": None, "updated_by": "import"})
print("reset OK\n")

# Step 2: list before
rows = sb("GET", "?select=*&order=flight_date.asc").json()
show(rows, "STEP 2: BEFORE daemon run")

# Step 3: run daemon
print("=== STEP 3: run daemon --once --max 2 ===")
import subprocess
result = subprocess.run(
    ["python", "app/flight_tracker/flight_tracker.py", "--once", "--max", "2"],
    capture_output=True, text=True, timeout=120,
)
print(result.stdout)
if result.stderr:
    print("STDERR:", result.stderr)
print()

# Step 4: list after daemon
rows = sb("GET", "?select=*&order=flight_date.asc").json()
show(rows, "STEP 4: AFTER daemon run (OpenSky should leave both as 'scheduled')")

# Step 5: simulate manual WebUI update on flight A (today's WN756 -> 'arrived' with 15 min delay)
print("=== STEP 5: simulate manual WebUI PATCH on flight 7baf43ed-... (today) ===")
sb("PATCH", "?id=eq.7baf43ed-5eb0-472e-a011-c2cca0938756", json={
    "status": "arrived",
    "actual_arr": "2026-11-17T20:35:00+00:00",
    "scheduled_arr": "2026-11-17T20:20:00+00:00",
    "notes": "Manual: arrived 15 min late, gate B5",
    "updated_by": "human",
})
print("PATCH OK\n")

# Step 6: list final
rows = sb("GET", "?select=*&order=flight_date.asc").json()
show(rows, "STEP 6: AFTER manual update (flight A=arrived, flight B=scheduled)")

print("=== TEST SUMMARY ===")
arrived = [f for f in rows if f["status"] == "arrived"]
scheduled = [f for f in rows if f["status"] == "scheduled"]
print(f"  arrived  : {len(arrived)} (manual update path)")
print(f"  scheduled: {len(scheduled)} (OpenSky quiet path)")
print(f"  total    : {len(rows)}")
