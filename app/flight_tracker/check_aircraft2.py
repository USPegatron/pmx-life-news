"""Check aircraft info for specific flights via AviationStack."""
import os, json, time
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")
ca = os.environ.get("REQUESTS_CA_BUNDLE")
KEY = "d7b77b1b5892141bc3b613ec296fec56"

checks = [
    ("WN", "342", "2026-11-17", "ELP", "LAS"),
    ("WN", "873", "2026-11-17", "ELP", "PHX"),
    ("WN", "2469", "2026-11-17", "ELP", "DAL"),
    ("HU", "7925", "2026-11-29", "PEK", "MEX"),
    ("HU", "7608", "2026-11-29", "SHA", "PEK"),
]

for ac, fn, date, want_dep, want_arr in checks:
    target = f"{ac}{fn}"
    r = requests.get("http://api.aviationstack.com/v1/flights",
        params={"access_key": KEY, "airline_code": ac, "flight_number": fn, "date": date},
        verify=ca, timeout=10)
    j = r.json()
    if j.get("message"):
        print(f"{target} {date}: API error: {j['message']}")
        continue
    matches = [f for f in j.get("data", []) if f.get("flight", {}).get("iata") == target]
    found = False
    for m in matches:
        dep_iata = m.get("departure", {}).get("iata", "?")
        arr_iata = m.get("arrival", {}).get("iata", "?")
        if dep_iata == want_dep and arr_iata == want_arr:
            found = True
            acft = m.get("aircraft")
            print(f"{target} {dep_iata}->{arr_iata} aircraft={json.dumps(acft, ensure_ascii=False) if acft else 'N/A'} status={m.get('flight_status')}")
    if not found:
        # Show what was found
        for m in matches[:3]:
            dep_iata = m.get("departure", {}).get("iata", "?")
            arr_iata = m.get("arrival", {}).get("iata", "?")
            print(f"  (other) {target} {dep_iata}->{arr_iata}")
        if not matches:
            print(f"{target} {date}: NO MATCHES at all")
    time.sleep(1.2)
