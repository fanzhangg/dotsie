"""One state's store as SQL for D1 (app/migrations/0004_places.sql): its rows in `places`, `place_links`,
`place_schemes` and `place_loads`, replacing what D1 had for the state.

Metadata and links only, for the public page at /developer/spots: names, points, descriptions, types, identifiers, links
between records, page views. No text fetched from other sites.

Run: python3 export_d1.py --state WA > data/WA.d1.sql
"""
import argparse, json, os, sqlite3, sys, time, urllib.parse
from store import HERE, batches, http_json

NPS_TYPE = {"parks": "NPS park", "places": "NPS place", "thingstodo": "NPS thing to do", "visitorcenters": "NPS visitor center",
            "campgrounds": "NPS campground", "tours": "NPS tour", "webcams": "NPS webcam"}
NPS_SCHEMES = {"url": "Page URL", "parkCode": "NPS park code", "P8649": "National Park Service place ID", "P4083": "Park Alpha Code"}
STATEMENT_BYTES = 90_000  # D1 allows 100 KB per statement


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("\x00", "").replace("'", "''") + "'"


def inserts(table, cols, rows, out):
    head = f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) VALUES "
    chunk, size = [], len(head)
    for r in rows:
        values = "(" + ", ".join(lit(v) for v in r) + ")"
        if chunk and size + len(values) + 2 > STATEMENT_BYTES:
            out.write(head + ",\n".join(chunk) + ";\n")
            chunk, size = [], len(head)
        chunk.append(values)
        size += len(values) + 2
    if chunk:
        out.write(head + ",\n".join(chunk) + ";\n")


def labels(qids):
    """English (or multilingual) labels for Wikidata items: here, the types places are instances of."""
    out = {}
    for b in batches(sorted(qids), 50):
        ents = http_json("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
            "action": "wbgetentities", "ids": "|".join(b), "props": "labels", "languages": "en|mul", "format": "json"}))
        for q, e in (ents or {}).get("entities", {}).items():
            l = e.get("labels", {})
            out[q] = (l.get("en") or l.get("mul") or {}).get("value", q)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True)
    st = ap.parse_args().state
    db = sqlite3.connect(os.path.join(HERE, "data", f"{st}.sqlite"))
    external = {p for (p,) in db.execute("SELECT pid FROM properties WHERE datatype = 'external-id'")}
    views = dict(db.execute("SELECT article, SUM(views) FROM pageviews GROUP BY article"))
    ids = {}
    for source, rid, scheme, value in db.execute("SELECT source, id, scheme, value FROM ids"):
        if source != "wikidata" or scheme in external:
            ids.setdefault((source, rid), {}).setdefault(scheme, []).append(value)

    records = db.execute("SELECT source, id, name, lat, lng, url, raw FROM records").fetchall()
    type_qids = set()
    for source, *_, raw in records:
        if source == "wikidata":
            type_qids.update(c["value"] for c in json.loads(raw)["claims"].get("P31", []) if isinstance(c["value"], str))
    type_names = labels(type_qids)

    rows = []
    for source, rid, name, lat, lng, url, raw in records:
        r = json.loads(raw)
        if source == "wikidata":
            d = r["descriptions"]
            title = r["sitelinks"].get("enwiki")
            site = next((c["value"] for c in r["claims"].get("P856", []) if isinstance(c["value"], str)), None)
            types = [type_names.get(c["value"], c["value"]) for c in r["claims"].get("P31", []) if isinstance(c["value"], str)]
            rows.append((source, rid, st, name, d.get("en") or d.get("mul"), lat, lng, json.dumps(types), url, title, site,
                         views.get(title) if title else None, json.dumps(ids.get((source, rid), {}))))
        else:
            desc = (r.get("listingDescription") or r.get("shortDescription") or r.get("description") or "").strip()
            types = [NPS_TYPE.get(source.split(":", 1)[1], source)]
            rows.append((source, rid, st, name or "(unnamed)", desc[:400] or None, lat, lng, json.dumps(types), url, None,
                         None, None, json.dumps(ids.get((source, rid), {}))))

    out = sys.stdout
    out.write(f"DELETE FROM places WHERE state = {lit(st)};\nDELETE FROM place_links WHERE state = {lit(st)};\n")
    inserts("places", ["source", "id", "state", "name", "description", "lat", "lng", "types", "url", "wikipedia", "website",
                       "views", "ids"], rows, out)
    inserts("place_links", ["source_a", "id_a", "source_b", "id_b", "via", "state"],
            [(*l, st) for l in db.execute("SELECT source_a, id_a, source_b, id_b, via FROM links")], out)
    inserts("place_schemes", ["scheme", "label"],
            list(db.execute("SELECT pid, label FROM properties WHERE datatype = 'external-id' AND label IS NOT NULL")) +
            list(NPS_SCHEMES.items()), out)
    summary = os.path.join(HERE, "data", f"{st}.json")
    built = json.load(open(summary)).get("built_at") if os.path.exists(summary) else None
    inserts("place_loads", ["state", "loaded_at", "built_at", "records"],
            [(st, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), built, len(rows))], out)
    print(f"{st}: {len(rows)} places", file=sys.stderr)


if __name__ == "__main__":
    main()
