"""Tests for guides.py that need no network or model: python3 -m unittest test_guides (from pipeline/)."""
import json, os, sqlite3, tempfile, types, unittest, zlib
from concurrent.futures import ThreadPoolExecutor
from unittest import mock
import guides, store

SQUARE = [(47.0, -122.0), (47.0, -121.0), (48.0, -121.0), (48.0, -122.0), (47.0, -122.0)]
DEST = {"id": "testville", "name": "Testville", "state": "ZZ", "kind": "big city", "wikidata": "Q100", "cap": 5}


def item(qid, enwiki=None, p31=("Q33506",), deprecated=()):
    claims = {"P31": [{"value": q, "rank": "normal"} for q in p31] + [{"value": q, "rank": "deprecated"} for q in deprecated]}
    return json.dumps({"id": qid, "labels": {"en": qid}, "descriptions": {"en": f"about {qid}"}, "claims": claims,
                       "sitelinks": {"enwiki": enwiki, "frwiki": "x", "commonswiki": "y"} if enwiki else {}})


def fixture():
    db = sqlite3.connect(":memory:")
    db.executescript(store.SCHEMA)
    db.executemany("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)", [
        ("wikidata", "Q1", "Test Museum", 47.5, -121.5, None, item("Q1", "Test Museum", deprecated=("Q5",))),
        ("wikidata", "Q2", "No Article", 47.5, -121.5, None, item("Q2")),
        ("wikidata", "Q3", "Outside", 49.0, -121.5, None, item("Q3", "Outside")),
        ("wikidata", "Q100", "Testville", 47.5, -121.5, None, item("Q100", "Testville")),  # the destination itself
        ("nps:places", "N1", "Test Museum", 47.5, -121.5, "https://www.nps.gov/places/museum.htm", json.dumps({"listingDescription": "A <b>museum</b>."})),
        ("nps:parks", "N2", "Test Park", 47.6, -121.6, "https://www.nps.gov/tepa", json.dumps({"description": "A park."})),
        ("nps:campgrounds", "N3", "Test Camp", 47.6, -121.6, "https://www.nps.gov/camp", json.dumps({})),
    ])
    db.execute("INSERT INTO links VALUES ('wikidata', 'Q1', 'nps:places', 'N1', 'website')")  # a website link starts from Wikidata
    db.executemany("INSERT INTO pageviews VALUES (?,?,?)", [("Test Museum", m, v) for m, v in (("202609", 100), ("202610", 300), ("202611", 200))])
    db.execute("INSERT INTO documents (source, id, kind, url, rev, status, text) VALUES (?,?,?,?,?,?,?)",
               ("wikidata", "Q1", "wikipedia", "https://en.wikipedia.org/wiki/Test_Museum", "wikitext:9", "ok",
                zlib.compress("'''Test Museum''' is a [[museum]].<ref>x</ref>\n== History ==\nOld.".encode())))
    return db


class Candidates(unittest.TestCase):
    def test_places_inside_with_an_article_or_an_nps_page_one_per_place(self):
        with mock.patch.object(guides, "labels", lambda qids: {"Q33506": "museum", "Q5": "gone"}):
            places = guides.candidates(fixture(), DEST, [SQUARE])
        self.assertEqual(sorted(places), [("nps:parks", "N2"), ("wikidata", "Q1")])
        museum = places[("wikidata", "Q1")]
        self.assertEqual(museum["types"], ["museum"])            # a deprecated "instance of" doesn't count
        self.assertEqual(museum["views"], 200)                   # the median month
        self.assertEqual(museum["langs"], 2)                     # Wikipedias, not Commons
        self.assertEqual(museum["lead"], "Test Museum is a museum.")
        self.assertEqual([n["id"] for n in museum["nps"]], ["N1"])
        self.assertEqual(museum["nps"][0]["text"], "A  museum .")


