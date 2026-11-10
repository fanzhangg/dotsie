-- A destination's picks and their guidebook entries, written by a model from the sources each entry lists
-- (pipeline/guides.py) and loaded here by the Spots guides workflow. Entries are published under CC BY-SA 4.0.
-- Shown read-only at /developer/guide, for review before anything reaches the app.
create table spot_destinations (
  id text primary key,        -- 'seattle'
  name text not null,
  state text not null,        -- 'WA'
  kind text,                  -- 'big city'
  wikidata text,
  built_at text not null,
  counts text,                -- JSON: candidates, sights, shortlist, picks
  left_out text               -- JSON array: shortlisted places the model chose not to pick, with its reason
);

create table spot_picks (
  destination text not null,
  source text not null,       -- the place's record in `places`
  id text not null,
  rank integer not null,      -- 1 for the first place to send someone
  reason text,                -- one sentence on why a visitor should go
  primary key (destination, source, id)
);
create index spot_picks_by_place on spot_picks (source, id);

create table spot_guides (
  source text not null,
  id text not null,
  state text not null,
  name text not null,
  one_liner text not null,
  paragraphs text not null,   -- JSON array: {text, sources: [url]}
  practical text,             -- JSON array: {label, value, source}
  sources text,               -- JSON array: {url, kind}
  images text,                -- JSON: {hero, inline: [{after_paragraph, …}]}, each a Commons file with author and licence
  overlap real,               -- share of 8-word phrases also in the sources
  model text,
  prompt text,
  created_at text not null,
  primary key (source, id)
);
