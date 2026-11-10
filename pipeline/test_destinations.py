"""Tests for destinations.py that need no network: python3 -m unittest test_destinations (from pipeline/)."""
import unittest
from unittest import mock
import destinations

DESTS = [
    {"id": "seattle", "name": "Seattle", "state": "WA", "kind": "big city"},
    {"id": "olympic", "name": "Olympic National Park", "state": "WA", "kind": "national park"},
    {"id": "yellowstone", "name": "Yellowstone National Park", "state": "WY", "other_states": ["ID", "MT"], "kind": "national park"},
    {"id": "teton-county-wy", "name": "Teton County", "state": "WY", "other_states": ["ID"], "kind": "county"},
]


class Plan(unittest.TestCase):
    def ids(self, spec):
        return {j["state"]: j["ids"] for j in destinations.plan(spec, DESTS)}

    def test_one_job_per_state_with_every_store_it_reads(self):
        self.assertEqual(destinations.plan("all", DESTS), [
            {"state": "WA", "ids": ["seattle", "olympic"], "stores": ["WA"]},
            {"state": "WY", "ids": ["yellowstone", "teton-county-wy"], "stores": ["WY", "ID", "MT"]}])

    def test_by_id_kind_and_state(self):
        self.assertEqual(self.ids("parks"), {"WA": ["olympic"], "WY": ["yellowstone"]})
        self.assertEqual(self.ids("counties"), {"WY": ["teton-county-wy"]})
        self.assertEqual(self.ids("cities"), {"WA": ["seattle"]})
        self.assertEqual(self.ids("WY, seattle"), {"WA": ["seattle"], "WY": ["yellowstone", "teton-county-wy"]})

    def test_a_word_that_names_nothing_is_an_error_not_a_smaller_run(self):
        with self.assertRaises(ValueError):
            destinations.plan("seattle,seatle", DESTS)

    def test_the_summary_says_what_it_would_cost(self):
        text = destinations.markdown(destinations.plan("parks", DESTS))
        self.assertIn("2 destinations in 2 states", text)
        self.assertIn("about $2 ($5 with Opus writing)", text)
        self.assertIn("- WY: yellowstone (also reads ID, MT)", text)


class Ids(unittest.TestCase):
    def test_slug(self):
        self.assertEqual(destinations.slug("Hawaiʻi Volcanoes"), "hawaii-volcanoes")
        self.assertEqual(destinations.slug("Wrangell–St. Elias"), "wrangell-st-elias")
        self.assertLessEqual(len(destinations.slug("Black Canyon of the Gunnison and a very long name indeed")), 40)


class Parks(unittest.TestCase):
    def test_a_parks_state_is_where_its_centre_is_and_the_others_are_read(self):
        def arcgis(url, **params):
            if "FeatureServer/2/" in url:
                return [{"attributes": {"UNIT_CODE": "YELL", "UNIT_NAME": "Yellowstone National Park", "STATE": "ID-MT-WY"}},
                        {"attributes": {"UNIT_CODE": "NPSA", "UNIT_NAME": "National Park of American Samoa", "STATE": "SAMOA"}}]
            if "FeatureServer/0/" in url:
                return [{"attributes": {"UNIT_CODE": "YELL"}, "geometry": {"x": -110.49, "y": 44.58}},
                        {"attributes": {"UNIT_CODE": "NPSA"}, "geometry": {"x": -170.7, "y": -14.2}}]
            return [{"attributes": {"STUSAB": "WY" if params["geometry"].startswith("-110") else "AS"}}]
        with mock.patch.object(destinations, "arcgis", arcgis), \
                mock.patch.object(destinations, "most_linked", lambda prop, codes: {"YELL": "Q351", "NPSA": "Q1"}):
            self.assertEqual(destinations.parks(), [
                {"id": "yellowstone", "name": "Yellowstone National Park", "state": "WY", "other_states": ["ID", "MT"],
                 "kind": "national park", "wikidata": "Q351", "nps_unit": "YELL", "cap": 15}])


if __name__ == "__main__":
    unittest.main()