class Asking(unittest.TestCase):
    def test_an_answer_is_kept_and_asked_again_only_when_its_input_changes(self):
        db = fixture()
        ask = guides.Asker.__new__(guides.Asker)
        calls = []

        def create(**kw):
            calls.append(kw)
            return types.SimpleNamespace(stop_reason="end_turn", content=[types.SimpleNamespace(type="text", text=json.dumps({"n": len(calls)}))],
                                         usage=types.SimpleNamespace(input_tokens=10, output_tokens=5, cache_read_input_tokens=0, cache_creation_input_tokens=0))
        ask.db, ask.client, ask.lock = db, types.SimpleNamespace(messages=types.SimpleNamespace(create=create)), guides.threading.Lock()
        ask.batcher, ask.spent = None, {}
        a = lambda content: ask("judge", "v2", "wikidata/Q1", guides.HAIKU, "system", content, {}, "low")
        self.assertEqual(a("one"), {"n": 1})
        self.assertEqual(a("one"), {"n": 1})
        self.assertEqual(a("two"), {"n": 2})
        self.assertEqual(len(calls), 2)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM llm_answers").fetchone()[0], 1)


class _Ctx:
    """A response as urlopen returns it, for `with`."""

    def __init__(self, r):
        self.r = r

    def __enter__(self):
        return self.r

    def __exit__(self, *a):
        return False


def message(text, stop="end_turn"):
    return types.SimpleNamespace(stop_reason=stop, content=[types.SimpleNamespace(type="text", text=text)],
                                 usage=types.SimpleNamespace(input_tokens=1_000_000, output_tokens=0, cache_read_input_tokens=0,
                                                             cache_creation_input_tokens=0))


class FakeBatches:
    """The Message Batches API as far as the Batcher uses it: each request answered with its custom_id, or as `answers` says."""

    def __init__(self, answers=None, known=()):
        self.created, self.answers, self.known = [], answers or {}, {b: [] for b in known}

    def create(self, requests):
        bid = f"msgbatch_{len(self.created)}"
        self.created.append([r["custom_id"] for r in requests])
        self.known[bid] = [r["custom_id"] for r in requests]
        return types.SimpleNamespace(id=bid)

    def retrieve(self, bid):
        return types.SimpleNamespace(processing_status="ended")

    def results(self, bid):
        for h in self.known[bid]:
            m = self.answers.get(h, message(json.dumps({"from": "batch"})))
            yield types.SimpleNamespace(custom_id=h, result=types.SimpleNamespace(type="succeeded" if m else "errored", message=m))


