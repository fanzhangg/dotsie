"""Why a place is or isn't in a destination's guide, step by step, from its state's store: read only, no model asked.

  python3 explain.py --destination great-smoky-mountains shenandoah --names "Kuwohi,Skyline Drive"

For each record whose name holds one of the names (any source, in any of the destination's stores): whether its point is
inside the outline, whether it's a candidate (an English Wikipedia article or an NPS page) or hosted by one, its views
and languages, the judging answer kept in the store (every model's and prompt's), and
whether it was ranked or left out with the model's reason.
"""
import argparse, json, os, sqlite3
from unittest import mock

import guides, store
from guides import DESTINATIONS, Area, boundary, candidates, store_path


def explain(dest_id, names, show_merges=False):
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
        if "include" in a:  # asked whether it belongs (v6)
            return a["include"]
        if "is_sight" not in a:  # judged by its draw alone (v5)
            return a["draw"] >= 1
        return a["is_sight"] and a["exists"] and a["visitable"] != "no" and not (a.get("part_of") and a["part_of"] != p["name"])

    judged = {k: sight(p) for k, p in places.items()}
    picks = {(s, i): (r, why) for s, i, r, why in home.execute(
        "SELECT source, id, rank, reason FROM picks WHERE destination = ?", (dest_id,))}
    left = {(x["source"], x["id"]): x["reason"] for x in json.loads((home.execute(
        "SELECT left_out FROM destinations WHERE id = ?", (dest_id,)).fetchone() or ["[]"])[0] or "[]")}
    lines = [f"## {dest['name']}: {len(places)} candidates, {sum(1 for v in judged.values() if v)} judged sights "
             f"(of {sum(1 for v in judged.values() if v is not None)} judged)"]
    # Records taken as one place, and why: to check before trusting it (python3 explain.py ... --merges)
    merged = [(p["name"], m) for p in places.values() for m in p.get("merged", [])]
    vias = {}
    for _, m in merged:
        vias[m[3]] = vias.get(m[3], 0) + 1
    lines.append(f"- records taken as one place: {len(merged)} ({', '.join(f'{v} {n}' for v, n in sorted(vias.items())) or 'none'})")
    if show_merges:
        lines += [f"  - {host} ← {m[2]} ({m[0]} {m[1]}, {m[3]})" for host, m in sorted(merged)
                  if m[3] in ("name", "similar name", "same name in the destination")]
    # The ranking as the model gave it, against the places it was given: ids it didn't answer for, and ids it made up
    row = home.execute("SELECT prompt, answer FROM llm_answers WHERE step = 'pick' AND key = ? ORDER BY created_at DESC LIMIT 1",
                       (dest_id,)).fetchone()
    if row:
        a = json.loads(row[1])
        given = {f"{k[0]}/{k[1]}": p for k, p in places.items() if judged[k]}
        ranked, out = [c["id"] for c in a["picks"]], [c["id"] for c in a.get("left_out", [])]
        unknown = [i for i in ranked + out if i not in given]
        missing = [p["name"] for i, p in given.items() if i not in ranked and i not in out]
        lines.append(f"- ranking ({row[0]}): {len(given)} given, {len(ranked)} ranked ({len(set(ranked))} distinct), "
                     f"{len(out)} left out; {len(unknown)} ids not given, e.g. {unknown[:5]}; "
                     f"{len(missing)} given and not answered for, e.g. {missing[:12]}")
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
                        if "include" in a:
                            out.append(f"judged ({prompt}): belongs {a['include']}, as {a['name']!r}"
                                       + (f", worth {a['worth']}, same as {a.get('same_as')!r}" if "worth" in a else "")
                                       + f"; {a['reason'][:300]}")
                            continue
                        if "is_sight" not in a:
                            out.append(f"judged ({prompt}): draw {a['draw']}; {a['reason'][:300]}")
                            continue
                        out.append(f"judged ({prompt}): sight {a['is_sight']}, exists {a['exists']}, visitable {a['visitable']}, "
                                   f"part of {a['part_of']!r}; evidence: {a['evidence'][:300]}")
                    if judged[key] is None:
                        out.append("not judged")
                    elif judged[key]:
                        out.append("judged to belong")
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
    ap.add_argument("--names", default="", help="comma-separated parts of names")
    ap.add_argument("--merges", action="store_true", help="also list every pair of records taken as one place by their names")
    a = ap.parse_args()
    for d in a.destination:
        print(explain(d, [n.strip() for n in a.names.split(",") if n.strip()], a.merges) + "\n")
