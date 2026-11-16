"""Plans and guides put together, by spot id, into pages (docs/guides-and-plans.md).

Reads out/plans/<destination>/knowledge.json (with each spot's guide entry) and plans.json. For each plan:
  - each stop shows its guide entry and its fact card;
  - between items, how long it takes to get there, from the travel times (code, no model);
  - each day opens with a sentence or two from a small model (Haiku) that reads only the day's places and their
    one-liners, saved by a hash of those.
Writes plan-<id>.json for each plan and plans.html, a page to review them all, in out/plans/<destination>/.
Run: PLAN_DESTINATION=seattle python3 compose.py
"""
import html, json, os, time

import store
from planning import DEST_ID, HAIKU, OUT, ask, log, obj, read, spent, write

INTRO = """You write the opening of one day in a travel guide's suggested plan for {city}: one or two sentences, at most 40 words, that tell the reader what kind of day it is. Plain and specific, no hype: no "breathtaking", "must-see", "hidden gem" or exclamation marks. Use only what you're given; don't add facts about the places. Don't list every stop."""
INTRO_SCHEMA = obj({"intro": {"type": "string"}})


def facts_line(f):
    h = f["hours"]
    hours = (f"Open {h['open']}–{h['close']}" + (f", closed {', '.join(h['closed_days'])}" if h["closed_days"] else "")
             if h["kind"] == "stated" else "Open any time" if h["kind"] == "always" else "Check hours before going")
    return " · ".join(x for x in [f"About {f['visit_minutes']} min", hours, "Book ahead" if f["book_ahead"] else "",
                                  {"free": "Free", "paid": "Paid entry"}.get(f["admission"], "")] if x)


# The routers the app's local dev and the prototype use (app/web/places.js): the OSRM demo server drives, OpenStreetMap
# Germany's walks. A plan has a few legs a day, each looked up once (cached in cache/http).
OSRM = {"drive": "https://router.project-osrm.org/route/v1/driving",
        "walk": "https://routing.openstreetmap.de/routed-foot/route/v1/driving"}


def route(a, b, mode):
    """A leg on the ground: minutes and its line ([lat, lng], 5 places), or None when the router has none."""
    try:
        j = store.http_json(f"{OSRM[mode]}/{a['lng']},{a['lat']};{b['lng']},{b['lat']}?overview=full&geometries=geojson", tries=3)
    except Exception:
        return None
    if not j or j.get("code") != "Ok":
        return None
    r = j["routes"][0]
    return {"minutes": max(1, round(r["duration"] / 60)), "km": round(r["distance"] / 1000, 2),
            "coords": [[round(y, 5), round(x, 5)] for x, y in r["geometry"]["coordinates"]]}


def leg(k, a, b):
    """How to get from one spot to the next: the way the plan was made with (on foot when close), and the route on
    the ground when the router has one. Its minutes replace the straight-line estimate's."""
    t = k["travel"][a][b]
    spots = {s["id"]: s for s in k["spots"]}
    r = route(spots[a], spots[b], t["mode"])
    return {"mode": t["mode"], "estimate": t["minutes"], "minutes": r["minutes"] if r else t["minutes"],
            "coords": r["coords"] if r else None}


def transition(t):
    if not t:
        return None
    return f"{t['minutes']} min on foot" if t["mode"] == "walk" else f"About {t['minutes']} min by car or bus"


def compose(p, k, city):
    spots = {s["id"]: s for s in k["spots"]}
    days = []
    for n, day in enumerate(p["days"], 1):
        items, prev = [], None
        for it in day["items"]:
            place = it["spot_id"] if it["kind"] == "stop" else it["near"]
            s = spots.get(place)
            if not s:
                continue
            t = leg(k, prev, place) if prev and prev != place else None
            item = {"kind": it["kind"], "start": it["start"], "minutes": it["minutes"], "why": it["why"],
                    "spot_id": place, "name": s["name"], "lat": s["lat"], "lng": s["lng"], "getting_there": transition(t), "leg": t}
            if it["kind"] == "stop":
                item["facts"] = facts_line(s["facts"])
                item["guide"] = {"one_liner": s["entry"]["one_liner"], "body": s["entry"]["paragraphs"], "tips": []}
                item["links"] = [{"label": "Official site" if x["kind"] == "official website" else x["kind"].capitalize(), "url": x["url"]}
                                 for x in s["sources"]]
            items.append(item)
            prev = place
        stops = [i for i in items if i["kind"] == "stop"]
        text = f"Theme: {day['theme']}\n" + "\n".join(f"- {i['start']} {i['name']}: {i['guide']['one_liner'] or spots[i['spot_id']]['reason']}" for i in stops)
        a = ask(HAIKU, INTRO.format(city=city), text, INTRO_SCHEMA, "low", "compose-intro-v1", f"{DEST_ID}/{p['id']}/{n}")
        days.append({"day": n, "theme": day["theme"], "intro": a["intro"], "items": items, "_usage": a.get("_usage")})
    for d in days:
        d.pop("_usage", None)
    ideas = [{"spot_id": i["spot_id"], "name": spots[i["spot_id"]]["name"], "why": i["why"],
              "one_liner": spots[i["spot_id"]]["entry"]["one_liner"]}
             for i in p["ideas"] if i["spot_id"] in spots]
    return {"id": p["id"], "destination": city, "traveler": p["config"]["traveler"], "days": days, "ideas": ideas,
            "checks": p["checks"], "rounds": p["rounds"], "travel_note": k["travel_note"]}


