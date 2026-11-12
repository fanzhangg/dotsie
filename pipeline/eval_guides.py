"""How well the live guides agree with Wikivoyage: read only, no model asked.

  python3 eval_guides.py                       every national park's guide
  python3 eval_guides.py badlands mesa-verde   some
  python3 eval_guides.py --json out.json ...   and every match and miss, for comparing runs

For each guide on dotsie.app, its picks against the "see" and "do" listings ({{see}}, {{do}}, {{listing|type=see}})
of the destination's English Wikivoyage article (the one its Wikidata item links to). A listing is found when a pick
has its Wikidata item, or a name that matches its name (words like "trail", "hike" and "overlook" aside) and, when
both have a point, is within 2 km of it.

- see recall: the share of Wikivoyage's "see" listings the guide picked. A guide with a cap of 15 can't have them all
  where Wikivoyage lists 40, so it's read next to the number of listings.
- do recall: the same for "do" listings (hikes, drives, tours).
- first 10, first 20: how good the order is: of the listings (see or do) the first 10 (20) picks could hold, the share
  they do.
- in Wikivoyage: the share of the guide's picks that are a listing of either kind. Wikivoyage doesn't list every
  place worth going to, so it isn't precision, but a guide far below the others has picked what nobody lists.

Wikivoyage is the reference, not a source: the guides never read it.
"""
import argparse, json, math, os, re, sys, time, unicodedata, urllib.parse, urllib.request

API = "https://dotsie.app/api/developer/spots/"
WIKIVOYAGE = "https://en.wikivoyage.org/wiki/"
SPARQL = "https://query.wikidata.org/sparql?"
UA = {"User-Agent": "dotsie-eval/1.0 (spots guide evaluation)"}


def get(url, as_json=True):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                body = r.read().decode()
            return json.loads(body) if as_json else body
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def voyage_titles(qids):
    """Wikidata item -> the title of its English Wikivoyage article."""
    q = f"""SELECT ?item ?title WHERE {{ VALUES ?item {{ {' '.join('wd:' + x for x in qids)} }}
            ?a schema:about ?item ; schema:isPartOf <https://en.wikivoyage.org/> ; schema:name ?title }}"""
    rows = get(SPARQL + urllib.parse.urlencode({"query": q, "format": "json"}))["results"]["bindings"]
    return {r["item"]["value"].rsplit("/", 1)[1]: r["title"]["value"] for r in rows}


def templates(text):
    """Every {{see}}, {{do}} and {{listing}} in a page, with its parameters."""
    for m in re.finditer(r"\{\{\s*(see|do|listing)\s*\|", text, re.I):
        depth, i = 0, m.start()
        while i < len(text):
            if text.startswith("{{", i):
                depth, i = depth + 1, i + 2
            elif text.startswith("}}", i):
                depth, i = depth - 1, i + 2
                if depth == 0:
                    break
            else:
                i += 1
        body = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text[m.start() + 2:i - 2])
        params = {}
        for part in re.split(r"\|(?![^{]*\}\})", body)[1:]:
            if "=" in part:
                k, v = part.split("=", 1)
                params[k.strip().lower()] = v.strip()
        kind = m.group(1).lower()
        if kind == "listing":
            kind = (params.get("type") or "").lower()
        if kind in ("see", "do") and params.get("name"):
            yield kind, params


def listings(title):
    text = get(WIKIVOYAGE + urllib.parse.quote(title.replace(" ", "_")) + "?action=raw", as_json=False)
    moved = re.match(r"\s*#REDIRECT\s*\[\[([^\]|#]+)", text, re.I)
    if moved:
        text = get(WIKIVOYAGE + urllib.parse.quote(moved.group(1).strip().replace(" ", "_")) + "?action=raw", as_json=False)
    out, seen = [], set()
    for kind, p in templates(text):
        name = re.sub(r"'''?|<[^>]+>", "", p["name"]).strip()
        if (kind, name) in seen:
            continue
        seen.add((kind, name))
        num = lambda k: float(p[k]) if re.fullmatch(r"-?\d+(\.\d+)?", p.get(k, "")) else None
        out.append({"kind": kind, "name": name, "alt": p.get("alt") or "", "wikidata": p.get("wikidata") or None,
                    "lat": num("lat"), "lng": num("long")})
    return out


