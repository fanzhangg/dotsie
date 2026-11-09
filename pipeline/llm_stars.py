"""Evaluate star ratings (prompt v2): Haiku on every candidate, Opus on a sample, and the rules.

A candidate is shown when the model says it is a place, still there, can be visited, and has at least
one star. A part hangs under its host when the host is shown. Measured against Wikivoyage's "see"
listings and the area's canaries; Haiku is compared with Opus on the sample. Prints a summary and
writes out/<area>/llm-stars.json.
"""
import json, os, statistics
from collections import Counter
from common import DATA, OUT
from canaries import CANARIES

MONTHS = [f"{y}{m:02d}" for y in range(2021, 2027) for m in range(1, 13)][10:70]
rows = json.load(open(os.path.join(DATA, "wikidata.json")))
v = json.load(open(os.path.join(DATA, "views.json")))
for r in rows:
    m = v["views"].get(r["enwiki"] or "", {})
    r["views"] = statistics.median([m.get(k, 0) for k in MONTHS]) if m else 0
by_id = {r["id"]: r for r in rows}
by_name = {}
for r in sorted(rows, key=lambda r: -r["views"]):
    by_name.setdefault(r["name"].lower(), r)
listings = json.load(open(os.path.join(OUT, "reference.json")))["listings"]
import sys
VERSION = sys.argv[1] if len(sys.argv) > 1 else "v2"
OPUS = sys.argv[2] if len(sys.argv) > 2 else "v2"
haiku = json.load(open(os.path.join(DATA, f"llm-{VERSION}-haiku.json")))
opus_path = os.path.join(DATA, f"llm-{OPUS}-opus-sample.json")
opus = json.load(open(opus_path)) if os.path.exists(opus_path) else {}
rules = {r["id"]: r for r in json.load(open(os.path.join(OUT, "spots.json")))["rows"]}


def shown(j):
    return j and "error" not in j and j["is_place"] and j["exists"] and j["visitable"] != "no" and j["stars"] >= 1


def place(res):
    """id -> ("standalone", stars) or ("part", host id, stars), for what is shown."""
    out = {q: ("standalone", j["stars"]) for q, j in res.items() if shown(j)}
    for q, j in res.items():
        if q in out and j["role"] == "part":
            host = by_name.get((j["part_of"] or "").lower())
            if host and host["id"] != q and out.get(host["id"], ("",))[0] == "standalone":
                out[q] = ("part", host["id"], j["stars"])
    return out


def metrics(t, among=None):
    ids = set(among) if among is not None else None
    if ids is not None:
        t = {q: x for q, x in t.items() if q in ids}
    lst = [q for q in listings if ids is None or q in ids]
    alone = {q: x[1] for q, x in t.items() if x[0] == "standalone"}
    out = {
        "3": sum(1 for s in alone.values() if s == 3), "2": sum(1 for s in alone.values() if s == 2),
        "1": sum(1 for s in alone.values() if s == 1), "parts": sum(1 for x in t.values() if x[0] == "part"),
        "recall": round(sum(1 for q in lst if q in t) / len(lst), 3) if lst else None,
        "recall_2plus": round(sum(1 for q in lst if alone.get(q, 0) >= 2 or (q in t and t[q][0] == "part")) / len(lst), 3) if lst else None,
    }
    for k in (1, 2, 3):
        sel = [q for q, s in alone.items() if s >= k]
        out[f"precision_{k}plus"] = round(sum(1 for q in sel if q in listings) / len(sel), 3) if sel else None
    return out


def canaries(t):
    res = []
    for group, key in (("tier1", "tier1"), ("any", "any"), ("never", "never")):
        for n in CANARIES[key]:
            r = by_name.get(n.lower())
            x = t.get(r["id"]) if r else None
            stars = x[-1] if x else 0
            ok = {"tier1": stars == 3, "any": x is not None, "never": x is None}[group]
            res.append({"group": group, "name": n, "ok": ok, "got": (x[0] + " " + "★" * stars) if x else None})
    return res


