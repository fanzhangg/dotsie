# Trip plans

Suggested days for a destination of the guide: a first visit of three days to Seattle so far. A plan is made from the
destination's picks and their guide entries ([pipeline/guides.py](../pipeline/guides.py)), and only ever points at
them: it holds places, times and the way between them, never guide text, so an entry written again shows in every plan
it's in. Reviewed at `/developer/plans`, and shown in the app: a city's plans above its spots on the Spots page, each
an article at `#/plans/<id>` that anyone can read and anyone signed in can make their own trip ([the UX design](ux-design.md#trip-plans)).

## Two lines

The guide writes about places; a plan puts them in order. They share one thing, the knowledge layer, and are joined
by place (`<source>/<id>`, as `places` and `spot_guides` key them):

```
picks + entries (the state's store)
        │
   knowledge.py ── fact cards, travel estimates, areas
        │
     plan.py ───── drafted by a model, checked in code, sent back to fix
        │
   compose.py ──── real routes for each leg, a line to open each day
        │
    story.py ───── the plan as an article: the one step that reads plans and entries together
        │
 export_plans.py ─ rows for D1 (trip_plans, trip_plan_spots); a plan that fails its checks stays out
```

## Knowledge

- **Spots:** the destination's best picks (at most 20, best first) with a point on the map. The destination's own
  entry (a park as a whole) isn't a stop.
- **Fact cards (Haiku):** what kind of stop it is, how long people stay, opening hours, the best time of day, whether to
  book, indoors or out, whether it costs, read from the place's entry (its paragraphs and practical notes, each with
  its sources). A fact the entry doesn't cite a source for is the model's estimate, and marked so.
- **Travel:** straight-line distance with a detour factor, on foot within 1.6 km, else by car. Good enough to plan
  with; `compose.py` looks up the legs a plan picks.
- **Areas:** places within 1.6 km of each other, grouped, so a day can keep to one part of town.

## Plan

A model (Opus) drafts the days: stops and meals, each with a start and a length, and the places that don't fit as
ideas (a trip's Want to go list). Code then checks every rule in `plan.py`'s `LIMITS`: open at that time, time to get
from one item to the next, at most 90 minutes of travel a day, a day from 08:30 to 21:30, lunch between 11:30 and
14:30, no place twice. What fails goes back to the model with the reasons, at most three times. Hours the sources
don't give, a place shut some weekdays and a short visit are warnings: kept, but not sent back.

## Compose and story

- **Routes:** each leg is looked up on OpenStreetMap's routers (the ones the app uses: driving on the OSRM demo,
  walking on OpenStreetMap Germany's), with its line for the map. Driving doesn't count parking.
- **Day intros (Haiku):** a sentence or two from the day's places and their one-liners.
- **Story (Opus):** the plan as a feature, day by day, with a card where each place comes up. Checked in code: each
  day's places as cards once, in the plan's order; no clock times or prices in the text (the cards and the itinerary
  show those). One repair round, then code puts the cards in order. How much wording it shares with the entries is
  measured.

## Where things live

| Where | What |
| --- | --- |
| The state's store (`data/<ST>.sqlite`, in R2) | The picks and entries plans start from, and every model answer the steps used (`llm_answers`), so a run asks again only what changed |
| `out/plans/<destination>/` | Each step's JSON, and `plans.html` to review them on this machine |
| D1 (`app/migrations/0008_trip_plans.sql`) | `trip_plans`: a plan whole (days, ideas, its places' fact cards, its article); `trip_plan_spots`: which plans a place is in. Replaced a destination at a time |
| `/developer/plans` | Each plan day by day, with its article, each place linked to its entry in the guide preview |
| `/api/spots/plans` | The plans for the app: a city's as cards on the Spots page, and each whole for its article at `#/plans/<id>` ([app/web/tripplans.js](../app/web/tripplans.js)) |
| [mockups/guides](../mockups/guides) | Where the app's article started: the design tried out on Seattle's plans before it was in the app |

## Running it

The [Trip plans workflow](../.github/workflows/trip-plans.yml) runs after each successful Spots guides run, for the
destinations in its `PLANNED` list, or by hand for the ones you name. On this machine, with the state's store in
`pipeline/data/`:

```bash
cd pipeline
PLAN_DESTINATION=seattle python3 knowledge.py
PLAN_DESTINATION=seattle python3 plan.py
PLAN_DESTINATION=seattle python3 compose.py
PLAN_DESTINATION=seattle python3 story.py
PLAN_DESTINATION=seattle python3 export_plans.py --sql out/plans/seattle/plans.d1.sql --mockup
```

The checks, the repair rounds and the export have tests that need no model: `python3 -m unittest test_plan test_plans`.

## Still open

- A city on foot first. A park or a road trip needs other limits: longer drives, and a day that starts at a trailhead.
- A plan's `why` for each stop is the model's and isn't checked.
