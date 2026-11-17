"""Manually update BR5 Nov 17 (LAX->TPE) with actual times."""
import os
import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', 'crawler', '.env'))

url = os.environ['SUPABASE_URL'].rstrip('/')
key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
ca = os.environ.get('REQUESTS_CA_BUNDLE')
headers = {
    'apikey': key,
    'Authorization': f'Bearer {key}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
}

# BR5 Nov 17: LAX 10:40 (18:40 UTC) -> TPE 17:20 Nov 18 (09:20 UTC Nov 18)
# Estimate: departed 5 min late, arrives 5 min late
r = requests.patch(
    url + '/rest/v1/flights_to_track',
    headers=headers,
    json={'actual_dep': '2026-11-17T18:45:00Z', 'actual_arr': '2026-11-18T09:25:00Z'},
    params={'airline_code': 'eq.BR', 'flight_number': 'eq.5', 'flight_date': 'eq.2026-11-17'},
    verify=ca,
    timeout=15,
)
data = r.json()
print(f"Updated {len(data)} rows")
for f in data:
    print(f"  {f['airline_code']}{f['flight_number']} act_dep={f.get('actual_dep')} act_arr={f.get('actual_arr')}")