class Batching(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "ZZ.sqlite")
        self.keep = sqlite3.connect(self.path)
        self.keep.executescript(store.SCHEMA)
        self.direct = []

    def tearDown(self):
        self.dir.cleanup()

    def asker(self, batcher):
        ask = guides.Asker.__new__(guides.Asker)
        ask.db, ask.lock, ask.batcher, ask.spent = sqlite3.connect(self.path, check_same_thread=False), guides.threading.Lock(), batcher, {}
        ask.direct = lambda params: self.direct.append(params) or message(json.dumps({"from": "direct"}))
        return ask

    def batcher(self, batches):
        return guides.Batcher(types.SimpleNamespace(messages=types.SimpleNamespace(batches=batches)), self.path, quiet=1, poll=0)

    def ask_all(self, ask, contents):
        with ThreadPoolExecutor(len(contents)) as pool:
            return list(pool.map(lambda c: ask("judge", "v2", f"k/{c}", guides.HAIKU, "sys", c, {}, "low"), contents))

    def test_questions_asked_together_share_a_batch_at_half_price_and_the_same_one_is_sent_once(self):
        batches = FakeBatches()
        ask = self.asker(self.batcher(batches))
        out = self.ask_all(ask, ["a", "b", "c"]) + self.ask_all(ask, ["a"])
        self.assertEqual(out, [{"from": "batch"}] * 4)
        self.assertEqual([len(c) for c in batches.created], [3])       # one batch; "a" again is already answered
        self.assertAlmostEqual(ask.spent["judge"], 3 * 0.10 / 2)       # a million tokens each, at half Haiku's price
        self.assertEqual(self.keep.execute("SELECT COUNT(*) FROM llm_batches").fetchone()[0], 0)

    def test_an_answer_the_batch_couldnt_give_is_asked_on_its_own(self):
        h = lambda c: guides.hashlib.sha256(json.dumps([guides.HAIKU, "sys", c], sort_keys=True).encode()).hexdigest()
        batches = FakeBatches({h("declined"): message("", stop="refusal"), h("failed"): None})
        out = self.ask_all(self.asker(self.batcher(batches)), ["fine", "declined", "failed"])
        self.assertEqual(out, [{"from": "batch"}, {"from": "direct"}, {"from": "direct"}])
        self.assertEqual(len(self.direct), 2)

    def test_a_run_again_takes_the_answers_from_the_batch_an_earlier_run_sent(self):
        h = guides.hashlib.sha256(json.dumps([guides.HAIKU, "sys", "a"], sort_keys=True).encode()).hexdigest()
        batches = FakeBatches(known=["msgbatch_earlier"])
        batches.known["msgbatch_earlier"] = [h]
        self.keep.execute("CREATE TABLE IF NOT EXISTS llm_batches (input_hash TEXT PRIMARY KEY, batch_id TEXT, created_at TEXT)")
        self.keep.execute("INSERT INTO llm_batches VALUES (?, 'msgbatch_earlier', 'then')", (h,))
        self.keep.commit()
        self.assertEqual(self.ask_all(self.asker(self.batcher(batches)), ["a"]), [{"from": "batch"}])
        self.assertEqual(batches.created, [])                          # nothing sent again

    def test_batches_stay_under_the_size_limit(self):
        b = self.batcher(FakeBatches())
        items = {f"h{i}": ({"x": "y" * 40}, None) for i in range(10)}
        with mock.patch.object(guides.Batcher, "MAX_BYTES", 100):  # each request is 49 bytes: two a batch
            self.assertEqual([len(c) for c in b.chunks(list(items), items)], [2, 2, 2, 2, 2])


class Judging(unittest.TestCase):
    def places(self, n):
        return {("wikidata", f"Q{i}"): {"source": "wikidata", "id": f"Q{i}", "name": f"Place {i}", "lat": 47.5, "lng": -121.5,
                                        "views": 1000 - i, "langs": 1, "types": [], "description": "", "categories": [], "lead": "", "docs": {}, "nps": []}
                for i in range(n)}

    def test_every_candidate_is_judged_and_only_a_draw_of_0_isnt_a_sight(self):
        places, asked = self.places(30), []

        def ask(step, prompt, key, model, system, content, schema, effort):
            asked.append(key)
            return {"reason": "", "draw": int(key.split("Q")[1]) % 3}
        guides.judge(ask, places, dest=DEST)
        self.assertEqual(len(asked), 30)
        self.assertEqual(sum(p["sight"] for p in places.values()), 20)       # draws 1 and 2 are sights, 0 isn't
        self.assertFalse(places[("wikidata", "Q3")]["sight"])

    def test_the_shortlist_is_by_draw_then_by_how_much_its_read(self):
        places = self.places(10)
        for i, p in enumerate(places.values()):
            p["judged"] = {"draw": 5 if i == 9 else 3 if i < 2 else 2}
        with mock.patch.object(guides, "SHORTLIST", 4):
            short = guides.shortlist_of(list(places.values()))
        self.assertEqual([p["id"] for p in short], ["Q9", "Q0", "Q1", "Q2"])  # the least read first, for its draw

    def test_answers_from_before_models_were_kept_apart_are_kept_under_their_model(self):
        db = fixture()
        db.execute("INSERT INTO llm_answers VALUES ('write', 'wikidata/Q1', 'v3', 'claude-opus-5-5', 'h', '{}', 'now')")
        guides.keep_older_answers(db)
        guides.keep_older_answers(db)
        self.assertEqual(db.execute("SELECT prompt FROM llm_answers").fetchall(), [("v3 claude-opus-5-5",)])

    def test_side_by_side_only_for_picks_more_than_one_model_wrote(self):
        db = fixture()
        db.execute("INSERT INTO picks VALUES ('testville', 'wikidata', 'Q1', 1, 'why', 'm')")
        db.execute("INSERT INTO guides (source, id, name, one_liner, paragraphs) VALUES ('wikidata', 'Q1', 'Test Museum', 'x', '[]')")
        write = lambda model, line: db.execute("INSERT INTO llm_answers VALUES ('write', 'wikidata/Q1', ?, ?, 'h', ?, 'now')",
                                               (f"v3 {model}", model, json.dumps({"one_liner": line, "paragraphs": [{"text": "P."}]})))
        write("claude-opus-5-5", "Opus line.")
        self.assertEqual(guides.compare(db, "testville"), "")
        write("claude-sonnet-5-5", "Sonnet line.")
        text = guides.compare(db, "testville")
        self.assertIn("#### Test Museum", text)
        self.assertLess(text.index("claude-opus-5-5**: Opus line."), text.index("claude-sonnet-5-5**: Sonnet line."))


