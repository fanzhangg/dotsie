"""Adds destinations to destinations.json for guides.py: every national park, or a state's counties.

  python3 destinations.py parks          every unit the NPS counts as a National Park (62), in the states.json states
  python3 destinations.py counties WA    every county in a state
  python3 destinations.py plan "parks,WA" [--markdown]   which guides a run makes, one job per state (Spots guides)

A destination already in the file is left as it is (edit it there: its cap, its name), so running this again only adds
what's missing. Each one gets what guides.py needs: its outline's ID (`nps_unit` or `census_county`), its Wikidata item
(left out of its own guide), its state (whose store keeps its guide) and, for a park across a state line, the
`other_states` whose stores hold the rest of its places.

A park's state is the one its centre is in (Yellowstone's list starts with Idaho, but nearly all of it is in Wyoming),
from the NPS Land Resources Division's boundary centroids and the Census Bureau's state outlines. Its Wikidata item is
the one with its NPS code (P4083) and the most sitelinks; a county's, the one with its FIPS code (P882).
"""
import json, os, re, sys, urllib.parse
import store

# Where outlines come from (guides.py's boundary() reads them too): the Census Bureau's TIGERweb, the NPS Land Resources
# Division's boundaries. All public domain, no key.
TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
NPS_BOUNDARIES = ("https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/"
                  "NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/2/query?")

HERE = os.path.dirname(os.path.abspath(__file__))
FILE = os.path.join(HERE, "destinations.json")
STATES = {s["code"] for s in json.load(open(os.path.join(HERE, "states.json")))}
CAP = {"national park": 15, "county": 20}
NPS_CENTROIDS = NPS_BOUNDARIES.replace("/FeatureServer/2/", "/FeatureServer/0/")
STATE_LAYER = TIGERWEB + "State_County/MapServer/0/query?"
COUNTY_LAYER = TIGERWEB + "State_County/MapServer/1/query?"


def arcgis(url, **params):
    body = store.http_json(url + urllib.parse.urlencode({"f": "json", "returnGeometry": "false", **params}))
    if not body or "error" in body:
        raise RuntimeError(f"{url}: {str(body)[:200]}")
    return body["features"]


def slug(name):
    """An id for addresses (/spots/<id>/…): letters, digits and hyphens, at most 40."""
    s = re.sub(r"[^a-z0-9]+", "-", re.sub(r"['’ʻ`]", "", name.lower())).strip("-")
    while len(s) > 40:
        s = s.rsplit("-", 1)[0]
    return s


def most_linked(prop, values):
    """value -> the Wikidata item with that value for prop and the most sitelinks."""
    out = {}
    for b in store.batches(sorted(values), 200):
        rows = store.sparql(f"""SELECT ?v ?item (COUNT(?s) AS ?n) WHERE {{
            VALUES ?v {{ {' '.join(json.dumps(v) for v in b)} }} ?item wdt:{prop} ?v . OPTIONAL {{ ?s schema:about ?item }}
          }} GROUP BY ?v ?item""")
        for r in sorted(rows, key=lambda r: -int(r["n"]["value"])):
            out.setdefault(r["v"]["value"], r["item"]["value"].rsplit("/", 1)[1])
    return out


def parks():
    # The parks and every state each reaches into from the boundaries; their centres from the centroids, whose own
    # lists differ ("National Park", and only one state: Yellowstone's is "ID")
    units = arcgis(NPS_BOUNDARIES, where="UNIT_TYPE='National Parks'", outFields="UNIT_CODE,UNIT_NAME,STATE")
    codes = sorted({u["attributes"]["UNIT_CODE"] for u in units})
    centre = {c["attributes"]["UNIT_CODE"]: c["geometry"] for c in arcgis(
        NPS_CENTROIDS, where=f"UNIT_CODE IN ({','.join(repr(c) for c in codes)})", outFields="UNIT_CODE", outSR=4326,
        returnGeometry="true")}
    qids = most_linked("P4083", codes)
    # A park whose item has another code (Congaree's still has its swamp's): the item of its English Wikipedia article
    for code, title in {(u["attributes"]["UNIT_CODE"], u["attributes"]["UNIT_NAME"]) for u in units} - set(qids.items()):
        if code not in qids:
            rows = store.sparql(f"""SELECT ?item WHERE {{ ?s schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ;
                                    schema:name {json.dumps(title)}@en }}""")
            if rows:
                qids[code] = rows[0]["item"]["value"].rsplit("/", 1)[1]
    out, seen = [], set()
    for u in sorted(units, key=lambda u: u["attributes"]["UNIT_NAME"]):
        a, g = u["attributes"], centre.get(u["attributes"]["UNIT_CODE"])
        if a["UNIT_CODE"] in seen or not g:
            continue
        seen.add(a["UNIT_CODE"])
        home = arcgis(STATE_LAYER, geometry=f"{g['x']},{g['y']}", geometryType="esriGeometryPoint", inSR=4326,
                      spatialRel="esriSpatialRelIntersects", outFields="STUSAB")
        state = home[0]["attributes"]["STUSAB"] if home else None
        if state not in STATES or a["UNIT_CODE"] not in qids:
            print(f"  {a['UNIT_NAME']}: left out ({'not in a state of states.json' if state not in STATES else 'no Wikidata item'})")
            continue
        others = sorted(set(re.findall(r"\b[A-Z]{2}\b", a["STATE"] or "")) & STATES - {state})
        out.append({"id": slug(re.sub(r"\s+National Parks?\b.*$", "", a["UNIT_NAME"])), "name": a["UNIT_NAME"], "state": state,
                    **({"other_states": others} if others else {}), "kind": "national park", "wikidata": qids[a["UNIT_CODE"]],
                    "nps_unit": a["UNIT_CODE"], "cap": CAP["national park"]})
    return out


