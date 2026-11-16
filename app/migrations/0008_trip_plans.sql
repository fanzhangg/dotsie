-- Suggested trip plans for a destination of the guide (spot_destinations), written by the Trip plans workflow
-- (pipeline/plan.py and the steps around it) from the destination's picks and entries, and loaded a destination at a
-- time, replacing its rows (pipeline/export_plans.py). Shown read-only to anyone at /developer/plans. A plan names its
-- places by source and id, as spot_guides does, and never holds guide text: the page joins it to the entries.
create table trip_plans (
  plan_id text primary key,     -- 'seattle-first-visit-3d'
  destination text not null,    -- spot_destinations.id
  title text not null,
  traveler text not null,       -- who it's for
  days text not null,           -- JSON: each day's theme, intro and items (kind, spot_id "<source>/<id>", start, minutes,
                                --   why, and leg: mode, minutes and the route's line from the place before)
  ideas text not null,          -- JSON: places that didn't fit, each with why
  places text not null,         -- JSON: spot_id -> name, point, kind, area and the fact card the plan was made from
  story text,                   -- JSON: the plan as an article (headline, dek, intro, days of text and cards, good_to_know,
                                --   closing), or null before it has one
  stops integer not null,
  built text not null,
  loaded_at text not null
);
create index trip_plans_by_destination on trip_plans (destination);

-- Which plans a place is in, kept in step with trip_plans.days
create table trip_plan_spots (
  plan_id text not null, source text not null, id text not null, day integer not null, start text not null,
  primary key (plan_id, day, start)
);
create index trip_plan_spots_by_place on trip_plan_spots (source, id);
