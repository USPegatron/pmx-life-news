"""Clear premature actual_arr for BR12 & BR16 (flights still in transit)."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

# Clear actual_arr for BR12 and BR16 (Nov 17) - flights still in the air
for fn in ["12", "16"]:
    r = requests.get(
        url + f"?select=id,actual_arr&airline_code=eq.BR&flight_number=eq.{fn}&flight_date=eq.2026-11-17",
        headers=headers, verify=ca, timeout=15
    )
    for f in r.json():
        if f["actual_arr"]:
            print(f"BR{fn}: clearing actual_arr={f['actual_arr']}")
            patch_r = requests.patch(
                f"{url}?id=eq.{f['id']}",
                headers=headers, json={"actual_arr": None}, verify=ca, timeout=15
            )
            print(f"  PATCH: {patch_r.status_code}")
        else:
            print(f"BR{fn}: actual_arr already null")
