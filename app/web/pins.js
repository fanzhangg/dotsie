// @ts-check
/* Where map pins crowd, they merge: a pin that would touch another joins it, and they show as one (.wt-pin--cluster):
   the first one's pin in front, round and with its number as ever, and the next ones' pins stacked behind it in their
   colors, so you can see there are several and what kinds. The others hide, so the numbers they hold are the ones
   missing from the map; the merged pin's label names them all. Zoom in and it comes apart. Numbers stay as the list
   gives them. (Before: crowded pins shrank to dots without numbers; then a merged pin was a pill with all its numbers,
   "3–4", the one pin on the map that wasn't round; then the first pin alone, with a rim or a "+1", which didn't say
   clearly what was under it.)
   - The list's order decides: each pin joins the first pin before it that it would touch, and merged pins that touch
     merge again, until none do.
   - A selected pin, and both ends of a route on show, never merge: they stand on their own, on top.
   - Want to go's places (idea) merge with each other, never with the plan's stops: a stack is one kind of place.
   The trip's map (map.js) and the guides mockup use it. No map here: the sums take a place's point at a zoom (geo.js). */
import { project } from './geo.js';

/** @typedef {{ ll: { lat: number, lng: number }, nums: number[], sel: boolean, muted: boolean, idea?: boolean, stops: { name: string }[],
 *   el?: HTMLElement | null, own?: { aria: string | null, color: string } | null, r?: number, members?: Pin[] | null, hidden?: boolean }} Pin */

export const PIN_GAP = 4; // px of map between two pins
export const PIN_FAN = 4; // each pin stacked behind a merged pin, further up and right

// How far a pin reaches from its center: half its width, and a merged pin's stack, included
/** @param {Pin[]} members */
export function pinReach(members) {
  const muted = members.every(m => m.muted);
  const w = members[0].sel ? 32 : muted ? 20 : 24;
  return w / 2 + Math.min(members.length - 1, 2) * PIN_FAN;
}

// Numbers as one label, for a merged pin's aria-label: runs as ranges, "2–4, 7". Past three runs the rest is "…"; it
// never joins numbers that aren't in a row into one range, which would claim stops that aren't there.
/** @param {number[]} nums */
export function numLabel(nums) {
  /** @type {[number, number][]} */
  const runs = [];
  for (const x of [...new Set(nums)].sort((a, b) => a - b)) {
    const r = runs.at(-1);
    if (r && x === r[1] + 1) r[1] = x; else runs.push([x, x]);
  }
  return runs.slice(0, 3).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ') + (runs.length > 3 ? ', …' : '');
}

// The pins that aren't selected, merged at zoom z: each group's first pin leads, the rest hide behind it
/** @param {Pin[]} pins @param {number} z @returns {{ pt: { x: number, y: number }, r: number, idea: boolean, members: Pin[] }[]} */
export function mergePins(pins, z) {
  const first = (/** @type {Pin} */ p) => (p.nums.length ? Math.min(...p.nums) : Infinity);
  const dist = (/** @type {{ x: number, y: number }} */ a, /** @type {{ x: number, y: number }} */ b) => Math.hypot(a.x - b.x, a.y - b.y);
  /** @type {{ pt: { x: number, y: number }, r: number, idea: boolean, members: Pin[] }[]} */
  const merged = [];
  for (const p of pins.filter(q => !q.sel).sort((a, b) => first(a) - first(b))) {
    const pt = project(p.ll, z), r = pinReach([p]);
    const m = merged.find(c => c.idea === !!p.idea && dist(pt, c.pt) < r + c.r + PIN_GAP);
    if (m) { m.members.push(p); m.r = pinReach(m.members); } else merged.push({ pt, r, idea: !!p.idea, members: [p] });
  }
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < merged.length && !again; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        if (a.idea !== b.idea || dist(a.pt, b.pt) >= a.r + b.r + PIN_GAP) continue;
        a.members.push(...b.members);
        a.r = pinReach(a.members);
        merged.splice(j, 1);
        again = true;
        break;
      }
    }
  }
  return merged;
}

// A pin alone, or as the pin for its merged stops: its own number, the next ones' pins stacked behind, in their
// colors (grey for one that's over), muted only when they all are
/** @param {Pin} p @param {Pin[] | null} members */
export function showMerged(p, members) {
  p.members = members;
  const el = p.el;
  if (!el || !p.own) return;
  const muted = members ? members.every(m => m.muted) : p.muted;
  el.classList.toggle('wt-pin--cluster', !!members);
  el.classList.toggle('wt-pin--deep', !!members && members.length > 2);
  el.classList.toggle('wt-pin--muted', muted);
  if (!members) { if (p.own.aria) el.setAttribute('aria-label', p.own.aria); return; }
  const stops = [...new Set(members.flatMap(m => m.stops))], label = numLabel(members.flatMap(m => m.nums));
  members.slice(1, 3).forEach((m, i) => el.style.setProperty(`--wt-pin-behind-${i + 1}`, m.muted ? 'var(--wt-kind-past)' : m.own?.color || 'var(--wt-kind-place)'));
  if (members[0].idea) return el.setAttribute('aria-label', `${stops.length} places on Want to go here: ${stops.map(s => s.name).join(', ')}`);
  el.setAttribute('aria-label', `${label}. ${stops.length} stops here: ${stops.map(s => s.name).join(', ')}`);
}
