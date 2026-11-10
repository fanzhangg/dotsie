"""Tests for export_d1.py that need no network: python3 -m unittest test_export (from pipeline/).

Loads on SQLite with the app's migrations, as D1 has them: the names' search index (places_fts) must follow every
load, a record in two states included."""
import glob, io, os, sqlite3, unittest
from export_d1 import inserts

MIGRATIONS = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "app", "migrations", "*.sql")))
COLS = ["source", "id", "state", "name", "views"]


class SearchIndex(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        for f in MIGRATIONS:
            self.db.executescript(open(f).read())

    def load(self, st, rows):
        out = io.StringIO()
        out.write(f"DELETE FROM places WHERE state = '{st}';\n")
        inserts("places", COLS, rows, out, key=["source", "id"])
        self.db.executescript(out.getvalue())

    def find(self, words):
        return self.db.execute("SELECT p.id, p.state FROM places_fts JOIN places p ON p.n = places_fts.rowid "
                               "WHERE places_fts MATCH ? ORDER BY p.id", (words,)).fetchall()

    def test_a_record_in_two_states_and_a_rename(self):
        self.load("ID", [("wikidata", "Q9", "ID", "Snake River", 5), ("wikidata", "Q10", "ID", "Craters of the Moon", 1)])
        self.load("WA", [("wikidata", "Q1", "WA", "Mount Rainier", 9), ("wikidata", "Q9", "WA", "Snake River", 5)])
        self.assertEqual(self.find('"snake"*'), [("Q9", "WA")])  # the last state loaded has it, once
        self.load("ID", [("wikidata", "Q9", "ID", "Snake River (Idaho)", 5), ("wikidata", "Q10", "ID", "Craters of the Moon", 1)])
        self.assertEqual(self.find('"idaho"'), [("Q9", "ID")])
        self.assertEqual(self.find('"rain"*'), [("Q1", "WA")])
        self.load("WA", [])
        self.assertEqual(self.find('"rain"*'), [])
        self.db.execute("INSERT INTO places_fts (places_fts) VALUES ('integrity-check')")

    def test_statements_split_under_d1s_limit(self):
        out = io.StringIO()
        inserts("places", COLS, [("wikidata", f"Q{i}", "WA", "x" * 1000, i) for i in range(300)], out, key=["source", "id"])
        statements = [s for s in out.getvalue().split(";\n") if s]
        self.assertGreater(len(statements), 1)
        self.assertTrue(all(len(s) < 100_000 and s.endswith("views = excluded.views") for s in statements))


if __name__ == "__main__":
    unittest.main()
