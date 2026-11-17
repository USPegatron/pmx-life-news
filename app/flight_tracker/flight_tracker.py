"""PMX Flight Tracker — local daemon.

Polls Gemini (with Google Search grounding) for each upcoming flight in
`flights_to_track`, then writes status + actual times back to Supabase via
the REST API. Designed to run on a user laptop/PC — no Vercel or GitHub
Actions cost.

Usage:
    python flight_tracker.py              # run forever, check every 15 minutes
    python flight_tracker.py --once       # check once and exit (smoke test)
    python flight_tracker.py --interval 5 # check every 5 minutes
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

# Provider: OpenSky Network (free ADS-B). Swap to duckduckgo / gemini by
# editing this import + the PROVIDER_NAME constant.
from opensky_provider import query_flight_status, AIRPORT_COORDS

PROVIDER_NAME = "opensky"

# ---------------------------------------------------------------------------
# Config / env
# ---------------------------------------------------------------------------
TRACKER_DIR = Path(__file__).resolve().parent
REPO_ROOT = TRACKER_DIR.parents[1]
CRAWLER_ENV = REPO_ROOT / "app" / "crawler" / ".env"

try:
    from dotenv import load_dotenv

    if CRAWLER_ENV.exists():
        load_dotenv(CRAWLER_ENV)
except ImportError:  # pragma: no cover
    pass

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
SERVICE_KEY = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
GEMINI_KEY = (os.environ.get("GEMINI_API_KEY") or "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")

DEFAULT_POLL_INTERVAL_MIN = 15
COOLDOWN_HOURS = 3  # don't re-check the same flight more often than this
HORIZON_DAYS = 1     # only check flights whose date is within the next N days

GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent"
)


# ---------------------------------------------------------------------------
# Supabase REST helpers
# ---------------------------------------------------------------------------
def _sb_headers(extra: dict | None = None) -> dict:
    h = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def fetch_flights_to_check() -> list[dict]:
    """Return flights in the next HORIZON_DAYS that haven't been checked recently."""
    today = datetime.now(timezone.utc).date()
    horizon = (today + timedelta(days=HORIZON_DAYS)).isoformat()
    cooldown_cutoff = (
        datetime.now(timezone.utc) - timedelta(hours=COOLDOWN_HOURS)
    ).isoformat()

    url = f"{SUPABASE_URL}/rest/v1/flights_to_track"
    params = {
        "or": "(status.eq.scheduled,status.eq.departed)",
        "flight_date": f"lte.{horizon}",
        "archived_at": "is.null",
        "order": "flight_date.asc,scheduled_dep.asc",
        "limit": 100,
    }
    r = requests.get(url, headers=_sb_headers(), params=params, timeout=30)
    r.raise_for_status()
    rows = r.json() or []

    return [
        f
        for f in rows
        if not f.get("last_checked_at") or f["last_checked_at"] < cooldown_cutoff
    ]


def archive_old_arrivals() -> int:
    """Stamp archived_at on flights that arrived more than 1 hour ago.

    Run at the start of every cycle so the active view stays clean.
    """
    url = f"{SUPABASE_URL}/rest/v1/flights_to_track"
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    params = {
        "status": "eq.arrived",
        "actual_arr": f"lt.{cutoff}",
        "archived_at": "is.null",
        "select": "id,actual_arr",
        "limit": 100,
    }
    r = requests.get(url, headers=_sb_headers(), params=params, timeout=30)
    r.raise_for_status()
    rows = r.json() or []
    for row in rows:
        requests.patch(
            url,
            headers=_sb_headers({"Prefer": "return=minimal"}),
            params={"id": f"eq.{row['id']}"},
            json={"archived_at": datetime.now(timezone.utc).isoformat()},
            timeout=30,
        ).raise_for_status()
    return len(rows)


