"""Compare the LLM classification (llm_classify.py) with the rule-based pipeline on one area.

Both get the same popularity rules: tier 1 at 3,000 views a month and 5 languages; tier 2 above
one views floor (the LLM side has no per-type floors, since the model decides what is a sight).
Measured against Wikivoyage's "see" listings and the area's canaries. Writes out/<area>/llm-compare.json.
"""
import json, os, statistics
from common import DATA, OUT
from config import TIER1
from llm_classify import PROMPT_VERSION
from canaries import CANARIES
MONTHS = [f"{y}{m:02d}" for y in range(2021, 2027) for m in range(1, 13)][10:70]

rows = json.load(open(os.path.join(DATA, "wikidata.json")))
llm = json.load(open(os.path.join(DATA, f"llm-{PROMPT_VERSION}.json")))
v = json.load(open(os.path.join(DATA, "views.json")))
rules = {r["id"]: r for r in json.load(open(os.path.join(OUT, "spots.json")))["rows"]}
listings = json.load(open(os.path.join(OUT, "reference.json")))["listings"]
by_name = {}
for r in rows:
    by_name.setdefault(r["name"].lower(), r)
for r in rows:
    m = v["views"].get(r["enwiki"] or "", {})
    r["views"] = statistics.median([m.get(k, 0) for k in MONTHS]) if m else 0


def llm_tiers(floor):
    """id -> 1, 2 or ("part", host id); with no entry for what's left out."""
    keep = {}
    for r in rows:
        j = llm.get(r["id"])
        if not j or "error" in j:
            continue
        if not (j["is_place"] and j["exists"] and j["visitable"] != "no" and j["destination"] != "no"):
            continue
        if r["views"] >= TIER1["views"] and r["langs"] >= TIER1["langs"]:
            keep[r["id"]] = 1
        elif r["views"] >= floor:
            keep[r["id"]] = 2
    # Parts hang under their host when the host is kept; a part whose host isn't kept stands alone.
    out = dict(keep)
    for q in keep:
        j = llm[q]
        host = by_name.get((j.get("part_of") or "").lower())
        if j["destination"] == "part" and host and host["id"] in keep and host["id"] != q \
                and llm[host["id"]]["destination"] == "standalone":
            out[q] = ("part", host["id"])
    return out


def rule_tiers():
    out = {}
    for q, r in rules.items():
        if r.get("tier"):
            out[q] = r["tier"]
        elif r.get("role") == "part":
            out[q] = ("part", r["host"])
    return out


def score(t):
    standalone = {q for q, x in t.items() if x in (1, 2)}
    shown = set(t)
    canary = []
    for group, key, want in (("tier1", "tier1", {1}), ("any", "any", {1, 2, "part"}), ("never", "never", {None})):
        for n in CANARIES[key]:
            r = by_name.get(n.lower())
            x = t.get(r["id"]) if r else None
            x = "part" if isinstance(x, tuple) else x
            canary.append({"group": group, "name": n, "ok": x in want, "got": x})
    return {
        "tier1": sum(1 for x in t.values() if x == 1), "tier2": sum(1 for x in t.values() if x == 2),
        "parts": sum(1 for x in t.values() if isinstance(x, tuple)),
        "recall": round(sum(1 for q in listings if q in shown) / len(listings), 3),
        "precision": round(sum(1 for q in standalone if q in listings) / len(standalone), 3) if standalone else None,
        "tier1_precision": round(sum(1 for q, x in t.items() if x == 1 and q in listings) /
                                 max(1, sum(1 for x in t.values() if x == 1)), 3),
        "canaries": f"{sum(c['ok'] for c in canary)}/{len(canary)}",
        "canary_fails": [c for c in canary if not c["ok"]],
    }


name = {r["id"]: r["name"] for r in rows}
rule = rule_tiers()
result = {"rules": score(rule)}
for floor in (100, 150, 300):
    result[f"llm_{floor}"] = score(llm_tiers(floor))
main = llm_tiers(150)


def why(q):
    j = llm.get(q, {})
    return {k: j.get(k) for k in ("is_place", "exists", "visitable", "destination", "part_of", "kind", "reason")}


result["only_llm"] = [{"name": name[q], "views": round(next(r["views"] for r in rows if r["id"] == q)),
                       "in_wikivoyage": q in listings, "rules_drop": rules.get(q, {}).get("drop"), "llm": why(q)}
                      for q in main if q not in rule]
result["only_rules"] = [{"name": name.get(q, q), "views": round(rules[q]["views"]), "in_wikivoyage": q in listings,
                         "llm": why(q)} for q in rule if q not in main and q in name]
result["errors"] = [q for q, j in llm.items() if "error" in j]
with open(os.path.join(OUT, "llm-compare.json"), "w") as f:
    json.dump(result, f, indent=1, ensure_ascii=False)
for k in ("rules", "llm_100", "llm_150", "llm_300"):
    s = result[k]
    print(f"{k:8} tier1 {s['tier1']:3} tier2 {s['tier2']:3} parts {s['parts']:3}  recall {s['recall']}  "
          f"precision {s['precision']}  tier1 precision {s['tier1_precision']}  canaries {s['canaries']}")
print("only LLM:", len(result["only_llm"]), "only rules:", len(result["only_rules"]), "errors:", len(result["errors"]))
