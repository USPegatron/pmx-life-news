"""Check actual_dep/arr vs scheduled for all active flights."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")
url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track?select=airline_code,flight_number,scheduled_dep,scheduled_arr,actual_dep,actual_arr&archived_at=is.null&limit=20"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
r = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15)
for f in r.json():
    print(f"{f['airline_code']}{f['flight_number']}")
    print(f"  sched_dep={f['scheduled_dep']}  act_dep={f['actual_dep']}")
    print(f"  sched_arr={f['scheduled_arr']}  act_arr={f['actual_arr']}")