def patch_flight(flight_id: str, updates: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/flights_to_track"
    params = {"id": f"eq.{flight_id}"}
    r = requests.patch(
        url,
        headers=_sb_headers({"Prefer": "return=minimal"}),
        params=params,
        json=updates,
        timeout=30,
    )
    r.raise_for_status()


# ---------------------------------------------------------------------------
# Flight status lookup (OpenSky Network — free ADS-B, no API key, no quota)
# ---------------------------------------------------------------------------
# The query_flight_status function is imported from opensky_provider above.
# (We keep the duckduckgo-style snippet parser below commented out as a
# reference, in case you find a workaround for DDG / Bing later.)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def process_one(flight: dict, log) -> None:
    flight_id = flight["id"]
    label = (
        f"{flight.get('airline_code','')}{flight.get('flight_number','')} "
        f"{flight.get('flight_date','')} {flight.get('dep_airport','')}→"
        f"{flight.get('arr_airport','')}"
    )
    log(f"  check {label}")
    try:
        result = query_flight_status(flight)
    except Exception as exc:
        log(f"    !! flight status lookup error: {exc}")
        patch_flight(
            flight_id,
            {
                "last_checked_at": datetime.now(timezone.utc).isoformat(),
                "notes": f"AI check failed: {str(exc)[:200]}",
                "updated_by": "ai",
            },
        )
        return

    update = {
        "last_checked_at": datetime.now(timezone.utc).isoformat(),
        "updated_by": "ai",
    }
    status = result.get("status")
    if status and status != "unknown":
        update["status"] = status
    for field in ("actual_dep", "actual_arr"):
        val = result.get(field)
        if val:
            try:
                datetime.fromisoformat(val.replace("Z", "+00:00"))
                update[field] = val
            except (ValueError, AttributeError):
                pass
    delay = result.get("delay_minutes")
    if delay is not None:
        try:
            update["delay_minutes"] = int(delay)
        except (TypeError, ValueError):
            pass
    notes = (result.get("notes") or "").strip()
    if notes:
        src = (result.get("source_url") or "").strip()
        suffix = f" (src: {src})" if src else ""
        update["notes"] = (notes[:480] + suffix)[:500]

    # Auto-compute departure_delay_minutes when both scheduled_dep and actual_dep now present.
    sched_dep = update.get("scheduled_dep") or flight.get("scheduled_dep")
    act_dep = update.get("actual_dep") or flight.get("actual_dep")
    if sched_dep and act_dep and status != "cancelled":
        try:
            update["departure_delay_minutes"] = int(
                round(
                    (datetime.fromisoformat(act_dep.replace("Z", "+00:00"))
                     - datetime.fromisoformat(sched_dep.replace("Z", "+00:00"))
                    ).total_seconds() / 60
                )
            )
        except (ValueError, AttributeError):
            pass

    patch_flight(flight_id, update)
    log(
        f"    -> status={update.get('status', flight.get('status'))} "
        f"delay={update.get('delay_minutes','n/a')}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="PMX flight tracker daemon")
    parser.add_argument("--once", action="store_true", help="check once and exit")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_POLL_INTERVAL_MIN,
        help="minutes between cycles",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=0,
        help="process at most N flights this run (0 = no cap)",
    )
    args = parser.parse_args()

    for name, val in (("SUPABASE_URL", SUPABASE_URL), ("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)):
        if not val:
            print(f"!! Missing env: {name}", file=sys.stderr)
            return 1

    def log(msg: str) -> None:
        print(f"[{datetime.now().isoformat(timespec='seconds')}] {msg}", flush=True)

    log(
        f"PMX flight tracker starting (provider={PROVIDER_NAME}, "
        f"interval={args.interval} min, horizon={HORIZON_DAYS}d, cooldown={COOLDOWN_HOURS}h)"
    )

    while True:
        try:
            # Auto-archive flights that arrived more than 1 hour ago.
            try:
                archived = archive_old_arrivals()
                if archived:
                    log(f"auto-archived {archived} arrival(s) older than 1h")
            except Exception as exc:
                log(f"!! archive step error: {exc}")

            flights = fetch_flights_to_check()
            if args.max:
                flights = flights[: args.max]
            log(f"flights to check: {len(flights)}")
            for flight in flights:
                try:
                    process_one(flight, log)
                except Exception as exc:
                    log(f"  !! flight error: {exc}")
        except Exception as exc:
            log(f"!! cycle error: {exc}")

        if args.once:
            break
        time.sleep(args.interval * 60)

    return 0


if __name__ == "__main__":
    sys.exit(main())
