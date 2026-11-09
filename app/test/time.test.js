// npm test runs these with TZ=America/Denver, so "this device" is in a zone with daylight saving
import './tz.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEVICE_ZONE, fmtDur, fmtTime, instantOf, momentOf, nowStamp, placeZone, toDate, toInput, zoneOf } from '../web/time.js';

const at = (lat, lng, time, extra = {}) => ({ lat, lng, time, tz: null, ...extra });
const LA = [34.05, -118.24], NYC = [40.71, -74.0], DENVER = [39.74, -104.99];

test('a stamp reads back as the same clock time', () => {
  assert.equal(toInput(toDate('2026-11-20T09:05')), '2026-11-20T09:05');
  assert.equal(toInput(toDate('2026-11-20')), '2026-11-20T00:00');
  assert.equal(fmtTime('2026-11-20T13:05'), '1:05 PM');
  assert.equal(fmtTime('2026-11-20T00:30'), '12:30 AM');
});

test('a place is in its own time zone, and an unknown place in this device’s', () => {
  assert.equal(placeZone(...DENVER), 'America/Denver');
  assert.equal(placeZone(...NYC), 'America/New_York');
  assert.equal(placeZone(null, null), DEVICE_ZONE);
  assert.equal(zoneOf(at(...NYC, '2026-11-20T10:00', { tz: 'Asia/Tokyo' })), 'Asia/Tokyo', 'a zone someone picked wins');
  assert.equal(zoneOf(at(...NYC, '2026-11-20T10:00', { tz: 'Not/AZone' })), 'America/New_York', 'an unknown one is ignored');
});

test('times are clock times where each stop is: a flight from LA at 10:00 that lands in New York at 18:30 takes 5½ hours', () => {
  const leave = momentOf(at(...LA, '2026-11-20T10:00')), land = momentOf(at(...NYC, '2026-11-20T18:30'));
  assert.equal((land - leave) / 36e5, 5.5);
});

test('a moment in a zone, across the clocks changing', () => {
  // Denver: UTC-6 in summer, UTC-7 in winter; the clocks go back on 2026-11-01
  assert.equal(new Date(instantOf('2026-07-01T12:00', 'America/Denver')).toISOString(), '2026-07-01T18:00:00.000Z');
  assert.equal(new Date(instantOf('2026-11-20T12:00', 'America/Denver')).toISOString(), '2026-11-20T19:00:00.000Z');
  // A time skipped when the clocks go forward counts as the hour after, west of Greenwich and east of it
  assert.equal(new Date(instantOf('2026-03-08T02:30', 'America/Denver')).toISOString(), '2026-03-08T09:30:00.000Z', '3:30 MDT');
  assert.equal(new Date(instantOf('2026-03-29T01:30', 'Europe/London')).toISOString(), '2026-03-29T01:30:00.000Z', '2:30 BST');
  // A time that happens twice when they go back is the first one
  assert.equal(new Date(instantOf('2026-11-01T01:30', 'America/Denver')).toISOString(), '2026-11-01T07:30:00.000Z', '1:30 MDT');
  assert.equal(new Date(instantOf('2026-10-25T01:30', 'Europe/London')).toISOString(), '2026-10-25T00:30:00.000Z', '1:30 BST');
  // And east of Greenwich in an ordinary hour
  assert.equal(new Date(instantOf('2026-07-01T09:00', 'Asia/Tokyo')).toISOString(), '2026-07-01T00:00:00.000Z');
});

test('now is a stamp like a stop’s time', () => {
  assert.match(nowStamp(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test('durations read the way the list says them', () => {
  assert.equal(fmtDur(45 * 60), '45 min');
  assert.equal(fmtDur(2 * 3600 + 4 * 60), '2 hr 4 min');
});
