/* Adding, changing and deleting stops, and how you get to one. */
import { esc, state, uid } from './core.js';
import { fmtDur } from './time.js';
import { me } from './signin.js';
import { openTripOf, save, writeStop } from './trips.js';
import { api } from './backend.js';
import { TRAVEL, backOf, staysOf, travelIcon, travelOf } from './plan.js';
import { getRoute } from './routes.js';
import { render } from './app.js';
import { refit } from './map.js';
import { closeSheet, modalHead, openSheet } from './sheets.js';
import { optionHTML } from './stopsheet.js';
import { toast } from './notices.js';

export let routeWatch = null; // called as each lookup finishes, while something outside the list shows routes (How you get there)

// ---------- Edits ----------
// The new stop is selected, so it's the list's focus and its pin is named.
export function addStop(trip, data) {
  const stop = { id: uid(), ...data, by: me.id, updatedAt: Date.now() };
  openTripOf(trip.id)?.stops.push(stop);
  if (state.leg) refit();
  state.leg = null;
  state.sel = stop.id;
  state.selRow = null;
  render();
  writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PUT', body: data }));
}
// Only the fields this person changed (against the stop as they opened it) are sent, so a
// co-editor's edit to another field of the same stop survives.
export function editStop(trip, stop, fields) {
  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => (k === 'links' ? JSON.stringify(stop.links || []) !== JSON.stringify(v) : (stop[k] ?? null) !== (v ?? null))));
  if (!Object.keys(changed).length) return;
  const target = openTripOf(trip.id)?.stops.find(s => s.id === stop.id);
  if (target) Object.assign(target, changed, { by: me.id });
  render();
  writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PATCH', body: changed }));
}
export function deleteStop(trip, stop) {
  const t = openTripOf(trip.id);
  if (t) t.stops = t.stops.filter(s => s.id !== stop.id);
  render();
  save(api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'DELETE' }));
  // Undo puts the same stop back under its old id
  toast(`Deleted ${stop.name}`, 'Undo', () => {
    const { name, address, lat, lng, time, tz = null, duration = null, note, kind, nights, checkout = null, back = {}, links = [], wikidata = null } = stop, travel = travelOf(stop);
    openTripOf(trip.id)?.stops.push({ ...stop, by: me.id });
    render();
    writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PUT', body: { name, address, lat, lng, time, tz, duration, note, kind, nights, checkout, travel, back, links, wikidata } }));
  });
}

// ---------- Want to go ----------
// A place saved for the trip, with no day yet. It's selected, so its pin is named and Add to a day is in reach.
const ideaBody = ({ name, address = '', lat, lng, note = '', kind = '', links = [], wikidata = null }) => ({ name, address, lat, lng, note, kind, links, wikidata });
export function addIdea(trip, data, { select = true } = {}) {
  const idea = { id: uid(), ...ideaBody(data), by: me.id, updatedAt: Date.now() };
  openTripOf(trip.id)?.ideas.push(idea);
  if (select) { state.leg = null; state.sel = idea.id; state.selRow = null; }
  render();
  save(api(`/trips/${trip.id}/ideas/${idea.id}`, { method: 'PUT', body: ideaBody(idea) }), 'Couldn’t save it to Want to go');
  return idea;
}
// Its note and links changed: saved whole, as the list keeps it (its place in the list stays)
export function editIdea(trip, idea, fields) {
  const target = openTripOf(trip.id)?.ideas.find(i => i.id === idea.id), next = { ...(target || idea), ...fields };
  if (target) Object.assign(target, fields, { by: me.id });
  render();
  save(api(`/trips/${trip.id}/ideas/${idea.id}`, { method: 'PUT', body: ideaBody(next) }));
}
// Taken off the list: with Undo, which saves it again (at the end of the list, as the server keeps it), or quietly,
// once it's been added to a day
export function deleteIdea(trip, idea, { quiet = false } = {}) {
  const t = openTripOf(trip.id);
  if (t) t.ideas = t.ideas.filter(i => i.id !== idea.id);
  if (state.sel === idea.id) state.sel = state.selRow = null;
  render();
  save(api(`/trips/${trip.id}/ideas/${idea.id}`, { method: 'DELETE' }));
  if (quiet) return;
  toast(`Removed ${idea.name} from Want to go`, 'Undo', () => {
    const now = openTripOf(trip.id);
    if (now && !now.ideas.some(i => i.id === idea.id)) now.ideas.push({ ...idea, by: me.id, updatedAt: Date.now() });
    render();
    save(api(`/trips/${trip.id}/ideas/${idea.id}`, { method: 'PUT', body: ideaBody(idea) }));
  });
}

// How you get there, from a drive on show: the round button beside Directions opens the ways, one per row, like a stop's
// Type. Each way that has a route says how long it takes, so they can be compared before picking: they're looked up as
// the list opens (… until then). Picking one saves it at once, for everyone; the row, the route and Directions follow.
// It's saved on the stop the leg ends at, as how you get there. The way back to a hotel at night is that night's alone,
// saved by the day in the hotel's `back`, so getting there on check-in day and each night back are all their own.
export function openTravel(trip, leg) {
  const to = leg.to, night = leg.toEntry.role === 'night' && leg.toEntry.day, now = leg.mode;
  const timeOf = k => { if (!TRAVEL[k].route) return null; const r = getRoute(leg.from, to, { mode: k }); return r ? fmtDur(r.duration) : '…'; };
  const option = k => optionHTML(k, TRAVEL[k].label, { marker: `<i class="wt-marker wt-marker--travel">${travelIcon(k)}</i>`, detail: TRAVEL[k].detail, meta: timeOf(k) });
  openSheet(`${modalHead(`${night ? 'Getting back to' : 'Getting to'} ${esc(to.name)}`)}
    <ul class="wt-options" role="radiogroup" aria-label="How you get there">${Object.keys(TRAVEL).map(option).join('')}</ul>`, el => {
    routeWatch = () => {
      for (const m of el.querySelectorAll('.wt-option__meta')) m.textContent = timeOf(m.closest('[data-value]').dataset.value);
    };
    for (const b of el.querySelectorAll('[data-value]')) {
      b.setAttribute('aria-checked', b.dataset.value === now);
      b.addEventListener('click', () => {
        closeSheet();
        const stop = openTripOf(trip.id)?.stops.find(s => s.id === to.id);
        const way = b.dataset.value;
        if (!stop) return;
        if (!night) { if (way !== travelOf(stop)) editStop(trip, stop, { travel: way }); return; }
        if (way === backOf(stop, night)) return;
        // only the nights of the stay as it is now: a night it no longer has is dropped
        const stay = staysOf(openTripOf(trip.id)).find(st => st.s.id === stop.id);
        const back = Object.fromEntries(Object.entries({ ...stop.back, [night]: way })
          .filter(([d, t]) => t !== 'drive' && (!stay || (d >= stay.checkIn && d < stay.checkOut))));
        editStop(trip, stop, { back });
      });
    }
    el.querySelector(`[data-value="${now}"]`)?.focus();
  }, { onClose: () => { routeWatch = null; } });
}
