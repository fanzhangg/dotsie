"""Tests for plan.py's checks and repair rounds, with no network or model: python3 -m unittest test_plan (from pipeline/)."""
import os, unittest
from unittest import mock

os.environ.setdefault("PLAN_DESTINATION", "seattle")
import plan

ALWAYS = {"kind": "always", "open": None, "close": None, "closed_days": [], "source": None}


def spot(sid, name, area, hours=ALWAYS, minutes=60):
    return {"id": sid, "name": name, "area": area, "rank": 1, "reason": "", "lat": 0, "lng": 0,
            "facts": {"visit_minutes": minutes, "hours": hours, "best_time": "any", "best_time_why": "", "setting": "outdoor",
                      "book_ahead": False}}


MUSEUM = {"kind": "stated", "open": "10:00", "close": "17:00", "closed_days": ["Mon"], "source": "https://example.org"}
K = {"destination": "Testville", "travel_note": "", "areas": [{"id": "a1", "name": "Old town", "spots": ["A", "B"]}, {"id": "a2", "name": "Hill", "spots": ["C"]}],
     "spots": [spot("A", "Market", "a1"), spot("B", "Museum", "a1", MUSEUM, 120), spot("C", "Hill", "a2")],
     "travel": {"A": {"B": {"minutes": 10, "mode": "walk"}, "C": {"minutes": 60, "mode": "drive"}},
                "B": {"A": {"minutes": 10, "mode": "walk"}, "C": {"minutes": 60, "mode": "drive"}},
                "C": {"A": {"minutes": 60, "mode": "drive"}, "B": {"minutes": 60, "mode": "drive"}}}}
CFG = {"id": "t", "days": 1, "traveler": "anyone"}


def stop(sid, start, minutes):
    return {"kind": "stop", "spot_id": sid, "near": None, "start": start, "minutes": minutes, "why": ""}


def lunch(near, start):
    return {"kind": "lunch", "spot_id": None, "near": near, "start": start, "minutes": 60, "why": ""}


class Check(unittest.TestCase):
    def test_a_plan_that_fits_has_no_errors_and_warns_of_closed_days(self):
        p = {"days": [{"theme": "", "items": [stop("A", "09:00", 60), stop("B", "10:10", 110), lunch("B", "12:00")]}],
             "ideas": [{"spot_id": "C", "why": ""}]}
        errors, warnings = plan.check(p, K, CFG)
        self.assertEqual(errors, [])
        self.assertEqual(warnings, ["Day 1: Museum is closed on Mon; put this day on another weekday."])

    def test_travel_hours_lunch_repeats_and_unknown_places_are_errors(self):
        p = {"days": [{"theme": "", "items": [stop("B", "09:00", 60), stop("A", "10:00", 30), stop("C", "10:40", 60),
                                              stop("A", "16:00", 30), stop("Z", "17:00", 30)]}], "ideas": []}
        errors, _ = plan.check(p, K, CFG)
        self.assertIn("Day 1: Museum is 09:00–10:00, but it's open 10:00–17:00.", errors)
        self.assertIn("Day 1: Market starts at 10:00, but Museum ends at 10:00 and it takes 10 min to get there.", errors)
        self.assertIn("Day 1: Hill starts at 10:40, but Market ends at 10:30 and it takes 60 min to get there.", errors)
        self.assertIn("Day 1: Market is already in the plan.", errors)
        self.assertIn("Day 1: 'Z' isn't one of the places.", errors)
        self.assertIn("Day 1 has 130 min of travel, more than 90.", errors)
        self.assertIn("Day 1 has no lunch between 11:30 and 14:30.", errors)


class Repair(unittest.TestCase):
    def test_errors_go_back_by_the_ids_the_model_uses_until_the_plan_fits(self):
        bad = {"days": [{"theme": "", "items": [stop("s1", "09:00", 60), stop("s2", "10:10", 110)]}], "ideas": [{"spot_id": "s3", "why": ""}]}
        good = {"days": [{"theme": "", "items": [stop("s1", "09:00", 60), stop("s2", "10:10", 110), lunch("s2", "12:00")]}],
                "ideas": [{"spot_id": "s3", "why": ""}]}
        prompts = []

        def ask(model, system, text, schema, effort, folder, key):
            prompts.append(text)
            return bad if len(prompts) == 1 else good
        with mock.patch.object(plan, "ask", ask), mock.patch.object(plan, "log"):
            r = plan.make(CFG, K)
        self.assertEqual(r["rounds"], 2)
        self.assertEqual(r["checks"]["errors"], [])
        self.assertIn("- Day 1 has no lunch between 11:30 and 14:30.", prompts[1])
        self.assertIn("Your last plan:", prompts[1])
        self.assertEqual([i["spot_id"] for i in r["days"][0]["items"]], ["A", "B", None])
        self.assertEqual(r["days"][0]["items"][2]["near"], "B")


if __name__ == "__main__":
    unittest.main()
