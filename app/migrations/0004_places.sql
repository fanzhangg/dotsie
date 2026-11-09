-- Places as outside sources describe them (Wikidata, the NPS Data API), one row per record, unfiltered. The Spots
-- data workflow builds each state's store and loads it here (pipeline/export_d1.py), replacing that state's rows.
-- Shown read-only to anyone at /data. Metadata and links only: no text copied from other sites.
create table places (
  source text not null,      -- 'wikidata', 'nps:places', 'nps:parks', …
  id text not null,          -- the record's ID at its source (a QID, an NPS ID)
  state text not null,       -- 'WA'
  name text not null,
  description text,          -- Wikidata's one-line description, or the NPS listing's
  lat real,
  lng real,
  types text,                -- JSON array of names: Wikidata's "instance of", or the NPS endpoint
  url text,                  -- the record's page at its source
  wikipedia text,            -- English Wikipedia article title
  website text,              -- official website
  views integer,             -- English Wikipedia views over the last 12 months
  ids text,                  -- JSON object: identifier scheme -> values
  primary key (source, id)
);
create index places_by_state on places (state, views desc);
create index places_by_views on places (views desc);

-- Two records that share an identifier (a Wikidata item's NPS place ID, the same website)
create table place_links (
  source_a text not null, id_a text not null, source_b text not null, id_b text not null, via text not null,
  state text not null,
  primary key (source_a, id_a, source_b, id_b, via)
);
create index place_links_b on place_links (source_b, id_b);

-- What each identifier scheme is called (Wikidata property labels)
create table place_schemes (scheme text primary key, label text);

-- When each state was last loaded, and from which store
create table place_loads (state text primary key, loaded_at text not null, built_at text, records integer not null);
