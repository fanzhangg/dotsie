import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergePins, numLabel, pinReach } from '../web/pins.js';
import { project, unproject } from '../web/geo.js';

// A pin `dx` pixels east of a place at zoom z
const Z = 14, HERE = { lat: 47.6097, lng: -122.3422 };
const at = dx => { const p = project(HERE, Z); return unproject({ x: p.x + dx, y: p.y }, Z); };
const pin = (n, dx, o = {}) => ({ ll: at(dx), nums: [n], sel: false, muted: false, stops: [{ name: `Stop ${n}` }], ...o });

test('pins that would touch merge into the first one, in the list’s order', () => {
  // 24px pins need 24 + 4px between centers
  const pins = [pin(2, 20), pin(1, 0), pin(3, 100)];
  const merged = mergePins(pins, Z);
  assert.deepEqual(merged.map(m => m.members.map(p => p.nums[0])), [[1, 2], [3]]);
  assert.equal(merged[0].r, pinReach(merged[0].members));
  assert.deepEqual(mergePins([pin(1, 0), pin(2, 28)], Z).map(m => m.members.length), [1, 1], 'just clear: apart');
});

test('merged pins that come to touch merge again; a selected pin never merges', () => {
  // 2 is just clear of 1; then 3 joins 1, and the merged pin's stack, reaching further, touches 2
  const merged = mergePins([pin(1, 0), pin(2, 30), pin(3, -26)], Z);
  assert.deepEqual(merged.map(m => m.members.map(p => p.nums[0])), [[1, 3, 2]]);
  assert.deepEqual(mergePins([pin(1, 0), pin(2, 10, { sel: true })], Z).map(m => m.members.map(p => p.nums[0])), [[1]]);
});

test('Want to go’s places merge with each other, never with the plan’s stops', () => {
  const merged = mergePins([pin(1, 0), pin(2, 10, { idea: true }), pin(3, 20, { idea: true })], Z);
  assert.deepEqual(merged.map(m => m.members.map(p => p.nums[0])), [[1], [2, 3]]);
});

test('a merged pin’s numbers read as runs', () => {
  assert.equal(numLabel([3, 2, 4, 7]), '2–4, 7');
  assert.equal(numLabel([1, 3, 5, 7]), '1, 3, 5, …');
});
