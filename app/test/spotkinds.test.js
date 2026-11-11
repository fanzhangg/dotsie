// The spots' types and orders (web/spotkinds.js): the Spots page's Type and Sort filters, the Worker's search and the
// prototype's pretend one
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SPOT_KINDS, isKind, kindSQL, kmBetween, nearOf, spotKind, spotText } from '../web/spotkinds.js';

const kindsOf = (types, name) => SPOT_KINDS.filter(k => isKind(k, spotText(types && JSON.stringify(types), name))).map(k => k.id);

test('a spot’s types come from its Wikidata types and its name', () => {
  assert.deepEqual(kindsOf(['urban park'], 'Discovery Park'), ['nature']);
  assert.deepEqual(kindsOf(['observation tower', 'tourist attraction'], 'Space Needle'), ['landmarks']);
  assert.deepEqual(kindsOf(['history museum'], 'Burke Museum'), ['museums', 'history']);
  assert.deepEqual(kindsOf(['public market', 'historic district'], 'Pike Place Market'), ['history', 'food']);
  assert.deepEqual(kindsOf(['NPS park'], 'Mount Rainier National Park'), ['nature']);
  assert.deepEqual(kindsOf(null, 'Fort Worden'), ['history']); // no types: the name alone
  // A ballpark is a stadium, not nature, though its name ends in Park
  assert.deepEqual(kindsOf(['baseball venue', 'stadium'], 'T-Mobile Park'), ['fun']);
  assert.deepEqual(kindsOf(['amusement park'], 'Wild Waves'), ['fun']);
  assert.deepEqual(kindsOf(['tourist attraction'], 'The Gum Wall'), []);
});

test('the server’s SQL finds the same types as the page’s', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('create table t (types text, name text)');
  const rows = [[['urban park'], 'Discovery Park'], [['baseball venue', 'stadium'], 'T-Mobile Park'], [['art museum'], 'Seattle Art Museum'],
    [null, 'Fort Worden'], [['NPS park'], 'Klondike Gold Rush National Historical Park'], [['public market'], 'Pike Place Market'],
    [['aquarium'], 'Seattle Aquarium'], [['bridge'], 'Fremont Bridge'], [['tourist attraction'], 'The Gum Wall']];
  const insert = db.prepare('insert into t values (?, ?)');
  for (const [types, name] of rows) insert.run(types && JSON.stringify(types), name);
  const text = `lower(coalesce(types, '') || ' "' || name || '"')`; // as the Worker's SPOT_TEXT
  for (const k of SPOT_KINDS) {
    const got = db.prepare(`select name from t where ${kindSQL(k, text)} order by rowid`).all().map(r => r.name);
    assert.deepEqual(got, rows.filter(([types, name]) => isKind(k, spotText(types && JSON.stringify(types), name))).map(([, name]) => name), k.id);
  }
});

test('a type is known by its id; where you are is two numbers in range', () => {
  assert.equal(spotKind('museums').label, 'Museums & art');
  assert.equal(spotKind('toString'), undefined);
  assert.deepEqual(nearOf('47.61,-122.33'), { lat: 47.61, lng: -122.33 });
  for (const bad of ['', '47.61', '95,10', '10,190', '1e3,2', '47.61,-122.33,1']) assert.equal(nearOf(bad), null, bad);
});

test('the distance between two places, along the ground', () => {
  const seattle = { lat: 47.6062, lng: -122.3321 }, portland = { lat: 45.5152, lng: -122.6784 };
  assert.ok(Math.abs(kmBetween(seattle, portland) - 234) < 2);
  assert.equal(kmBetween(seattle, seattle), 0);
});
