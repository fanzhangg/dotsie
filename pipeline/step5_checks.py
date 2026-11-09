"""Quality checks, instead of human review. Exit code 1 if any fails.
For an area with a Wikivoyage guide, also measures the tiers against its "see" listings."""
import json, os, re, sys, urllib.parse
from common import HERE, OUT, get_json
from config import AREA, AREA_CODE

from canaries import CANARIES

data = json.load(open(os.path.join(OUT, "spots.json")))
rows = data["rows"]
by_id = {r["id"]: r for r in rows}
by_name = {r["id"].lower(): r for r in rows}
for r in sorted(rows, key=lambda r: (r.get("tier") or 9, -r["score"])):
    by_name.setdefault(r["name"].lower(), r)
results, failed = [], 0


def check(name, ok, detail):
    global failed
    failed += not ok
    results.append({"check": name, "ok": ok, "detail": detail})


for group, key, want in (("tier 1", "tier1", {1}), ("listed", "any", {1, 2}), ("never listed", "never", {None})):
    for n in CANARIES[key]:
        r = by_name.get(n.lower())
        # A small thing hung under a spot counts as listed: it shows on that spot's card.
        tier = (r.get("tier") or (2 if r.get("role") == "part" else None)) if r else None
        ok = tier in want if r else want == {None}
        why = "not in Wikidata candidates" if not r else f"tier {tier}" if tier else r["drop"]
        check(f"{group}: {n}", ok, why)

bad = [r["name"] for r in rows if r.get("tier") and r["block"] and not r["allow"] and not r.get("rescued")]
check("no blocked type in a tier", not bad, ", ".join(bad[:10]) or "none")

# Wikivoyage: every "see" listing with a Wikidata item, on the guide's page and its district pages.
import math


def norm(t):
    return re.sub(r"[^a-z0-9]", "", re.sub(r"^the ", "", t.lower().replace("&", "and")))


def km(a, b):
    p = math.pi / 180
    h = (math.sin((b["lat"] - a["lat"]) * p / 2) ** 2 +
         math.cos(a["lat"] * p) * math.cos(b["lat"] * p) * math.sin((b["lng"] - a["lng"]) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))

reference = None
if AREA.get("wikivoyage"):
    API = "https://en.wikivoyage.org/w/api.php?"
    title = AREA["wikivoyage"]
    pages = [title] + [p["title"] for p in get_json(API + urllib.parse.urlencode(
        {"action": "query", "list": "allpages", "apprefix": title + "/", "aplimit": "max", "format": "json"}))["query"]["allpages"]]
    listings = {}
    for page in pages:
        q = get_json(API + urllib.parse.urlencode({"action": "query", "prop": "revisions", "rvprop": "content",
                                                   "rvslots": "main", "titles": page, "format": "json"}))["query"]
        text = next(iter(q["pages"].values()))["revisions"][0]["slots"]["main"]["*"]
        for m in re.finditer(r"\{\{\s*(see|listing)\b", text, re.I):
            depth, i = 0, m.start()
            while i < len(text):
                if text.startswith("{{", i): depth, i = depth + 1, i + 2
                elif text.startswith("}}", i):
                    depth, i = depth - 1, i + 2
                    if depth == 0: break
                else: i += 1
            body = text[m.start():i]
            if m.group(1).lower() == "listing" and not re.search(r"\|\s*type\s*=\s*see\b", body, re.I):
                continue
            qid = re.search(r"\|\s*wikidata\s*=\s*(Q\d+)", body)
            name = re.search(r"\|\s*name\s*=\s*([^|\n}]+)", body)
            lat = re.search(r"\|\s*lat\s*=\s*(-?[\d.]+)", body)
            lng = re.search(r"\|\s*long\s*=\s*(-?[\d.]+)", body)
            name = name.group(1).strip() if name else None
            if qid:
                listings[qid.group(1)] = {"name": name or qid.group(1), "page": page, "via": "wikidata"}
                continue
            # No Wikidata ID: match a candidate by name, or by a name inside the other within 300 m.
            if not name:
                continue
            n = norm(name)
            pt = {"lat": float(lat.group(1)), "lng": float(lng.group(1))} if lat and lng else None
            match = next((r for r in rows if norm(r["name"]) == n), None) or (pt and next(
                (r for r in rows if km(r, pt) <= 0.3 and (n in norm(r["name"]) or norm(r["name"]) in n) and len(n) > 3), None))
            if match:
                listings.setdefault(match["id"], {"name": name, "page": page, "via": "name"})
    tiered = {r["id"] for r in rows if r.get("tier")}
    shown = tiered | {r["id"] for r in rows if r.get("role") == "part"}  # on a spot's card
    t1 = [r for r in rows if r.get("tier") == 1]
    found = [q for q in listings if q in shown]
    missed = []
    for q, l in listings.items():
        if q in shown:
            continue
        r = by_id.get(q)
        missed.append({"id": q, "name": r["name"] if r else l["name"], "page": l["page"],
                       "views": round(r["views"]) if r else None,
                       "why": (r["drop"] if r else "not a candidate (no coordinates in the city, or no article)")})
    reference = {
        "pages": len(pages), "listings": len(listings),
        "recall": round(len(found) / len(listings), 3) if listings else None,
        "tier1_precision": round(sum(1 for r in t1 if r["id"] in listings) / len(t1), 3) if t1 else None,
        "tiered_precision": round(sum(1 for q in tiered if q in listings) / len(tiered), 3) if tiered else None,
        "missed": sorted(missed, key=lambda m: -(m["views"] or 0)),
        "listings": listings,
    }
    print(f"Wikivoyage: {len(pages)} pages, {len(listings)} see listings with an item; recall {reference['recall']}, "
          f"tier 1 precision {reference['tier1_precision']}, tiered precision {reference['tiered_precision']}")

with open(os.path.join(OUT, "checks.json"), "w") as f:
    json.dump(results, f, indent=1)
with open(os.path.join(OUT, "reference.json"), "w") as f:
    json.dump(reference, f, indent=1)
for c in results:
    print("PASS" if c["ok"] else "FAIL", c["check"], "-", c["detail"])
print(f"{len(results) - failed}/{len(results)} passed")
sys.exit(1 if failed else 0)
