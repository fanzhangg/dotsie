"""The place store for one US state: everything outside sources say about its places, kept as it came.

No filtering and no judging. Every record a source has for the state goes in with its raw data, and
records from different sources are linked only through identifiers they share (a Wikidata item's NPS
place ID or park code, a website), never by guessing from names or distances.

One SQLite file per state (data/<ST>.sqlite), fetched texts included (zlib), so a state is one object
in R2. A run updates the previous file in place: only what changed since is fetched again.

Tables:
  records     one row per record per source: name, point, page, licence, revision, fetch time, raw JSON
  ids         every identifier a record carries (scheme, value), e.g. ("P590", GNIS ID)
  links       record <-> record through a shared identifier
  pageviews   English Wikipedia views per article per month (user agents)
  categories  English Wikipedia categories per article
  documents   texts fetched for a record (Wikipedia article, official website)
  properties  Wikidata property labels, to read the raw claims

Run: python3 store.py --state WA [--limit N] [--pageviews DIR] [steps...]
  steps: wikidata wikipedia websites nps pageviews links (default: all, in that order)
  --limit N     only the first N Wikidata items (to try the code on a few)
  --pageviews   a folder of enwiki-YYYYMM.tsv.gz files from pageviews_month.py
"""
import argparse, glob, gzip, hashlib, html.parser, json, os, re, sqlite3, subprocess, sys, time, urllib.parse, urllib.request, zlib
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "waythread-spots/0.1 (https://github.com/fanzhangg/waythread)"
STATES = {s["code"]: s for s in json.load(open(os.path.join(HERE, "states.json")))}
NOW = lambda: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
WEBSITE_MAX_AGE_DAYS = 90
NPS_ENDPOINTS = ["parks", "places", "thingstodo", "visitorcenters", "campgrounds", "tours", "webcams"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS records (
  source TEXT, id TEXT, name TEXT, lat REAL, lng REAL, url TEXT, license TEXT, rev TEXT, fetched_at TEXT, raw TEXT,
  PRIMARY KEY (source, id));
CREATE TABLE IF NOT EXISTS ids (source TEXT, id TEXT, scheme TEXT, value TEXT, PRIMARY KEY (source, id, scheme, value));
CREATE INDEX IF NOT EXISTS ids_by_value ON ids (scheme, value);
CREATE TABLE IF NOT EXISTS links (
  source_a TEXT, id_a TEXT, source_b TEXT, id_b TEXT, via TEXT, PRIMARY KEY (source_a, id_a, source_b, id_b, via));
CREATE TABLE IF NOT EXISTS pageviews (article TEXT, month TEXT, views INTEGER, PRIMARY KEY (article, month));
CREATE TABLE IF NOT EXISTS categories (article TEXT, category TEXT, PRIMARY KEY (article, category));
CREATE TABLE IF NOT EXISTS documents (
  source TEXT, id TEXT, kind TEXT, url TEXT, title TEXT, license TEXT, rev TEXT, fetched_at TEXT, status TEXT,
  sha256 TEXT, chars INTEGER, text BLOB, PRIMARY KEY (source, id, kind));
CREATE TABLE IF NOT EXISTS properties (pid TEXT PRIMARY KEY, label TEXT, datatype TEXT);
"""


def http_json(url, data=None, tries=6, wait_cap=60):
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if data:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data.encode() if data else None, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if i == tries - 1:
                raise
            retry = e.headers.get("Retry-After")
            time.sleep(min(wait_cap, int(retry) if retry and retry.isdigit() else 2 ** i * (5 if e.code == 429 else 1)))
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 ** i)


def sparql(query):
    return http_json("https://query.wikidata.org/sparql",
                     urllib.parse.urlencode({"query": query, "format": "json"}))["results"]["bindings"]


def batches(xs, n):
    return [xs[i:i + n] for i in range(0, len(xs), n)]


def pmap(fn, items, threads):
    with ThreadPoolExecutor(threads) as pool:
        yield from pool.map(fn, items)


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


class Store:
    def __init__(self, state, limit=None):
        self.state, self.limit = STATES[state], limit
        os.makedirs(os.path.join(HERE, "data"), exist_ok=True)
        self.path = os.path.join(HERE, "data", f"{state}.sqlite")
        self.db = sqlite3.connect(self.path)
        self.db.executescript(SCHEMA)

    def put_ids(self, source, rid, pairs):
        self.db.executemany("INSERT OR IGNORE INTO ids VALUES (?,?,?,?)", [(source, rid, s, v) for s, v in pairs])

    # ---------- Wikidata: every item located in the state that has coordinates ----------

    def item_revisions(self):
        """Every item in the state with coordinates, and its current revision. One query for the state;
        if that times out, one per county."""
        q = "SELECT ?i ?rev WHERE {{ ?i wdt:P131+ wd:{area} ; wdt:P625 ?c ; schema:version ?rev }}"
        try:
            rows = sparql(q.format(area=self.state["qid"]))
        except Exception as err:
            log(f"  state query failed ({err}); querying county by county")
            counties = [r["c"]["value"].rsplit("/", 1)[1] for r in sparql(
                f"SELECT DISTINCT ?c WHERE {{ ?c wdt:P131 wd:{self.state['qid']} ; wdt:P31/wdt:P279* wd:Q47168 }}")]
            rows = [r for c in counties for r in sparql(q.format(area=c))]
            rows += sparql(f"SELECT ?i ?rev WHERE {{ ?i wdt:P131 wd:{self.state['qid']} ; wdt:P625 ?c ; schema:version ?rev }}")
        revs = {r["i"]["value"].rsplit("/", 1)[1]: r["rev"]["value"] for r in rows}
        items = sorted(revs)[:self.limit] if self.limit else sorted(revs)
        return {q: revs[q] for q in items}

    def wikidata(self):
        revs = self.item_revisions()
        have = dict(self.db.execute("SELECT id, rev FROM records WHERE source='wikidata'"))
        gone = set(have) - set(revs)
        todo = [q for q, r in revs.items() if have.get(q) != r]
        log(f"wikidata: {len(revs)} items; {len(todo)} new or changed, {len(gone)} no longer in the state")
        for q in gone:
            self.db.execute("DELETE FROM records WHERE source='wikidata' AND id=?", (q,))
            self.db.execute("DELETE FROM ids WHERE source='wikidata' AND id=?", (q,))

        def fetch(b):
            return http_json("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
                "action": "wbgetentities", "ids": "|".join(b), "props": "labels|descriptions|aliases|claims|sitelinks|info",
                "languages": "en|mul", "format": "json"})).get("entities", {})

        pids = set()
        for n, ents in enumerate(pmap(fetch, batches(todo, 50), 8)):
            for q, e in ents.items():
                if "missing" in e:
                    continue
                e = compact(e)
                pids.update(e["claims"])
                coord = next((x["value"] for x in e["claims"].get("P625", [])
                              if isinstance(x["value"], dict) and "lat" in x["value"]), {})
                self.db.execute("DELETE FROM ids WHERE source='wikidata' AND id=?", (q,))
                self.db.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?,?,?,?,?,?,?)", (
                    "wikidata", q, e["labels"].get("en") or e["labels"].get("mul") or q, coord.get("lat"), coord.get("lng"),
                    f"https://www.wikidata.org/wiki/{q}", "CC0", str(e["rev"]), NOW(), json.dumps(e)))
                self.put_ids("wikidata", q, [(p, x["value"]) for p, cs in e["claims"].items() for x in cs
                                             if isinstance(x["value"], str)] +
                             [("sitelink:" + s, t) for s, t in e["sitelinks"].items()])
            if n % 40 == 39:
                self.db.commit()
                log(f"  {min((n + 1) * 50, len(todo))}/{len(todo)}")
        self.db.commit()
        known = {p for (p,) in self.db.execute("SELECT pid FROM properties")}
        for b in batches(sorted(pids - known), 50):
            for p, e in http_json("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
                    "action": "wbgetentities", "ids": "|".join(b), "props": "labels|datatype",
                    "languages": "en", "format": "json"}))["entities"].items():
                self.db.execute("INSERT OR REPLACE INTO properties VALUES (?,?,?)",
                                (p, (e.get("labels", {}).get("en") or {}).get("value"), e.get("datatype")))
        self.db.commit()

    # ---------- English Wikipedia: article text and categories, for articles that changed ----------

    def wikipedia(self):
        owner = dict((t, q) for q, t in self.db.execute(
            "SELECT id, value FROM ids WHERE source='wikidata' AND scheme='sitelink:enwiki'"))
        have = dict(self.db.execute("SELECT id, rev FROM documents WHERE kind='wikipedia' AND status='ok'"))

        def revs(b):
            q = http_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
                "action": "query", "prop": "info", "titles": "|".join(b), "format": "json"}))["query"]
            norm = {n["to"]: n["from"] for n in q.get("normalized", [])}
            return {norm.get(p["title"], p["title"]): str(p.get("lastrevid")) for p in q["pages"].values()}

        current = {}
        for r in pmap(revs, batches(sorted(owner), 50), 4):
            current.update(r)
        todo = [t for t in owner if have.get(owner[t]) != current.get(t)]
        log(f"wikipedia: {len(owner)} articles; {len(todo)} new or changed")

        def fetch(t):
            try:
                q = http_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
                    "action": "query", "prop": "extracts|categories", "explaintext": 1, "clshow": "!hidden",
                    "cllimit": "max", "redirects": 1, "titles": t, "format": "json"}))["query"]
                p = next(iter(q["pages"].values()))
                return t, p.get("title", t), p.get("extract", ""), [c["title"][9:] for c in p.get("categories", [])], "ok"
            except Exception as err:
                return t, t, "", [], f"error: {type(err).__name__}: {str(err)[:120]}"

        for n, (t, title, text, cats, status) in enumerate(pmap(fetch, todo, 8)):
            self.put_doc(owner[t], "wikipedia", "https://en.wikipedia.org/wiki/" + urllib.parse.quote(t.replace(" ", "_")),
                         title, "CC BY-SA 4.0", current.get(t), status, text)
            self.db.execute("DELETE FROM categories WHERE article=?", (t,))
            self.db.executemany("INSERT OR IGNORE INTO categories VALUES (?,?)", [(t, c) for c in cats])
            if n % 500 == 499:
                self.db.commit()
                log(f"  {n + 1}/{len(todo)}")
        self.db.commit()

    def put_doc(self, rid, kind, url, title, license, rev, status, text, source="wikidata"):
        self.db.execute("INSERT OR REPLACE INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
            source, rid, kind, url, title, license, rev, NOW(), status,
            hashlib.sha256(text.encode()).hexdigest() if text else None, len(text),
            zlib.compress(text.encode(), 9) if text else None))

    # ---------- Official websites (Wikidata P856): the first page, as text ----------

    def websites(self):
        sites = self.db.execute("SELECT id, value FROM ids WHERE source='wikidata' AND scheme='P856'").fetchall()
        fresh = {(i, u) for i, u in self.db.execute(
            "SELECT id, url FROM documents WHERE kind='website' AND fetched_at > ?",
            (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - WEBSITE_MAX_AGE_DAYS * 86400)),))}
        todo = [(q, u) for q, u in sites if (q, u) not in fresh]
        log(f"websites: {len(sites)} listed; {len(todo)} to fetch (new, or older than {WEBSITE_MAX_AGE_DAYS} days)")

        def fetch(job):
            q, url = job
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
                with urllib.request.urlopen(req, timeout=20) as r:
                    if "html" not in (r.headers.get("Content-Type") or ""):
                        raise ValueError(f"not HTML: {r.headers.get('Content-Type')}")
                    raw = r.read(2_000_000).decode(r.headers.get_content_charset() or "utf-8", "replace")
                p = TextOf()
                p.feed(raw)
                title = re.sub(r"\s+", " ", p.title).strip()
                body = re.sub(r"\s+", " ", " ".join(p.parts))
                return q, url, title, (title + "\n" + p.meta + "\n\n" + body).strip(), "ok"
            except Exception as err:
                return q, url, None, "", f"error: {type(err).__name__}: {str(err)[:120]}"

        for n, (q, url, title, text, status) in enumerate(pmap(fetch, todo, 16)):
            self.put_doc(q, "website", url, title, "the site's own terms", None, status, text)
            if n % 500 == 499:
                self.db.commit()
                log(f"  {n + 1}/{len(todo)}")
        self.db.commit()

    # ---------- National Park Service Data API: every endpoint that lists located things ----------

    def nps_endpoint(self, ep, key):
        out, start = [], 0
        while True:
            # The API's daily allowance (50 requests a day on DEMO_KEY) answers 429: stop rather than wait it out.
            body = http_json(f"https://developer.nps.gov/api/v1/{ep}?" + urllib.parse.urlencode(
                {"stateCode": self.state["code"], "limit": 500, "start": start, "api_key": key}), tries=2, wait_cap=10)
            if not body or "data" not in body:
                raise ValueError(f"no data: {str(body)[:100]}")
            out += body["data"]
            start += len(body["data"])
            if not body["data"] or start >= int(body.get("total") or 0):
                return out

    def nps(self):
        key = os.environ.get("NPS_API_KEY") or "DEMO_KEY"
        fetched = NOW()
        for ep in NPS_ENDPOINTS:
            try:
                out = self.nps_endpoint(ep, key)
            except Exception as err:
                log(f"  nps {ep}: failed ({type(err).__name__}: {str(err)[:100]}); last run's records kept")
                continue
            source = f"nps:{ep}"
            self.db.execute("DELETE FROM records WHERE source=?", (source,))
            self.db.execute("DELETE FROM ids WHERE source=?", (source,))
            for rec in out:
                rid = rec.get("id") or hashlib.sha1(json.dumps(rec, sort_keys=True).encode()).hexdigest()[:16]
                try:
                    lat, lng = float(rec.get("latitude")), float(rec.get("longitude"))
                except (TypeError, ValueError):
                    lat = lng = None
                self.db.execute("INSERT OR REPLACE INTO records VALUES (?,?,?,?,?,?,?,?,?,?)", (
                    source, rid, rec.get("fullName") or rec.get("title") or rec.get("name"), lat, lng, rec.get("url"),
                    "public domain (images: see each credit)", None, fetched, json.dumps(rec)))
                pairs = []
                if rec.get("url"):
                    pairs.append(("url", rec["url"]))
                    slug = re.search(r"/places/([^/]+)\.htm", rec["url"])
                    if slug:
                        pairs.append(("P8649", slug.group(1)))
                if ep == "parks" and rec.get("parkCode"):
                    pairs.append(("P4083", rec["parkCode"]))
                pairs += [("parkCode", p["parkCode"]) for p in rec.get("relatedParks") or []]
                self.put_ids(source, rid, pairs)
            log(f"nps {ep}: {len(out)}")
        self.db.commit()

    # ---------- Page views: from monthly files made by pageviews_month.py ----------

    def pageviews(self, folder):
        files = sorted(glob.glob(os.path.join(folder or "", "enwiki-*.tsv.gz")))
        if not files:
            log("pageviews: no monthly files given (--pageviews); skipped")
            return
        titles = sorted({t.replace(" ", "_") for (t,) in self.db.execute(
            "SELECT value FROM ids WHERE source='wikidata' AND scheme='sitelink:enwiki'")})
        have = {m for (m,) in self.db.execute("SELECT DISTINCT month FROM pageviews")}
        wanted = set(titles)
        patterns = os.path.join(HERE, "data", f"{self.state['code']}.titles")
        with open(patterns, "w") as f:
            f.write("\n".join(f"\t{t}\t" for t in titles) + "\n")
        for path in files:
            month = re.search(r"enwiki-(\d{6})", path).group(1)
            if month in have:
                continue
            # grep -F narrows millions of lines to this state's titles quickly; the exact match is below.
            out = subprocess.run(f"gzip -dc {path} | sed 's/^/\\t/' | grep -F -f {patterns}", shell=True,
                                 capture_output=True, text=True).stdout
            rows = []
            for line in out.splitlines():
                parts = line.split("\t")
                if len(parts) >= 3 and parts[1] in wanted:
                    rows.append((parts[1].replace("_", " "), month, int(parts[2])))
            self.db.executemany("INSERT OR REPLACE INTO pageviews VALUES (?,?,?)", rows)
            self.db.commit()
            log(f"pageviews {month}: {len(rows)} of {len(titles)} articles")

    # ---------- Links: records that share an identifier ----------

    def links(self):
        """A record from another source and a Wikidata item that carry the same identifier, ignoring case: Wikidata
        writes park codes in capitals (P4083 "MORA"), the NPS API in lower case ("mora"). Starts from the other
        sources' few thousand identifiers rather than joining every identifier with every other."""
        self.db.execute("DELETE FROM links")
        self.db.execute("""INSERT OR IGNORE INTO links
                           SELECT a.source, a.id, b.source, b.id, a.scheme FROM ids a JOIN ids b
                             ON b.source = 'wikidata' AND b.scheme = a.scheme AND lower(b.value) = lower(a.value)
                           WHERE a.source != 'wikidata' AND a.scheme NOT IN ('parkCode', 'url')""")
        self.db.execute("""INSERT OR IGNORE INTO links
                           SELECT a.source, a.id, b.source, b.id, 'website' FROM ids a JOIN ids b
                             ON a.source = 'wikidata' AND a.scheme = 'P856' AND b.scheme = 'url' AND b.source != 'wikidata'
                            AND rtrim(lower(a.value), '/') = rtrim(lower(b.value), '/')""")
        self.db.commit()
        log("links:", self.db.execute("SELECT via, source_b, COUNT(*) FROM links GROUP BY 1, 2").fetchall())

    def summary(self):
        s = {
            "state": self.state["code"], "built_at": NOW(),
            "records": dict(self.db.execute("SELECT source, COUNT(*) FROM records GROUP BY 1")),
            "with_point": self.db.execute("SELECT COUNT(*) FROM records WHERE lat IS NOT NULL").fetchone()[0],
            "documents": {f"{k} {s}": n for k, s, n in self.db.execute(
                "SELECT kind, CASE WHEN status='ok' THEN 'ok' ELSE 'failed' END, COUNT(*) FROM documents GROUP BY 1, 2")},
            "pageview_months": [m for (m,) in self.db.execute("SELECT DISTINCT month FROM pageviews ORDER BY 1")],
            "links": self.db.execute("SELECT COUNT(*) FROM links").fetchone()[0],
            "bytes": os.path.getsize(self.path),
        }
        with open(os.path.join(HERE, "data", f"{self.state['code']}.json"), "w") as f:
            json.dump(s, f, indent=1)
        log(json.dumps(s))


def simple(snak):
    """A snak's value as plain JSON: an item ID, a string, a time, a quantity, a point, a text."""
    if snak.get("snaktype") != "value":
        return {"snaktype": snak.get("snaktype")}
    v = snak["datavalue"]["value"]
    if isinstance(v, dict):
        if "id" in v:
            return v["id"]
        if "time" in v:
            return {"time": v["time"], "precision": v.get("precision")}
        if "amount" in v:
            return {"amount": v["amount"], "unit": v.get("unit", "1").rsplit("/", 1)[-1]}
        if "latitude" in v:
            return {"lat": v["latitude"], "lng": v["longitude"]}
        if "text" in v:
            return {"text": v["text"], "language": v.get("language")}
    return v


def compact(e):
    """An entity without its references (most of its size): claims as plain values, with qualifiers."""
    claims = {pid: [{"value": simple(c["mainsnak"]), "rank": c.get("rank"),
                     **({"qualifiers": {q: [simple(s) for s in ss] for q, ss in c["qualifiers"].items()}}
                        if c.get("qualifiers") else {})} for c in cs]
              for pid, cs in e.get("claims", {}).items()}
    pick = lambda d: {k: (v["value"] if isinstance(v, dict) else [x["value"] for x in v])
                      for k, v in d.items() if k in ("en", "mul")}
    return {"id": e["id"], "rev": e.get("lastrevid"), "labels": pick(e.get("labels", {})),
            "descriptions": pick(e.get("descriptions", {})), "aliases": pick(e.get("aliases", {})), "claims": claims,
            "sitelinks": {k: v["title"] for k, v in e.get("sitelinks", {}).items()}}


class TextOf(html.parser.HTMLParser):
    """A page's visible text, its <title> and its meta description."""
    SKIP = {"script", "style", "noscript", "svg", "template", "iframe"}

    def __init__(self):
        super().__init__()
        self.parts, self.title, self.meta, self.skip, self.in_title = [], "", "", 0, False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag == "title":
            self.in_title = True
        elif tag == "meta":
            a = dict(attrs)
            if (a.get("name") or a.get("property") or "").lower() in ("description", "og:description"):
                self.meta = self.meta or (a.get("content") or "")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        elif tag == "title":
            self.in_title = False

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        elif not self.skip and data.strip():
            self.parts.append(data.strip())


STEPS = ["wikidata", "wikipedia", "websites", "nps", "pageviews", "links"]

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", required=True, choices=sorted(STATES))
    ap.add_argument("--limit", type=int)
    ap.add_argument("--pageviews")
    ap.add_argument("steps", nargs="*", default=STEPS)
    a = ap.parse_args()
    store = Store(a.state, a.limit)
    for step in a.steps:
        t = time.time()
        getattr(store, step)(*( [a.pageviews] if step == "pageviews" else []))
        log(f"{step} done in {time.time() - t:.0f} s")
    store.summary()
