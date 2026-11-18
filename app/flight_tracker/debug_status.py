"""Debug: check status + last_checked_at for active flights."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")
url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track?select=id,airline_code,flight_number,flight_date,status,scheduled_dep,actual_dep,actual_arr,last_checked_at&archived_at=is.null&order=flight_date,scheduled_dep&limit=20"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")
r = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15)
data = r.json()
print(f"total active: {len(data)}")
for f in data:
    print(f"  {f['flight_date']} {f['airline_code']}{f['flight_number']}: status={f['status']!r} last_checked={f['last_checked_at']}")
    print(f"    sched_dep={f['scheduled_dep']}  act_dep={f['actual_dep']}  act_arr={f['actual_arr']}")