class Pictures(unittest.TestCase):
    def test_captions_leave_out_layout_options_links_and_references(self):
        self.assertEqual(guides.caption_of("|thumb|right|upright=1.2|The [[Space Needle|needle]] at night<ref>x</ref>"), "The needle at night")
        self.assertEqual(guides.caption_of("|thumb|left|250px"), "")

    def test_images_named_by_wikidata_infobox_and_article_once_each(self):
        text = "{{Infobox\n| image = Front.jpg\n}}\nIntro [[File:Front.jpg|thumb|Again]]\n== Inside ==\n[[File:Hall.png|thumb|The hall]]\n[[File:Plan.pdf|thumb|plan]]"
        self.assertEqual(guides.image_names(["Aerial.jpg"], text), [
            ("Aerial.jpg", "", "Wikidata image"), ("Front.jpg", "", "infobox"), ("Hall.png", "The hall", "Inside")])

    def test_a_photo_turned_away_is_asked_for_again_after_the_wait_it_names(self):
        calls, waits = [], []

        def urlopen(req, timeout):
            calls.append(req.full_url)
            if len(calls) < 3:
                raise guides.urllib.error.HTTPError(req.full_url, 429, "Too many", {"Retry-After": "7"}, None)
            return types.SimpleNamespace(read=lambda: b"img", __enter__=lambda s: s, __exit__=lambda s, *a: None)
        with mock.patch.object(guides.urllib.request, "urlopen", lambda req, timeout: _Ctx(urlopen(req, timeout))), \
                mock.patch.object(guides.time, "sleep", waits.append):
            self.assertEqual(guides.fetch_image("https://upload.wikimedia.org/x.jpg"), b"img")
        self.assertEqual((len(calls), waits), (3, [7, 7]))

    def test_a_photo_that_isnt_there_isnt_asked_for_again(self):
        def urlopen(req, timeout):
            raise guides.urllib.error.HTTPError(req.full_url, 404, "Not found", {}, None)
        with mock.patch.object(guides.urllib.request, "urlopen", urlopen), self.assertRaises(guides.urllib.error.HTTPError):
            guides.fetch_image("https://upload.wikimedia.org/x.jpg")

    def test_media_type_from_the_bytes(self):
        self.assertEqual(guides.media_type(b"\x89PNG\r\n\x1a\nxxxx"), "image/png")
        self.assertEqual(guides.media_type(b"RIFF0000WEBPxxxx"), "image/webp")
        self.assertEqual(guides.media_type(b"\xff\xd8\xff"), "image/jpeg")


    def test_a_park_across_a_state_line_from_two_stores_each_place_once_and_not_the_park_itself(self):
        park = dict(DEST, id="testpark", kind="national park", nps_unit="TEPA", wikidata="Q999")
        home, other = fixture(), sqlite3.connect(":memory:")
        other.executescript(store.SCHEMA)
        other.executemany("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)", [
            ("wikidata", "Q1", "Test Museum", 47.5, -121.5, None, item("Q1", "Test Museum")),           # in both stores
            ("nps:places", "N1", "Test Museum", 47.5, -121.5, "https://www.nps.gov/places/museum.htm", json.dumps({})),  # unlinked here
            ("wikidata", "Q7", "Falls Across the Line", 47.2, -121.2, None, item("Q7", "Falls Across the Line")),
        ])
        home.execute("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)",
                     ("nps:parks", "N9", "Test Park Itself", 47.4, -121.4, "https://www.nps.gov/tepa", json.dumps({"parkCode": "tepa"})))
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates([home, other], park, [SQUARE])
        # the park's NPS record (N9) and the one NPS record both stores have (N1, linked to Q1 at home) don't come again
        self.assertEqual(sorted(places), [("nps:parks", "N2"), ("wikidata", "Q1"), ("wikidata", "Q100"), ("wikidata", "Q7")])
        self.assertEqual(places[("wikidata", "Q1")]["views"], 200)  # the home store's copy, with its page views


