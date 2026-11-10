/* Dotsie — vanilla JS in ES modules, no bundler: each file is served as it is (see the modulepreload list in index.html).
   One trip screen: a full-screen map with one day of the plan as a draggable sheet on top; from 768px wide,
   the plan is a side panel next to the map instead.
   Data comes from the Worker's /api (backend.js). Edits show at once and save in the background; the open trip
   keeps a WebSocket so co-editors' changes land live. Look, components and icons come from design-system/.
   The prototype (../../prototype) runs these same modules with its own backend.js in place of this one.

   This file is the entry: the page for the address (#/, #/trip/…, #/join/…, #/spots/…), and the app's taps and keys.
   core      shared helpers, and the trip screen's state
   fields    what a stop is made of (the server checks the same)
   time      clock times, time zones and how they read
   plan      a trip's days, stays, stop types and travel
   backend   the server: /api, the live socket, sign-out
   signin    who's signed in, and the sign-in screens
   trips     the open trip, the home list, live events
   routes    looking up drives, a day's legs, maps apps
   offline   a trip saved on this device
   home      the trip cards
   spots     the guide's places, for anyone
   map       the trip's map, its camera and pins
   timeline  the day's list and the day bar
   sheet     the plan's sheet: its height and dragging
   sights    what's worth seeing nearby, and its card
   edits     adding, changing and deleting stops
   sheets    new trip, trip settings, account
   stopsheet the stop sheet and its pickers
   notices   toasts and questions */
import { $app, $sheets, esc, state } from './core.js';
import { boot, me, renderSignIn, signInSocial } from './signin.js';
import { closeTrip, cur, join, loadTrips, openTrip, setTrips, tripLoad, trips } from './trips.js';
import { homeHTML, loadCardPhotos } from './home.js';
import { renderSpots } from './spots.js';
import { signOut } from './backend.js';
import { applySnap, centerFocus, closeDayCal, currentDay, grabLabel, isWide, pickDay, renderAddBar, renderDayBar, renderList, setSnap, snaps, stepDay, toggleDayCal } from './timeline.js';
import { legsOn } from './routes.js';
import { openTravel } from './edits.js';
import { ideasOf } from './plan.js';
import { keepOfflinePlan, needsConnection, renderOfflineStatus, savedTrip, statusSay } from './offline.js';
import { drawMap, mountTrip, preloadMap, previewLeg, refit, schedulePreload, selectStop, showWholeDay, teardownTrip, updateFitBtn, zoomToStop } from './map.js';
import { drag, holdRender, sheetTarget } from './sheet.js';
import { closeSheet, openAccount, openNewTrip, openSettings } from './sheets.js';
import { addToDay, openDayPicker, openIdeaSearch, openIdeaSheet, openStopSheet } from './stopsheet.js';
import { toast } from './notices.js';

// ---------- Routing (hash) ----------
export function parseHash() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?'), p = path.split('/');
  if (p[0] === 'trip' && p[1]) return { page: 'trip', id: decodeURIComponent(p[1]) };
  if (p[0] === 'join' && p[1]) return { page: 'join', token: p[1] };
  // #/spots (with what's asked after ?: #/spots?city=seattle), or one spot: #/spots/<city>/<source>/<id>
  if (p[0] === 'spots') return p[3] ? { page: 'spot', city: decodeURIComponent(p[1]), source: decodeURIComponent(p[2]), id: decodeURIComponent(p.slice(3).join('/')) } : { page: 'spots', query };
  return { page: 'home' };
}
// setTimeout rather than rAF: rAF is paused in background tabs, and co-editors' changes should land there too
let renderTimer = 0;
export function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 16); }

export const messageHTML = msg => `<p class="wt-empty">${esc(msg)} <a href="#/">All trips</a></p>`;
const TRIP_ERRORS = {
  not_member: 'You’re not on this trip. Ask someone on it to send you the link.',
  not_found: 'This trip doesn’t exist.',
  gone: 'This trip was deleted.',
  offline: 'Couldn’t load this trip. Check your connection.',
};

