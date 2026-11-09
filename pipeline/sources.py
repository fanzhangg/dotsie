"""The source store: each candidate's metadata and the pages written about it, fetched and kept.

A local SQLite file stands in for D1 (`spots`, `spot_sources`) and a folder of text files for R2,
as in issue #90's storage plan. Nothing here judges anything: it collects what a model (or a person)
would read to judge a place.

Sources so far: the English Wikipedia article (whole, as plain text) and the official website that
Wikidata lists (P856), its first page as text. Wikivoyage is left out on purpose: it is what the
ratings are measured against.

Run: SPOTS_AREA=SEA python3 sources.py [--sample N]   (N: the same fixed sample llm_classify.py uses)
"""
import hashlib, html.parser, json, math, os, random, re, sqlite3, statistics, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from common import CACHE, DATA, HERE, OUT, UA, entities, claim_values, get_json

DB = os.path.join(DATA, "sources.sqlite")
TEXTS = os.path.join(CACHE, "sources")
WIKI_CHARS, SITE_CHARS = 12000, 6000
MONTHS = [f"{y}{m:02d}" for y in range(2021, 2027) for m in range(1, 13)][10:70]

SCHEMA = """
CREATE TABLE IF NOT EXISTS spots (
  id TEXT PRIMARY KEY, name TEXT, lat REAL, lng REAL, description TEXT, types TEXT,
  views INTEGER, langs INTEGER, wikidata TEXT, enwiki TEXT, website TEXT
);
CREATE TABLE IF NOT EXISTS spot_sources (
  spot_id TEXT, kind TEXT, url TEXT, title TEXT, license TEXT,
  fetched_at TEXT, status TEXT, hash TEXT, text_key TEXT, chars INTEGER,
  PRIMARY KEY (spot_id, kind)
);
"""


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


def keep_text(text):
    """Store a text by its hash, like an R2 object; returns (hash, key)."""
    h = hashlib.sha256(text.encode()).hexdigest()
    key = f"{h[:2]}/{h}.txt"
    path = os.path.join(TEXTS, key)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(text)
    return h, key


def read_text(key):
    return open(os.path.join(TEXTS, key)).read() if key else ""


