"""Read an enrichment result JSON (output from OpenCode websearch) and PATCH into Supabase.

Usage: python apply_enrichment.py enrich_result_<ts>.json

Expected JSON shape (per flight):
{
  "id": "<flight uuid>",
  "results": {
    "dep_airport": "PHX",
    "arr_airport": "ELP",
    "airline_name": "Southwest Airlines",
    "aircraft_type": "Boeing 737-800",
    "scheduled_dep": "2026-11-17T09:05:00-07:00",
    "scheduled_arr": "2026-11-17T10:15:00-07:00"
  }
}

Only fields with non-null values are PATCHed (so you can fill just some).
"""
import json
import sys
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

URL = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
CA = os.environ.get("REQUESTS_CA_BUNDLE")

if len(sys.argv) < 2:
    print("Usage: python apply_enrichment.py <enrich_result.json>")
    sys.exit(1)

src = Path(sys.argv[1])
data = json.loads(src.read_text(encoding="utf-8"))

flights = data.get("flights") or []
print(f"Applying enrichment to {len(flights)} flights...")

success = 0
errors = 0
for entry in flights:
    fid = entry.get("id")
    results = entry.get("results") or {}
    if not fid or not results:
        continue
    patch = {k: v for k, v in results.items() if v}
    if not patch:
        print(f"  skip {fid[:8]}.. (no values)")
        continue
    r = requests.patch(
        URL + f"?id=eq.{fid}",
        headers={
            "apikey": KEY,
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
        },
        json=patch,
        verify=CA,
        timeout=30,
    )
    if r.ok:
        success += 1
        fields = ", ".join(patch.keys())
        print(f"  ✓ {fid[:8]}.. [{fields}]")
    else:
        errors += 1
        print(f"  ✗ {fid[:8]}.. {r.status_code} {r.text[:120]}")

print(f"\nDone. Success: {success}, Errors: {errors}")
