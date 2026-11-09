// D1's copy of a trip, run on SQLite with the app's migrations, as D1 runs it: a batch is one transaction, and foreign
// keys are on.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { copyStatements } from '../src/copy.ts';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec('pragma foreign_keys = on');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  for (const id of ['alex', 'sam', 'jo']) {
    db.prepare(`insert into "user" (id, name, email, emailVerified, createdAt, updatedAt) values (?, ?, ?, 0, 0, 0)`).run(id, id, `${id}@example.com`);
  }
  const batch = statements => {
    db.exec('begin');
    try { for (const [sql, values] of statements) db.prepare(sql).run(...values); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
  };
  const row = () => db.prepare('select name, updated_at, deleted_at, rev from trips where id = ?').get('t1');
  const members = () => db.prepare('select user_id from trip_members where trip_id = ? order by user_id').all('t1').map(r => r.user_id);
  return { db, batch, row, members };
}
const copy = (rev, fields = {}) => copyStatements({
  id: 't1', name: 'White Sands', inviteHash: 'h1', first: null, last: null, preview: '{}', deletedAt: null, editedAt: 1000, rev,
  members: [{ id: 'alex', joined: 1 }], ...fields,
});

test('the first copy makes the row and its members', () => {
  const { batch, row, members } = d1();
  batch(copy(1));
  assert.deepEqual({ ...row() }, { name: 'White Sands', updated_at: 1000, deleted_at: null, rev: 1 });
  assert.deepEqual(members(), ['alex']);
});

test('a newer copy replaces it, members who joined and left included', () => {
  const { batch, row, members } = d1();
  batch(copy(1, { members: [{ id: 'alex', joined: 1 }, { id: 'sam', joined: 2 }] }));
  batch(copy(2, { name: 'Dunes', members: [{ id: 'alex', joined: 1 }, { id: 'jo', joined: 3 }] }));
  assert.equal(row().name, 'Dunes');
  assert.deepEqual(members(), ['alex', 'jo']);
});

test('an older copy that lands late changes nothing', () => {
  const { batch, row, members } = d1();
  batch(copy(2, { name: 'Dunes', members: [{ id: 'alex', joined: 1 }, { id: 'sam', joined: 2 }] }));
  batch(copy(1));
  assert.deepEqual({ ...row() }, { name: 'Dunes', updated_at: 1000, deleted_at: null, rev: 2 });
  assert.deepEqual(members(), ['alex', 'sam']);
});

test('a copy can be written again, as a retry does', () => {
  const { batch, members } = d1();
  batch(copy(1));
  assert.doesNotThrow(() => batch(copy(2)));
  assert.deepEqual(members(), ['alex']);
});

test('a member whose account is gone is left out, rather than failing the copy', () => {
  const { batch, row, members } = d1();
  batch(copy(1, { members: [{ id: 'alex', joined: 1 }, { id: 'deleted-guest', joined: 2 }] }));
  assert.equal(row().rev, 1);
  assert.deepEqual(members(), ['alex']);
});

test('deleting and restoring a trip, and a trip that doesn’t say when it was edited', () => {
  const { batch, row } = d1();
  batch(copy(1, { editedAt: 1000 }));
  batch(copy(2, { deletedAt: 5, editedAt: null }));
  assert.deepEqual({ ...row() }, { name: 'White Sands', updated_at: 1000, deleted_at: 5, rev: 2 });
  batch(copy(3, { editedAt: 2000 }));
  assert.deepEqual({ ...row() }, { name: 'White Sands', updated_at: 2000, deleted_at: null, rev: 3 });
});

test('a rotated share link replaces the old one', () => {
  const { db, batch } = d1();
  batch(copy(1));
  batch(copy(2, { inviteHash: 'h2' }));
  assert.equal(db.prepare('select count(*) as n from trips where invite_hash = ?').get('h1').n, 0);
  assert.equal(db.prepare('select id from trips where invite_hash = ?').get('h2').id, 't1');
});
