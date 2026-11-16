"""What the trip-plan steps share (knowledge.py, plan.py, compose.py, story.py, export_plans.py): the destination they're
for, its state's store, where they write, and asking the model.

The destination is PLAN_DESTINATION, an id from destinations.json (default seattle), whose picks and entries guides.py
has written into its state's store (data/<ST>.sqlite). The plans start from those picks and entries; their model
answers go in the same store's llm_answers, through guides.py's Asker, so a run asks again only what changed and the
store, kept in R2, carries them from one run to the next. Each step writes its JSON to out/plans/<destination>/.
"""
import json, os, sqlite3

import store
from guides import DESTINATIONS, HAIKU, OPUS, SONNET, Asker, log, obj, overlap, store_path

DEST_ID = os.environ.get("PLAN_DESTINATION", "seattle")
DEST = DESTINATIONS[DEST_ID]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "plans", DEST_ID)
os.makedirs(OUT, exist_ok=True)

_db = _asker = None


def db(path=None):
    """The destination's state's store (or `path`, for tests)."""
    global _db
    if _db is None:
        path = path or store_path(DEST["state"])
        if not os.path.exists(path):
            raise SystemExit(f"{DEST_ID}: no store for {DEST['state']} ({path}): the Spots data and Spots guides workflows make it")
        _db = sqlite3.connect(path, timeout=60, check_same_thread=False)
        _db.executescript(store.SCHEMA)
    return _db


def ask(model, system, text, schema, effort, step, key):
    """One structured answer, kept in the store under the step's name and version (e.g. "plan-v1"): asked again only
    when what it's asked changes."""
    global _asker
    if _asker is None:
        _asker = Asker(db())
    return _asker(step, step, key, model, system, text, schema, effort)


def spent():
    """Dollars spent on model answers in this run, by step: answers kept from earlier runs cost nothing."""
    return {k: round(v, 3) for k, v in (_asker.spent if _asker else {}).items()}


def read(name):
    with open(os.path.join(OUT, name)) as f:
        return json.load(f)


def write(name, value):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(value, f, indent=1, ensure_ascii=False)
    log(f"wrote {os.path.join(OUT, name)}")


__all__ = ["DEST", "DEST_ID", "HAIKU", "OPUS", "SONNET", "OUT", "ask", "db", "log", "obj", "overlap", "read", "spent", "write"]
