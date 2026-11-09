"""Score and tier the candidates: filters, signals, parents, NPS matches. Writes out/spots.json."""
import json, math, os, re, statistics
from collections import defaultdict
from common import CACHE, DATA, OUT, HERE, outline, inside as inside_poly
from config import TIER1, FLOOR, FLOORS, NATURE, SIGHT, COMMON, GONE_CATEGORIES, CATEGORY_KINDS, NOT_PLACE_CATEGORIES, SMALL_TYPES, HOSTS, HOST_M, SMALL_ALONE_VIEWS, GROUP_M, RADIUS_KM, LOCAL_TOP, MAX_INCEPTION_YEAR, NPS_MIN_PAGES, NPS_GENERIC, NPS_FACILITY

rows = json.load(open(os.path.join(DATA, "wikidata.json")))
v = json.load(open(os.path.join(DATA, "views.json")))
views, targets, categories = v["views"], v["targets"], v["categories"]
nps = json.load(open(os.path.join(DATA, "nps.json")))
MONTHS = [f"{y}{m:02d}" for y in range(2021, 2027) for m in range(1, 13)][10:70]  # 2021-11 .. 2026-10
by_id = {r["id"]: r for r in rows}

# Overrides: where Wikidata is wrong and no rule can fix it. Kept across runs, like `locked`.
overrides = json.load(open(os.path.join(HERE, "overrides.json")))
for q, o in overrides.items():
    if q in by_id:
        r = by_id[q]
        r["override"] = o["why"]
        if "class" in o:
            r["class"] = o["class"]
            r["block"] = [] if o["class"] == "allow" else r["block"]
        if "allow" in o:
            r["allow"] = o["allow"]


