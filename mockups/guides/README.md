# Guides mockup

Now in the app: a city's trip plans are on the Spots page, each an article at `#/plans/<id>` ([app/web/tripplans.js](../../app/web/tripplans.js), [the UX design](../../docs/ux-design.md#trip-plans)), on the plans as they are in D1. This mockup stays as where it started, on an older copy of Seattle's plan.

What guides could look like in Dotsie: a destination's places and suggested plans, each plan told as an article
that reads like a blog post, laid out as a place's guide is: a bar with Back at the top, and its one button, Make
it my trip, floating at the bottom beside the trip's dates. Which day you're on is always clear: the bar names the day you're reading, each day
opens with "Day 2", its name and what it asks of you (places, time on foot and by car), and each card says "Day 2 ·
Afternoon". A day has one name everywhere it shows. Cards carry no numbers: numbers belong to the map, one
day at a time under the app's day tabs, starting at 1 each day as in the app's day view, with the same numbers in
the list under it, and a button under the list opens that day's schedule with its times. Photo credits are at the
end, as a magazine has them. It's a design to try out, not part of the app: no server and no sign-in.

- **The data** is real: `data/SEA.json`, Seattle's rows of the tables in
  [Trip plans](../../docs/trip-plans.md), written by `pipeline/export_plans.py --mockup` (this copy is Seattle's from before
  the plans moved onto the guide's picks: its places are keyed by Wikidata item). The page joins
  them by `spot_id`, as the app would ([data.js](data.js)): the article's cards are drawn from each spot's guide
  and fact card, never from the plan.
- **The look** is the design system's: the trip card, the timeline, the day tabs, the pins, the about card, the
  modal sheet and the toast. Stop types, their icons and the travel words come from `app/web/plan.js`. The map is
  the trip map's ([maps.js](maps.js)): MapLibre on Stadia's style, the routes on the ground (looked up by the
  pipeline) in the app's route layers, numbered pins that merge where they crowd with the app's own code
  (`app/web/pins.js`), tapping a pin to select it (its row in the plan's list goes grey; tapping a row selects its
  pin and brings the map up close), and Whole trip. Only its gestures differ: one finger scrolls the page, two move
  the map.
- **Pages:** `#/`, the destination (plans, then places); `#/plan/<id>`, the plan as an article ([story.js](story.js));
  `#/plan/<id>/<day>`, the plan hour by hour (0 is the overview). A place's guide opens in a sheet over any of them.
- **Make it my trip** writes the plan, from the dates picked (tap them to change the first day), into the
  prototype's trips (its localStorage, as `POST /api/trips` and a `PUT` per stop would in the app); the button then
  becomes **Open my trip**, which shows it at `/prototype/#/trip/<id>`. Served
  from the same address as the prototype only: run the server from the repo root. A browser that never opened the
  prototype gets the copied trip without the prototype's sample trips.
- **Save**, a small button beside each card's name, keeps places in this browser ([trips.js](trips.js)), listed under Saved
  places on the destination's page. In the app, a saved place
  would go on a trip's Want to go list, which isn't built yet.

Run it from the repo root, then open `http://localhost:5174/mockups/guides/` (`?area=` for another destination's
file):

```bash
python3 -m http.server 5174 -d .
```
