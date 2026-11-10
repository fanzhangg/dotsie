/* Drives: looking them up (one at a time, cached on this device), a day's legs, and handing directions to a maps app. */
import { ROUTE_KEY } from './core.js';
import { toDate, toInput } from './time.js';
import { api } from './backend.js';
import { ALL, IDEAS, TRAVEL, dayPlan, daysOf, samePlace, wayTo } from './plan.js';
import { routeWatch } from './edits.js';
import { scheduleRender } from './app.js';

// The day's drives, between consecutive places in the plan. Arrival is the next stop's time; you leave that long before it.
// The drive back to the hotel has no times: the day's last stop has no end. A leg goes the way its end says (`mode`);
// transit and flights have no route, so no time.
export function dayLegs(trip, day) {
  const plan = dayPlan(trip, day), legs = [];
  for (let i = 1; i < plan.length; i++) {
    const a = plan[i - 1], b = plan[i];
    if (samePlace(a.place, b.place)) continue;
    const mode = wayTo(b), r = legRoute(a, b);
    const arrive = b.role === 'stop' ? b.place.time : null;
    const leave = arrive && r ? toInput(new Date(toDate(arrive) - r.duration * 1000)) : null;
    legs.push({ key: b.key, mode, from: a.place, to: b.place, fromEntry: a, toEntry: b, r, arrive, leave });
  }
  return legs;
}
export const legsOn = (trip, day) => (day === IDEAS ? [] : day === ALL ? daysOf(trip).flatMap(d => dayLegs(trip, d)) : dayLegs(trip, day));

