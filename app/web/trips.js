/* The open trip and the home list: loading them, saving edits in the background, and applying co-editors' changes. */
import { $app, state } from './core.js';
import { me } from './signin.js';
import { api, connectLive, disconnectLive } from './backend.js';
import { OFFLINE_WAIT, anySaved, offlineCards, offlineCopy } from './offline.js';
import { messageHTML, parseHash, render, scheduleRender } from './app.js';
import { failToast, toast } from './notices.js';

export let trips = null, cur = null;
export const setTrips = v => { trips = v; };
export const setCur = v => { cur = v; };
const memberOf = id => cur?.members?.find(m => m.id === id);
export const fromSnapshot = s => ({ id: s.trip.id, name: s.trip.name, owner: s.trip.owner, members: s.members, stops: s.stops });

// Writes show at once and save in the background. If one fails, reload the trip so the screen
// matches what's saved.
export async function save(req, title = 'Couldn’t save your change') {
  try { return await req; } catch (e) {
    if (e.status === 401) return;
    failToast(e, title);
    if (cur && !cur.error) reloadTrip();
  }
}
// Stop writes in flight, per stop. My own live echoes for these are skipped, and the server's copy
// is applied only once the last write lands, so a quick second edit isn't undone by the first reply.
const pendingStops = new Map();
export async function writeStop(tripId, id, req) {
  pendingStops.set(id, (pendingStops.get(id) || 0) + 1);
  const saved = await save(req);
  const left = (pendingStops.get(id) || 1) - 1;
  if (left) pendingStops.set(id, left); else pendingStops.delete(id);
  if (saved && !left && openTripOf(tripId)) { upsertLocal(saved); scheduleRender(); }
}
// The open trip, if it's still this one: a sheet or notice may outlive a reload or a trip change.
export const openTripOf = id => (cur?.id === id && cur.stops ? cur : null);
function upsertLocal(stop) {
  const i = cur.stops.findIndex(s => s.id === stop.id);
  if (i < 0) cur.stops.push(stop); else cur.stops[i] = stop;
}

// ---------- Trips ----------
export let tripLoad = null; // the id being fetched, so a slow reply for a trip you've left is dropped
export async function openTrip(id) {
  tripLoad = id;
  // A trip saved for offline opens from its copy with no connection, or while the server is slow to answer (a weak
  // signal); the server's copy replaces it once it comes.
  const copy = offlineCopy(id);
  const early = copy && setTimeout(() => { if (tripLoad === id && cur?.id !== id) { cur = copy; render(); } }, OFFLINE_WAIT);
  let next;
  try { next = fromSnapshot(await api(`/trips/${id}`)); } catch (e) { next = (e.code === 'offline' && copy) || { id, error: e.code || 'offline' }; }
  clearTimeout(early);
  if (tripLoad !== id) return;
  tripLoad = null;
  cur = next;
  if (!cur.error) connectLive(id);
  render();
}
export async function reloadTrip() {
  const id = cur?.id;
  if (!id) return;
  try {
    const next = fromSnapshot(await api(`/trips/${id}`));
    if (cur?.id === id) { cur = next; scheduleRender(); }
  } catch (e) {
    if (cur?.id === id && ['gone', 'not_member', 'not_found'].includes(e.code)) { closeTrip(); cur = { id, error: e.code }; render(); }
  }
}
export function closeTrip() {
  disconnectLive();
  cur = null;
  tripLoad = null;
  pendingStops.clear();
}
export async function loadTrips() {
  // with no connection, the trips saved on this device
  try { trips = await api('/trips'); } catch (e) { trips = e.code === 'offline' && anySaved() ? offlineCards() : trips || []; }
  if (parseHash().page === 'home' && me) render();
}
let joining = null;
export async function join(token) {
  if (joining === token) return;
  joining = token;
  $app.innerHTML = '';
  try {
    const snap = await api(`/join/${encodeURIComponent(token)}`, { method: 'POST' });
    closeTrip();
    cur = fromSnapshot(snap);
    connectLive(cur.id);
    location.replace(`#/trip/${cur.id}`);
  } catch (e) {
    if (e.status === 401) return;
    $app.innerHTML = messageHTML(e.code === 'gone' ? 'This trip was deleted.'
      : e.code === 'offline' ? "Couldn't open the link. Check your connection."
        : "This link doesn't work anymore. Ask someone on the trip for a new one.");
  } finally { joining = null; }
}

export function onEvent(m) {
  if (!cur?.stops) return;
  const mine = m.by === me?.id, who = memberOf(m.by)?.name || 'Someone';
  switch (m.type) {
    case 'stop.upserted': {
      if (mine && pendingStops.has(m.stop.id)) return;
      const old = cur.stops.find(s => s.id === m.stop.id);
      if (old?.updatedAt === m.stop.updatedAt) return;
      upsertLocal(m.stop);
      if (!mine) {
        note(`${who} ${old ? 'updated' : 'added'} ${m.stop.name}`);
        state.flash.add(m.stop.id);
      }
      break;
    }
    case 'stop.removed':
      cur.stops = cur.stops.filter(s => s.id !== m.id);
      if (!mine) note(`${who} removed ${m.name}`);
      break;
    case 'member.joined':
      if (!memberOf(m.member.id)) cur.members.push(m.member);
      if (!mine) note(`${m.member.name} joined`);
      break;
    case 'member.left':
      // Left in another tab: this one goes home too
      if (mine) { closeTrip(); location.hash = '#/'; return; }
      cur.members = cur.members.filter(x => x.id !== m.id);
      note(`${m.name} left`);
      break;
    case 'member.updated': {
      const i = cur.members.findIndex(x => x.id === m.member.id);
      if (i >= 0) cur.members[i] = m.member;
      break;
    }
    case 'trip.updated':
      cur.name = m.name;
      break;
    case 'trip.deleted':
      if (!mine) toast(`${who} deleted ${cur.name}`);
      closeTrip();
      location.hash = '#/';
      return;
  }
  scheduleRender();
}
// Several changes at once read as one notice: "Sam added Cloudcroft + 2 more"
let notes = [], noteTimer = 0;
function note(msg) {
  notes.push(msg);
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { toast(notes.length === 1 ? notes[0] : `${notes[0]} + ${notes.length - 1} more`); notes = []; }, 250);
}
