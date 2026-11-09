/* A trip saved on this device for when there's no signal: its plan, its drives, its map, and the app's own files. */
import { $app, ICON } from './core.js';
import { fmtDay, toInput } from './time.js';
import { config, me } from './signin.js';
import { cur, fromSnapshot, reloadTrip } from './trips.js';
import { TRAVEL, dayPlan, daysOf, pagesOf, samePlace, wayTo } from './plan.js';
import { BG_ROUTE_GAP, fetchRoute, legKey, routes } from './routes.js';
import { scheduleRender } from './app.js';
import { STADIA_CHECK, TILE_PRELOAD_PARALLEL, basemap, dayView, glFiles, glTileURLs, isGLStyle, map, tiles } from './map.js';
import { toast } from './notices.js';

// ---------- Offline: a trip saved on this device ----------
// Trip settings can save a trip on this device, to see it with no signal: its plan (the last copy the server sent), its
// drives, the map around each day and each stop, and the app itself, which sw.js serves when the network can't. A saved
// trip keeps itself up to date: while it's open online its plan is saved again as it changes, and each visit fetches any
// map it now needs. With no connection, Home lists the saved trips and a saved trip opens from its copy. The trip
// header says which it is (offlineStatus). Changes still need a connection. Signing out removes everything saved.
const OFFLINE_KEY = 'waythread:offline:v1';
const SHELL_CACHE = 'waythread-shell';
const tileCache = id => `waythread-tiles:${id}`;
const canSaveOffline = window.isSecureContext && 'caches' in window && 'serviceWorker' in navigator;
export const OFFLINE_WAIT = 4000; // ms a saved trip waits for the server before showing its copy (a weak signal)
// Who's signed in and what sign-in offers, so the app opens offline, and each saved trip:
// { snap (as /api/trips/:id sends it), savedAt, style (its map: MapLibre's style, or the pictures' address), tiles, bytes, missing, noMap }
export let offline = { trips: {} };
try { offline = JSON.parse(localStorage.getItem(OFFLINE_KEY)) || offline; } catch {}
const storeOffline = () => { try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(offline)); } catch {} };
export const savedTrip = id => offline.trips[id] || null;
export const anySaved = () => Object.keys(offline.trips).length > 0;
// The saved copy of a trip, as the trip screen holds one. `offline` marks it as maybe not the latest.
export const offlineCopy = id => (savedTrip(id) ? { ...fromSnapshot(savedTrip(id).snap), offline: true } : null);
// Home's cards for the saved trips, as /api/trips sends them
export const offlineCards = () => Object.values(offline.trips).sort((a, b) => b.savedAt - a.savedAt).map(({ snap }) => {
  const times = snap.stops.map(s => s.time).sort();
  return { id: snap.trip.id, name: snap.trip.name, start: times[0] || null, end: times.at(-1) || null, members: snap.members, stops: snap.stops };
});
// No connection, or the trip on screen is its saved copy because the server didn't answer
export const offlineNow = () => !navigator.onLine || !!cur?.offline;
export const registerOffline = () => navigator.serviceWorker?.register('sw.js').catch(() => {});
export function rememberSession() {
  if (!anySaved() || !me) return;
  offline.me = me;
  offline.config = config;
  storeOffline();
}
export function forgetOffline() {
  const ids = Object.keys(offline.trips);
  offline = { trips: {} };
  offlineJob = null;
  try { localStorage.removeItem(OFFLINE_KEY); } catch {}
  if (canSaveOffline) for (const name of [SHELL_CACHE, ...ids.map(tileCache)]) caches.delete(name).catch(() => {});
}

// The plan, saved again as it changes while the trip is open online. Not from a saved copy: an edit made offline
// hasn't reached the server, so it isn't saved as if it had.
let planTimer = 0;
export function keepOfflinePlan() {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => {
    const trip = cur?.stops ? cur : null, t = trip && savedTrip(trip.id);
    if (!t || trip.offline) return;
    const snap = { trip: { id: trip.id, name: trip.name }, members: trip.members, stops: trip.stops };
    if (JSON.stringify(snap) !== JSON.stringify(t.snap)) { t.snap = snap; t.savedAt = Date.now(); storeOffline(); }
  }, 1000);
}

