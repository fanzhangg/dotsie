-- What the home card shows beyond the name and dates: who's on the trip and where it goes, as JSON
-- { members: [{ id, name, image, identity }], stops: [{ id, name, lat, lng, time, kind, nights }] }.
-- Written by the trip's TripRoom. Null for a trip not written since; GET /api/trips has its TripRoom fill it in.
alter table trips add column preview text;
