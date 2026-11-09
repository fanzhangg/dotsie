// A trip's tables (src/schema.ts), on SQLite as a TripRoom has them: a new trip, and trips stored by older versions
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SCHEMA, migrate } from '../src/schema.ts';

// SqlStorage's exec, as far as the changes use it
function room() {
  const db = new DatabaseSync(':memory:');
  const sql = {
    exec(query, ...bindings) {
      const rows = /;\s*\S/.test(query.trim().replace(/;\s*$/, '')) ? (db.exec(query), []) : db.prepare(query).all(...bindings);
      return { toArray: () => rows, one: () => rows[0] };
    },
  };
  const transaction = fn => { db.exec('begin'); try { fn(); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; } };
  const cols = table => db.prepare(`pragma table_info(${table})`).all().map(c => c.name);
  const version = () => db.prepare('select version from schema').get()?.version;
  return { db, sql, up: () => migrate(sql, transaction), cols, version };
}
const STOP_COLUMNS = ['id', 'name', 'address', 'lat', 'lng', 'time', 'note', 'by', 'updated_at', 'kind', 'nights', 'checkout', 'travel', 'back', 'links', 'wikidata', 'tz', 'duration'];

test('a new trip gets the tables as they are now', () => {
  const r = room();
  r.up();
  assert.deepEqual(r.cols('stops'), STOP_COLUMNS);
  assert.deepEqual(r.cols('trip'), ['id', 'name', 'created_by', 'invite', 'deleted_at', 'rev', 'edited_at']);
  assert.deepEqual(r.cols('members'), ['id', 'name', 'image', 'identity', 'joined_at']);
  assert.equal(r.version(), SCHEMA.length);
  // the stop the app writes (putStop in trip.ts) fits
  r.db.prepare(`insert into stops (id, name, address, lat, lng, time, tz, duration, note, kind, nights, checkout, travel, back, links, wikidata, by, updated_at)
    values ('s1', 'A', '', 1, 2, '2026-11-20T10:00', null, null, '', '', null, null, 'drive', '{}', '[]', null, 'u', 0)`).run();
});

test('a trip stored when stops had folders keeps its stops, gains what came since, and loses what went', () => {
  const r = room();
  // as the version with folders left it: launch tables, a few columns added, the folders
  r.db.exec(`
    create table trip (id text primary key, name text not null, created_by text not null, invite text not null, deleted_at integer);
    create table members (id text primary key, name text not null, image text, identity integer not null, joined_at integer not null);
    create table stops (id text primary key, name text not null, address text not null, lat real not null, lng real not null,
      time text not null, note text not null, done integer not null, by text not null, updated_at integer not null);
    alter table stops add column kind text not null default '';
    alter table stops add column nights integer;
    alter table stops add column folder text;
    create table folders (id text primary key, name text not null);
    insert into trip values ('t1', 'Old trip', 'u', 'tok', null);
    insert into stops (id, name, address, lat, lng, time, note, done, by, updated_at, kind, nights, folder)
      values ('s1', 'Lodge', '', 32.88, -105.96, '2026-11-20T15:00', 'Drop bags', 1, 'u', 5, 'hotel', 2, 'f1');
    insert into folders values ('f1', 'Day one');`);
  r.up();
  assert.deepEqual(r.cols('stops').sort(), [...STOP_COLUMNS].sort());
  assert.equal(r.db.prepare("select count(*) as n from sqlite_master where name = 'folders'").get().n, 0);
  assert.deepEqual({ ...r.db.prepare('select name, note, kind, nights, travel, back, links, updated_at from stops').get() },
    { name: 'Lodge', note: 'Drop bags', kind: 'hotel', nights: 2, travel: 'drive', back: '{}', links: '[]', updated_at: 5 });
  assert.deepEqual({ ...r.db.prepare('select name, rev, edited_at from trip').get() }, { name: 'Old trip', rev: 0, edited_at: null });
});

test('a trip that’s up to date is left as it is', () => {
  const r = room();
  r.up();
  r.db.exec("insert into stops (id, name, address, lat, lng, time, note, by, updated_at) values ('s1', 'A', '', 1, 2, 't', '', 'u', 0)");
  r.up();
  assert.equal(r.version(), SCHEMA.length);
  assert.equal(r.db.prepare('select count(*) as n from stops').get().n, 1);
});
