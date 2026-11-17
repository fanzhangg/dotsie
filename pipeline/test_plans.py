"""Tests for the trip plans' ends, with no network or model: the picks they start from in a store, the fact cards' sources,
and the rows they end as in D1. python3 -m unittest test_plans (from pipeline/)."""
import io, json, os, sqlite3, tempfile, unittest
from unittest import mock

os.environ.setdefault("PLAN_DESTINATION", "seattle")
import export_plans, knowledge, planning, store

ENTRY = {"paragraphs": [{"text": "Built in 1907.", "sources": ["https://en.wikipedia.org/wiki/Market"]}],
         "practical": [{"label": "Hours", "value": "9 to 6", "source": "https://market.example"}]}


def make_store():
    db = sqlite3.connect(":memory:")
    db.executescript(store.SCHEMA)
    rows = [  # source, id, rank, reason, name, lat
        ("wikidata", "Q1", 2, "The market.", "Market", 47.61),
        ("wikidata", "Q2", 1, "The tower.", "Tower", 47.62),
        ("nps:places", "ABC", 3, "The park's lodge.", "Lodge", None),  # no point on the map: not a stop
        ("wikidata", "Q9", 0, None, "Seattle itself", 47.6),  # the destination's own entry has no reason: not a stop
    ]
    for source, pid, rank, reason, name, lat in rows:
        db.execute("INSERT INTO picks VALUES (?,?,?,?,?,?)", ("seattle", source, pid, rank, reason, "test"))
        db.execute("INSERT INTO guides (source, id, name, one_liner, paragraphs, practical, sources, images, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                   (source, pid, name, f"{name} in a line.", json.dumps(ENTRY["paragraphs"]), json.dumps(ENTRY["practical"]),
                    json.dumps([{"url": "https://en.wikipedia.org/wiki/Market", "kind": "wikipedia"}]),
                    json.dumps({"hero": {"thumb": "https://img/x.jpg", "page": "https://commons/x", "author": "A", "licence": "CC0"}, "inline": []}),
                    "2026-11-09T12:00:00Z"))
        db.execute("INSERT INTO records (source, id, name, lat, lng) VALUES (?,?,?,?,?)", (source, pid, name, lat, -122.3 if lat else None))
    db.execute("INSERT INTO picks VALUES ('elsewhere', 'wikidata', 'Q5', 1, 'Another city.', 'test')")
    return db


class Picks(unittest.TestCase):
    def test_the_best_picks_with_a_point_and_a_reason_in_rank_order(self):
        spots = knowledge.picks(make_store(), "seattle")
        self.assertEqual([s["id"] for s in spots], ["wikidata/Q2", "wikidata/Q1"])
        self.assertEqual(spots[0]["wikidata"], "Q2")
        self.assertEqual(spots[0]["entry"]["hero"]["thumb"], "https://img/x.jpg")
        self.assertEqual(spots[0]["fetched"], "2026-11-09")
        self.assertEqual(len(knowledge.picks(make_store(), "seattle", n=1)), 1)

    def test_a_fact_card_keeps_only_sources_the_entry_cites(self):
        s = knowledge.picks(make_store(), "seattle")[1]
        self.assertIn("Built in 1907.", knowledge.text_of(s))
        self.assertIn("Hours: 9 to 6 (source: https://market.example)", knowledge.text_of(s))
        answer = {"kind": "shopping", "visit_minutes": 60, "visit_source": "https://made.up", "book_ahead": False, "book_source": None,
                  "admission": "free", "admission_source": "https://en.wikipedia.org/wiki/Market",
                  "hours": {"kind": "stated", "open": "09:00", "close": "18:00", "closed_days": [], "source": "https://market.example"}}
        with mock.patch.object(knowledge, "ask", return_value=dict(answer)):
            a = knowledge.facts(s)
        self.assertIsNone(a["visit_source"])  # not cited by the entry: an estimate
        self.assertEqual(a["admission_source"], "https://en.wikipedia.org/wiki/Market")
        self.assertEqual(a["hours"]["kind"], "stated")


