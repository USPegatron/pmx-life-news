"""Delete the 2 smoke-test flights."""
import os
from dotenv import load_dotenv
import requests

load_dotenv("app/crawler/.env")

url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/flights_to_track"
key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ca = os.environ.get("REQUESTS_CA_BUNDLE")

r = requests.delete(
    url + "?id=in.(7baf43ed-5eb0-472e-a011-c2cca0938756,279ba33a-df8b-47a1-9e81-bea2d740fadf)",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
    verify=ca,
    timeout=15,
)
print("DELETE status:", r.status_code)

r2 = requests.get(
    url + "?select=id",
    headers={"apikey": key, "Authorization": f"Bearer {key}"},
    verify=ca,
    timeout=15,
)
data = r2.json()
print("after delete, count:", len(data))
for f in data:
    print("  -", f.get("id"))
