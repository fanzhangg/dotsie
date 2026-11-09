"""Views: monthly English Wikipedia pageviews (user agents only) for five years, from the
Pageviews API. One request per title covers every month; responses are cached on disk.

Pageviews count a title, not an article, so two fixes:
- A sitelink to a redirect (Ape Cave -> a section of another article) is resolved to its target.
- An article moved during the window has its earlier months under the old title, so the views
  of every redirect to an article whose series starts late are added in."""
import json, os, re, urllib.parse
from concurrent.futures import ThreadPoolExecutor
from common import CACHE, DATA, OUT, HERE, get_json
from config import VIEWS_START, VIEWS_END

API = "https://en.wikipedia.org/w/api.php?"
rows = json.load(open(os.path.join(DATA, "wikidata.json")))
# Blocked items are skipped, except those an NPS place shares a name with (NPS can rescue them)
# and those in overrides.json.
norm = lambda t: re.sub(r"[^a-z0-9]", "", t.lower())
nps_names = {norm(p["title"]) for p in json.load(open(os.path.join(DATA, "nps.json")))["places"]}
overridden = set(json.load(open(os.path.join(HERE, "overrides.json"))))
titles = sorted({r["enwiki"] for r in rows if r["enwiki"] and (
    r["class"] != "block" or norm(r["name"]) in nps_names or r["id"] in overridden)})
print("articles", len(titles))


def batches(xs, n=50):
    return [xs[i:i + n] for i in range(0, len(xs), n)]


# Sitelinks that are redirects.
targets = {}
for b in batches(titles):
    q = get_json(API + urllib.parse.urlencode({"action": "query", "titles": "|".join(b), "redirects": 1, "format": "json"}))["query"]
    norm = {n["from"]: n["to"] for n in q.get("normalized", [])}
    for rd in q.get("redirects", []):
        targets[rd["from"]] = {"to": rd["to"], "section": rd.get("tofragment")}
    for f, t in norm.items():
        if t in targets:
            targets[f] = targets[t]


def fetch(title):
    t = urllib.parse.quote(title.replace(" ", "_"), safe="")
    url = ("https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/"
           f"all-access/user/{t}/monthly/{VIEWS_START}/{VIEWS_END}")
    body = get_json(url)
    return title, {i["timestamp"][:6]: i["views"] for i in (body or {}).get("items", [])}


with ThreadPoolExecutor(8) as pool:
    views = dict(pool.map(fetch, titles))

# Articles whose series starts after the window opens, or whose first year is far below their
# last (the article was moved and its old title kept the views): add their redirects' views.
def late_start(m):
    if not m or min(m) > VIEWS_START[:6]:
        return True
    xs = [m[k] for k in sorted(m)]
    first, last = sorted(xs[:12])[6], sorted(xs[-12:])[6]
    return last >= 50 and first < last / 5

late = [t for t, m in views.items() if late_start(m)]
redirects = {}
for b in batches(late):
    q = get_json(API + urllib.parse.urlencode({"action": "query", "titles": "|".join(b), "prop": "redirects",
                                               "rdlimit": "max", "rdnamespace": 0, "format": "json"}))["query"]
    for p in q.get("pages", {}).values():
        redirects[p["title"]] = [r["title"] for r in p.get("redirects", [])]
extra = sorted({r for rs in redirects.values() for r in rs})
with ThreadPoolExecutor(8) as pool:
    extra_views = dict(pool.map(fetch, extra))
for t, rs in redirects.items():
    if t in views:
        m = dict(views[t])
        for r in rs:
            for k, v in extra_views.get(r, {}).items():
                m[k] = m.get(k, 0) + v
        views[t] = m
print("late series", len(late), "redirect titles", len(extra), "sitelinks to redirects", len(targets))

# Each article's (visible) categories, for what Wikidata doesn't say: closed, demolished, not a place.
categories = {}
for b in batches(titles):
    params = {"action": "query", "titles": "|".join(b), "prop": "categories", "clshow": "!hidden",
              "cllimit": "max", "redirects": 1, "format": "json"}
    cont = {}
    while True:
        q = get_json(API + urllib.parse.urlencode({**params, **cont}))
        back = {rd["to"]: rd["from"] for rd in q["query"].get("redirects", [])}
        back.update({n["to"]: n["from"] for n in q["query"].get("normalized", [])})
        for p in q["query"]["pages"].values():
            t = back.get(p["title"], p["title"])
            categories.setdefault(t, []).extend(c["title"].removeprefix("Category:") for c in p.get("categories", []))
        if "continue" not in q:
            break
        cont = q["continue"]

with open(os.path.join(DATA, "views.json"), "w") as f:
    json.dump({"views": views, "targets": targets, "categories": categories}, f)
