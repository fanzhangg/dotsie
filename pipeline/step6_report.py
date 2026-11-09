"""The review page: checks, tiers, notable drops and findings, as one HTML file (out/report.html)."""
import json, os
from common import HERE, OUT, outline
from config import AREA, AREA_CODE, TIER1, FLOORS

data = json.load(open(os.path.join(OUT, "spots.json")))
checks = json.load(open(os.path.join(OUT, "checks.json")))
findings = json.load(open(os.path.join(HERE, f"findings-{AREA_CODE}.json")))
reference = json.load(open(os.path.join(OUT, "reference.json")))
rows = data["rows"]
by_id = {r["id"]: r for r in rows}


def slim(r):
    return {
        "id": r["id"], "name": r["name"], "tier": r.get("tier"), "kind": (r["types"] or ["?"])[0],
        "views": round(r["views"]), "langs": r["langs"], "lat": round(r["lat"], 4), "lng": round(r["lng"], 4),
        "parent": by_id[r["parent"]]["name"] if r.get("parent") in by_id else None,
        "source": "NPS" if r["id"].startswith("nps:") else "Wikidata",
        "rescued": bool(r.get("rescued")), "rising": r.get("rising", False),
        "mentions": r.get("nps_mentions"), "neutral": r["class"] == "neutral",
        "url": r["nps"][0]["url"] if r["id"].startswith("nps:") else f"https://www.wikidata.org/wiki/{r['id']}",
        "drop": r["drop"], "family": r.get("family"), "override": r.get("override"),
        "role": r.get("role"), "host": (by_id[r["host"]]["name"] if r.get("host") in by_id else None),
        "parts": [by_id[p]["name"] for p in r.get("parts", []) if p in by_id],
        "area": r["class"] == "area",
    }


by_id.update({r["id"]: r for r in rows})
tiered = sorted((slim(r) for r in rows if r.get("tier")), key=lambda r: (r["tier"], -r["views"], r["name"]))
parts = sorted((slim(r) for r in rows if r.get("role") == "part"), key=lambda r: (r["host"] or "", r["name"]))
dropped = sorted((slim(r) for r in rows if not r.get("tier") and not r.get("role") and r["views"] >= 1500),
                 key=lambda r: -r["views"])[:80]
payload = {
    "tiered": tiered, "parts": parts, "dropped": dropped, "checks": checks, "findings": findings, "outline": outline(), "reference": reference, "area": AREA["name"],
    "stats": {
        "candidates": sum(1 for r in rows if not r["id"].startswith("nps:")),
        "nps_places": len(data["nps_only"]) + sum(1 for r in rows if r.get("nps")),
        "tier1": sum(1 for r in tiered if r["tier"] == 1), "tier2": sum(1 for r in tiered if r["tier"] == 2),
        "passed": sum(1 for c in checks if c["ok"]), "checks": len(checks), "parts": len(parts),
        "tier1_rule": TIER1, "floors": FLOORS,
    },
}
template = open(os.path.join(HERE, "report.template.html")).read()
TEXT = {
    "WA": ("华盛顿州景点试点", "用 Wikidata、英文维基五年浏览量和 NPS 数据 API，把华盛顿州的候选地点筛成两档：第一档值得专程去，第二档值得绕路去。这一页用来审核结果，并核对方案里哪些规则成立、哪些要改。"),
    "SEA": ("西雅图市景点试点", "同一套流程跑在西雅图市内：从全州候选里按人口普查局的城市边界圈出来，再筛成两档。城市里景点密、写字楼和基础设施多，用来检验规则在城市里是否站得住，并用 Wikivoyage 的景点条目当参照。"),
}[AREA_CODE]
template = template.replace("__TITLE__", TEXT[0]).replace("__LEDE__", TEXT[1])
html = template.replace("/*DATA*/null", json.dumps(payload, ensure_ascii=False).replace("</", "<\\/"))
with open(os.path.join(OUT, "report.html"), "w") as f:
    f.write(html)
print(f"wrote out/{AREA_CODE}/report.html", len(html) // 1024, "KB")
