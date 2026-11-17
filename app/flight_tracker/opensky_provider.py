"""OpenSky Network provider for PMX flight tracker.

OpenSky Network is a free, open-source ADS-B aggregator. The free REST API
(https://opensky-network.org/api/states/all) returns real-time state vectors
for aircraft near any bbox — no API key, no quota. We use it to infer
flight status by checking aircraft proximity to the scheduled departure
and arrival airports.

Limitations:
- No ICAO24 (aircraft registration) -> flight-number mapping, so we cannot
  distinguish "our flight" from any other aircraft in the bbox. For small
  airports (e.g. ELP) this is mostly OK; for major hubs (LAX) noise is high.
- Cannot compute delay minutes from this signal alone.
"""

from __future__ import annotations

import re
from typing import Iterable

import requests

OPENSKY_STATES_URL = "https://opensky-network.org/api/states/all"

# lat, lon for common PMX-relevant airports
AIRPORT_COORDS: dict[str, tuple[float, float]] = {
    # US / Mexico border + common corporate travel
    "ELP": (31.8067, -106.3776),   # El Paso Intl
    "CJS": (31.6361, -106.4286),   # Ciudad Juárez Intl (Abraham González)
    "LAX": (33.9425, -118.4081),   # Los Angeles Intl
    "PHX": (33.4373, -112.0078),   # Phoenix Sky Harbor
    "LAS": (36.0840, -115.1537),   # Las Vegas Harry Reid
    "DEN": (39.8561, -104.6737),   # Denver Intl
    "ORD": (41.9742, -87.9073),    # Chicago O'Hare
    "ATL": (33.6407, -84.4277),    # Atlanta Hartsfield
    "DFW": (32.8998, -97.0403),    # Dallas/Fort Worth
    "SFO": (37.6213, -122.3790),   # San Francisco Intl
    "SEA": (47.4502, -122.3088),   # Seattle-Tacoma
    "JFK": (40.6413, -73.7781),    # New York JFK
    "EWR": (40.6895, -74.1745),    # Newark
    "IAH": (29.9844, -95.3414),    # Houston Intercontinental
    "MIA": (25.7959, -80.2870),    # Miami Intl
    "MEX": (19.4361, -99.0719),    # Mexico City Benito Juárez
    "TIJ": (32.5410, -116.9700),   # Tijuana
    "GDL": (20.5218, -103.3111),   # Guadalajara
    "MTY": (25.7785, -100.1075),   # Monterrey
    # Asia (PMX corporate travel)
    "TPE": (25.0777, 121.2328),    # Taipei Taoyuan
    "TSA": (25.0797, 121.2342),    # Taipei Songshan
    "HKG": (22.3080, 113.9185),    # Hong Kong
    "NRT": (35.7720, 140.3929),    # Tokyo Narita
    "ICN": (37.4602, 126.4407),    # Seoul Incheon
    "PVG": (31.1443, 121.8083),    # Shanghai Pudong
    "PEK": (40.0801, 116.5846),    # Beijing Capital
    "SIN": (1.3644, 103.9915),     # Singapore Changi
    "BKK": (13.6900, 100.7501),    # Bangkok Suvarnabhumi
    "KUL": (2.7456, 101.7099),     # Kuala Lumpur
    "DEL": (28.5562, 77.1000),     # Delhi Indira Gandhi
    "BOM": (19.0896, 72.8656),     # Mumbai
}

ON_GROUND_IDX = 8
VELOCITY_IDX = 9
CALLSIGN_IDX = 1


def _bbox(lat: float, lon: float, deg: float = 0.4) -> tuple[float, float, float, float]:
    """Return (lamin, lomin, lamax, lomax) around (lat, lon) by ±deg."""
    return (lat - deg, lon - deg, lat + deg, lon + deg)


def get_aircraft_near(airport_code: str, deg: float = 0.4) -> list[list]:
    """Return OpenSky state vectors near `airport_code` within ±deg lat/lon.

    Returns an empty list if the airport is unknown or the request fails.
    """
    if airport_code not in AIRPORT_COORDS:
        return []
    lat, lon = AIRPORT_COORDS[airport_code]
    lamin, lomin, lamax, lomax = _bbox(lat, lon, deg)
    try:
        r = requests.get(
            OPENSKY_STATES_URL,
            params={"lamin": lamin, "lomin": lomin, "lamax": lamax, "lomax": lomax},
            timeout=20,
        )
        r.raise_for_status()
        return r.json().get("states") or []
    except Exception:
        return []


