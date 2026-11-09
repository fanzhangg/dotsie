"""NPS Data API: the state's park units, their places and things to do.
Uses NPS_API_KEY if set, else api.data.gov's DEMO_KEY (enough for one state)."""
import json, os, urllib.parse
from common import CACHE, DATA, OUT, get_json
from config import STATE

KEY = os.environ.get("NPS_API_KEY", "DEMO_KEY")


def fetch_all(endpoint):
    out, start = [], 0
    while True:
        url = f"https://developer.nps.gov/api/v1/{endpoint}?" + urllib.parse.urlencode(
            {"stateCode": STATE["code"], "limit": 500, "start": start, "api_key": KEY})
        body = get_json(url)
        out += body["data"]
        start += len(body["data"])
        if not body["data"] or start >= int(body["total"]):
            return out


nps = {e: fetch_all(e) for e in ("parks", "places", "thingstodo")}
with open(os.path.join(DATA, "nps.json"), "w") as f:
    json.dump(nps, f)
for e, rows in nps.items():
    print(e, len(rows))