def km(a, b):
    p = math.pi / 180
    h = (math.sin((b["lat"] - a["lat"]) * p / 2) ** 2 +
         math.cos(a["lat"] * p) * math.cos(b["lat"] * p) * math.sin((b["lng"] - a["lng"]) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


OUTLINE = outline()


def inside(lat, lng):
    # A state with no outline keeps all its NPS places (multi-state parks may leak in).
    return OUTLINE is None or inside_poly(lat, lng, OUTLINE)


# Signals.
for r in rows:
    m = views.get(r["enwiki"] or "", {})
    series = [m.get(k, 0) for k in MONTHS]
    r["views"] = statistics.median(series) if m else 0
    r["recent"] = statistics.median(series[-3:]) if m else 0
    r["rising"] = r["views"] > 0 and r["recent"] > 2 * r["views"]
    by_month = [statistics.mean(series[i] for i in range(len(MONTHS)) if MONTHS[i][4:] == f"{k:02d}") for k in range(1, 13)]
    top = max(by_month) or 1
    r["months"] = [round(v / top, 2) for v in by_month]
    r["redirect"] = targets.get(r["enwiki"] or "")
    r["score"] = round(math.log10(r["views"] + 1) + math.log10(r["langs"] + 1), 3)

# Filters, with the reason a row is left out.
for r in rows:
    r["drop"] = None
    if r["class"] == "block":
        r["drop"] = "type: " + ", ".join(r["block"])
    elif r["class"] == "context" and not (
            any("lake" in t or "reservoir" in t for t in r["types"]) and
            any(p in by_id and ("park" in by_id[p]["allow"] or by_id[p]["nps_code"]) for p in r["in_protected_area"])):
        r["drop"] = "context: " + ", ".join(r["context"])
    elif r["demolished"]:
        r["drop"] = "demolished or dissolved (P576)"
    elif r["inception"] and r["inception"] > MAX_INCEPTION_YEAR:
        r["drop"] = f"too new ({r['inception']})"
    if r["drop"] is None and not r.get("override"):
        cats = categories.get(r["enwiki"] or "", [])
        def about_this(c):
            for noun, kinds in CATEGORY_KINDS.items():
                if re.search(rf"\b{noun}\b", c, re.I) and (kinds is None or not r["allow"] or set(r["allow"]) & kinds):
                    return True
            return False
        gone = next((c for c in cats if re.search(GONE_CATEGORIES, c, re.I) and about_this(c)), None)
        not_place = next((c for c in cats if re.search(NOT_PLACE_CATEGORIES, c, re.I)), None)
        if gone:
            r["drop"] = f"gone (category: {gone})"
        elif not_place:
            r["drop"] = f"not a place (category: {not_place})"

# Parents: a sight inside a park, or a part of a whole. Parts of a museum fold into it.
for r in rows:
    r["parent"] = None
    for p in r["in_protected_area"] + r["part_of"]:
        if p in by_id and p != r["id"] and by_id[p]["drop"] is None:
            r["parent"] = p
            break
    if r["parent"] and r["drop"] is None and "museum" in by_id[r["parent"]]["allow"] \
            and not set(r["allow"]) & {"museum", "park", "garden", "protected area"}:
        r["drop"] = "part of " + by_id[r["parent"]]["name"]

# Tiers.
def family(r):
    a = set(r["allow"])
    if a & NATURE:
        return "nature"
    if r["class"] == "neutral":
        return "neutral"
    if a and a <= COMMON:
        return "common"
    if a & SIGHT:
        return "sight"
    return "default"


kept = [r for r in rows if r["drop"] is None]
for r in kept:
    r["family"] = family(r)
    floor_views = FLOORS[r["family"]]
    # Types on neither list can reach tier 2 only: they are the ones nobody has looked at.
    if r["views"] >= TIER1["views"] and r["langs"] >= TIER1["langs"] and r["class"] != "neutral":
        r["tier"] = 1
    elif r["views"] >= floor_views:
        r["tier"] = 2
    else:
        r["tier"] = None
        r["drop"] = f"below floor ({r['family']}: {floor_views})"
floor = [r for r in kept if r["tier"]]
for r in floor:
    if r["tier"] == 2:
        better = sum(1 for o in floor if o is not r and o["score"] > r["score"] and km(r, o) <= RADIUS_KM)
        r["local_rank"] = better + 1
        if LOCAL_TOP and better >= LOCAL_TOP:
            r["tier"] = None
            r["drop"] = f"#{better + 1} within {RADIUS_KM} km"

# NPS places: match by the NPS place ID on Wikidata (P8649), else by name within 3 km.
def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("&", "and"))

by_slug = {r["nps_place"]: r for r in rows if r["nps_place"]}
by_name = defaultdict(list)
for r in rows:
    by_name[norm(r["name"])].append(r)
nps_only = []
for p in nps["places"]:
    if not p["latitude"] or p["isMapPinHidden"] == "1" or p["isOpenToPublic"] != "1":
        continue
    pt = {"lat": float(p["latitude"]), "lng": float(p["longitude"])}
    if not inside(pt["lat"], pt["lng"]):
        continue
    slug = p["url"].rsplit("/", 1)[-1].removesuffix(".htm")
    match = by_slug.get(slug) or next((r for r in by_name.get(norm(p["title"]), []) if km(r, pt) <= 3), None)
    park = p["relatedParks"][0]["parkCode"] if p["relatedParks"] else None
    if match:
        match.setdefault("nps", []).append({"title": p["title"], "url": p["url"], "park": park})
        # Only places typed as settlements or big geography; a lodge NPS lists is still a lodge.
        if match["drop"] and (match["drop"].startswith("context:") or (
                "human settlement" in match["block"] and not {"hotel", "business", "restaurant", "shop"} & set(match["block"]))):
            if match["views"] >= FLOOR["views"]:
                match["rescued"] = match["drop"]
                match["drop"] = None
                match["tier"] = 2
    else:
        nps_only.append({"title": p["title"], "url": p["url"], "park": park, **pt,
                         "passport": p["isPassportStampLocation"] == "1",
                         "has_text": bool(p["listingDescription"]), "images": len(p["images"])})

# NPS-only places, ranked inside their park by how many of the park's NPS pages mention them.
def base(title):
    t = re.sub(r"<[^>]+>", "", title.lower())
    return re.sub(r"\s*(trailhead|parking( area| lot)?|exhibit.*|wayside.*|sign|\d+)$", "", t).strip()

pages = defaultdict(list)
for p in nps["places"]:
    for rp in p["relatedParks"][:1]:
        pages[rp["parkCode"]].append(re.sub(r"<[^>]+>", " ", p.get("bodyText") or "").lower())
for t in nps["thingstodo"]:
    for rp in t["relatedParks"]:
        pages[rp["parkCode"]].append(re.sub(r"<[^>]+>", " ", (t.get("longDescription") or "") + " " + t["title"]).lower())
park_row = {r["nps_code"].lower(): r for r in rows if r["nps_code"]}
taken = {norm(r["name"]) for r in rows if r.get("tier")}
best = {}
for p in nps_only:
    b = base(p["title"])
    if len(b) < 5 or b in NPS_GENERIC or p["title"].startswith("[") or any(w in b for w in NPS_FACILITY):
        continue
    p["mentions"] = sum(1 for d in pages[p["park"]] if b in d)
    key = (p["park"], b)
    if p["mentions"] >= NPS_MIN_PAGES and norm(b) not in taken and (
            key not in best or len(p["title"]) < len(best[key]["title"])):
        best[key] = p
for (park, b), p in best.items():
    slug = p["url"].rsplit("/", 1)[-1].removesuffix(".htm")
    parent = park_row.get(park)
    name = re.sub(r"\s*(Trailhead|Parking( Area| Lot)?|\d+)$", "", p["title"]).strip()
    rows.append({"id": "nps:" + slug, "name": name, "lat": p["lat"], "lng": p["lng"], "types": ["NPS place"],
                 "class": "nps", "allow": [], "context": [], "block": [], "langs": 0, "views": 0, "recent": 0,
                 "rising": False, "months": None, "score": 0, "enwiki": None, "drop": None, "tier": 2,
                 "parent": parent["id"] if parent else None, "nps_mentions": p["mentions"],
                 "nps": [{"title": p["title"], "url": p["url"], "park": park}]})

# Small things hang under a bigger spot: the one Wikidata says they're part of or in, else the
# nearest within HOST_M. Ones with no host that sit close together make one neighbourhood stop.
def small(r):
    return (r.get("tier") and any(re.search(SMALL_TYPES, t, re.I) for t in r["types"])
            and not set(r["allow"]) & {"museum", "park", "garden", "historic district", "protected area"})

hosts = [r for r in rows if r.get("tier") and set(r["allow"]) & HOSTS and not small(r)]
host_ids = {r["id"] for r in hosts}
loose = []
for r in [r for r in rows if small(r)]:
    if r["tier"] == 1 or r["views"] >= SMALL_ALONE_VIEWS:
        continue
    said = next((p for p in r["part_of"] + r["in_protected_area"] if p in host_ids), None)
    near = min(hosts, key=lambda h: km(r, h), default=None)
    host = by_id.get(said) or (near if near and km(r, near) * 1000 <= HOST_M else None)
    if host:
        r.update(role="part", host=host["id"], own_tier=r["tier"], tier=None)
        host.setdefault("parts", []).append(r["id"])
    else:
        loose.append(r)

neighbourhoods = [r for r in rows if any(re.search(r"neighbou?rhood", t, re.I) for t in r["types"])]
groups, placed = [], set()
for r in loose:
    if r["id"] in placed:
        continue
    members = [o for o in loose if o["id"] not in placed and km(r, o) * 1000 <= GROUP_M]
    if len(members) < 2:
        continue
    lat = sum(m["lat"] for m in members) / len(members)
    lng = sum(m["lng"] for m in members) / len(members)
    hood = min(neighbourhoods, key=lambda h: km(h, {"lat": lat, "lng": lng}), default=None)
    gid = "area:" + (hood["id"] if hood else members[0]["id"])
    for m in members:
        placed.add(m["id"])
        m.update(role="part", host=gid, own_tier=m["tier"], tier=None)
    groups.append({"id": gid, "name": hood["name"] if hood else members[0]["name"], "lat": lat, "lng": lng,
                   "types": ["neighbourhood (group of small sights)"], "class": "area", "allow": [], "context": [],
                   "block": [], "langs": 0, "views": sum(m["views"] for m in members), "recent": 0, "rising": False,
                   "months": None, "score": max(m["score"] for m in members), "enwiki": None, "drop": None,
                   "tier": 2, "parent": None, "parts": [m["id"] for m in members], "family": "area"})
rows += groups
print("small things:", sum(1 for r in rows if r.get("role") == "part"), "hung under a spot or neighbourhood;",
      len(groups), "neighbourhood groups")

with open(os.path.join(OUT, "spots.json"), "w") as f:
    json.dump({"rows": rows, "nps_only": nps_only}, f)
t1 = [r for r in rows if r.get("tier") == 1]
t2 = [r for r in rows if r.get("tier") == 2]
print("tier 1", len(t1), "tier 2", len(t2), "nps matched", sum(1 for r in rows if r.get("nps")), "nps only", len(nps_only))
