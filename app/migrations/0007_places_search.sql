-- Search the spots data through a full-text index on names, now that `places` holds every state (over a million rows):
-- `name like '%…%'` read the whole table on every search. `places` gets an integer key (`n`) for the index to point
-- at, since SQLite can renumber an implicit rowid; triggers keep the index in step with every insert, delete and
-- rename, so the loads (pipeline/export_d1.py) only write `places`. The rows already loaded are kept.
create table places_new (
  n integer primary key,
  source text not null,
  id text not null,
  state text not null,
  name text not null,
  description text,
  lat real,
  lng real,
  types text,
  url text,
  wikipedia text,
  website text,
  views integer,
  ids text,
  unique (source, id)
);
insert into places_new (source, id, state, name, description, lat, lng, types, url, wikipedia, website, views, ids)
  select source, id, state, name, description, lat, lng, types, url, wikipedia, website, views, ids from places;
drop table places;
alter table places_new rename to places;
create index places_by_state on places (state, views desc);
create index places_by_views on places (views desc);
-- The NPS filter with no state: without it, the NPS rows (no page views) come last in places_by_views
create index places_by_source on places (source, views desc);

-- Words of each name, accents ignored. columnsize=0: no per-row sizes, which nothing here ranks by
create virtual table places_fts using fts5(name, content = 'places', content_rowid = 'n', columnsize = 0,
  tokenize = 'unicode61 remove_diacritics 2');
insert into places_fts (places_fts) values ('rebuild');
create trigger places_fts_insert after insert on places begin
  insert into places_fts (rowid, name) values (new.n, new.name);
end;
create trigger places_fts_delete after delete on places begin
  insert into places_fts (places_fts, rowid, name) values ('delete', old.n, old.name);
end;
create trigger places_fts_rename after update of name on places begin
  insert into places_fts (places_fts, rowid, name) values ('delete', old.n, old.name);
  insert into places_fts (rowid, name) values (new.n, new.name);
end;
