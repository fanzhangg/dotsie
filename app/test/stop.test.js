// The server's check on every stop written. Node runs the TypeScript as it is (type stripping).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanStop, ERR } from '../src/stop.ts';

const base = { name: 'White Sands', lat: 32.78, lng: -106.17, time: '2026-11-20T15:00' };
const bad = (input, partial = false) => assert.throws(() => cleanStop(input, partial), { message: ERR.invalid }, JSON.stringify(input));

test('a new stop needs a name, a place and a time, and gets defaults for the rest', () => {
  assert.deepEqual(cleanStop({ ...base, name: '  White Sands  ', extra: 'dropped' }, false), {
    address: '', note: '', tz: null, duration: null, kind: '', nights: null, checkout: null, travel: 'drive', back: {}, links: [],
    wikidata: null, done: false, name: 'White Sands', lat: 32.78, lng: -106.17, time: '2026-11-20T15:00',
  });
  for (const k of ['name', 'lat', 'lng', 'time']) bad({ ...base, [k]: undefined });
  bad({ ...base, name: '   ' });
  bad(null);
});

test('a change has only the fields it changes', () => {
  assert.deepEqual(cleanStop({ note: 'Bring a sled' }, true), { note: 'Bring a sled' });
  assert.deepEqual(cleanStop({}, true), {});
});

test('each field is checked', () => {
  bad({ ...base, lat: 91 });
  bad({ ...base, lng: Number.NaN });
  bad({ ...base, time: '2026-11-20 15:00' });
  bad({ ...base, name: 'x'.repeat(201) });
  bad({ kind: 'castle' }, true);
  bad({ travel: 'teleport' }, true);
  bad({ tz: 'Not/AZone' }, true);
  bad({ nights: 31 }, true);
  bad({ nights: -1 }, true);
  bad({ duration: 0 }, true);
  bad({ duration: 24 * 60 + 1 }, true);
  bad({ checkout: '25:00' }, true);
  bad({ wikidata: 'Q0' }, true);
  bad({ done: 'yes' }, true);
  assert.deepEqual(cleanStop({ kind: '', tz: 'America/Denver', nights: 30, duration: 24 * 60, checkout: '11:00', wikidata: 'Q123' }, true),
    { kind: '', tz: 'America/Denver', nights: 30, duration: 24 * 60, checkout: '11:00', wikidata: 'Q123' });
});

test('links are web pages, up to ten, with short labels', () => {
  assert.deepEqual(cleanStop({ links: [{ url: ' https://example.com/a b ', label: ' Tickets ' }, { url: 'http://example.org' }] }, true).links,
    [{ url: 'https://example.com/a%20b', label: 'Tickets' }, { url: 'http://example.org/', label: '' }]);
  bad({ links: [{ url: 'javascript:alert(1)' }] }, true);
  bad({ links: [{ url: 'not a url' }] }, true);
  bad({ links: [{ url: 'https://example.com', label: 'x'.repeat(61) }] }, true);
  bad({ links: Array.from({ length: 11 }, (_, i) => ({ url: `https://example.com/${i}` })) }, true);
});

test('a hotel’s ways back keep only the nights that aren’t drives', () => {
  assert.deepEqual(cleanStop({ back: { '2026-11-20': 'walk', '2026-11-21': 'drive' } }, true).back, { '2026-11-20': 'walk' });
  bad({ back: { tomorrow: 'walk' } }, true);
  bad({ back: { '2026-11-20': 'swim' } }, true);
  bad({ back: [] }, true);
});