def query_flight_status(flight: dict, deg: float = 0.4) -> dict:
    """Infer flight status from aircraft proximity to dep/arr airports.

    Heuristic (best effort, given OpenSky's no-ICAO24-map limitation):
      - status = "arrived"  if aircraft on-ground near arrival airport
      - status = "departed" if aircraft NOT on-ground near departure airport AND
                              aircraft on-ground near arrival airport
                              (rough "in the air between" signal)
      - otherwise status = "scheduled" (no signal)

    Returns the same shape as the DuckDuckGo provider so the daemon code
    is unchanged.
    """
    airline = (flight.get("airline_code") or "").strip().upper()
    number = (flight.get("flight_number") or "").strip()
    dep = (flight.get("dep_airport") or "").strip().upper()
    arr = (flight.get("arr_airport") or "").strip().upper()
    ident = f"{airline}{number}"

    if dep not in AIRPORT_COORDS or arr not in AIRPORT_COORDS:
        return {
            "status": "unknown",
            "actual_dep": None,
            "actual_arr": None,
            "delay_minutes": None,
            "notes": f"airport {dep if dep not in AIRPORT_COORDS else arr} not in lookup",
            "source_url": "https://opensky-network.org/",
        }

    dep_aircraft = get_aircraft_near(dep, deg=deg)
    arr_aircraft = get_aircraft_near(arr, deg=deg)

    dep_on_ground = [a for a in dep_aircraft if len(a) > ON_GROUND_IDX and a[ON_GROUND_IDX]]
    dep_airborne = [a for a in dep_aircraft if len(a) > ON_GROUND_IDX and not a[ON_GROUND_IDX]]
    arr_on_ground = [a for a in arr_aircraft if len(a) > ON_GROUND_IDX and a[ON_GROUND_IDX]]
    arr_airborne = [a for a in arr_aircraft if len(a) > ON_GROUND_IDX and not a[ON_GROUND_IDX]]

    # Callsign matching: only trust non-scheduled statuses if we find an
    # aircraft broadcasting this flight's callsign (e.g. "WN756" or "SWA756").
    callsigns_re = re.compile(rf"\b(?:{re.escape(airline)}{re.escape(number)}|{re.escape(ident)})\b", re.IGNORECASE)
    matched = []
    for a in dep_aircraft + arr_aircraft:
        cs = (a[CALLSIGN_IDX] if len(a) > CALLSIGN_IDX else "") or ""
        if cs and callsigns_re.search(cs.strip()):
            matched.append(a)

    matched_dep = [a for a in matched if a in dep_aircraft]
    matched_arr = [a for a in matched if a in arr_aircraft]
    matched_dep_airborne = [a for a in matched_dep if len(a) > ON_GROUND_IDX and not a[ON_GROUND_IDX]]
    matched_arr_airborne = [a for a in matched_arr if len(a) > ON_GROUND_IDX and not a[ON_GROUND_IDX]]
    matched_arr_ground = [a for a in matched_arr if len(a) > ON_GROUND_IDX and a[ON_GROUND_IDX]]
    matched_dep_ground = [a for a in matched_dep if len(a) > ON_GROUND_IDX and a[ON_GROUND_IDX]]

    status = "scheduled"  # default; require callsign match to change
    if matched_arr_ground and not matched_dep_airborne:
        # Our flight is on the ground at arrival and not airborne near departure
        status = "arrived"
    elif matched_dep_airborne:
        # Our flight is airborne near departure (and not already at arrival ground)
        status = "departed"
    elif matched_arr_airborne and matched_dep_ground:
        # In transit
        status = "departed"

    notes = (
        f"ident={ident} | dep({dep}): on-ground={len(dep_on_ground)} "
        f"airborne={len(dep_airborne)} | arr({arr}): on-ground={len(arr_on_ground)} "
        f"airborne={len(arr_airborne)} | matched={len(matched)} (dep={len(matched_dep)},arr={len(matched_arr)})"
    )

    return {
        "status": status,
        "actual_dep": None,
        "actual_arr": None,
        "delay_minutes": None,
        "notes": notes,
        "source_url": "https://opensky-network.org/",
    }
