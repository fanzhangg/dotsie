"""A plan as a long-form article, the way a travel guide's feature reads (docs/guides-and-plans.md).

The one step that reads both lines: compose.py's plan-<id>.json, which holds the plan and each stop's guide entry.
The article tells how the days go, from one place to the next. Where a place comes up, it puts the place's card
(the page draws it from the spot's guide and facts), so the text doesn't repeat what a card says. It says no clock
times, hours or prices: the cards and the itinerary show those from the fact cards.

Checks (code): each day's stops appear as cards once each, in the plan's order; no clock times or prices in the
text. What fails goes back to the model once; what's still wrong is then fixed by code (cards put in order) or kept as
a warning. How much wording the text shares with the guide entries is measured.

Writes out/plans/<destination>/story-<id>.json. Run: PLAN_DESTINATION=seattle python3 story.py
"""
import glob, json, os, re, time

from knowledge import digest
from planning import DEST_ID, OPUS, OUT, ask, log, obj, overlap, spent, write as save

STORY = """You write long-form features for a travel guide: one suggested plan for {city}, told as an article a reader enjoys on the sofa and then follows on the trip. Second person, present tense, warm and specific, the way a well-traveled friend who has done the reading would tell it. No hype: no "breathtaking", "must-see", "hidden gem", "nestled", "vibrant" or exclamation marks.

You get the plan, day by day, and our guide entries for its places. Text inside <guide> tags is our own entries: the only facts about the places you may use. You may say how the days flow (the order, the pace, why one place comes before another, walking from one to the next), but don't add details about places, streets, food, views or history that the entries don't give.

The page shows a card for each place: its photo, its one-line hook, how long to spend, its hours and whether to book. So:
- Where a place comes up, put its card right after the text that brings it in (a part with kind "spot" and its id). Each stop of a day gets one card in that day, in the plan's order. Meals and places not in the plan get no card.
- Don't repeat the card: no clock times, opening hours, prices or minutes. Say "first thing", "after lunch", "by late afternoon" instead.
- Don't retell a guide entry: pick the one or two things from it that make the day, in your own words.

Fields:
- headline: at most 10 words, about the trip, not a list of places.
- dek: one sentence under the headline: who it's for and what it gives them.
- intro: 1 or 2 paragraphs, about 120 words in all: what these days add up to.
- days: one per day, in order. heading: a few words for the day. parts: text and cards in reading order: 3 to 6 text parts of 1 to 3 sentences each, about 250 to 350 words of text in all, with the day's cards between them.
- good_to_know: 3 to 5 short practical notes for the whole trip, from the plan and the entries only (what to book ahead, which hours to check, when the plan walks and when it needs a car or a bus).
- closing: one or two sentences to end on."""
PART = obj({"kind": {"type": "string", "enum": ["text", "spot"]}, "text": {"type": ["string", "null"]}, "spot_id": {"type": ["string", "null"]}})
STORY_SCHEMA = obj({"headline": {"type": "string"}, "dek": {"type": "string"}, "intro": {"type": "array", "items": {"type": "string"}},
                    "days": {"type": "array", "items": obj({"day": {"type": "integer"}, "heading": {"type": "string"},
                                                            "parts": {"type": "array", "items": PART}})},
                    "good_to_know": {"type": "array", "items": {"type": "string"}}, "closing": {"type": "string"}})
VERSION = "story-v1"
NO_NUMBERS = re.compile(r"\b\d{1,2}(:\d{2})?\s?(a\.?m\.?|p\.?m\.?)(?=\W|$)|\b\d{1,2}:\d{2}\b|\$\s?\d|\b\d+\s?(min|mins|minutes|hours?|hrs?)\b", re.I)


def describe(c):
    """The plan and its places' guide entries, with short ids (s1, s2…) for the places."""
    short, lines = {}, []
    for d in c["days"]:
        lines.append(f"Day {d['day']}: {d['theme']}")
        for i in d["items"]:
            if i["kind"] == "stop":
                sid = short.setdefault(i["spot_id"], f"s{len(short) + 1}")
                lines.append(f"- {i['start']} [{sid}] {i['name']}, {i['minutes']} min. Why here: {i['why']}")
            else:
                lines.append(f"- {i['start']} {i['kind']} near {i['name']}")
            if i.get("getting_there"):
                lines[-1] += f" (from the place before: {i['getting_there']})"
        lines.append("")
    lines.append("Not in the plan, for another time: " + "; ".join(i["name"] for i in c["ideas"]))
    entries = []
    seen = set()
    for d in c["days"]:
        for i in d["items"]:
            if i["kind"] != "stop" or i["spot_id"] in seen:
                continue
            seen.add(i["spot_id"])
            g = i["guide"]
            entries.append(f'<guide place="{short[i["spot_id"]]}" name="{i["name"]}">\n{g["one_liner"]}\n\n' +
                           "\n\n".join(b["text"] for b in g["body"]) +
                           ("\n\nTips: " + " ".join(b["text"] for b in g["tips"]) if g["tips"] else "") + "\n</guide>")
    return "\n".join(lines) + "\n\nGuide entries:\n\n" + "\n\n".join(entries), short


