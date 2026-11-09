"""Shared helpers for the spots pipeline MVP: HTTP with a disk cache, SPARQL, Wikidata entities."""
import hashlib, json, os, time, urllib.parse, urllib.request

UA = "waythread-spots-mvp/0.1 (https://github.com/fanzhangg/waythread)"
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache")  # HTTP responses, shared by every area
AREA_CODE = os.environ.get("SPOTS_AREA", "WA")
DATA = os.path.join(CACHE, AREA_CODE)  # one area's step outputs
OUT = os.path.join(HERE, "out", AREA_CODE)
os.makedirs(DATA, exist_ok=True)
os.makedirs(OUT, exist_ok=True)


def get_json(url, data=None, headers=None, tries=8):
    key = hashlib.sha1((url + (data or "")).encode()).hexdigest()
    path = os.path.join(CACHE, "http", key[:2], key + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data.encode() if data else None, headers=h)
            with urllib.request.urlopen(req, timeout=120) as r:
                body = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                body = None
                break
            if i == tries - 1:
                raise
            time.sleep(2 ** i * (5 if e.code == 429 else 1))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(body, f)
    return body


def sparql(query):
    body = get_json("https://query.wikidata.org/sparql",
                    data=urllib.parse.urlencode({"query": query, "format": "json"}),
                    headers={"Content-Type": "application/x-www-form-urlencoded"})
    return body["results"]["bindings"]


def entities(qids, props="claims|sitelinks|labels"):
    out = {}
    qids = list(qids)
    for i in range(0, len(qids), 50):
        chunk = qids[i:i + 50]
        url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(chunk), "props": props,
            "languages": "en|mul", "format": "json"})
        out.update(get_json(url).get("entities", {}))
    return out


def truthy(ent, prop):
    """A property's statements that aren't deprecated. All of them, not only the preferred ones:
    an item's types add up (the 1940 Tacoma Narrows Bridge is a preferred suspension bridge and a
    normal-rank destroyed structure)."""
    return [c for c in ent.get("claims", {}).get(prop, []) if c.get("rank") != "deprecated"]


def claim_ids(ent, prop):
    out = []
    for c in truthy(ent, prop):
        v = c.get("mainsnak", {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and "id" in v:
            out.append(v["id"])
    return out


def claim_values(ent, prop):
    return [c["mainsnak"]["datavalue"]["value"] for c in truthy(ent, prop)
            if "datavalue" in c.get("mainsnak", {})]


def label(ent, default=None):
    labels = ent.get("labels", {})
    return (labels.get("en") or labels.get("mul") or {}).get("value", default)


def outline():
    """The area's outline as (lat, lng) pairs: its Census boundary when it has one, else the config's."""
    from config import AREA
    path = os.path.join(DATA, "boundary.json")
    if AREA.get("census_place"):
        if not os.path.exists(path):
            url = ("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4/query?"
                   + urllib.parse.urlencode({"where": f"GEOID='{AREA['census_place']}'", "outFields": "NAME",
                                             "outSR": 4326, "f": "json", "geometryPrecision": 5}))
            ring = max(get_json(url)["features"][0]["geometry"]["rings"], key=len)
            with open(path, "w") as f:
                json.dump([(round(y, 5), round(x, 5)) for x, y in ring], f)
        return [tuple(p) for p in json.load(open(path))]
    return AREA["outline"]


def inside(lat, lng, poly):
    hit = False
    for (y1, x1), (y2, x2) in zip(poly, poly[1:]):
        if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit
