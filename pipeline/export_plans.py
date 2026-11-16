"""A destination's trip plans as rows for D1 (app/migrations/0008_trip_plans.sql), replacing the rows it had, and as
the guides mockup's data (mockups/guides/data/<destination>.json).

Reads out/plans/<destination>/: knowledge.json, the composed plans (compose.py's plan-<id>.json) and their articles
(story.py's story-<id>.json). A plan that still breaks a rule after plan.py's repair rounds is left out, with a warning,
so it never reaches D1. No guide text goes in a plan's row: the page joins its places to spot_guides.

Run: PLAN_DESTINATION=seattle python3 export_plans.py --sql out/plans/seattle/plans.d1.sql [--mockup]
"""
import argparse, glob, json, os, time

from export_d1 import STATEMENT_BYTES, inserts, lit
from planning import DEST, DEST_ID, HERE, OUT, log, read

MOCKUP = os.path.join(HERE, "..", "mockups", "guides", "data", f"{DEST_ID}.json")
load = lambda path: json.loads(open(path).read())
js = lambda v: None if v is None else json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def rows():
    """The destination's plans, as stored: those that pass their checks, each with its story when it has one."""
    k = read("knowledge.json")
    spots = {s["id"]: s for s in k["spots"]}
    stories = {}
    for p in glob.glob(os.path.join(OUT, "story-*.json")):
        s = load(p)
        stories[s["plan_id"]] = {key: v for key, v in s.items() if key not in ("checks", "rounds", "plan_id", "input_hash", "version")}
    plans = []
    for p in sorted(glob.glob(os.path.join(OUT, "plan-*.json"))):
        c = load(p)
        if c["checks"]["errors"]:  # plan.py ran out of repair rounds: a plan that breaks a rule never goes out
            print(f"::warning::{DEST_ID}: plan {c['id']} left out: it still fails {len(c['checks']['errors'])} checks: "
                  + "; ".join(c["checks"]["errors"]))
            continue
        days = [{"day": d["day"], "theme": d["theme"], "intro": d["intro"],
                 "items": [{"kind": i["kind"], "spot_id": i["spot_id"], "start": i["start"], "minutes": i["minutes"], "why": i["why"],
                            "leg": i["leg"] and {key: i["leg"][key] for key in ("mode", "minutes", "coords")}} for i in d["items"]]}
                for d in c["days"]]
        used = {i["spot_id"] for d in days for i in d["items"]} | {i["spot_id"] for i in c["ideas"]}
        places = {sid: {"source": spots[sid]["source"], "id": spots[sid]["pid"], "name": spots[sid]["name"], "lat": spots[sid]["lat"],
                        "lng": spots[sid]["lng"], "kind": spots[sid]["kind"], "area": next(a["name"] for a in k["areas"] if a["id"] == spots[sid]["area"]),
                        "facts": {key: v for key, v in spots[sid]["facts"].items() if key != "evidence"}} for sid in sorted(used) if sid in spots}
        plans.append({"plan_id": f"{DEST_ID}-{c['id']}", "destination": DEST_ID, "title": f"{len(days)} days in {k['destination']}",
                      "traveler": c["traveler"], "days": days, "ideas": [{"spot_id": i["spot_id"], "why": i["why"]} for i in c["ideas"]],
                      "places": places, "story": stories.get(c["id"]),
                      "stops": sum(1 for d in days for i in d["items"] if i["kind"] == "stop"), "built": k["built"]})
    return k, plans


def sql(plans, out):
    """Deleted first, then inserted, in one file that wrangler runs as one batch."""
    dest = lit(DEST_ID)
    out.write(f"DELETE FROM trip_plan_spots WHERE plan_id IN (SELECT plan_id FROM trip_plans WHERE destination = {dest});\n"
              f"DELETE FROM trip_plans WHERE destination = {dest};\n")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rs = [(p["plan_id"], p["destination"], p["title"], p["traveler"], js(p["days"]), js(p["ideas"]), js(p["places"]), js(p["story"]),
           p["stops"], p["built"], now) for p in plans]
    for r in rs:  # a plan is one row, and one statement
        if sum(len(str(v)) for v in r) > STATEMENT_BYTES - 2000:
            raise SystemExit(f"plan {r[0]} is more than a D1 statement holds")
    inserts("trip_plans", ["plan_id", "destination", "title", "traveler", "days", "ideas", "places", "story", "stops", "built", "loaded_at"], rs, out)
    inserts("trip_plan_spots", ["plan_id", "source", "id", "day", "start"],
            [(p["plan_id"], *i["spot_id"].split("/", 1), d["day"], i["start"]) for p in plans for d in p["days"]
             for i in d["items"] if i["kind"] == "stop"], out)


def mockup(k, plans):
    """The guides mockup's data: a destination's tables as the app would send them, with each entry as blocks."""
    spots = [{"spot_id": s["id"], "name": s["name"], "lat": s["lat"], "lng": s["lng"], "kind": s["kind"], "rank": s["rank"],
              "area": next(a["name"] for a in k["areas"] if a["id"] == s["area"]),
              "facts": {key: v for key, v in s["facts"].items() if key != "evidence"},
              "photo": s["entry"]["hero"] and {"url": s["entry"]["hero"]["thumb"], "page": s["entry"]["hero"]["page"],
                                               "author": s["entry"]["hero"].get("author") or "", "license": s["entry"]["hero"].get("licence") or ""},
              "links": [{"label": {"wikipedia": "Wikipedia", "official website": "Official site"}.get(x["kind"], x["kind"]), "url": x["url"]} for x in s["sources"]],
              "fetched": s["fetched"]} for s in k["spots"]]
    blocks = []
    for s in k["spots"]:
        e = s["entry"]
        blocks.append({"spot_id": s["id"], "kind": "one_liner", "text": e["one_liner"], "sources": [], "ord": 0})
        blocks += [{"spot_id": s["id"], "kind": "body", "text": x["text"], "sources": x.get("sources") or [], "ord": n}
                   for n, x in enumerate(e["paragraphs"], 1)]
    data = {"destination": {"id": DEST_ID, "name": k["destination"], "built": k["built"],
                            "travel_note": "Times between places are OpenStreetMap routes, on foot or by car; driving doesn't count parking."},
            "spots": spots, "blocks": blocks,
            "plans": [{key: v for key, v in p.items() if key not in ("places", "story", "destination")} for p in plans],
            "stories": [dict(p["story"], plan_id=p["plan_id"]) for p in plans if p["story"]]}
    os.makedirs(os.path.dirname(MOCKUP), exist_ok=True)
    with open(MOCKUP, "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    log(f"wrote {os.path.normpath(MOCKUP)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sql", help="write the rows as SQL for D1, to this file")
    ap.add_argument("--mockup", action="store_true", help="also write the guides mockup's data")
    a = ap.parse_args()
    k, plans = rows()
    log(f"{DEST['name']}: {len(plans)} plans, {sum(1 for p in plans if p['story'])} with an article")
    if a.sql:
        with open(a.sql, "w") as f:
            sql(plans, f)
        log(f"wrote {a.sql}")
    if a.mockup:
        mockup(k, plans)


if __name__ == "__main__":
    main()
