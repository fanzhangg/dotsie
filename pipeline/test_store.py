"""Tests for store.py that need no network: python3 -m unittest test_store (from pipeline/)."""
import sqlite3, types, unittest
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
        Store.links(store)
        self.assertEqual(sorted(db.execute("SELECT * FROM links")), [
            ("nps:parks", "P1", "wikidata", "Q944329", "P4083"),
            ("nps:places", "X1", "wikidata", "Q1", "P8649"),
            ("wikidata", "Q944329", "nps:parks", "P1", "website"),
        ])


if __name__ == "__main__":
    unittest.main()