class Asking(unittest.TestCase):
    def test_threads_asking_at_once_share_one_asker(self):
        """knowledge.py writes fact cards from 8 threads; each made its own Asker on the one store connection, and
        SQLite refused ("bad parameter or other API misuse")."""
        made = []

        class Fake:
            def __init__(self, db):
                made.append(self)
                self.spent = {}

            def __call__(self, *a):
                return {"ok": True}

        with mock.patch.object(planning, "Asker", Fake), mock.patch.object(planning, "_asker", None), \
             mock.patch.object(planning, "_db", sqlite3.connect(":memory:", check_same_thread=False)):
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(8) as pool:
                answers = list(pool.map(lambda n: planning.ask("m", "s", "t", {}, "low", "step", str(n)), range(32)))
        self.assertEqual(len(made), 1)
        self.assertEqual(answers, [{"ok": True}] * 32)


class Export(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        spots = knowledge.picks(make_store(), "seattle")
        for s in spots:
            s.update(kind="attraction", area="a1", facts={"visit_minutes": 60, "evidence": "…"})
        k = {"destination": "Seattle", "built": "2026-11-16", "spots": spots, "areas": [{"id": "a1", "name": "Downtown", "spots": []}]}
        item = lambda sid, kind="stop", leg=None: {"kind": kind, "spot_id": sid, "start": "09:00" if kind == "stop" else "12:00", "minutes": 60,
                                                   "why": "Why.", "leg": leg, "name": "", "getting_there": None}
        good = {"id": "first-visit-1d", "traveler": "a first visit", "checks": {"errors": [], "warnings": []}, "ideas": [{"spot_id": "wikidata/Q1", "why": "Later."}],
                "days": [{"day": 1, "theme": "Up", "intro": "A day.", "items": [item("wikidata/Q2"), item("wikidata/Q2", "lunch", {"mode": "walk", "minutes": 3, "coords": None, "estimate": 3})]}]}
        bad = dict(good, id="broken", checks={"errors": ["Day 1: no lunch."], "warnings": []})
        files = {"knowledge.json": k, "plan-first-visit-1d.json": good, "plan-broken.json": bad,
                 "story-first-visit-1d.json": {"plan_id": "first-visit-1d", "headline": "Up", "checks": {}, "input_hash": "h", "version": "v"}}
        for name, v in files.items():
            with open(os.path.join(self.dir, name), "w") as f:
                json.dump(v, f)
        self.patches = [mock.patch.object(planning, "OUT", self.dir), mock.patch.object(export_plans, "OUT", self.dir)]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_a_plan_that_fails_its_checks_is_left_out(self):
        with mock.patch("builtins.print") as said:
            _, plans = export_plans.rows()
        self.assertEqual([p["plan_id"] for p in plans], ["seattle-first-visit-1d"])
        self.assertIn("plan broken left out", said.call_args[0][0])
        p = plans[0]
        self.assertEqual(p["stops"], 1)
        self.assertEqual(p["story"], {"headline": "Up"})
        self.assertEqual(sorted(p["places"]), ["wikidata/Q1", "wikidata/Q2"])  # its stops and its ideas
        self.assertEqual(p["places"]["wikidata/Q2"]["area"], "Downtown")
        self.assertNotIn("evidence", p["places"]["wikidata/Q2"]["facts"])
        self.assertEqual(p["days"][0]["items"][1]["leg"], {"mode": "walk", "minutes": 3, "coords": None})

    def test_the_sql_replaces_the_destination_s_rows(self):
        with mock.patch("builtins.print"):
            _, plans = export_plans.rows()
        out = io.StringIO()
        export_plans.sql(plans, out)
        db = sqlite3.connect(":memory:")
        with open(os.path.join(planning.HERE, "..", "app", "migrations", "0008_trip_plans.sql")) as f:
            db.executescript(f.read())
        db.execute("INSERT INTO trip_plans VALUES ('seattle-old', 'seattle', 't', 't', '[]', '[]', '{}', NULL, 0, 'b', 'l')")
        db.executescript(out.getvalue())
        self.assertEqual([r[0] for r in db.execute("SELECT plan_id FROM trip_plans")], ["seattle-first-visit-1d"])
        self.assertEqual(db.execute("SELECT source, id, day, start FROM trip_plan_spots").fetchall(), [("wikidata", "Q2", 1, "09:00")])
        self.assertEqual(json.loads(db.execute("SELECT story FROM trip_plans").fetchone()[0]), {"headline": "Up"})


if __name__ == "__main__":
    unittest.main()