def counties(state):
    fips = arcgis(STATE_LAYER, where=f"STUSAB='{state}'", outFields="STATE")[0]["attributes"]["STATE"]
    found = arcgis(COUNTY_LAYER, where=f"STATE='{fips}'", outFields="GEOID,NAME")
    qids = most_linked("P882", {c["attributes"]["GEOID"] for c in found})
    out = []
    for c in sorted(found, key=lambda c: c["attributes"]["NAME"]):
        a = c["attributes"]
        if a["GEOID"] not in qids:
            print(f"  {a['NAME']}: left out (no Wikidata item)")
            continue
        out.append({"id": slug(f"{a['NAME']} {state}"), "name": a["NAME"], "state": state, "kind": "county",
                    "wikidata": qids[a["GEOID"]], "census_county": a["GEOID"], "cap": CAP["county"]})
    return out


KINDS = {"parks": {"national park"}, "counties": {"county"}}


def plan(spec, dests):
    """The destinations a request names, as one job per state: the ones whose guides that state's store keeps, and
    every store they read. A request is a comma-separated list of destination ids, "all", "parks", "counties",
    "cities" (the rest), or state codes ("WA": the destinations kept in Washington's store)."""
    want, unknown = set(), []
    for word in (w.strip() for w in spec.split(",")):
        if not word:
            continue
        hit = {d["id"] for d in dests if word == "all" or d["id"] == word or d["state"] == word
               or d["kind"] in KINDS.get(word, ()) or (word == "cities" and d["kind"] not in set().union(*KINDS.values()))}
        want |= hit
        if not hit:
            unknown.append(word)
    if unknown:
        raise ValueError(f"no destination is {', '.join(map(repr, unknown))}")
    jobs = {}
    for d in dests:
        if d["id"] in want:
            j = jobs.setdefault(d["state"], {"state": d["state"], "ids": [], "stores": [d["state"]]})
            j["ids"].append(d["id"])
            j["stores"] += [s for s in d.get("other_states", []) if s not in j["stores"]]
    return [jobs[s] for s in sorted(jobs)]


def markdown(jobs):
    """A plan for the workflow's summary, with what a first run would cost: about $0.80 a destination with guides.py's
    models (Haiku and Sonnet), $2.50 with Opus writing (Seattle's was $2.34)."""
    n = sum(len(j["ids"]) for j in jobs)
    lines = [f"### {n} destinations in {len(jobs)} states", "",
             f"A first run costs about $0.80 a destination with the default models, so about ${n * 0.8:,.0f} "
             f"(${n * 2.5:,.0f} with Opus writing); one whose answers are kept costs little.", ""]
    for j in jobs:
        also = f" (also reads {', '.join(j['stores'][1:])})" if j["stores"][1:] else ""
        lines.append(f"- {j['state']}: {', '.join(j['ids'])}{also}")
    return "\n".join(lines)


def write(dests):
    with open(FILE, "w") as f:
        f.write("[\n" + ",\n".join(" " + json.dumps(d) for d in dests) + "\n]\n")


def main(argv):
    if argv[:1] == ["plan"] and len(argv) in (2, 3):
        jobs = plan(argv[1], json.load(open(FILE)))
        print(markdown(jobs) if argv[2:] == ["--markdown"] else json.dumps(jobs))
        return
    if argv[:1] == ["parks"] and len(argv) == 1:
        new = parks()
    elif argv[:1] == ["counties"] and len(argv) == 2 and argv[1].upper() in STATES:
        new = counties(argv[1].upper())
    else:
        raise SystemExit(__doc__)
    dests = json.load(open(FILE))
    ids = {d["id"] for d in dests}
    added = [d for d in new if d["id"] not in ids]
    write(dests + added)
    print(f"{len(added)} added, {len(new) - len(added)} already there: {', '.join(d['id'] for d in added)}")


if __name__ == "__main__":
    main(sys.argv[1:])