class ThePark(unittest.TestCase):
    def park_store(self, with_item=True):
        db = fixture()
        if with_item:  # the park's item, its point at headquarters outside the park
            db.execute("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)",
                       ("wikidata", "Q999", "Test National Park", 49.5, -125.0, None, item("Q999", "Test National Park")))
            db.execute("INSERT INTO ids VALUES ('wikidata', 'Q999', 'P4083', 'TEPA')")
        db.execute("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)",
                   ("nps:parks", "N9", "Test National Park", 47.4, -121.4, "https://www.nps.gov/tepa",
                    json.dumps({"parkCode": "tepa", "description": "The park's own page."})))
        db.execute("INSERT INTO ids VALUES ('nps:parks', 'N9', 'P4083', 'tepa')")
        return db

    PARK = dict(DEST, id="testpark", name="Test National Park", kind="national park", nps_unit="TEPA", wikidata="Q999")

    def test_a_park_is_an_entry_of_its_own_with_its_nps_page_wherever_its_point_is(self):
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates([self.park_store()], self.PARK, [SQUARE])
        whole = [p for p in places.values() if p["itself"]]
        self.assertEqual([(p["source"], p["id"]) for p in whole], [("wikidata", "Q999")])
        self.assertEqual([n["id"] for n in whole[0]["nps"]], ["N9"])
        self.assertNotIn(("nps:parks", "N9"), places)
        self.assertEqual(sum(1 for p in places.values() if p["itself"]), 1)

    def test_without_its_item_the_parks_nps_page_is_its_entry_and_two_stores_make_one(self):
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates([self.park_store(with_item=False), self.park_store()], self.PARK, [SQUARE])
        self.assertEqual([(p["source"], p["id"]) for p in places.values() if p["itself"]], [("wikidata", "Q999")])
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates([self.park_store(with_item=False)], self.PARK, [SQUARE])
        self.assertEqual([(p["source"], p["id"]) for p in places.values() if p["itself"]], [("nps:parks", "N9")])

    def test_a_city_isnt_one_of_its_own_sights(self):
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates(fixture(), DEST, [SQUARE])
        self.assertNotIn(("wikidata", "Q100"), places)
        self.assertFalse(any(p["itself"] for p in places.values()))

    def test_an_item_wikidata_puts_in_the_park_counts_wherever_its_point_is(self):
        db = self.park_store()
        db.execute("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)",
                   ("wikidata", "Q55", "Skyline Road", 50.0, -125.0, None, item("Q55", "Skyline Road")))  # its point outside
        db.execute("INSERT INTO ids VALUES ('wikidata', 'Q55', 'P3018', 'Q999')")
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates([db], self.PARK, [SQUARE])
        self.assertIn(("wikidata", "Q55"), places)
        self.assertNotIn(("wikidata", "Q3"), places)  # outside, and nothing says it's in the park

    def test_an_item_in_the_park_without_a_point_is_left_out_and_the_park_without_one_is_put_in_its_middle(self):
        db = self.park_store()
        db.execute("UPDATE records SET lat = NULL, lng = NULL WHERE id = 'Q999'")
        db.execute("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)",
                   ("wikidata", "Q56", "Somewhere in the Park", None, None, None, item("Q56", "Somewhere in the Park")))
        db.execute("INSERT INTO ids VALUES ('wikidata', 'Q56', 'P3018', 'Q999')")
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates([db], self.PARK, [SQUARE])
        self.assertNotIn(("wikidata", "Q56"), places)
        self.assertEqual((places[("wikidata", "Q999")]["lat"], places[("wikidata", "Q999")]["lng"]), (47.5, -121.5))
        ask = lambda *a: {"evidence": "", "is_sight": True, "exists": True, "visitable": "yes", "part_of": None, "draw": 3}
        guides.judge(ask, {k: p for k, p in places.items() if not p["itself"]}, dest=self.PARK)  # no point fails it

    def test_the_pick_is_told_the_park_has_its_own_entry_and_a_city_isnt(self):
        prompts = []
        ask = lambda step, prompt, key, model, system, *a: prompts.append(system) or {"picks": [], "left_out": []}
        guides.pick(ask, self.PARK, [])
        guides.pick(ask, DEST, [])
        self.assertIn("Test National Park itself has an entry at the top of the page already", prompts[0])
        self.assertEqual(prompts[1], guides.PICK.format(name=DEST["name"], cap=DEST["cap"], whole=""))
        self.assertNotIn("has an entry", prompts[1])

    def test_a_pick_is_shown_by_the_pick_s_name_or_else_its_record_s(self):
        p = {"name": "Take a Cave Tour"}
        self.assertEqual(guides.shown({"name": "Wind Cave tour"}, p), "Wind Cave tour")
        self.assertEqual(guides.shown({"name": " "}, p), "Take a Cave Tour")
        self.assertEqual(guides.shown({"reason": None}, p), "Take a Cave Tour")  # the park itself

    def test_a_person_or_a_species_isnt_a_candidate_and_the_pick_names_each_place(self):
        db = fixture()
        db.executemany("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)", [
            ("wikidata", "Q7", "A Ranger", 47.5, -121.5, None, item("Q7", "A Ranger", p31=("Q5",))),
            ("wikidata", "Q8", "A Pine", 47.5, -121.5, None, item("Q8", "A Pine", p31=("Q16521",)))])
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates(db, DEST, [SQUARE])
        self.assertNotIn(("wikidata", "Q7"), places)
        self.assertNotIn(("wikidata", "Q8"), places)
        self.assertIn("name", guides.PICK_SCHEMA["properties"]["picks"]["items"]["required"])

    def test_an_nps_page_under_a_places_name_within_2_km_is_that_place(self):
        db = fixture()
        db.executemany("INSERT INTO records (source, id, name, lat, lng, url, raw) VALUES (?,?,?,?,?,?,?)", [
            ("wikidata", "Q9", "Test Icefield", 47.5, -121.5, None, item("Q9", "Test Icefield")),
            ("nps:thingstodo", "T1", "Hike the Test Icefield Trail", 47.51, -121.5, "https://www.nps.gov/t1", json.dumps({})),
            ("nps:thingstodo", "T2", "Hike the Test Icefield Trail", 47.9, -121.5, "https://www.nps.gov/t2", json.dumps({}))])
        with mock.patch.object(guides, "labels", lambda qids: {}):
            places = guides.candidates(db, DEST, [SQUARE])
        self.assertEqual([n["id"] for n in places[("wikidata", "Q9")]["nps"]], ["T1"])
        self.assertNotIn(("nps:thingstodo", "T1"), places)
        self.assertIn(("nps:thingstodo", "T2"), places)                     # 45 km off: another place

    def test_a_place_without_an_article_isnt_shown_as_unread_in_the_pick(self):
        contents = []
        ask = lambda step, prompt, key, model, system, content, *a: contents.append(content) or {"picks": [], "left_out": []}
        dunes = {"source": "nps:places", "id": "N5", "name": "Dunes", "types": ["NPS places"], "views": 0, "langs": 0,
                 "lead": "Dunes.", "nps": [{"id": "N5"}], "judged": {"draw": 5}}
        guides.pick(ask, self.PARK, [dunes])
        self.assertIn("no English Wikipedia article (an NPS page)", contents[0])
        self.assertNotIn("0 Wikipedia views", contents[0])

    def test_another_item_for_the_park_isnt_picked_again(self):
        self.assertTrue(guides.same_name("Denali National Park", "Denali  national park"))
        self.assertFalse(guides.same_name("Denali", "Denali National Park"))


