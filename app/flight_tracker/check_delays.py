"""Check scheduled vs actual to verify delay calculations."""
import os
from dotenv import load_dotenv
import requests
from datetime import datetime, timezone

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track?select=airline_code,flight_number,dep_airport,arr_airport,scheduled_dep,scheduled_arr,actual_dep,actual_arr&archived_at=is.null&order=flight_date,scheduled_dep&limit=20"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

r = requests.get(url, headers={"apikey": key, "Authorization": f"Bearer {key}"}, verify=ca, timeout=15)
data = r.json()

def calc_delay(sched, actual):
    if not sched or not actual:
        return "N/A"
    s = datetime.fromisoformat(sched)
    a = datetime.fromisoformat(actual)
    diff_min = round((a - s).total_seconds() / 60)
    if diff_min == 0:
        return "準點"
    return f"{'延遲' if diff_min > 0 else '提早'}{abs(diff_min)}Min"

print(f"{'Flight':<12} {'Route':<10} {'SchedDep':<26} {'ActDep':<26} {'DepDelay':<12} {'SchedArr':<26} {'ActArr':<26} {'ArrDelay'}")
print("-" * 150)
for f in data:
    route = f"{f['dep_airport']}->{f['arr_airport']}"
    dep_delay = calc_delay(f["scheduled_dep"], f["actual_dep"])
    arr_delay = calc_delay(f["scheduled_arr"], f["actual_arr"])
    print(f"{f['airline_code']}{f['flight_number']:<7} {route:<10} {str(f['scheduled_dep']):<26} {str(f['actual_dep']):<26} {dep_delay:<12} {str(f['scheduled_arr']):<26} {str(f['actual_arr']):<26} {arr_delay}")