e = lambda s: html.escape(str(s or ""))


def item_html(i):
    move = f'<li class="move">{e(i["getting_there"])}</li>' if i["getting_there"] else ""
    if i["kind"] != "stop":
        return move + f'<li class="meal"><time>{e(i["start"])}</time><div><b>{e(i["kind"].capitalize())}</b> near {e(i["name"])} · {i["minutes"]} min<p class="why">{e(i["why"])}</p></div></li>'
    g = i["guide"]
    body = "".join(f"<p>{e(b['text'])}</p>" for b in g["body"])
    tips = "".join(f"<li>{e(b['text'])}</li>" for b in g["tips"])
    links = " · ".join(f'<a href="{e(x["url"])}">{e(x["label"])}</a>' for x in i["links"])
    guide = (f'<p class="oneliner">{e(g["one_liner"])}</p><details><summary>Read the guide</summary><div class="prose">{body}</div>'
             f'{f"<ul class=tips>{tips}</ul>" if tips else ""}</details>') if g["one_liner"] else '<p class="none">No guide entry yet.</p>'
    return move + f"""<li class="stop"><time>{e(i['start'])}</time><div>
      <h4>{e(i['name'])} <span>{i['minutes']} min</span></h4>
      <p class="why">{e(i['why'])}</p>{guide}
      <p class="facts">{e(i['facts'])}</p><p class="links">{links}</p></div></li>"""