def rule_place():
    out = {}
    for q, r in rules.items():
        if r.get("tier"):
            out[q] = ("standalone", 3 if r["tier"] == 1 else 2)
        elif r.get("role") == "part":
            out[q] = ("part", r["host"], 2)
    return out


H, O, R = place(haiku), place(opus), rule_place()
sample = list(opus)
result = {"haiku": metrics(H), "rules": metrics(R), "haiku_sample": metrics(H, sample), "opus_sample": metrics(O, sample)}
for k in ("haiku", "rules"):
    c = canaries(H if k == "haiku" else R)
    result[k]["canaries"] = f"{sum(x['ok'] for x in c)}/{len(c)}"
    result[k]["canary_fails"] = [x for x in c if not x["ok"]]

# Haiku against Opus on the sample.
pairs = [(haiku[q], opus[q]) for q in sample if q in haiku and "error" not in haiku[q] and "error" not in opus[q]]
eff = lambda j: j["stars"] if shown(j) else 0
result["agreement"] = {} if not pairs else {
    "n": len(pairs),
    "stars_exact": round(sum(eff(a) == eff(b) for a, b in pairs) / len(pairs), 3),
    "stars_within_1": round(sum(abs(eff(a) - eff(b)) <= 1 for a, b in pairs) / len(pairs), 3),
    "shown_same": round(sum(shown(a) == shown(b) for a, b in pairs) / len(pairs), 3),
    "is_place_same": round(sum(a["is_place"] == b["is_place"] for a, b in pairs) / len(pairs), 3),
    "exists_same": round(sum(a["exists"] == b["exists"] for a, b in pairs) / len(pairs), 3),
    "role_same": round(sum(a["role"] == b["role"] for a, b in pairs) / len(pairs), 3),
    "confusion": {f"opus {s}": dict(Counter(eff(a) for a, b in pairs if eff(b) == s)) for s in range(4)},
}
result["disagree"] = [{"name": by_id[q]["name"], "views": round(by_id[q]["views"]), "wikivoyage": q in listings,
                       "haiku": f"{eff(haiku[q])} {haiku[q]['reason']}", "opus": f"{eff(opus[q])} {opus[q]['reason']}"}
                      for q in sample if q in haiku and abs(eff(haiku[q]) - eff(opus[q])) >= 2]
result["views_by_stars"] = {s: round(statistics.median([by_id[q]["views"] for q, j in haiku.items() if shown(j) and j["stars"] == s] or [0]))
                            for s in (1, 2, 3)}
result["haiku_3"] = sorted((by_id[q]["name"] for q, x in H.items() if x == ("standalone", 3)))
result["haiku_2"] = sorted((by_id[q]["name"] for q, x in H.items() if x == ("standalone", 2)))
result["errors"] = {"haiku": sum(1 for j in haiku.values() if "error" in j), "opus": sum(1 for j in opus.values() if "error" in j)}
with open(os.path.join(OUT, f"llm-stars-{VERSION}.json"), "w") as f:
    json.dump(result, f, indent=1, ensure_ascii=False)

fmt = lambda m: (f"★★★ {m['3']:3} ★★ {m['2']:3} ★ {m['1']:3} parts {m['parts']:3} | recall {m['recall']} (★★+ {m['recall_2plus']}) | "
                 f"precision ★+ {m['precision_1plus']} ★★+ {m['precision_2plus']} ★★★ {m['precision_3plus']}")
for k in ("rules", "haiku") + (("haiku_sample", "opus_sample") if pairs else ()):
    print(f"{k:13} {fmt(result[k])}" + (f" | canaries {result[k]['canaries']}" if "canaries" in result[k] else ""))
if pairs:
    print("agreement:", {k: v for k, v in result["agreement"].items() if k != "confusion"})
    print("confusion (rows: Opus stars -> Haiku stars):", result["agreement"]["confusion"])
print("median views by Haiku stars:", result["views_by_stars"])
print("errors:", result["errors"])