FILLER = {"the", "a", "an", "of", "to", "and", "at", "on", "in", "hike", "hiking", "visit", "drive", "explore",
          "experience", "take", "enjoy", "see", "tour", "walk", "paddle", "bike", "cruise", "climb", "trail", "trails",
          "trailhead", "loop", "overlook", "viewpoint", "nature", "scenic", "national", "park", "historic", "district",
          "north", "south", "rim", "unit", "area", "site"}


def words(name):
    s = unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode()
    w = [x[:-1] if len(x) > 4 and x.endswith("s") else x for x in re.findall(r"[a-z0-9]+", s.replace("&", " and "))]
    return {x for x in w if x not in FILLER}


def km(a, b):
    p = math.pi / 180
    h = (math.sin((b["lat"] - a["lat"]) * p / 2) ** 2 +
         math.cos(a["lat"] * p) * math.cos(b["lat"] * p) * math.sin((b["lng"] - a["lng"]) * p / 2) ** 2)
    return 12742 * math.asin(math.sqrt(h))


def same(pick, l):
    if l["wikidata"] and pick["source"] == "wikidata" and pick["id"] == l["wikidata"]:
        return True
    a = words(pick["name"])
    for n in (l["name"], l["alt"]):
        b = words(n)
        if not a or not b:
            continue
        small, big = (a, b) if len(a) <= len(b) else (b, a)
        if small <= big and (len(small) > 1 or len(next(iter(small))) > 3):
            if l["lat"] is None or pick.get("lat") is None or km(pick, l) <= 2:
                return True
    return False


def evaluate(guide, ls):
    picks = [p for p in guide["picks"] if p["rank"] > 1 or guide["kind"] != "national park"]  # not the park itself
    found = {i for i, l in enumerate(ls) if any(same(p, l) for p in picks)}
    listed = [p for p in picks if any(same(p, l) for l in ls)]
    see = [i for i, l in enumerate(ls) if l["kind"] == "see"]
    do = [i for i, l in enumerate(ls) if l["kind"] == "do"]
    share = lambda xs, f=found: round(sum(1 for i in xs if i in f) / len(xs), 2) if xs else None
    # How good the top of the order is: Wikivoyage's listings found among the first k picks, of as many as k could hold
    def at(k):
        top = {i for i, l in enumerate(ls) if any(same(p, l) for p in picks[:k])}
        return round(len(top) / min(k, len(ls)), 2) if ls else None
    return {"id": guide["id"], "picks": len(picks), "see": len(see), "do": len(do),
            "see_recall": share(see), "do_recall": share(do), "at_10": at(10), "at_20": at(20),
            "in_wikivoyage": round(len(listed) / len(picks), 2) if picks else None,
            "missed_see": [ls[i]["name"] for i in see if i not in found],
            "not_listed": [p["name"] for p in picks if p not in listed]}


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    qid = {d["id"]: d["wikidata"] for d in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "destinations.json")))}
    guides = [dict(g, wikidata=qid.get(g["id"])) for g in get(API + "guides")
              if (g["id"] in a.ids if a.ids else g["kind"] == "national park")]
    titles = voyage_titles(sorted({g["wikidata"] for g in guides if g["wikidata"]}))
    rows = []
    for g in guides:
        if g["wikidata"] not in titles:
            print(f"{g['id']}: no English Wikivoyage article", file=sys.stderr)
            continue
        time.sleep(1.2)
        guide = get(API + "guides/" + g["id"])
        r = evaluate(guide, listings(titles[g["wikidata"]]))
        rows.append(r)
        print(f"{r['id']}: {r['picks']} picks; see {r['see_recall']} of {r['see']}, do {r['do_recall']} of {r['do']}, "
              f"in Wikivoyage {r['in_wikivoyage']}", file=sys.stderr)
    avg = lambda k: round(sum(r[k] for r in rows if r[k] is not None) / max(1, sum(1 for r in rows if r[k] is not None)), 3)
    total = {"guides": len(rows), "picks": sum(r["picks"] for r in rows), "see_recall": avg("see_recall"),
             "do_recall": avg("do_recall"), "in_wikivoyage": avg("in_wikivoyage"), "at_10": avg("at_10"), "at_20": avg("at_20")}
    print(f"\n{total['guides']} guides, {total['picks']} picks: see recall {total['see_recall']}, do recall "
          f"{total['do_recall']}, in Wikivoyage {total['in_wikivoyage']}, listings in the first 10 {total['at_10']}, "
          f"first 20 {total['at_20']} (averages over guides)")
    if a.json:
        json.dump({"total": total, "guides": rows}, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1:])
