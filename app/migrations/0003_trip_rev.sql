-- Which copy of the trip's TripRoom the row is (see project in src/trip.ts): a copy with a lower rev is older, and is
-- ignored if it lands after a newer one.
alter table trips add column rev integer not null default 0;
