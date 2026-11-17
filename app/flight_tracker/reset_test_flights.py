"""Reset the 2 smoke-test flights so flight_tracker.py re-checks them."""
import os, json
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

# Reset only the two test flights we inserted
r = requests.patch(
    url + "?id=in.(7baf43ed-5eb0-472e-a011-c2cca0938756,279ba33a-df8b-47a1-9e81-bea2d740fadf)",
    headers={
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    },
    json={"last_checked_at": None, "notes": None, "status": "scheduled", "actual_dep": None, "actual_arr": None, "delay_minutes": None, "updated_by": "import"},
    verify=ca,
    timeout=15,
)
print("reset status:", r.status_code)
print("reset body:", r.text[:300])

# Verify
r2 = requests.get(
    url + "?select=id,flight_date,status,last_checked_at,notes&order=flight_date.asc",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
    verify=ca,
    timeout=15,
)
print("list:")
print(json.dumps(r2.json(), indent=2, ensure_ascii=False))
