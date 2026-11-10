"""Tests for guides.py that need no network or model: python3 -m unittest test_guides (from pipeline/)."""
import json, sqlite3, types, unittest, zlib
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
            places = guides.candidates(fixture(), DEST, SQUARE)
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
        a = lambda content: ask("judge", "v2", "wikidata/Q1", guides.HAIKU, "system", content, {}, "low")
        self.assertEqual(a("one"), {"n": 1})
        self.assertEqual(a("one"), {"n": 1})
        self.assertEqual(a("two"), {"n": 2})
        self.assertEqual(len(calls), 2)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM llm_answers").fetchone()[0], 1)


class Pictures(unittest.TestCase):
    def test_captions_leave_out_layout_options_links_and_references(self):
        self.assertEqual(guides.caption_of("|thumb|right|upright=1.2|The [[Space Needle|needle]] at night<ref>x</ref>"), "The needle at night")
        self.assertEqual(guides.caption_of("|thumb|left|250px"), "")

    def test_images_named_by_wikidata_infobox_and_article_once_each(self):
        text = "{{Infobox\n| image = Front.jpg\n}}\nIntro [[File:Front.jpg|thumb|Again]]\n== Inside ==\n[[File:Hall.png|thumb|The hall]]\n[[File:Plan.pdf|thumb|plan]]"
        self.assertEqual(guides.image_names(["Aerial.jpg"], text), [
            ("Aerial.jpg", "", "Wikidata image"), ("Front.jpg", "", "infobox"), ("Hall.png", "The hall", "Inside")])

    def test_media_type_from_the_bytes(self):
        self.assertEqual(guides.media_type(b"\x89PNG\r\n\x1a\nxxxx"), "image/png")
        self.assertEqual(guides.media_type(b"RIFF0000WEBPxxxx"), "image/webp")
        self.assertEqual(guides.media_type(b"\xff\xd8\xff"), "image/jpeg")


class Boundary(unittest.TestCase):
    def test_inside(self):
        self.assertTrue(guides.inside(47.5, -121.5, SQUARE))
        self.assertFalse(guides.inside(48.5, -121.5, SQUARE))


if __name__ == "__main__":
    unittest.main()
