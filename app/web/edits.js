/* Adding, changing and deleting stops, how you get to one, and a place's state.

   A place on a trip is in one of two states, and changes between them the same way wherever it's shown:

     (none) ── Save ──▶ WANT TO GO ── Add to this day ──▶ PLANNED
            ◀─ Remove ─  no day,    ◀─ Move to Want to go ─  a day and a time,
                         no time                             a note and links
     PLANNED ── Delete ──▶ (none)

   Save and Move to Want to go are the bookmark (filled once a place is saved); Remove is the trash, Delete is in a
   stop's sheet. Add to this day is the calendar, on a day, which is where a time comes from; on Want to go and the overview, Add to a day
   asks which day first (stopsheet.js's openAddToDay). Every change says what happened,
   with Undo, which puts the place back as it was. */
import { esc, state, uid } from './core.js';
import { fmtDur } from './time.js';
import { me } from './signin.js';
import { openTripOf, save, writeStop } from './trips.js';
import { api } from './backend.js';
import { TRAVEL, backOf, findIdea, staysOf, travelIcon, travelOf } from './plan.js';
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
// `quiet`: no notice, for a change that says so itself (Move to Want to go, an Undo)
export function deleteStop(trip, stop, { quiet = false } = {}) {
  const t = openTripOf(trip.id);
  if (t) t.stops = t.stops.filter(s => s.id !== stop.id);
  if (state.sel === stop.id) state.sel = state.selRow = null;
  render();
  save(api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'DELETE' }));
  if (!quiet) toast(`Deleted ${stop.name}`, 'Undo', () => restoreStop(trip, stop));
}
// The same stop back under its old id, as it was
function restoreStop(trip, stop) {
  const { name, address, lat, lng, time, tz = null, duration = null, note, kind, nights, checkout = null, back = {}, links = [], wikidata = null } = stop, travel = travelOf(stop);
  const t = openTripOf(trip.id);
  if (t && !t.stops.some(s => s.id === stop.id)) t.stops.push({ ...stop, by: me.id });
  render();
  writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PUT', body: { name, address, lat, lng, time, tz, duration, note, kind, nights, checkout, travel, back, links, wikidata } }));
}

// ---------- A place's state: Want to go and planned ----------
// Want to go → planned: the place as a new stop on the day (stopsheet.js's addToDay works out when), off the list. Undo
// takes the stop away and puts the place back on Want to go.
export function planIdea(trip, idea, data, say) {
  addStop(trip, data);
  const stop = openTripOf(trip.id)?.stops.find(s => s.id === state.sel);
  if (idea) deleteIdea(trip, idea, { quiet: true });
  toast(say, 'Undo', () => {
    if (stop) deleteStop(trip, stop, { quiet: true });
    if (idea) restoreIdea(trip, idea);
  });
}
// Planned → Want to go: off its day, onto the list as a place, and only a place: its time, stay, note and links go
// (Undo brings it all back). A place on the list already isn't put on it twice.
export function moveToIdeas(trip, stop) {
  const had = findIdea(openTripOf(trip.id) || trip, stop);
  deleteStop(trip, stop, { quiet: true });
  const idea = had || addIdea(trip, stop, { select: false });
  toast(`Moved ${stop.name} to Want to go`, 'Undo', () => {
    if (!had) deleteIdea(trip, idea, { quiet: true });
    restoreStop(trip, stop);
  });
}

// ---------- Want to go ----------
// Save: a place on the trip's list, with no day yet. Selected (`select`), so its pin is named; `say`, the notice, with
// Undo (left out where the change says so itself).
const ideaBody = ({ name, address = '', lat, lng, kind = '', wikidata = null }) => ({ name, address, lat, lng, kind, wikidata });
export function addIdea(trip, data, { select = true, say = false } = {}) {
  const idea = { id: uid(), ...ideaBody(data), by: me.id, updatedAt: Date.now() };
  openTripOf(trip.id)?.ideas.push(idea);
  if (select) { state.leg = null; state.sel = idea.id; state.selRow = null; }
  render();
  save(api(`/trips/${trip.id}/ideas/${idea.id}`, { method: 'PUT', body: ideaBody(idea) }), 'Couldn’t save it to Want to go');
  if (say) toast(`Saved ${idea.name} to Want to go`, 'Undo', () => deleteIdea(trip, idea, { quiet: true }));
  return idea;
}
// Back on the list, as it was (saved again, it goes at the end, as the server keeps it)
function restoreIdea(trip, idea) {
  const now = openTripOf(trip.id);
  if (now && !now.ideas.some(i => i.id === idea.id)) now.ideas.push({ ...idea, by: me.id, updatedAt: Date.now() });
  render();
  save(api(`/trips/${trip.id}/ideas/${idea.id}`, { method: 'PUT', body: ideaBody(idea) }));
}
// Remove: off the list, with Undo; or quietly, as part of another change that says so (planned, an Undo)
export function deleteIdea(trip, idea, { quiet = false } = {}) {
  const t = openTripOf(trip.id);
  if (t) t.ideas = t.ideas.filter(i => i.id !== idea.id);
  if (state.sel === idea.id) state.sel = state.selRow = null;
  render();
  save(api(`/trips/${trip.id}/ideas/${idea.id}`, { method: 'DELETE' }));
  if (!quiet) toast(`Removed ${idea.name} from Want to go`, 'Undo', () => restoreIdea(trip, idea));
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
