"""Trip plans for a destination, from its fact cards, areas and travel times only (docs/guides-and-plans.md).

Reads out/plans/<destination>/knowledge.json, never guide text. One plan for each row of PLANS:
  1. Draft (Opus): days of stops and meals, each with a start time and a length, and the places that didn't fit as
     ideas (a trip's Want to go list).
  2. Check (code): open at that time, time to get from one item to the next, each day's travel and length, a lunch
     each day, no place twice. What fails goes back to the model to fix, at most REPAIRS times; what's still wrong
     after that is kept with the plan.
Warnings (hours the sources don't give, a place closed some weekdays, a short visit) are kept but don't send it back.

Writes out/plans/<destination>/plans.json. Run: PLAN_DESTINATION=seattle python3 plan.py
"""
import json, time

from knowledge import digest
from planning import DEST_ID, OPUS, ask, log, obj, read, spent, write

PLANS = [{"id": "first-visit-3d", "days": 3,
          "traveler": "a first visit: someone who hasn't been before and wants the places the city is known for, at an easy pace"}]
LIMITS = {"start": "08:30", "end": "21:30", "travel": 90, "lunch": ("11:30", "14:30"), "slack": 5}
REPAIRS = 3

PLAN = """You plan days for visitors to {city}. You get the places to choose from, each with its facts, the areas they're grouped into and the travel time from each place to each other one. Plan {days} days for {traveler}.

- Each day is an ordered list of items. An item is a stop at one of the places ("stop", with its id as spot_id) or a meal ("lunch" or "dinner", spot_id null, near: the id of the place it's next to). Each has a start ("HH:MM", 24-hour) and minutes.
- Leave time to get from one item to the next: an item starts no earlier than the previous one ends plus the travel time between their places. A meal is at the place it's near, so getting to it from that place takes no time.
- Visit a place only while it's open, and at its best time of day where you can. Where opening hours are unknown, keep to usual hours (10:00 to 17:00) for a museum or an attraction.
- Stay about as long as its visit_minutes; shorter is fine for a place that's on the way.
- Keep each day to one area or neighbouring ones: at most {travel} minutes of travel in a day.
- Lunch every day between {lunch_from} and {lunch_to}; dinner if the day goes past 18:30.
- A full day but not a rushed one, from no earlier than {start} to no later than {end}.
- Not every place has to fit. Put the ones that don't under ideas, each with a sentence on when it would fit.
- theme: a few words for each day. why: one short sentence for each item, on why it's there at that time.
- Use only the facts given. Don't describe the places: a guide does that."""
ITEM = obj({"kind": {"type": "string", "enum": ["stop", "lunch", "dinner"]}, "spot_id": {"type": ["string", "null"]},
            "near": {"type": ["string", "null"]}, "start": {"type": "string"}, "minutes": {"type": "integer"}, "why": {"type": "string"}})
PLAN_SCHEMA = obj({"days": {"type": "array", "items": obj({"theme": {"type": "string"}, "items": {"type": "array", "items": ITEM}})},
                   "ideas": {"type": "array", "items": obj({"spot_id": {"type": "string"}, "why": {"type": "string"}})}})
VERSION = "plan-v1"


