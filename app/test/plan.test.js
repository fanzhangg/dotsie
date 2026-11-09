import './tz.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STOP_KINDS, TRAVEL_MODES } from '../web/fields.js';
import { daysOf, dayPlan, guessKind, KINDS, kindOf, staysOf, stayOf, stopsOf, TRAVEL, wayTo } from '../web/plan.js';

// Stops near Alamogordo, NM, unless they say otherwise
let n = 0;
const stop = (time, fields = {}) => ({
  id: `s${++n}`, name: `Stop ${n}`, address: '', lat: 32.9 + n / 100, lng: -105.96, time, tz: null, duration: null, note: '',
  kind: '', nights: null, checkout: null, travel: 'drive', back: {}, links: [], wikidata: null, done: false, by: 'u', updatedAt: 0, ...fields,
});
const hotel = (time, fields = {}) => stop(time, { kind: 'hotel', name: 'Lodge', ...fields });
const roles = (trip, day) => dayPlan(trip, day).map(e => `${e.role}:${e.place.id}`);

test('stops are in the order they happen, wherever they are', () => {
  // 10:00 in Los Angeles is after 12:00 in New York the same day
  const ny = stop('2026-11-20T12:00', { lat: 40.71, lng: -74.0 }), la = stop('2026-11-20T10:00', { lat: 34.05, lng: -118.24 });
  assert.deepEqual(stopsOf({ stops: [la, ny] }).map(s => s.id), [ny.id, la.id]);
});

test('a hotel lasts its nights, or until the next hotel, or the trip’s last day', () => {
  const a = hotel('2026-11-20T15:00'), b = hotel('2026-11-22T15:00', { nights: 0 }), c = hotel('2026-11-23T15:00', { nights: 2 });
  const end = stop('2026-11-27T10:00');
  const stays = staysOf({ stops: [a, b, c, end] });
  assert.deepEqual(stays.map(st => [st.s.id, st.nights, st.checkIn, st.checkOut]), [
    [a.id, 2, '2026-11-20', '2026-11-22'], // unset: until the next hotel
    [b.id, 0, '2026-11-22', '2026-11-22'], // a same-day stay
    [c.id, 2, '2026-11-23', '2026-11-25'],
  ]);
  // With no hotel after it, an unset stay lasts until the last stop's day, and at least a night
  assert.equal(staysOf({ stops: [hotel('2026-11-20T15:00'), stop('2026-11-24T10:00')] })[0].nights, 4);
  assert.equal(staysOf({ stops: [hotel('2026-11-20T15:00')] })[0].nights, 1);
});

test('a trip’s days are the days with stops and every day of a stay, up to check-out', () => {
  const trip = { stops: [stop('2026-11-20T10:00'), hotel('2026-11-20T15:00', { nights: 3 })] };
  assert.deepEqual(daysOf(trip), ['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23']);
});

test('a day starts at last night’s hotel and ends back at tonight’s', () => {
  const h = hotel('2026-11-20T15:00', { nights: 2 }), a = stop('2026-11-20T17:00'), b = stop('2026-11-21T09:00'), c = stop('2026-11-22T13:00');
  const trip = { stops: [h, a, b, c] };
  assert.deepEqual(roles(trip, '2026-11-20'), [`stop:${h.id}`, `stop:${a.id}`, `night:${h.id}`]);
  assert.deepEqual(roles(trip, '2026-11-21'), [`wake:${h.id}`, `stop:${b.id}`, `night:${h.id}`]);
  assert.deepEqual(roles(trip, '2026-11-22'), [`checkout:${h.id}`, `stop:${c.id}`]);
});

test('with no hotel the night before, a day starts from the day before’s last stop', () => {
  const a = stop('2026-11-20T10:00'), b = stop('2026-11-21T10:00');
  assert.deepEqual(roles({ stops: [a, b] }, '2026-11-21'), [`from:${a.id}`, `stop:${b.id}`]);
});

test('a same-day stay checks out among the day’s stops, at its check-out time', () => {
  const h = hotel('2026-11-20T01:00', { nights: 0, checkout: '10:00' }), a = stop('2026-11-20T09:00'), b = stop('2026-11-20T12:00');
  assert.deepEqual(roles({ stops: [h, a, b] }, '2026-11-20'), [`stop:${h.id}`, `stop:${a.id}`, `checkout:${h.id}`, `stop:${b.id}`]);
});

test('the way back to a hotel is that night’s, and the way to a stop is its own', () => {
  const h = hotel('2026-11-20T15:00', { nights: 2, back: { '2026-11-21': 'walk' } }), a = stop('2026-11-21T10:00', { travel: 'bike' });
  const plan = dayPlan({ stops: [h, a] }, '2026-11-21');
  assert.deepEqual(plan.map(wayTo), ['drive', 'bike', 'walk']);
});

test('a stop’s type: the one picked, else a guess from its name, or a meal in its note', () => {
  assert.equal(kindOf({ kind: 'museum', name: 'Holiday Inn' }), 'museum');
  assert.equal(kindOf({ kind: '', name: 'El Paso International Airport' }), 'airport');
  assert.equal(kindOf({ kind: '', name: 'Cloudcroft', note: 'Lunch' }), 'restaurant');
  assert.equal(kindOf({ kind: '', name: 'Cloudcroft' }), 'place');
  assert.equal(guessKind('Somewhere', 'tourism:museum'), 'museum');
  assert.equal(stayOf(stop('2026-11-20T10:00', { duration: 90 })), 90);
  assert.equal(stayOf(hotel('2026-11-20T10:00', { duration: 90 })), null, 'a hotel’s stay is its nights');
});

test('every stop type and way to travel the server accepts has a look in the app', () => {
  assert.deepEqual(Object.keys(KINDS), [...STOP_KINDS]);
  for (const k of STOP_KINDS) assert.ok(KINDS[k]?.label && KINDS[k].icon, k);
  assert.deepEqual(Object.keys(TRAVEL), [...TRAVEL_MODES]);
  for (const k of TRAVEL_MODES) assert.ok(TRAVEL[k]?.label && TRAVEL[k].icon, k);
});
