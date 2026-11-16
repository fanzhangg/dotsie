/* What a reader keeps from a guide: places they save, and a plan copied into their trips.

   Saved places stay in this browser: a trip's Want to go list isn't in the app yet, and a saved place has no trip
   until someone picks one.

   Copying writes the trip where the prototype keeps its trips (localStorage, prototype/backend.js), as POST /api/trips
   and a PUT /api/trips/<id>/stops/<stop> for each stop would in the app. So, served from the repo root, the copy opens
   in the prototype at /prototype/#/trip/<id>. Each stop is a stop as app/src/stop.ts has it: the place's type, its
   Wikidata item (so its sheet shows what Wikipedia says), how long to stay, how to get there, and its pages as links. */
import { spots } from './data.js';

const SAVED_KEY = 'dotsie-guides:saved:v1';
const TRIPS_KEY = 'waythread:v2';  // the prototype's (prototype/backend.js DB_KEY)
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };

let saved = new Set(read(SAVED_KEY, []).filter(id => spots.has(id)));
export const isSaved = id => saved.has(id);
export const savedList = () => [...saved].map(id => spots.get(id));
export function toggleSaved(id) {
  if (saved.has(id)) saved.delete(id); else saved.add(id);
  write(SAVED_KEY, [...saved]);
  return saved.has(id);
}

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The coming Friday (or the one after, if it's Friday already): a weekend is when most people would go
export function nextFriday(from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + (((5 - d.getDay()) + 7) % 7 || 7));
  return isoDay(d);
}

// The plan's days from the start day, as a trip's stops
export function stopsFrom(plan, start) {
  const [y, m, dd] = start.split('-').map(Number), now = Date.now();
  return plan.days.flatMap(d => d.items.map((i, n) => {
    const s = spots.get(i.spot_id), meal = i.kind !== 'stop';
    const day = isoDay(new Date(y, m - 1, dd + d.day - 1));
    return {
      id: uid(), kind: meal ? 'restaurant' : s.kind, name: meal ? i.kind[0].toUpperCase() + i.kind.slice(1) : s.name, address: '',
      lat: s.lat, lng: s.lng, time: `${day}T${i.start}`, tz: null, duration: i.minutes, note: meal ? `Near ${s.name}` : '',
      nights: null, checkout: null, travel: n && (!i.leg || i.leg.mode === 'walk') ? 'walk' : 'drive', back: {},
      links: meal ? [] : s.links.map(l => ({ url: l.url, label: l.label })), wikidata: meal ? null : s.spot_id, by: 'alex', updatedAt: now,
    };
  }));
}

// Returns the new trip's id, or null if it couldn't be saved
export function copyToTrips(plan, start) {
  const db = read(TRIPS_KEY, null) || { names: {}, trips: {} };
  const id = uid();
  db.trips[id] = { id, name: plan.title, members: ['alex'], createdBy: 'alex', updatedAt: Date.now(), spots: stopsFrom(plan, start) };
  return write(TRIPS_KEY, db) ? id : null;
}
