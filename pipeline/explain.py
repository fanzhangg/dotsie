"""Why a place is or isn't in a destination's guide, step by step, from its state's store: read only, no model asked.

  python3 explain.py --destination great-smoky-mountains shenandoah --names "Kuwohi,Skyline Drive"

For each record whose name holds one of the names (any source, in any of the destination's stores): whether its point is
inside the outline, whether it's a candidate (an English Wikipedia article or an NPS page) or hosted by one, its views
and languages, the judging answer kept in the store (every model's and prompt's), its place among the sights by the
shortlist's order, and whether it was picked or left out with the model's reason.
"""
import argparse, json, os, sqlite3
from unittest import mock

import guides, store
from guides import DESTINATIONS, SHORTLIST, Area, boundary, candidates, rank, store_path


def explain(dest_id, names):
    dest = DESTINATIONS[dest_id]
    dbs = [sqlite3.connect(f"file:{store_path(st)}?mode=ro", uri=True)
           for st in [dest["state"], *dest.get("other_states", [])] if os.path.exists(store_path(st))]
    rings = boundary(dest)
    area = Area(rings)
    with mock.patch.object(guides, "labels", lambda qids: {}):  # types aren't needed here
        places = candidates(dbs, dest, rings)
    hosted = {(n["source"], n["id"]): k for k, p in places.items() for n in p["nps"]}
    home = dbs[0]

    def answers(key):
        return [(prompt, json.loads(a)) for prompt, a in home.execute(
            "SELECT prompt, answer FROM llm_answers WHERE step = 'judge' AND key = ? ORDER BY created_at", (key,))]

    def sight(p):
        a = answers(f"{p['source']}/{p['id']}")
        if not a:
            return None
        a = a[-1][1]
        return a["is_sight"] and a["exists"] and a["visitable"] != "no" and not (a.get("part_of") and a["part_of"] != p["name"])

    judged = {k: sight(p) for k, p in places.items()}
    sights = sorted((p for k, p in places.items() if judged[k]), key=rank)
    picks = {(s, i): (r, why) for s, i, r, why in home.execute(
        "SELECT source, id, rank, reason FROM picks WHERE destination = ?", (dest_id,))}
    left = {(x["source"], x["id"]): x["reason"] for x in json.loads((home.execute(
        "SELECT left_out FROM destinations WHERE id = ?", (dest_id,)).fetchone() or ["[]"])[0] or "[]")}
    lines = [f"## {dest['name']}: {len(places)} candidates, {sum(1 for v in judged.values() if v)} judged sights "
             f"(of {sum(1 for v in judged.values() if v is not None)} judged), shortlist {SHORTLIST}"]
    for name in names:
        seen = set()
        for db in dbs:
            for source, rid, rname, lat, lng, raw in db.execute(
                    "SELECT source, id, name, lat, lng, raw FROM records WHERE name LIKE ? ORDER BY source, id", (f"%{name}%",)):
                if (source, rid) in seen:
                    continue
                seen.add((source, rid))
                key = (source, rid) if (source, rid) in places else hosted.get((source, rid))
                out = [f"- **{rname}** ({source} {rid}, {lat}, {lng}): "
                       + ("inside" if (lat, lng) in area else "outside the outline")]
                if source == "wikidata":
                    e = json.loads(raw)
                    out.append(f"enwiki {e['sitelinks'].get('enwiki')!r}")
                if key is None:
                    out.append("not a candidate (outside, or no English Wikipedia article and no NPS page)")
                else:
                    p = places[key]
                    if key != (source, rid):
                        out.append(f"its NPS page is on {p['name']} ({key[0]} {key[1]})")
                    out.append(f"views {p['views']}, {p['langs']} languages")
                    for prompt, a in answers(f"{key[0]}/{key[1]}"):
                        out.append(f"judged ({prompt}): sight {a['is_sight']}, exists {a['exists']}, visitable {a['visitable']}, "
                                   f"part of {a['part_of']!r}; evidence: {a['evidence'][:300]}")
                    if judged[key] is None:
                        out.append("not judged (the shortlist was full before it came up)")
                    elif judged[key]:
                        n = sights.index(p) + 1
                        out.append(f"sight #{n} by the shortlist's order: {'on' if n <= SHORTLIST else 'not on'} the shortlist")
                    if key in picks:
                        out.append(f"picked #{picks[key][0]}: {picks[key][1]}")
                    elif key in left:
                        out.append(f"left out: {left[key]}")
                lines.append("; ".join(out))
        if not seen:
            lines.append(f"- no record named like {name!r} in the stores")
    return "\n".join(lines)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--destination", required=True, nargs="+", choices=sorted(DESTINATIONS))
    ap.add_argument("--names", required=True, help="comma-separated parts of names")
    a = ap.parse_args()
    for d in a.destination:
        print(explain(d, [n.strip() for n in a.names.split(",") if n.strip()]) + "\n")