// The map files a saved trip needs, for the map showing: each day's view, and the overview's, at its zoom (with a tile to
// spare around it), a level out and a level in; and a street-level patch around each place. MapLibre's map also needs
// its style, sprite and fonts, and its tiles go no closer than street level, where it enlarges them.
function offlineTileURLs(trip) {
  const gs = basemap?.gs;
  if (!map || !(tiles || gs)) return [];
  const urls = new Set([STADIA_CHECK, ...(gs ? glFiles(gs) : [])]), size = map.getSize(), street = L.point(256, 256);
  // MapLibre's map reaches a tenth of the map past each side (the plugin's padding)
  const spare = L.point(128, 128).add(gs ? size.multiplyBy(0.1) : L.point(0, 0));
  const add = (center, z, half) => {
    const c = map.project(center, z), b = L.bounds(c.subtract(half), c.add(half));
    for (const u of gs ? glTileURLs(gs, b, z) : tiles.tileURLs(b, z)) urls.add(u);
  };
  for (const d of pagesOf(trip)) {
    const v = dayView(trip, d);
    if (!v) continue;
    // a level in covers the whole view, where a zoom in can land; a level out, a view-sized area around its middle
    for (const dz of [-1, 0, 1]) add(v.center, Math.round(v.zoom) + dz, size.multiplyBy(Math.max(1, 2 ** dz) / 2).add(spare));
  }
  for (const s of trip.stops) for (const z of [15, 16]) add(L.latLng(s.lat, s.lng), z, street);
  return [...urls];
}