def mins(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def hhmm(n):
    return f"{n // 60:02d}:{n % 60:02d}"


def describe(k):
    """The places, areas and travel times as the model reads them, with short ids (s1, s2…) in place of Wikidata's."""
    short = {s["id"]: f"s{i}" for i, s in enumerate(k["spots"], 1)}
    area = {a["id"]: a["name"] for a in k["areas"]}
    lines = ["Places:"]
    for s in k["spots"]:
        f, h = s["facts"], s["facts"]["hours"]
        hours = (f"open {h['open']}–{h['close']}" + (f", closed {', '.join(h['closed_days'])}" if h["closed_days"] else "")
                 if h["kind"] == "stated" else "open at any hour" if h["kind"] == "always" else "hours unknown")
        lines.append(f"[{short[s['id']]}] {s['name']} | {area[s['area']]} | editor's rank {s['rank']} | visit_minutes {f['visit_minutes']} | "
                     f"{hours} | best: {f['best_time']} ({f['best_time_why']}) | {f['setting']} | "
                     f"{'book ahead' if f['book_ahead'] else 'no booking needed'}\n    why it's a pick: {s['reason']}")
    lines += ["", "Areas:"] + [f"- {a['name']}: {', '.join(short[i] for i in a['spots'])}" for a in k["areas"]]
    lines += ["", f"Travel times in minutes ({k['travel_note']}):"]
    for a in k["spots"]:
        lines.append(f"{short[a['id']]} → " + ", ".join(f"{short[b]} {t['minutes']}{'' if t['mode'] == 'walk' else ' by car/bus'}"
                                                       for b, t in k["travel"][a["id"]].items()))
    return "\n".join(lines), short


def check(plan, k, cfg, tag=None):
    """What's wrong with a plan (errors send it back to the model) and what to know (warnings), in plain sentences.
    With tag (spot id → the short id the model uses), each place is named with its short id too."""
    spots = {s["id"]: s for s in k["spots"]}
    errors, warnings, seen = [], [], set()
    name = lambda i: (spots[i]["name"] + (f" [{tag[i]}]" if tag else "")) if i in spots else repr(i)
    if len(plan["days"]) != cfg["days"]:
        errors.append(f"The plan has {len(plan['days'])} days, not {cfg['days']}.")
    for d, day in enumerate(plan["days"], 1):
        prev, travel, lunch = None, 0, False
        for it in day["items"]:
            label = name(it["spot_id"]) if it["kind"] == "stop" else f"{it['kind']} near {name(it['near'])}"
            place = it["spot_id"] if it["kind"] == "stop" else it["near"]
            if place not in spots:
                errors.append(f"Day {d}: {label} isn't one of the places.")
                continue
            try:
                start = mins(it["start"])
            except ValueError:
                errors.append(f"Day {d}: {label} starts at {it['start']!r}, not a time.")
                continue
            end = start + it["minutes"]
            if it["kind"] == "stop":
                if place in seen:
                    errors.append(f"Day {d}: {label} is already in the plan.")
                seen.add(place)
                f, h = spots[place]["facts"], spots[place]["facts"]["hours"]
                if h["kind"] == "stated" and (start < mins(h["open"]) or end > mins(h["close"])):
                    errors.append(f"Day {d}: {label} is {it['start']}–{hhmm(end)}, but it's open {h['open']}–{h['close']}.")
                if h["closed_days"]:
                    warnings.append(f"Day {d}: {label} is closed on {', '.join(h['closed_days'])}; put this day on another weekday.")
                if h["kind"] == "unknown":
                    warnings.append(f"Day {d}: the sources don't give {label}'s opening hours; check them before going.")
                if it["minutes"] < f["visit_minutes"] / 2:
                    warnings.append(f"Day {d}: {it['minutes']} min at {label}, where people usually spend {f['visit_minutes']}.")
            else:
                lunch |= it["kind"] == "lunch" and mins(LIMITS["lunch"][0]) <= start <= mins(LIMITS["lunch"][1])
            if prev:
                t = k["travel"][prev["place"]][place]["minutes"] if prev["place"] != place else 0
                travel += t
                if start < prev["end"] + t - LIMITS["slack"]:
                    errors.append(f"Day {d}: {label} starts at {it['start']}, but {prev['label']} ends at {hhmm(prev['end'])} "
                                  f"and it takes {t} min to get there.")
            else:
                if start < mins(LIMITS["start"]):
                    errors.append(f"Day {d} starts at {it['start']}, before {LIMITS['start']}.")
            prev = {"place": place, "end": end, "label": label}
        if prev and prev["end"] > mins(LIMITS["end"]):
            errors.append(f"Day {d} ends at {hhmm(prev['end'])}, after {LIMITS['end']}.")
        if travel > LIMITS["travel"]:
            errors.append(f"Day {d} has {travel} min of travel, more than {LIMITS['travel']}.")
        if not lunch:
            errors.append(f"Day {d} has no lunch between {LIMITS['lunch'][0]} and {LIMITS['lunch'][1]}.")
    for i in plan["ideas"]:
        if i["spot_id"] not in spots:
            errors.append(f"Idea {i['spot_id']!r} isn't one of the places.")
        elif i["spot_id"] in seen:
            errors.append(f"{name(i['spot_id'])} is both in a day and an idea.")
    missing = set(spots) - seen - {i["spot_id"] for i in plan["ideas"]}
    if missing:
        warnings.append(f"Neither in a day nor an idea: {', '.join(sorted(name(i) for i in missing))}.")
    return errors, warnings


def make(cfg, k):
    text, short = describe(k)
    long = {v: key for key, v in short.items()}
    system = PLAN.format(city=k["destination"], days=cfg["days"], traveler=cfg["traveler"], travel=LIMITS["travel"],
                         lunch_from=LIMITS["lunch"][0], lunch_to=LIMITS["lunch"][1], start=LIMITS["start"], end=LIMITS["end"])
    h = digest(system, text)

    def full(a):  # the model's short ids back to the spots' ids
        to = lambda i: long.get(i, i) if i else i
        return {"days": [{"theme": d["theme"], "items": [dict(it, spot_id=to(it["spot_id"]), near=to(it["near"])) for it in d["items"]]}
                         for d in a["days"]], "ideas": [dict(i, spot_id=to(i["spot_id"])) for i in a["ideas"]]}

    answers, prompt = [], text
    for n in range(REPAIRS + 1):
        a = ask(OPUS, system, prompt, PLAN_SCHEMA, "high", VERSION, f"{DEST_ID}/{cfg['id']}/{n}")
        answers.append(a)
        plan = full(a)
        errors, warnings = check(plan, k, cfg)
        log(f"{cfg['id']} round {n}: {len(errors)} errors, {len(warnings)} warnings")
        if not errors:
            break
        back = {"days": a["days"], "ideas": a["ideas"]}
        prompt = (text + "\n\nYour last plan:\n" + json.dumps(back, ensure_ascii=False) +
                  "\n\nThe checks found these problems. Fix them, and keep the rest of the plan as it is where you can:\n" +
                  "\n".join(f"- {e}" for e in check(plan, k, cfg, tag=short)[0]))
    return dict(plan, id=cfg["id"], config=cfg, limits=LIMITS, rounds=len(answers), input_hash=h,
                checks={"errors": errors, "warnings": warnings})


def main():
    k = read("knowledge.json")
    plans = [make(cfg, k) for cfg in PLANS]
    result = {"destination": k["destination"], "built": time.strftime("%Y-%m-%d"), "version": VERSION, "plans": plans,
              "cost": spent()}
    write("plans.json", result)
    for p in plans:
        log(f"{p['id']}: {len(p['checks']['errors'])} errors after {p['rounds']} rounds; model cost this run: ${sum(spent().values()):.2f}")


if __name__ == "__main__":
    main()
