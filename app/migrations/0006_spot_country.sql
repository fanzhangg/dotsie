-- Which country a destination is in, so the spots page (/#/spots) can filter by country, then state, then city. The
-- spots data covers the US only so far, so every destination loaded before this is in it; `state` is then the state's
-- two-letter code, and in another country whatever its first-level division is called.
alter table spot_destinations add column country text not null default 'US';