// ---------- Routes: only the line and the time it takes; navigation is handed to the maps app ----------
export const routes = (() => { try { return JSON.parse(localStorage.getItem(ROUTE_KEY)) || {}; } catch { return {}; } })();
// One lookup at a time, so opening a trip doesn't burst the router. Drives the screen needs go first; the other
// days' drives (preloaded so switching days is instant) wait behind them and go slowly, so a trip opened for the
// first time can't use up the per-person limit that place search shares with routes.
export const BG_ROUTE_GAP = 1000; // ms between background lookups: at most 60 a minute, half the server's limit
const pending = new Map(); // key → job
const routeJobs = [];
const bgRouteFailed = new Set(); // not retried in the background this visit; retried once its day is on screen
let routeBusy = false, bgRouteNext = 0, bgRouteTimer = 0;
// Drives keep the key they've always had, so routes saved on this device stay; a walk or a ride is `walk:`, `bike:`
export const legKey = (a, b, mode = 'drive') => `${mode === 'drive' ? '' : `${mode}:`}${(+a.lng).toFixed(5)},${(+a.lat).toFixed(5)};${(+b.lng).toFixed(5)},${(+b.lat).toFixed(5)}`;
function haversine(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// The route between two places in a day's plan, the way you get to the second; none for transit and flights
export function legRoute(a, b, opts) {
  const mode = wayTo(b);
  return TRAVEL[mode].route ? getRoute(a.place, b.place, { ...opts, mode }) : null;
}
export function getRoute(a, b, { background = false, mode = 'drive' } = {}) {
  const k = legKey(a, b, mode);
  if (routes[k]) return routes[k];
  if (a.lat === b.lat && a.lng === b.lng) return { ok: true, duration: 0, distance: 0, coords: [[a.lat, a.lng]] };
  if (background && bgRouteFailed.has(k)) return null;
  const job = pending.get(k);
  if (!job) {
    const j = { a, b, k, mode, background };
    pending.set(k, j);
    routeJobs.push(j);
  } else if (!background) job.background = false; // queued for later, but it's on screen now: it goes next
  pumpRoutes();
  return null;
}
async function pumpRoutes() {
  if (routeBusy || !routeJobs.length) return;
  let i = routeJobs.findIndex(j => !j.background);
  if (i < 0) {
    const wait = bgRouteNext - Date.now();
    if (wait > 0) { bgRouteTimer ||= setTimeout(() => { bgRouteTimer = 0; pumpRoutes(); }, wait); return; }
    i = 0;
    bgRouteNext = Date.now() + BG_ROUTE_GAP;
  }
  const [job] = routeJobs.splice(i, 1);
  routeBusy = true;
  await fetchRoute(job);
  routeBusy = false;
  pumpRoutes();
}
export async function fetchRoute(job) {
  const { a, b, k, mode = 'drive' } = job;
  try {
    const rt = await api(`/route?from=${a.lat},${a.lng}&to=${b.lat},${b.lng}${mode === 'drive' ? '' : `&mode=${mode}`}`);
    routes[k] = { ok: true, ...rt };
    try { localStorage.setItem(ROUTE_KEY, JSON.stringify(Object.fromEntries(Object.entries(routes).filter(([, v]) => v.ok)))); } catch {}
  } catch (e) {
    if (job.background) {
      // Nobody's looking at it yet: leave it for when its day is on screen, and back off if over the limit
      bgRouteFailed.add(k);
      if (e.status === 429) bgRouteNext = Date.now() + 60000;
    } else {
      // Offline or unavailable: straight-line estimate so the plan still reads. Not persisted, so it retries next load.
      const d = haversine(a, b) * 1.3;
      routes[k] = { ok: false, duration: d / TRAVEL[mode].speed, distance: d, coords: [[a.lat, a.lng], [b.lat, b.lng]] };
    }
  }
  pending.delete(k);
  routeWatch?.();
  if (!job.background) scheduleRender(); // a preloaded route shows once its day does
}
// Leaving a trip drops its preloading; a lookup the screen asked for still finishes.
export function dropBackgroundRoutes() {
  for (let i = routeJobs.length - 1; i >= 0; i--) {
    if (routeJobs[i].background) { pending.delete(routeJobs[i].k); routeJobs.splice(i, 1); }
  }
  bgRouteFailed.clear();
}
// Directions and places open in one maps app, the one you pick in Account: Google Maps unless you choose Apple Maps.
// A web page can't ask which maps app is the default, so it's a setting. It's kept on this device, not the account,
// since which apps you have is up to the phone.
const MAPS_KEY = 'waythread:maps';
export const MAPS_APPS = { google: 'Google Maps', apple: 'Apple Maps' };
export let mapsApp = 'google';
try { if (localStorage.getItem(MAPS_KEY) === 'apple') mapsApp = 'apple'; } catch {}
export function setMapsApp(app) {
  mapsApp = app;
  try { localStorage.setItem(MAPS_KEY, app); } catch {}
}
export function directionsURL(from, to, mode = 'drive') {
  const { apple, google } = TRAVEL[mode];
  return mapsApp === 'apple'
    ? `https://maps.apple.com/?saddr=${from.lat},${from.lng}&daddr=${to.lat},${to.lng}${apple ? `&dirflg=${apple}` : ''}`
    : `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${google}`;
}
// A place, to see that it's the right one and whether it's worth going: photos, reviews, hours. Found by name and
// address, which opens the place itself (Apple Maps searches near its coordinates); coordinates alone would open
// only a dropped pin.
export function placeURL(p) {
  const q = encodeURIComponent([p.name, p.address].filter(Boolean).join(', '));
  return mapsApp === 'apple' ? `https://maps.apple.com/?q=${q}&sll=${p.lat},${p.lng}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
// Places to eat around a place, in the maps app, whose reviews and hours say where's good: no free source Dotsie
// could use does (sights come from OpenStreetMap, which has restaurants but no reviews)
export function foodURL(p) {
  return mapsApp === 'apple' ? `https://maps.apple.com/?q=restaurants&sll=${p.lat},${p.lng}` : `https://www.google.com/maps/search/restaurants/@${p.lat},${p.lng},15z`;
}
