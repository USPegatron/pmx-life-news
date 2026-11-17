"""Fix BR11 & BR15 arrival dates: Nov 17 -> Nov 18 (LAX->TPE reverse direction)."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Fix BR11 and BR15 (flight_date 2026-11-17)
for fn in ["11", "15"]:
    r = requests.get(
        url + f"?select=id,scheduled_arr&airline_code=eq.BR&flight_number=eq.{fn}&flight_date=eq.2026-11-17",
        headers=headers, verify=ca, timeout=15
    )
    flights = r.json()
    for f in flights:
        old = f["scheduled_arr"]
        new = old.replace("2026-11-17T21:", "2026-11-18T21:") if old else None
        print(f"BR{fn}: {old} -> {new}")
        if new and new != old:
            patch_r = requests.patch(
                f"{url}?id=eq.{f['id']}",
                headers=headers, json={"scheduled_arr": new}, verify=ca, timeout=15
            )
            print(f"  PATCH: {patch_r.status_code}")

# Also check BR5 to confirm it's correct
r = requests.get(
    url + "?select=id,scheduled_dep,scheduled_arr&airline_code=eq.BR&flight_number=eq.5&flight_date=eq.2026-11-17",
    headers=headers, verify=ca, timeout=15
)
for f in r.json():
    print(f"\nBR5 (verify): dep={f['scheduled_dep']} arr={f['scheduled_arr']}")
    print("  (dep 18:40Z Nov17 < arr 09:20Z Nov18 = OK, 14h40m flight time)")