def check(a, c, long):
    """Errors (sent back once) and the stops each day should have, as the model's ids."""
    errors = []
    if len(a["days"]) != len(c["days"]):
        errors.append(f"The article has {len(a['days'])} days; the plan has {len(c['days'])}.")
    for d, ad in zip(c["days"], a["days"]):
        want = [i["spot_id"] for i in d["items"] if i["kind"] == "stop"]
        got = [long.get(p["spot_id"], p["spot_id"]) for p in ad["parts"] if p["kind"] == "spot"]
        if got != want:
            name = {i["spot_id"]: i["name"] for i in d["items"]}
            errors.append(f"Day {d['day']}'s cards must be, in this order: {', '.join(name[w] for w in want)}; "
                          f"they are: {', '.join(name.get(g, repr(g)) for g in got) or 'none'}.")
    texts = a["intro"] + [p["text"] or "" for ad in a["days"] for p in ad["parts"] if p["kind"] == "text"] + a["good_to_know"] + [a["closing"]]
    for t in texts:
        m = NO_NUMBERS.search(t)
        if m:
            errors.append(f"The text says {m.group(0)!r} (in: {t[:80]}…). The cards show times, hours, prices and minutes: say it another way.")
    return errors


def fix(a, c, long):
    """Puts each day's cards in the plan's order where the model didn't: its text parts stay as they are, and the cards
    go after them in turn, a missing one after the last text."""
    for d, ad in zip(c["days"], a["days"]):
        want = [i["spot_id"] for i in d["items"] if i["kind"] == "stop"]
        texts = [p for p in ad["parts"] if p["kind"] == "text"]
        got = [long.get(p["spot_id"], p["spot_id"]) for p in ad["parts"] if p["kind"] == "spot"]
        if got == want:
            continue
        parts, cards = [], list(want)
        for n, t in enumerate(texts):
            parts.append(t)
            share = len(cards) if n == len(texts) - 1 else max(0, round(len(want) / max(1, len(texts))))
            for _ in range(min(share, len(cards))):
                parts.append({"kind": "spot", "text": None, "spot_id": cards.pop(0)})
        ad["parts"] = parts + [{"kind": "spot", "text": None, "spot_id": s} for s in cards]
    return a


def write(c):
    text, short = describe(c)
    long = {v: k for k, v in short.items()}
    system = STORY.format(city=c["destination"])
    h = digest(system, text)
    answers, prompt, errors = [], text, []
    for n in range(2):
        a = ask(OPUS, system, prompt, STORY_SCHEMA, "high", VERSION, f"{DEST_ID}/{c['id']}/{n}")
        answers.append(a)
        errors = check(a, c, long)
        log(f"{c['id']} round {n}: {len(errors)} errors")
        if not errors:
            break
        prompt = (text + "\n\nYour last article:\n" + json.dumps({k: v for k, v in a.items() if k != "_usage"}, ensure_ascii=False) +
                  "\n\nThe checks found these problems. Fix them and keep the rest as it is:\n" + "\n".join(f"- {e}" for e in errors))
    a = {k: v for k, v in answers[-1].items() if k != "_usage"}
    for ad in a["days"]:
        for p in ad["parts"]:
            if p["kind"] == "spot":
                p["spot_id"] = long.get(p["spot_id"], p["spot_id"])
    a = fix(a, c, {})
    bodies = [b["text"] for d in c["days"] for i in d["items"] if i["kind"] == "stop" for b in i["guide"]["body"]]
    prose = " ".join(a["intro"] + [p["text"] for ad in a["days"] for p in ad["parts"] if p["kind"] == "text"])
    return dict(a, plan_id=c["id"], version=VERSION, input_hash=h, rounds=len(answers),
                checks={"errors": errors, "overlap_with_guide": round(overlap(prose, bodies), 3), "words": len(prose.split())})


def main():
    stories = [write(json.load(open(p))) for p in sorted(glob.glob(os.path.join(OUT, "plan-*.json")))]
    for s in stories:
        save(f"story-{s['plan_id']}.json", s)
        log(f"{s['plan_id']}: {s['checks']['words']} words, {s['checks']['overlap_with_guide']:.0%} of 8-word phrases shared with the guide, "
            f"{len(s['checks']['errors'])} errors left")
    log(f"model cost this run: ${sum(spent().values()):.2f}")


if __name__ == "__main__":
    main()
