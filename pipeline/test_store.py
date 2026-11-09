"""Tests for store.py that need no network: python3 -m unittest test_store (from pipeline/)."""
import sqlite3, types, unittest
from unittest import mock
import store
from store import SCHEMA, Store


class Links(unittest.TestCase):
    def test_identifiers_match_whatever_their_case_and_websites_whatever_their_slash(self):
        db = sqlite3.connect(":memory:")
        db.executescript(SCHEMA)
        db.executemany("INSERT INTO ids VALUES (?,?,?,?)", [
            ("wikidata", "Q944329", "P4083", "MORA"),               # Mount Rainier National Park
            ("wikidata", "Q944329", "P856", "https://www.nps.gov/mora/"),
            ("wikidata", "Q1", "P8649", "paradise-inn"),
            ("wikidata", "Q2", "P590", "1234"),                     # only on Wikidata: no link
            ("nps:parks", "P1", "P4083", "mora"),
            ("nps:parks", "P1", "url", "https://www.nps.gov/mora"),
            ("nps:places", "X1", "P8649", "paradise-inn"),
            ("nps:places", "X1", "parkCode", "mora"),                # a park it's in, not the same place
        ])
        store = types.SimpleNamespace(db=db)
        store.name_links = lambda: Store.name_links(store)
        Store.links(store)
        self.assertEqual(sorted(db.execute("SELECT * FROM links")), [
            ("nps:parks", "P1", "wikidata", "Q944329", "P4083"),
            ("nps:places", "X1", "wikidata", "Q1", "P8649"),
            ("wikidata", "Q944329", "nps:parks", "P1", "website"),
        ])


class NameLinks(unittest.TestCase):
    def test_the_same_or_nearly_the_same_name_close_by_is_probably_the_same_place(self):
        db = sqlite3.connect(":memory:")
        db.executescript(SCHEMA)
        rec = lambda source, rid, name, lat, lng: (source, rid, name, lat, lng, None, None, None, None, "{}")
        db.executemany("INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?)", [
            rec("wikidata", "Q1", "Tipsoo Lake", 46.8697, -121.5185),
            rec("wikidata", "Q2", "Gobbler's Knob Fire Lookout", 46.7350, -121.9440),
            rec("wikidata", "Q3", "King Street Station", 47.5985, -122.3297),
            rec("wikidata", "Q4", "Tipsoo Lake Comfort Station", 46.8700, -121.5190),
            rec("wikidata", "Q5", "Ruby Beach", 47.7100, -124.4150),
            rec("nps:places", "A", "Tipsoo Lake", 46.8690, -121.5160),                  # 200 m: same name
            rec("nps:places", "B", "Gobblers Knob Fire Lookout", 46.7355, -121.9445),   # nearly the same name
            rec("nps:places", "C", "King Street Station (#23)", 47.5989, -122.3299),    # a tour's number
            rec("nps:places", "D", "Ruby Beach", 47.7300, -124.4150),                   # 2.2 km away: no
        ])
        Store.name_links(types.SimpleNamespace(db=db))
        self.assertEqual(sorted(db.execute("SELECT source_a, id_a, id_b, via FROM links")), [
            ("nps:places", "A", "Q1", "name"),
            ("nps:places", "B", "Q2", "similar name"),
            ("nps:places", "C", "Q3", "name"),
        ])


class Wikitext(unittest.TestCase):
    def test_an_answer_split_by_continuation_and_a_redirect_come_back_whole_under_the_title_asked(self):
        answers = [
            {"continue": {"clcontinue": "2|B", "continue": "||"}, "query": {
                "redirects": [{"from": "Gas Works", "to": "Gas Works Park"}],
                "pages": [{"title": "Gas Works Park", "revisions": [{"revid": 11, "slots": {"main": {"content": "{{Infobox park}}"}}}],
                           "categories": [{"title": "Category:Parks in Seattle"}]},
                          {"title": "Space Needle", "revisions": [{"revid": 22, "slots": {"main": {"content": "{{Infobox building}}"}}}]}]}},
            {"query": {"pages": [{"title": "Gas Works Park"},
                                 {"title": "Space Needle", "categories": [{"title": "Category:Towers in Seattle"}]}]}},
        ]
        with mock.patch.object(store, "http_json", side_effect=answers):
            got = store.wikitext(["Gas Works", "Space Needle", "Gas Works Park"])
        self.assertIs(got["Gas Works Park"], got["Gas Works"])  # a redirect and its page, both asked
        self.assertEqual(got["Gas Works"]["text"], "{{Infobox park}}")
        self.assertEqual(got["Gas Works"]["rev"], 11)
        self.assertEqual(got["Gas Works"]["categories"], ["Parks in Seattle"])
        self.assertEqual(got["Space Needle"]["categories"], ["Towers in Seattle"])


if __name__ == "__main__":
    unittest.main()