class Boundary(unittest.TestCase):
    def test_inside(self):
        self.assertTrue(guides.inside(47.5, -121.5, [SQUARE]))
        self.assertFalse(guides.inside(48.5, -121.5, [SQUARE]))

    def test_islands_and_a_hole(self):
        island = [(49.0, -122.0), (49.0, -121.0), (50.0, -121.0), (50.0, -122.0)]   # not closed: the last edge is implied
        hole = [(47.4, -121.6), (47.4, -121.4), (47.6, -121.4), (47.6, -121.6), (47.4, -121.6)]
        area = guides.Area([SQUARE, island, hole])
        self.assertIn((49.5, -121.5), area)
        self.assertIn((47.2, -121.2), area)
        self.assertNotIn((47.5, -121.5), area)    # in the hole
        self.assertNotIn((48.5, -121.5), area)    # between the two
        self.assertNotIn((None, None), area)
        self.assertEqual(area.box, (47.0, 50.0, -122.0, -121.0))

    def test_each_kind_of_outline_asked_for_by_its_id_in_lat_lng(self):
        asked = []

        def http_json(url):
            asked.append(url)
            return {"features": [{"geometry": {"rings": [[[-110.0, 44.0], [-110.5, 44.5]]]}},
                                 {"geometry": {"rings": [[[-111.0, 45.0], [-111.5, 45.5]]]}}]}
        with mock.patch.object(guides.store, "http_json", http_json):
            rings = guides.boundary({"id": "yellowstone", "nps_unit": "YELL"})
            guides.boundary({"id": "king", "census_county": "53033"})
            guides.boundary({"id": "seattle", "census_place": "5363000"})
        self.assertEqual(rings, [[(44.0, -110.0), (44.5, -110.5)], [(45.0, -111.0), (45.5, -111.5)]])  # every part
        self.assertIn("FeatureServer/2/query?where=UNIT_CODE%3D%27YELL%27", asked[0])
        self.assertIn("State_County/MapServer/1/query?where=GEOID%3D%2753033%27", asked[1])
        self.assertIn("MapServer/4/query?where=GEOID%3D%275363000%27", asked[2])
        with self.assertRaises(ValueError):
            guides.boundary({"id": "x", "nps_unit": "YELL' OR 1=1"})
        with mock.patch.object(guides.store, "http_json", lambda url: {"features": []}), self.assertRaises(ValueError):
            guides.boundary({"id": "x", "census_county": "99999"})


if __name__ == "__main__":
    unittest.main()
