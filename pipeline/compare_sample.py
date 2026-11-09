"""Compare prompt versions on the fixed sample (the ids in llm-v2-opus-sample.json) of one area.

Each version's ratings are measured on the same items: how many get each star, Wikivoyage recall and
precision within the sample, agreement with Opus (v2), and median page views per star.
Run: SPOTS_AREA=SEA python3 compare_sample.py v3v-haiku v4-haiku v6-haiku-sample
"""
import json, os, statistics, sys
from collections import Counter
from common import DATA, OUT

opus = json.load(open(os.path.join(DATA, "llm-v2-opus-sample.json")))
sample = list(opus)
listings = json.load(open(os.path.join(OUT, "reference.json")))["listings"]
rows = {r["id"]: r for r in json.load(open(os.path.join(DATA, "wikidata.json")))}
pv = json.load(open(os.path.join(DATA, "views.json")))["views"]
MONTHS = [f"{y}{m:02d}" for y in range(2021, 2027) for m in range(1, 13)][10:70]
views = {q: statistics.median([pv.get(rows[q]["enwiki"] or "", {}).get(k, 0) for k in MONTHS]) for q in sample}
eff = lambda j: j["stars"] if j and "error" not in j and j["is_place"] and j["exists"] and j["visitable"] != "no" else 0
listed = [q for q in sample if q in listings]


def report(name, res):
    s = {q: eff(res.get(q)) for q in sample}
    two = [q for q in sample if s[q] >= 2]
    one = [q for q in sample if s[q] >= 1]
    agree = sum(s[q] == eff(opus[q]) for q in sample) / len(sample)
    by = {k: round(statistics.median([views[q] for q in sample if s[q] == k] or [0])) for k in (0, 1, 2, 3)}
    c = Counter(s.values())
    print(f"{name:18} ★★★ {c[3]:2} ★★ {c[2]:3} ★ {c[1]:3} 0 {c[0]:3} | WV recall ★+ {sum(s[q] >= 1 for q in listed) / len(listed):.2f} "
          f"★★+ {sum(s[q] >= 2 for q in listed) / len(listed):.2f} | precision ★★+ {sum(q in listings for q in two) / max(1, len(two)):.2f} "
          f"★+ {sum(q in listings for q in one) / max(1, len(one)):.2f} | = Opus {agree:.2f} | views by stars {by}")
    return s


report("opus-v2 (ref)", opus)
results = {}
for v in sys.argv[1:]:
    results[v] = report(v, json.load(open(os.path.join(DATA, f"llm-{v}.json"))))
if len(sys.argv) > 2:
    a, b = sys.argv[-2], sys.argv[-1]
    ra, rb = json.load(open(os.path.join(DATA, f"llm-{a}.json"))), json.load(open(os.path.join(DATA, f"llm-{b}.json")))
    diff = [q for q in sample if results[a][q] != results[b][q]]
    print(f"\n{len(diff)} of {len(sample)} differ between {a} and {b}:")
    for q in sorted(diff, key=lambda q: -views[q]):
        print(f"  {rows[q]['name'][:32]:32} {'WV' if q in listings else '  '} {results[a][q]} -> {results[b][q]} | {rb[q]['reason'][:110]}")