def page(composed, k, plans):
    sections = ""
    for c in composed:
        days = "".join(f"""<section class="day"><h3>Day {d['day']} <span>{e(d['theme'])}</span></h3><p class="intro">{e(d['intro'])}</p>
          <ol class="timeline">{''.join(item_html(i) for i in d['items'])}</ol></section>""" for d in c["days"])
        ideas = "".join(f"<li><b>{e(i['name'])}</b>{(' — ' + e(i['one_liner'])) if i['one_liner'] else ''}<br><span>{e(i['why'])}</span></li>" for i in c["ideas"])
        errs = "".join(f'<li class="err">{e(x)}</li>' for x in c["checks"]["errors"])
        warns = "".join(f"<li>{e(x)}</li>" for x in c["checks"]["warnings"])
        sections += f"""<article class="plan"><header><div class="eyebrow">Plan · {e(c['id'])}</div>
          <h2>{len(c['days'])} days in {e(c['destination'])}</h2><p class="lede">For {e(c['traveler'])}.</p></header>{days}
          <section><h3>Want to go</h3><p class="note">Places that didn't fit, as a trip's Want to go list.</p><ul class="ideas">{ideas}</ul></section>
          <section class="review"><h3>Checks</h3><p class="note">Drafted in {c['rounds']} round{'s' if c['rounds'] > 1 else ''}; errors send a plan back to the model, warnings don't. {e(c['travel_note'])}</p>
          <ul>{errs or '<li>No errors.</li>'}{warns}</ul></section></article>"""
    costs = {**k["cost"], **plans["cost"], **spent()}
    return f"""<title>{e(k['destination'])} plans</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,400;0,600;1,400&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono&display=swap">
<style>
/* One reading column, like picks.html: a plan's days as timelines, each stop with its guide entry folded away. */
:root {{
  --paper: #f6f8f7; --ink: #1b2422; --muted: #5d6965; --line: #dbe2df; --accent: #1e5d61; --tint: #e6efee; --warn: #a3401c;
  --serif: "Spectral", Georgia, "Times New Roman", serif; --sans: "IBM Plex Sans", system-ui, sans-serif; --mono: "IBM Plex Mono", ui-monospace, monospace;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --paper: #121817; --ink: #e3ebe8; --muted: #95a39e; --line: #27322f; --accent: #7cc1c4; --tint: #1b2928; --warn: #ef8a62; color-scheme: dark }} }}
:root[data-theme="dark"] {{ --paper: #121817; --ink: #e3ebe8; --muted: #95a39e; --line: #27322f; --accent: #7cc1c4; --tint: #1b2928; --warn: #ef8a62; color-scheme: dark }}
* {{ box-sizing: border-box }}
body {{ background: var(--paper); color: var(--ink); font: 16px/1.6 var(--sans); margin: 0; }}
main {{ max-width: 46rem; margin: 0 auto; padding-block: 48px 72px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 40px; }}
a {{ color: var(--accent); text-underline-offset: 3px; }}
a:focus-visible, summary:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 2px; }}
.plan {{ display: grid; gap: 32px; }}
.plan > header {{ display: grid; gap: 10px; }}
.eyebrow {{ font: 500 12px/1.2 var(--sans); letter-spacing: .1em; text-transform: uppercase; color: var(--accent); }}
h2 {{ font: 600 clamp(36px, 7vw, 56px)/1.05 var(--serif); margin: 0; text-wrap: balance; }}
.lede {{ font: 400 19px/1.5 var(--serif); color: var(--muted); margin: 0; max-width: 60ch; }}
h3 {{ font: 600 24px/1.25 var(--serif); margin: 0 0 6px; }}
h3 span {{ font: 500 15px/1.3 var(--sans); color: var(--muted); margin-left: 8px; }}
.day {{ border-top: 1px solid var(--line); padding-top: 24px; }}
.intro {{ font: italic 400 18px/1.5 var(--serif); margin: 0 0 16px; max-width: 62ch; }}
.timeline {{ list-style: none; margin: 0; padding: 0; display: grid; }}
.timeline > li {{ display: grid; grid-template-columns: 3.6rem minmax(0, 1fr); gap: 14px; }}
.timeline time {{ font: 500 14px/1.9 var(--mono); color: var(--accent); font-variant-numeric: tabular-nums; }}
.stop > div, .meal > div {{ border-left: 2px solid var(--line); padding: 2px 0 18px 16px; display: grid; gap: 6px; min-width: 0; }}
.meal > div {{ font-size: 15px; color: var(--muted); }}
.move {{ display: block !important; padding: 0 0 12px calc(3.6rem + 14px + 18px); font: 13px/1.4 var(--sans); color: var(--muted); }}
.move::before {{ content: "↓ "; color: var(--accent); }}
h4 {{ font: 600 20px/1.25 var(--serif); margin: 0; }}
h4 span {{ font: 400 13px var(--mono); color: var(--muted); margin-left: 6px; }}
.why {{ margin: 0; font: 14px/1.5 var(--sans); color: var(--muted); }}
.oneliner {{ font: italic 400 17px/1.45 var(--serif); margin: 0; }}
details summary {{ cursor: pointer; font: 500 13px/1.4 var(--sans); color: var(--accent); }}
.prose {{ display: grid; gap: 10px; font: 16px/1.6 var(--serif); margin-top: 8px; }}
.prose p {{ margin: 0; max-width: 65ch; }}
.tips {{ margin: 10px 0 0; padding-left: 18px; font: 14px/1.5 var(--sans); }}
.facts {{ margin: 0; padding: 6px 10px; background: var(--tint); border-radius: 4px; font: 13px/1.5 var(--sans); justify-self: start; }}
.links, .none {{ margin: 0; font: 12.5px/1.5 var(--sans); color: var(--muted); }}
.note {{ margin: 0 0 12px; font: 14px/1.5 var(--sans); color: var(--muted); max-width: 62ch; }}
.ideas {{ list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; font: 15px/1.5 var(--sans); }}
.ideas span {{ color: var(--muted); font-size: 14px; }}
.review ul {{ margin: 0; padding-left: 18px; font: 14px/1.55 var(--sans); display: grid; gap: 4px; }}
.err {{ color: var(--warn); font-weight: 600; }}
footer {{ font: 13px/1.6 var(--sans); color: var(--muted); border-top: 1px solid var(--line); padding-top: 16px; }}
@media (max-width: 520px) {{ .timeline > li {{ grid-template-columns: minmax(0, 1fr); gap: 2px; }} .move {{ padding-left: 18px; }} }}
</style>
<main>{sections}
<footer>Made by four separate steps: facts (Claude Haiku), guide (Claude Opus, from the sources only), plan (Claude Opus, from the facts only) and day intros (Claude Haiku). Travel times are straight-line estimates. Model cost: ${sum(costs.values()):.2f} ({', '.join(f'{key} ${v:.2f}' for key, v in costs.items())}). Guide text is CC BY-SA 4.0, adapted from the Wikipedia articles linked under each stop. For review: nothing here is published.</footer>
</main>
"""


def main():
    k, plans = read("knowledge.json"), read("plans.json")
    composed = [compose(p, k, k["destination"]) for p in plans["plans"]]
    for c in composed:
        write(f"plan-{c['id']}.json", c)
    with open(os.path.join(OUT, "plans.html"), "w") as f:
        f.write(page(composed, k, plans))
    log(f"wrote {os.path.join(OUT, 'plans.html')}; model cost this run: ${sum(spent().values()):.2f}")


if __name__ == "__main__":
    main()