def wikipedia(title):
    q = get_json("https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "prop": "extracts", "explaintext": 1, "redirects": 1, "titles": title, "format": "json"}))["query"]
    page = next(iter(q["pages"].values()))
    return page.get("title", title), page.get("extract", "")[:WIKI_CHARS]


def website(url):
    """The first page of a site, as text. Page content is untrusted data, kept only as text."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=20) as r:
        if "html" not in (r.headers.get("Content-Type") or ""):
            raise ValueError(f"not HTML: {r.headers.get('Content-Type')}")
        raw = r.read(2_000_000).decode(r.headers.get_content_charset() or "utf-8", "replace")
    p = TextOf()
    p.feed(raw)
    body = re.sub(r"\s+", " ", " ".join(p.parts))
    title = re.sub(r"\s+", " ", p.title).strip()
    return title, (f"{title}\n{p.meta}\n\n{body}".strip())[:SITE_CHARS]


def sample_ids(rows, n):
    """The fixed comparison sample llm_classify.py draws: every Wikivoyage listing, then a random draw."""
    listed = set(json.load(open(os.path.join(OUT, "reference.json")))["listings"])
    rest = [r for r in rows if r["id"] not in listed]
    random.Random(7).shuffle(rest)
    return [r["id"] for r in rows if r["id"] in listed] + [r["id"] for r in rest[:max(0, n - len(listed))]]


def build(only=None):
    from llm_classify import HARD_NOT_PLACE
    rows = [r for r in json.load(open(os.path.join(DATA, "wikidata.json")))
            if r["allow"] or not set(r["block"]) & HARD_NOT_PLACE]
    pv = json.load(open(os.path.join(DATA, "views.json")))["views"]
    ents = entities([r["id"] for r in rows], props="claims|descriptions")
    db = sqlite3.connect(DB)
    db.executescript(SCHEMA)
    for r in rows:
        e = ents.get(r["id"], {})
        m = pv.get(r["enwiki"] or "")
        views = round(statistics.median([m.get(k, 0) for k in MONTHS])) if m else None
        site = next(iter(claim_values(e, "P856")), None)
        db.execute("INSERT OR REPLACE INTO spots VALUES (?,?,?,?,?,?,?,?,?,?,?)", (
            r["id"], r["name"], r["lat"], r["lng"], (e.get("descriptions", {}).get("en") or {}).get("value"),
            json.dumps(r["types"]), views, r["langs"], r["id"], r["enwiki"], site))
    db.commit()

    todo = [r for r in rows if only is None or r["id"] in only]
    jobs = []
    for r in todo:
        site = db.execute("SELECT website FROM spots WHERE id=?", (r["id"],)).fetchone()[0]
        if r["enwiki"]:
            jobs.append((r["id"], "wikipedia", "https://en.wikipedia.org/wiki/" + urllib.parse.quote(r["enwiki"].replace(" ", "_")), r["enwiki"]))
        if site:
            jobs.append((r["id"], "website", site, None))
    done = {(a, b) for a, b in db.execute("SELECT spot_id, kind FROM spot_sources WHERE status='ok'")}
    jobs = [j for j in jobs if (j[0], j[1]) not in done]

    def fetch(job):
        sid, kind, url, title = job
        try:
            title, text = wikipedia(title) if kind == "wikipedia" else website(url)
            return job, title, text, "ok"
        except Exception as err:
            return job, None, "", f"error: {type(err).__name__}: {str(err)[:120]}"

    with ThreadPoolExecutor(8) as pool:
        for (sid, kind, url, _), title, text, status in pool.map(fetch, jobs):
            h, key = keep_text(text) if text else (None, None)
            db.execute("INSERT OR REPLACE INTO spot_sources VALUES (?,?,?,?,?,?,?,?,?,?)", (
                sid, kind, url, title, "CC BY-SA 4.0" if kind == "wikipedia" else "the site's own terms",
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), status, h, key, len(text)))
    db.commit()
    n = db.execute("SELECT kind, status LIKE 'ok', COUNT(*) FROM spot_sources GROUP BY 1, 2").fetchall()
    print(f"spots {db.execute('SELECT COUNT(*) FROM spots').fetchone()[0]}; sources (kind, ok, count): {n}")


def dossier(spot_id, rows_by_id=None, nearby_m=300):
    """Everything the store has on one place, as text for a model to read."""
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    s = db.execute("SELECT * FROM spots WHERE id=?", (spot_id,)).fetchone()
    near = []
    for o in db.execute("SELECT id, name, lat, lng FROM spots WHERE id != ? AND abs(lat-?) < 0.01 AND abs(lng-?) < 0.015",
                        (spot_id, s["lat"], s["lng"])):
        p = math.pi / 180
        d = 12742 * math.asin(math.sqrt(math.sin((o["lat"] - s["lat"]) * p / 2) ** 2 + math.cos(s["lat"] * p) *
                                        math.cos(o["lat"] * p) * math.sin((o["lng"] - s["lng"]) * p / 2) ** 2)) * 1000
        if d <= nearby_m:
            near.append((d, o["name"]))
    lines = [
        f"Name: {s['name']}",
        f"Wikidata: {s['id']} — {s['description'] or '(no description)'}; instance of: {', '.join(json.loads(s['types'])) or '(none)'}",
        f"English Wikipedia page views: {'about %d a month (median of the last five years)' % s['views'] if s['views'] is not None else 'no article'}",
        f"Nearby places within {nearby_m} m: {'; '.join(f'{n} ({d:.0f} m)' for d, n in sorted(near)[:12]) or '(none)'}",
    ]
    for src in db.execute("SELECT * FROM spot_sources WHERE spot_id=? ORDER BY kind DESC", (spot_id,)):
        if src["status"] != "ok":
            lines.append(f"\n[{src['kind']}: {src['url']} could not be read: {src['status']}]")
            continue
        lines.append(f"\n<source kind=\"{src['kind']}\" url=\"{src['url']}\" fetched=\"{src['fetched_at']}\">\n"
                     f"{read_text(src['text_key'])}\n</source>")
    return "\n".join(lines)


if __name__ == "__main__":
    rows = json.load(open(os.path.join(DATA, "wikidata.json")))
    only = set(sample_ids(rows, int(sys.argv[sys.argv.index("--sample") + 1]))) if "--sample" in sys.argv else None
    build(only)
