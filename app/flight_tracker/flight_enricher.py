"""Export flights needing enrichment as a JSON request file.

Output: app/flight_tracker/enrich_request_<ts>.json

Workflow:
  1. Run this script daily (or when new flights uploaded)
  2. Open the resulting JSON in your OpenCode session
  3. Use websearch to look up each flight's:
       dep_airport, arr_airport, airline_name, aircraft_type,
       scheduled_dep, scheduled_arr
  4. OpenCode writes the filled result to enrich_result_<ts>.json
  5. Run apply_enrichment.py enrich_result_<ts>.json to PATCH into Supabase
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

URL = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CA = os.environ.get("REQUESTS_CA_BUNDLE")

# Fetch flights with any missing fields
select = (
    "id,flight_date,airline_code,flight_number,"
    "dep_airport,arr_airport,airline_name,aircraft_type,"
    "scheduled_dep,scheduled_arr,archived_at"
)
r = requests.get(
    URL + f"?select={select}&archived_at=is.null&order=flight_date.asc&limit=200",
    headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"},
    verify=CA, timeout=30,
)
r.raise_for_status()
all_flights = r.json()

def needs_enrichment(f):
    return not all([
        f.get("dep_airport"),
        f.get("arr_airport"),
        f.get("airline_name"),
        f.get("aircraft_type"),
        f.get("scheduled_dep"),
        f.get("scheduled_arr"),
    ])

pending = [f for f in all_flights if needs_enrichment(f)]

ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
out = Path(__file__).parent / f"enrich_request_{ts}.json"

payload = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "instructions": (
        "For each flight, use websearch to look up: "
        "dep_airport, arr_airport (IATA), airline_name, aircraft_type, "
        "scheduled_dep (ISO with original offset), scheduled_arr (ISO with original offset). "
        "Save the result JSON to enrich_result_<ts>.json (same filename prefix), "
        "then run apply_enrichment.py."
    ),
    "flights": [
        {
            "id": f["id"],
            "flight_date": f["flight_date"],
            "airline_code": f["airline_code"],
            "flight_number": f["flight_number"],
            "current": {
                "dep_airport": f.get("dep_airport"),
                "arr_airport": f.get("arr_airport"),
                "airline_name": f.get("airline_name"),
                "aircraft_type": f.get("aircraft_type"),
                "scheduled_dep": f.get("scheduled_dep"),
                "scheduled_arr": f.get("scheduled_arr"),
            },
            "fields_to_fill": [
                k for k, v in {
                    "dep_airport": f.get("dep_airport"),
                    "arr_airport": f.get("arr_airport"),
                    "airline_name": f.get("airline_name"),
                    "aircraft_type": f.get("aircraft_type"),
                    "scheduled_dep": f.get("scheduled_dep"),
                    "scheduled_arr": f.get("scheduled_arr"),
                }.items() if not v
            ],
        }
        for f in pending
    ],
}

out.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Exported {len(pending)} flights needing enrichment → {out}")
if not pending:
    print("(All flights already enriched.)")
