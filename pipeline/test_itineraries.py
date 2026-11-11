"""Tests for itineraries.py that need no network or model: python3 -m unittest test_itineraries (from pipeline/)."""
import json, os, unittest
import itineraries as it

# Three junctions in a line, A - B - C, an hour apart, the B - C road open only in summer; and a fourth, D, off B.
ROADS = {
    "nodes": {"a": {"name": "A", "lat": 45.0, "lng": -110.0, "gateway": True}, "b": {"name": "B", "lat": 45.0, "lng": -109.5},
              "c": {"name": "C", "lat": 45.0, "lng": -109.0}, "d": {"name": "D", "lat": 45.5, "lng": -109.5}},
    "segments": [{"a": "a", "b": "b", "minutes": [60, 60], "open": ["01-01", "12-31"]},
                 {"a": "b", "b": "c", "minutes": [50, 70], "open": ["06-01", "09-30"]},
                 {"a": "b", "b": "d", "minutes": [30, 30], "open": ["01-01", "12-31"]}],
    "bases": [{"node": "b", "name": "B", "lodging": []}, {"node": "c", "name": "C", "lodging": []}],
    "access": {"x/far": {"node": "d", "why": "reached from D"}},
}
STOPS = [{"id": "x/mid", "name": "Halfway Falls", "lat": 45.001, "lng": -109.75, "kind": "pick", "rank": 2},
         {"id": "x/atb", "name": "B Springs", "lat": 45.0005, "lng": -109.5005, "kind": "pick", "rank": 3},
         {"id": "x/far", "name": "Far Lake", "lat": 45.9, "lng": -108.0, "kind": "pick", "rank": 4}]
SUMMER = ("06-15", "09-15")


def plan(*days, start="a", end="a", season=SUMMER):
    return {"days_why": "", "start": start, "end": end, "season": {"from": season[0], "to": season[1], "why": ""},
            "summary": "", "left_out": [],
            "days": [{"title": f"day {i}", "base": base, "stops": [{"id": s, "minutes": m, "why": ""} for s, m in stops]}
                     for i, (base, stops) in enumerate(days, 1)]}


class TestRoads(unittest.TestCase):
    def test_stops_go_on_the_road_they_are_nearest(self):
        r = it.Roads(ROADS, STOPS, SUMMER)
        self.assertEqual(r.where["x/atb"], {"node": "b"})  # within 1.5 km of a junction: at it
        self.assertEqual(r.where["x/far"]["node"], "d")    # the roads file's access wins
        self.assertEqual(r.where["x/mid"]["segment"], 0)
        self.assertAlmostEqual(r.where["x/mid"]["t"], 0.5, places=2)
        self.assertEqual(round(r.route("a", "x/mid")["minutes"]), 30)  # half of the A - B road's hour
        self.assertEqual(r.describe("x/mid"), "on the road from A to B, about 30 min from A")

    def test_a_road_not_open_all_season_is_left_out(self):
        self.assertEqual(it.Roads(ROADS, STOPS, SUMMER).route("a", "c")["minutes"], 120)  # 60 + the mean of 50-70
        self.assertEqual(it.Roads(ROADS, STOPS).route("a", "c")["minutes"], 120)          # no season: every road
        late_may = it.Roads(ROADS, STOPS, ("05-31", "07-01"))
        self.assertIsNone(late_may.route("a", "c"))
        east = STOPS + [{"id": "x/east", "name": "East Meadow", "lat": 45.0, "lng": -109.25, "kind": "pick", "rank": 5}]
        self.assertEqual(it.Roads(ROADS, east, ("05-31", "07-01")).describe("x/east"),
                         "on the road from B to C (closed for part of the season), about 30 min from B")

    def test_legs_name_only_the_junctions_passed_between(self):
        r = it.Roads(ROADS, STOPS, SUMMER)
        names = {"a": "A", "b": "B", "c": "C", "d": "D", "x/mid": "Halfway Falls", "x/atb": "B Springs", "x/far": "Far Lake"}
        legs = it.legs_of(plan(("b", [("x/mid", 30), ("x/far", 60)]), ("", [])), r, names)
        self.assertEqual(legs[0]["legs"][1]["via"], ["B"])  # Halfway Falls to Far Lake goes by B, then D, where Far Lake is
        self.assertEqual(legs[0]["drive"], 30 + 60 + 30)    # to the falls, on by B to Far Lake (at D), back to the night at B
        self.assertEqual(legs[1]["drive"], 60)