export let offlineJob = null; // the trip being saved: { id, done, total, quiet, first (not saved before) }
const toppedUp = new Set(); // saved trips brought up to date this visit
// Save a trip, or bring a saved one up to date (`quiet`: on its own, when the trip opens). Only what isn't saved yet
// is fetched, so bringing it up to date is cheap. The plan is saved first, so it's there even if the map isn't finished.
export async function saveOffline(trip, { quiet = false } = {}) {
  if (!canSaveOffline || offlineJob?.id === trip.id || trip.offline) return;
  const id = trip.id, urls = offlineTileURLs(trip), legs = new Map();
  for (const d of daysOf(trip)) {
    const plan = dayPlan(trip, d);
    for (let i = 1; i < plan.length; i++) {
      const a = plan[i - 1].place, b = plan[i].place, mode = wayTo(plan[i]), k = legKey(a, b, mode);
      if (TRAVEL[mode].route && !samePlace(a, b) && !routes[k]?.ok) legs.set(k, { a, b, k, mode });
    }
  }
  const job = offlineJob = { id, done: 0, total: urls.length + legs.size, quiet, first: !savedTrip(id) };
  if (!quiet) navigator.storage?.persist?.().catch(() => {});
  registerOffline();
  const t = offline.trips[id] ||= { tiles: 0, bytes: 0 };
  t.snap = { trip: { id, name: trip.name }, members: trip.members, stops: trip.stops };
  t.savedAt = Date.now();
  // the map showing; a trip saved with the other kind keeps it until this one is all saved
  const style = basemap?.gs.url || tiles?._url;
  if (style && (!t.style || isGLStyle(t.style) === isGLStyle(style))) t.style = style;
  t.noMap = !style;
  rememberSession();
  showOffline();
  // The app's own files: the page, its scripts and styles
  const shell = caches.open(SHELL_CACHE).then(c => Promise.all([location.pathname, ...[...document.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="modulepreload"]')].map(el => el.src || el.href)]
    .map(f => c.add(f).catch(() => {})))).catch(() => {});
  // Each drive's route, a second apart, as preloading fetches them
  const drives = (async () => {
    for (const leg of legs.values()) {
      if (offlineJob !== job) return;
      if (!routes[leg.k]?.ok) { await fetchRoute({ ...leg, background: true }); await new Promise(r => setTimeout(r, BG_ROUTE_GAP)); }
      job.done++;
      showOffline();
    }
    scheduleRender();
  })();
  // The map, a few tiles at a time
  let missing = 0, next = 0;
  const cache = await caches.open(tileCache(id)).catch(() => null);
  const worker = async () => {
    while (cache && next < urls.length && offlineJob === job) {
      const u = urls[next++];
      try {
        if (!(await cache.match(u))) {
          const res = await fetch(u);
          if (!res.ok) throw new Error(res.status);
          const bytes = +res.headers.get('content-length') || (await res.clone().blob()).size;
          await cache.put(u, res);
          t.bytes += bytes;
        }
      } catch { missing++; }
      job.done++;
      showOffline();
    }
  };
  await Promise.all([shell, drives, ...Array.from({ length: TILE_PRELOAD_PARALLEL }, worker)]);
  if (offlineJob !== job) return; // removed, or signed out, meanwhile
  offlineJob = null;
  t.tiles = urls.length - missing;
  t.missing = cache ? missing : urls.length;
  if (cache && !missing && style) {
    t.style = style;
    // tiles the trip no longer needs: around places taken out of it, or the other kind of map's
    const keep = new Set(urls.map(u => new Request(u).url));
    const gone = (await cache.keys()).filter(r => !keep.has(r.url) && /\/(tiles|data)\//.test(new URL(r.url).pathname));
    if (gone.length) {
      await Promise.all(gone.map(r => cache.delete(r)));
      t.bytes = await cachedBytes(cache);
    }
  }
  storeOffline();
  showOffline();
  if (!quiet) {
    toast(t.missing ? { icon: ICON.download, title: 'Part of the map didn’t download', detail: 'The plan is saved. Try again in trip settings when the signal is better.' }
      : { icon: ICON.saved, title: 'Available offline', detail: `${trip.name} is saved on this device.` });
  }
}
const cachedBytes = async cache => {
  let n = 0;
  for (const r of await cache.keys()) { const res = await cache.match(r); n += +res?.headers.get('content-length') || (await res?.blob())?.size || 0; }
  return n;
};
// A saved trip, brought up to date once a visit, after the day on screen has loaded
export function topUpOffline(trip) {
  if (!savedTrip(trip.id) || trip.offline || toppedUp.has(trip.id) || !navigator.onLine) return;
  toppedUp.add(trip.id);
  saveOffline(trip, { quiet: true });
}
export function removeOffline(trip) {
  if (offlineJob?.id === trip.id) offlineJob = null;
  delete offline.trips[trip.id];
  toppedUp.delete(trip.id);
  storeOffline();
  if (canSaveOffline) {
    caches.delete(tileCache(trip.id)).catch(() => {});
    if (!anySaved()) caches.delete(SHELL_CACHE).catch(() => {});
  }
  showOffline();
}

// The trip header's status: available offline, saving, or no connection. Not saved and online, it says nothing.
// It's a button: a tap says what it means, in a notice.
const fmtMB = b => (b < 1e6 ? 'under 1 MB' : `${Math.round(b / 1e6)} MB`);
const fmtAgo = t => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return fmtDay(toInput(new Date(t)));
};
const pctOf = job => (job.total ? Math.floor((job.done / job.total) * 100) : 0);
function offlineStatus(trip) {
  const t = savedTrip(trip.id);
  if (offlineNow()) return { icon: ICON.cloudOff, label: 'Offline', say: offlineNotice(trip) };
  if (offlineJob?.id === trip.id && !offlineJob.quiet) {
    return { icon: ICON.download, label: 'Saving for offline', say: { icon: ICON.download, title: 'Saving for offline', detail: `${pctOf(offlineJob)}% done. Keep the app open until it finishes.` } };
  }
  if (t) return { icon: ICON.saved, label: 'Available offline', say: { icon: ICON.saved, title: 'Available offline', detail: 'The plan and map are saved on this device, so they open without a signal.' } };
  return null;
}
// What being offline means for this trip: what you can still do, and what has to wait
function offlineNotice(trip) {
  const t = savedTrip(trip.id);
  return {
    icon: ICON.cloudOff, title: 'You’re offline',
    detail: t ? `Showing the plan saved ${fmtAgo(t.savedAt)}. To add or change stops, reconnect.` : 'To add or change stops, reconnect.',
  };
}
export let statusSay = null;
export function renderOfflineStatus(trip) {
  const btn = $app.dataset.trip === trip.id && $app.querySelector('.wt-trip-head__status');
  if (!btn) return;
  const st = offlineStatus(trip);
  btn.hidden = !st;
  statusSay = st?.say || null;
  if (!st || btn.dataset.label === st.label) return;
  btn.dataset.label = st.label;
  btn.classList.toggle('is-offline', st.icon === ICON.cloudOff);
  btn.setAttribute('aria-label', st.label);
  btn.title = st.label;
  btn.innerHTML = st.icon;
}

// Trip settings' Offline section: save the trip, how it's going, or what's saved and a way to remove it
let offlineField = null; // { el, trip, kind } while trip settings are open
export const setOfflineField = v => { offlineField = v; };
function offlineFieldHTML(trip) {
  const head = text => `<h3 class="wt-section__title">Offline</h3><p class="wt-section__text">${text}</p>`;
  if (!canSaveOffline) return { kind: 'none', html: head('This browser can’t save trips for offline.') };
  // bringing a saved trip up to date happens on its own, and the section goes on showing what's saved
  const t = savedTrip(trip.id), job = offlineJob?.id === trip.id && !offlineJob.quiet && offlineJob;
  if (!t) {
    return { kind: 'save', html: `${head('Save the plan and its map on this device, to see them with no signal.')}
      <button class="wt-btn wt-btn--secondary" data-offline-save${trip.offline ? ' disabled' : ''}>${ICON.download}Save for offline</button>` };
  }
  if (job) return { kind: 'saving', html: `${head('Saving the map: <span data-offline-pct>' + pctOf(job) + '</span>%')}
      <button class="wt-btn wt-btn--secondary" data-offline-remove>${job.first ? 'Cancel' : 'Remove from this device'}</button>` };
  // Safari in a browser tab clears a site's saved data after about a week without a visit; an app on the Home Screen keeps it
  const ios = navigator.standalone === false ? '<p class="wt-section__hint">On iPhone, Safari clears saved trips you haven’t opened in a week. To keep this one, add Dotsie to your Home Screen, open it from there and save the trip again.</p>' : '';
  const map = t.noMap ? ' The map can’t be saved with this map provider.' : t.missing ? ' Part of the map didn’t download.' : '';
  return { kind: 'saved', html: `${head(`Saved on this device (${fmtMB(t.bytes)}), updated ${fmtAgo(t.savedAt)}. It updates whenever you open the trip online.${map}`)}${ios}
      ${t.missing && !trip.offline ? '<button class="wt-btn wt-btn--secondary" data-offline-save>Try again</button>' : ''}
      <button class="wt-btn wt-btn--secondary" data-offline-remove>Remove from this device</button>` };
}
export function showOffline() {
  const trip = cur?.stops ? cur : null;
  if (trip) renderOfflineStatus(trip);
  const f = offlineField;
  if (!f || !f.el.isConnected) { offlineField = null; return; }
  const { kind, html } = offlineFieldHTML(f.trip);
  if (kind !== f.kind) { f.kind = kind; f.el.innerHTML = html; return; }
  const pct = f.el.querySelector('[data-offline-pct]');
  if (pct && offlineJob) pct.textContent = pctOf(offlineJob);
}
// Adding, editing and deleting stops need a connection: offline, their buttons are greyed out, and a tap says why
// rather than opening a stop that couldn't be saved. Deleting is in the stop sheet, so it's covered too.
export function needsConnection() {
  if (!offlineNow()) return true;
  toast(offlineNotice(cur));
  return false;
}
// Back online: a trip showing its saved copy loads the server's, and the header stops saying offline.
// Either way, the add bar's buttons follow.
addEventListener('online', () => { if (cur?.offline) reloadTrip(); showOffline(); if (cur?.stops) scheduleRender(); });
addEventListener('offline', () => { showOffline(); if (cur?.stops) scheduleRender(); });
