"""Candidates from Wikidata: every item with coordinates in the state and at least 2 sitelinks,
with its types classified against the allow, context and block lists."""
import json, os, re
from common import CACHE, DATA, OUT, sparql, entities, claim_ids, claim_values, label
from config import AREA, STATE, ALLOW, CONTEXT, BLOCK, GONE, BOT_WIKIS, NOT_WIKIPEDIA

if AREA.get("within"):
    # A city: its state's candidates inside its boundary, reclassified with today's rules.
    from common import outline, inside
    poly = outline()
    parent = json.load(open(os.path.join(CACHE, AREA["within"], "wikidata.json")))
    keep = [r["id"] for r in parent if inside(r["lat"], r["lng"], poly)]
else:
    keep = None

# An English Wikipedia article, or at least 2 sitelinks. Many US places have only the English one.
rows = [] if keep is not None else sparql(f"""SELECT DISTINCT ?item WHERE {{
  ?item wdt:P131+ wd:{STATE['qid']} ; wdt:P625 ?c .
  {{ ?a schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }}
  UNION {{ ?item wikibase:sitelinks ?sl . FILTER(?sl >= 2) }} }}""")
qids = sorted({r["item"]["value"].rsplit("/", 1)[1] for r in rows}) if keep is None else sorted(keep)
ents = entities(qids)
print("candidates", len(qids))

# Which roots each class reaches through P279*: walk the subclass graph here, from each class's
# direct superclasses (wbgetentities, cached per batch). A P279* query on the query service runs
# past its 60-second limit for some classes, and would have to run again whenever the roots change.
classes = sorted({c for e in ents.values() for c in claim_ids(e, "P31")})
roots = {**ALLOW, **CONTEXT, **BLOCK, **GONE}
parents, frontier = {}, set(classes)
for depth in range(25):
    todo = sorted(frontier - set(parents))
    if not todo:
        break
    got = entities(todo, props="claims")
    for c in todo:
        parents[c] = claim_ids(got.get(c, {}), "P279")
    frontier = {p for c in todo for p in parents[c]}
    print(f"subclass walk: depth {depth}, {len(parents)} classes", flush=True)


def ancestors(c):
    seen, stack = {c}, [c]
    while stack:
        for p in parents.get(stack.pop(), []):
            if p not in seen:
                seen.add(p)
                stack.append(p)
    return seen


reach = {c: ancestors(c) & set(roots) for c in classes}
class_labels = {c: label(e, c)
                for c, e in entities(classes, props="labels").items()}


def year(t):
    m = re.match(r"[+-](\d+)-", t.get("time", "")) if isinstance(t, dict) else None
    return int(m.group(1)) if m else None


out = []
for q in qids:
    e = ents.get(q)
    if not e or "claims" not in e:
        continue
    coord = next(iter(claim_values(e, "P625")), None)
    if not coord:
        continue
    types = claim_ids(e, "P31")
    hit = set().union(*(reach.get(t, set()) for t in types)) if types else set()
    allow = sorted(ALLOW[h] for h in hit if h in ALLOW)
    context = sorted(CONTEXT[h] for h in hit if h in CONTEXT)
    block = sorted(BLOCK[h] for h in hit if h in BLOCK)
    # An occurrence with no date (point in time, start, end) is something that stays, such as a
    # permanent exhibition: not blocked for being an occurrence.
    if "occurrence" in block and not any(claim_values(e, p) for p in ("P585", "P580", "P582")):
        block.remove("occurrence")
    klass = "allow" if allow else "block" if block else "context" if context else "neutral"
    links = e.get("sitelinks", {})
    langs = [w for w in links if w.endswith("wiki") and w not in NOT_WIKIPEDIA and w not in BOT_WIKIS]
    inception = [y for y in map(year, claim_values(e, "P571")) if y]
    out.append({
        "id": q, "name": label(e, q),
        "lat": coord["latitude"], "lng": coord["longitude"],
        "types": [class_labels.get(t, t) for t in types],
        "class": klass, "allow": allow, "context": context, "block": block,
        "langs": len(langs), "enwiki": links.get("enwiki", {}).get("title"),
        "part_of": claim_ids(e, "P361"), "in_protected_area": claim_ids(e, "P3018"),
        "demolished": bool(claim_values(e, "P576")) or bool(hit & set(GONE)), "inception": min(inception) if inception else None,
        "heritage": len(claim_ids(e, "P1435")), "image": next(iter(claim_values(e, "P18")), None),
        "gnis": next(iter(claim_values(e, "P590")), None), "nrhp": next(iter(claim_values(e, "P649")), None),
        "nps_code": next(iter(claim_values(e, "P4083")), None),
        "nps_place": next(iter(claim_values(e, "P8649")), None),
        "nnl": next(iter(claim_values(e, "P4182")), None),
    })

with open(os.path.join(DATA, "wikidata.json"), "w") as f:
    json.dump(out, f)
from collections import Counter
print(Counter(r["class"] for r in out))