class TestCheckPlan(unittest.TestCase):
    def setUp(self):
        self.check = lambda p: it.check_plan(p, STOPS, ROADS)

    def test_a_good_plan_passes(self):
        self.assertEqual(self.check(plan(("b", [("x/mid", 60), ("x/atb", 60)]), ("", [("x/far", 90)]))), [])

    def test_unknown_places_bad_bases_and_repeats_are_named(self):
        errors = self.check(plan(("nowhere", [("x/mid", 60), ("x/nope", 30)]), ("c", [("x/mid", 0)])))
        self.assertIn("Day 1's base 'nowhere' isn't one of the bases.", errors)
        self.assertIn("Day 1: 'x/nope' isn't one of the places.", errors)
        self.assertIn("Day 2 is the last: it ends at a, with no base.", errors)
        self.assertIn("Day 2: Halfway Falls is already on an earlier day.", errors)
        self.assertEqual(self.check(plan(*[("b", [])] * 7 + [("", [])])), ["The trip has 8 days; make it 1 to 7."])
        self.assertEqual(self.check(plan(("", []), start="b", end="z")), ["start 'b' isn't one of the gateways.", "end 'z' isn't one of the gateways."])
        self.assertEqual(self.check(plan(("", []), season=("09-15", "06-15"))),
                         ["The season runs from 09-15 to 06-15: give it within one year, from before to."])
        self.assertEqual(self.check(plan(("", []), season=("June", "09-15"))), ["The season June to 09-15 isn't two MM-DD dates."])

    def test_long_days_and_roads_not_open_all_season(self):
        self.assertEqual(self.check(plan(("", [("x/mid", 500), ("x/atb", 60)]))),
                         ["Day 1 takes 680 minutes with its drives, more than 600."])
        to_c = plan(("c", [("x/mid", 30)]), ("", []))  # a night at C, behind the summer-only road
        self.assertEqual(self.check(to_c), [])
        self.assertEqual(self.check(dict(to_c, season={"from": "05-15", "to": "09-15", "why": ""})), [
            "The road from B to C is open only from 06-01 to 09-30, not all through the season 05-15 to 09-15.",
            "Day 1: no road open all season from Halfway Falls to C.",
            "Day 2: no road open all season from C to A."])


class TestSources(unittest.TestCase):
    def test_walks_and_tours_find_the_place_they_are_about(self):
        self.assertLessEqual(it.key_words("Grand Prismatic Spring"), set(it.core("Grand Prismatic Overlook Trail")))
        self.assertLessEqual(it.key_words("Mammoth Hot Springs"), set(it.core("Mammoth Hot Springs Trails")))
        self.assertFalse(it.key_words("Old Faithful Inn") <= set(it.core("Watch Old Faithful Geyser Erupt")))
        self.assertEqual(it.duration_of("1-2 Hours"), [60, 120])
        self.assertEqual(it.duration_of("30-90 Minutes"), [30, 90])
        self.assertIsNone(it.duration_of(""))

    def test_the_writing_cites_only_the_dossier(self):
        w = {"intro": [{"text": "", "sources": ["u1"]}], "days": [{"title": "", "paragraphs": [{"text": "", "sources": ["u2"]}]}],
             "practical": [{"label": "", "value": "", "source": "u1"}]}
        self.assertEqual(it.check_written(w, {"days": [{}]}, [("u1", "", "")]), ["cites u2, not in the dossier"])

    def test_the_parks_roads_file_is_whole(self):
        here = os.path.dirname(os.path.abspath(__file__))
        for f in os.listdir(os.path.join(here, "roads")):
            r = json.load(open(os.path.join(here, "roads", f)))
            for s in r["segments"]:
                self.assertIn(s["a"], r["nodes"])
                self.assertIn(s["b"], r["nodes"])
            for b in r["bases"]:
                self.assertIn(b["node"], r["nodes"])
            self.assertTrue(any(v.get("gateway") for v in r["nodes"].values()))


if __name__ == "__main__":
    unittest.main()
