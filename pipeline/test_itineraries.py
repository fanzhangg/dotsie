"""Tests for itineraries.py that need no network or model: python3 -m unittest test_itineraries (from pipeline/)."""
import datetime, json, os, unittest
import itineraries as it

# Three junctions in a line, A - B - C, an hour apart, the B - C road open only in summer; and a fourth, D, off B.
ROADS = {
    "nodes": {"a": {"name": "A", "lat": 45.0, "lng": -110.0}, "b": {"name": "B", "lat": 45.0, "lng": -109.5},
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
JULY = [datetime.date(2027, 7, 14), datetime.date(2027, 7, 15)]
TRIP = {"id": "t", "days": 2, "start": "a", "end": "a", "first_day": "2027-07-14", "for": "a test"}


def plan(*days):
    return {"summary": "", "left_out": [],
            "days": [{"title": f"day {i}", "base": base, "stops": [{"id": s, "minutes": m, "why": ""} for s, m in stops]}
                     for i, (base, stops) in enumerate(days, 1)]}


class TestRoads(unittest.TestCase):
    def test_stops_go_on_the_road_they_are_nearest(self):
        r = it.Roads(ROADS, STOPS, JULY)
        self.assertEqual(r.where["x/atb"], {"node": "b"})  # within 1.5 km of a junction: at it
        self.assertEqual(r.where["x/far"]["node"], "d")    # the roads file's access wins
        self.assertEqual(r.where["x/mid"]["segment"], 0)
        self.assertAlmostEqual(r.where["x/mid"]["t"], 0.5, places=2)
        self.assertEqual(round(r.route("a", "x/mid")["minutes"]), 30)  # half of the A - B road's hour
        self.assertEqual(r.describe("x/mid"), "on the road from A to B, about 30 min from A")

    def test_a_road_closed_on_any_day_of_the_trip_is_left_out(self):
        self.assertEqual(it.Roads(ROADS, STOPS, JULY).route("a", "c")["minutes"], 120)  # 60 + the mean of 50-70
        may = it.Roads(ROADS, STOPS, [datetime.date(2027, 5, 31), datetime.date(2027, 6, 1)])
        self.assertIsNone(may.route("a", "c"))
        east = STOPS + [{"id": "x/east", "name": "East Meadow", "lat": 45.0, "lng": -109.25, "kind": "pick", "rank": 5}]
        self.assertEqual(it.Roads(ROADS, east, [datetime.date(2027, 5, 31)]).describe("x/east"),
                         "on the road from B to C (closed on the trip's dates), about 30 min from B")

    def test_legs_name_only_the_junctions_passed_between(self):
        r = it.Roads(ROADS, STOPS, JULY)
        names = {"a": "A", "b": "B", "c": "C", "d": "D", "x/mid": "Halfway Falls", "x/atb": "B Springs", "x/far": "Far Lake"}
        legs = it.legs_of(plan(("b", [("x/mid", 30), ("x/far", 60)]), ("", [])), TRIP, r, names)
        self.assertEqual(legs[0]["legs"][1]["via"], ["B"])  # Halfway Falls to Far Lake goes by B, then D, where Far Lake is
        self.assertEqual(legs[0]["drive"], 30 + 60 + 30)    # to the falls, on by B to Far Lake (at D), back to the night at B
        self.assertEqual(legs[1]["drive"], 60)


class TestCheckPlan(unittest.TestCase):
    def setUp(self):
        self.roads = it.Roads(ROADS, STOPS, JULY)
        self.check = lambda p, trip=TRIP: it.check_plan(p, trip, STOPS, ROADS["bases"], self.roads)

    def test_a_good_plan_passes(self):
        self.assertEqual(self.check(plan(("b", [("x/mid", 60), ("x/atb", 60)]), ("", [("x/far", 90)]))), [])

    def test_unknown_places_bad_bases_and_repeats_are_named(self):
        errors = self.check(plan(("nowhere", [("x/mid", 60), ("x/nope", 30)]), ("c", [("x/mid", 0)])))
        self.assertIn("Day 1's base 'nowhere' isn't one of the bases.", errors)
        self.assertIn("Day 1: 'x/nope' isn't one of the places.", errors)
        self.assertIn("Day 2 is the last: it ends at a, with no base.", errors)
        self.assertIn("Day 2: Halfway Falls is already on an earlier day.", errors)
        self.assertEqual(self.check(plan(("", []),)), ["The trip is 2 days; the plan has 1."])

    def test_long_days_and_closed_roads(self):
        long = dict(TRIP, days=1)
        self.assertEqual(self.check(plan(("", [("x/mid", 500), ("x/atb", 60)])), long),
                         ["Day 1 takes 680 minutes with its drives, more than 600."])
        may = dict(TRIP, days=1, first_day="2027-05-20")
        roads = it.Roads(ROADS, STOPS, [datetime.date(2027, 5, 20)])
        self.assertEqual(it.check_plan(plan(("", [])), dict(may, end="c"), STOPS, ROADS["bases"], roads),
                         ["Day 1: no open road from A to C on the trip's dates."])


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
            for t in r["trips"]:
                self.assertIn(t["start"], r["nodes"])
                self.assertIn(t["end"], r["nodes"])


if __name__ == "__main__":
    unittest.main()