export function render() {
  const r = parseHash();
  document.title = 'Dotsie';
  // Spots are for anyone, signed in or not
  if (r.page === 'spots' || r.page === 'spot') { if (cur) closeTrip(); teardownTrip(); renderSpots(r); return; }
  if (!me) { closeTrip(); teardownTrip(); $app.dataset.page = 'signin'; renderSignIn(r); return; }
  if (r.page === 'join') { teardownTrip(); join(r.token); return; }
  if (r.page !== 'trip') {
    if (cur) closeTrip();
    teardownTrip();
    if (trips === null) loadTrips();
    $app.dataset.page = 'home';
    $app.innerHTML = homeHTML();
    loadCardPhotos();
    preloadMap();
    return;
  }
  setTrips(null); // the home list reloads on the way back
  if (cur?.id !== r.id) {
    if (tripLoad === r.id) return;
    closeTrip();
    teardownTrip();
    $app.dataset.page = 'trip';
    $app.innerHTML = '';
    openTrip(r.id);
    return;
  }
  if (holdRender()) return; // the page is being swiped: this render comes when it's let go
  const trip = cur;
  if (trip.error) { teardownTrip(); $app.dataset.page = 'message'; $app.innerHTML = messageHTML(TRIP_ERRORS[trip.error] || TRIP_ERRORS.offline); return; }
  if ($app.dataset.trip !== trip.id) mountTrip(trip);
  document.title = `${trip.name} · Dotsie`;
  const el = $app.querySelector('.trip');
  el.querySelector('.wt-trip-head__name').textContent = trip.name;
  renderOfflineStatus(trip);
  if (savedTrip(trip.id)) keepOfflinePlan();
  const topH = el.querySelector('.wt-sheet__top').offsetHeight;
  renderDayBar(trip);
  const newDay = renderList(trip);
  renderAddBar(trip);
  el.querySelector('.wt-sheet__grab').setAttribute('aria-label', grabLabel());
  if (!el.querySelector('.wt-sheet').style.height || topH !== el.querySelector('.wt-sheet__top').offsetHeight) applySnap();
  // a taller add bar can change the half height: slide there
  else if (!isWide() && state.snap === 'half' && !drag.active && Math.abs(snaps().half - sheetTarget()) >= 1) applySnap(true);
  // the focused row in the middle of the list: at once on a new day, or else moved there if the plan moved it
  centerFocus(newDay ? { force: true, animate: false } : {});
  for (const id of state.flash) el.querySelector(`.wt-tl-stop[data-id="${id}"]`)?.classList.add('is-flash');
  state.flash.clear();
  drawMap(trip);
  updateFitBtn();
  schedulePreload();
}

// ---------- Events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const trip = cur?.stops ? cur : null;
  const stop = trip && el.dataset.id && trip.stops.find(s => s.id === el.dataset.id);
  const idea = trip && el.dataset.id && ideasOf(trip).find(i => i.id === el.dataset.id);
  switch (el.dataset.action) {
    case 'new-trip': openNewTrip(); break;
    case 'add': if (needsConnection()) openStopSheet(trip); break;
    case 'select': if (stop && !e.target.closest('a')) selectStop(stop, el.dataset.row); break; // a link in its note opens on its own
    case 'edit': if (stop && needsConnection()) openStopSheet(trip, stop); break;
    // Want to go: Save place finds one for the list; one on it goes to a day (picked, or the day on screen) as a new stop.
    // Selecting one brings its pin into view without zooming in: the list is about where the places are.
    case 'select-idea': if (idea && !e.target.closest('a')) { selectStop(idea); zoomToStop(idea, 0); } break;
    case 'add-idea': if (needsConnection()) openIdeaSearch(trip); break;
    case 'plan-idea': if (idea && needsConnection()) openDayPicker(trip, idea); break;
    case 'idea-to-day': if (idea && needsConnection()) addToDay(trip, idea, el.dataset.day, idea); break;
    case 'edit-idea': if (idea && needsConnection()) openIdeaSheet(trip, idea); break;
    case 'settings': openSettings(trip); break;
    case 'offline-status': if (statusSay) toast(statusSay); break;
    case 'pick-day': closeSheet(); pickDay(el.dataset.day); break;
    case 'day-cal': toggleDayCal(); break;
    case 'leg': {
      const l = legsOn(trip, currentDay(trip)).find(x => x.key === el.dataset.leg);
      if (l) previewLeg(l);
      break;
    }
    case 'travel': {
      const l = legsOn(trip, currentDay(trip)).find(x => x.key === el.dataset.leg);
      if (l && needsConnection()) openTravel(trip, l);
      break;
    }
    case 'account': openAccount(); break;
    case 'social': signInSocial(el.dataset.provider); break;
    case 'sign-out': signOut(); break;
    case 'close-sheet': closeSheet(); break;
    case 'fit-day': showWholeDay(); break;
    case 'grab': setSnap(state.snap === 'half' ? 'full' : 'half'); break;
    case 'copy': copyText(el); break;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // with no sheet open, Esc closes the calendar of days, or else clears the selection, like tapping empty map
    if (!$sheets.innerHTML && $app.dataset.trip && closeDayCal()) return;
    if (!$sheets.innerHTML && $app.dataset.trip && (state.sel || state.leg)) {
      if (state.leg) refit();
      state.sel = state.selRow = state.leg = null;
      render();
    }
    closeSheet();
  }
  // Stop and drive rows are focusable: Enter or Space selects the stop or shows the drive's route, like a tap
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.wt-tl-stop, .wt-tl-drive')) { e.preventDefault(); e.target.click(); }
  // ← → change day on the trip screen, unless typing or a sheet is open
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && $app.dataset.trip && !$sheets.innerHTML && !e.target.closest('input, textarea')) stepDay(e.key === 'ArrowRight' ? 1 : -1);
});
addEventListener('hashchange', render);
// Copy buttons sit beside the text they copy. If the browser won't copy, the text is selected, so it's one step by hand.
function copyText(el) {
  const done = () => toast(el.dataset.copied || 'Link copied');
  const failed = () => {
    el.parentElement.querySelector('input')?.select();
    toast({ error: true, title: 'Couldn’t copy', detail: 'It’s selected: copy it from the menu or with your keyboard.' });
  };
  if (navigator.clipboard) navigator.clipboard.writeText(el.dataset.text).then(done, failed); else failed();
}

boot();
