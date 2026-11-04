'use strict';

/* Waythread — vanilla JS, no build step.
   One trip screen: a full-screen map with one day of the plan as a draggable sheet on top; from 768px wide,
   the plan is a side panel next to the map instead.
   Data comes from the Worker's /api. Edits show at once and save in the background; the open trip
   keeps a WebSocket so co-editors' changes land live. Look, components and icons come from design-system/. */

const params = new URLSearchParams(location.search);
// ?today=YYYY-MM-DD (and &now=HH:MM) pretend it's a trip day, so today's highlight can be previewed before the trip
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '') ? params.get('today') : null;
const NOW_HM = /^\d{2}:\d{2}$/.test(params.get('now') || '') ? params.get('now') : null;

const ROUTE_KEY = 'waythread:routes:v1';
const $app = document.getElementById('app');
const $sheets = document.getElementById('sheets');
// sel: the selected stop · selRow: which of its rows was tapped (a hotel can start and end the day) · leg: the drive whose route is shown · snap: the phone's list, 'half' or 'full' ·
// draft: the stop open in the stop sheet, as edited so far, which the map shows in its place
const state = { sel: null, selRow: null, leg: null, hoverLeg: null, day: null, snap: 'half', draft: null, flash: new Set() };

// Who's signed in, the home list, and the open trip ({ id, name, members, stops } or { id, error })
let me = null, config = { google: false, apple: false, password: false }, trips = null, cur = null;
// Whether any real sign-in is set up; without one, guests aren't offered an upgrade they can't do.
const canSignIn = () => config.google || config.apple || config.password;
// What to say when a request fails: the server's rate limit, no connection, or anything else
const failMsg = (err, what) => err?.code === 'rate_limited' ? 'Too many tries. Wait a minute, then try again.'
  : err?.code === 'offline' ? `${what} Check your connection.` : `${what} Try again.`;

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const memberOf = id => cur?.members?.find(m => m.id === id);
const avatarHTML = m => `<span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-${m.identity || 1})">${esc((m.name || '?')[0].toUpperCase())}</span>`;
// Map drawing can't use CSS classes, so it reads the design tokens directly (theme-aware).
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Icons (design system) ----------
const ICON = Object.fromEntries(['home', 'settings', 'back', 'forward', 'chevron-down', 'close', 'plus', 'edit', 'car', 'directions', 'map', 'list', 'check', 'fit']
  .map(n => [n.replace(/-(\w)/g, (_, c) => c.toUpperCase()), WaythreadIcons.svg(n)]));

// ---------- Time & distance formatting (times are trip-local, stored as "YYYY-MM-DDTHH:MM") ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function toDate(t) {
  const [d, hm = '00:00'] = t.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(y, m - 1, dd, h, mi);
}
const toInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
function fmtClock(d) { const h = d.getHours(); return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`; }
const fmtTime = t => fmtClock(toDate(t));
const fmtDay = t => { const d = toDate(t); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
// "Now" as a "YYYY-MM-DDTHH:MM" stamp, trip-local like stop times
function nowStamp() {
  const real = toInput(new Date());
  return `${TODAY || real.slice(0, 10)}T${NOW_HM || real.slice(11)}`;
}
function fmtRange(start, end) {
  if (!start) return '';
  const a = toDate(start), b = toDate(end);
  const left = `${MONTHS[a.getMonth()]} ${a.getDate()}`;
  if (a.toDateString() === b.toDateString()) return left;
  return a.getMonth() === b.getMonth() ? `${left} – ${b.getDate()}` : `${left} – ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}
function fmtDur(sec) {
  const m = Math.max(1, Math.round(Math.abs(sec) / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

// ---------- API ----------
class ApiError extends Error {
  constructor(status, code) { super(code || `HTTP ${status}`); this.status = status; this.code = code; }
}
async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, signal,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body && JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'offline');
  }
  if (res.status === 401 && !path.startsWith('/auth/')) { signedOut(); throw new ApiError(401, 'unauthorized'); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, j.error || j.code); } // ours, or Better Auth's
  return res.status === 204 ? null : res.json();
}
const fromSnapshot = s => ({ id: s.trip.id, name: s.trip.name, members: s.members, stops: s.stops });

// Writes show at once and save in the background. If one fails, reload the trip so the screen
// matches what's saved.
async function save(req, msg = "Couldn't save. Check your connection.") {
  try { return await req; } catch (e) {
    if (e.status === 401) return;
    toast(msg);
    if (cur && !cur.error) reloadTrip();
  }
}
// Stop writes in flight, per stop. My own live echoes for these are skipped, and the server's copy
// is applied only once the last write lands, so a quick second edit isn't undone by the first reply.
const pendingStops = new Map();
async function writeStop(tripId, id, req) {
  pendingStops.set(id, (pendingStops.get(id) || 0) + 1);
  const saved = await save(req);
  const left = (pendingStops.get(id) || 1) - 1;
  if (left) pendingStops.set(id, left); else pendingStops.delete(id);
  if (saved && !left && openTripOf(tripId)) { upsertLocal(saved); scheduleRender(); }
}
// The open trip, if it's still this one: a sheet or notice may outlive a reload or a trip change.
const openTripOf = id => (cur?.id === id && cur.stops ? cur : null);
function upsertLocal(stop) {
  const i = cur.stops.findIndex(s => s.id === stop.id);
  if (i < 0) cur.stops.push(stop); else cur.stops[i] = stop;
}

const stopsOf = trip => [...trip.stops].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));

// ---------- Days: the trip screen shows one day at a time ----------
const dayOf = s => s.time.slice(0, 10);
function addDays(day, n) { const d = toDate(day); d.setDate(d.getDate() + n); return toInput(d).slice(0, 10); }
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const samePlace = (a, b) => a.lat === b.lat && a.lng === b.lng;

// Hotels are stays, not just stops: you check in, sleep there, and start the next morning from there.
// A hotel lasts its nights; left unset, it lasts until the next hotel, or the trip's last day.
function staysOf(trip) {
  const stops = stopsOf(trip), hotels = stops.filter(s => kindOf(s) === 'hotel');
  const lastDay = stops.length ? dayOf(stops.at(-1)) : null;
  return hotels.map((s, i) => {
    const until = hotels[i + 1] ? dayOf(hotels[i + 1]) : lastDay;
    const nights = s.nights >= 1 ? s.nights : Math.max(1, daysBetween(dayOf(s), until));
    return { s, nights, checkIn: dayOf(s), checkOut: addDays(dayOf(s), nights) };
  });
}
// The stay you sleep at on the night of `day`, if any.
const stayOnNight = (trip, day) => staysOf(trip).find(st => st.checkIn <= day && day < st.checkOut);
// Trip days: every day with a stop, plus every day of a stay up to check-out.
function daysOf(trip) {
  const days = new Set(stopsOf(trip).map(dayOf));
  for (const st of staysOf(trip)) for (let d = st.checkIn; d <= st.checkOut; d = addDays(d, 1)) days.add(d);
  return [...days].sort();
}
// Is today one of the trip's days? Then the trip opens on today, with what's happening now highlighted.
function onTrip(trip) {
  const days = daysOf(trip), today = nowStamp().slice(0, 10);
  return days.length > 0 && today >= days[0] && today <= days.at(-1);
}
// Today on a trip day, else the first day. If the day's stops are gone (deleted, moved), the next day that has some.
function currentDay(trip) {
  const days = daysOf(trip);
  if (!days.length) return null;
  if (!state.day) state.day = onTrip(trip) ? nowStamp().slice(0, 10) : days[0];
  if (!days.includes(state.day)) state.day = days.find(d => d > state.day) || days.at(-1);
  return state.day;
}
const dayStops = (trip, day) => stopsOf(trip).filter(s => dayOf(s) === day);

// A day as you'll live it: wake up at last night's hotel, the day's stops, then back to tonight's hotel.
// Each entry is a place with a role. With no hotel the night before, the day starts from the day before's last stop.
function dayPlan(trip, day) {
  const stops = dayStops(trip, day), plan = [];
  const morning = stayOnNight(trip, addDays(day, -1));
  if (morning) plan.push({ key: `wake:${morning.s.id}:${day}`, place: morning.s, role: morning.checkOut === day ? 'checkout' : 'wake' });
  else {
    const prev = stopsOf(trip).filter(s => dayOf(s) < day).at(-1);
    if (prev && stops.length) plan.push({ key: `from:${prev.id}:${day}`, place: prev, role: 'from' });
  }
  for (const s of stops) plan.push({ key: s.id, place: s, role: 'stop' });
  const night = stayOnNight(trip, day);
  if (night && plan.at(-1)?.place !== night.s) plan.push({ key: `night:${night.s.id}:${day}`, place: night.s, role: 'night' });
  return plan;
}
// The day's drives, between consecutive places in the plan. Arrival is the next stop's time; you leave that long before it.
// The drive back to the hotel has no times: the day's last stop has no end.
function dayLegs(trip, day) {
  const plan = dayPlan(trip, day), legs = [];
  for (let i = 1; i < plan.length; i++) {
    const a = plan[i - 1], b = plan[i];
    if (samePlace(a.place, b.place)) continue;
    const r = getRoute(a.place, b.place);
    const arrive = b.role === 'stop' ? b.place.time : null;
    const leave = arrive && r ? toInput(new Date(toDate(arrive) - r.duration * 1000)) : null;
    legs.push({ key: b.key, from: a.place, to: b.place, fromEntry: a, toEntry: b, r, arrive, leave });
  }
  return legs;
}

// ---------- Stop types: an icon each, and a color per group, shared by the list marker and the map pin ----------
// The colors skip blue (routes) and red (a drive that doesn't fit). Keep the keys in sync with KINDS in src/trip.ts.
const KINDS = {
  place: { label: 'Place', icon: 'pin', group: 'place' },
  airport: { label: 'Airport', icon: 'plane', group: 'travel' },
  hotel: { label: 'Hotel', icon: 'bed', group: 'stay' },
  restaurant: { label: 'Restaurant', icon: 'utensils', group: 'food' },
  cafe: { label: 'Café', icon: 'cup', group: 'food' },
  attraction: { label: 'Attraction', icon: 'star', group: 'sight' },
  museum: { label: 'Museum', icon: 'museum', group: 'sight' },
  viewpoint: { label: 'Viewpoint', icon: 'camera', group: 'sight' },
  nature: { label: 'Nature', icon: 'tree', group: 'nature' },
  shopping: { label: 'Shopping', icon: 'bag', group: 'shop' },
  gas: { label: 'Gas', icon: 'fuel', group: 'travel' },
};
// A first guess from the place's name, and from its category when it came from search
// (OpenStreetMap's "tourism:museum" in local dev, Stadia's "accommodation" or "food" in production).
function guessKind(name = '', cat = '') {
  const is = (tags, words) => tags.test(cat) || words.test(name);
  if (is(/aerodrome|airport|transport:air/, /airport|\bintl\b/i)) return 'airport';
  if (is(/hotel|motel|hostel|guest_house|camp_site|chalet|accommodation/, /hotel|\binn\b|motel|lodge|resort|hostel/i)) return 'hotel';
  if (is(/cafe|coffee/, /caf[eé]|coffee|bakery/i)) return 'cafe';
  if (is(/restaurant|fast_food|food_court|:bar|:pub|\bfood\b|nightlife/, /restaurant|grill|diner|bistro|pizz|taco|bbq|kitchen/i)) return 'restaurant';
  if (is(/museum|gallery/, /museum|gallery/i)) return 'museum';
  if (is(/viewpoint/, /viewpoint|overlook|lookout|vista/i)) return 'viewpoint';
  if (is(/fuel|gas_station/, /\bgas\b|fuel/i)) return 'gas';
  if (is(/natural|:park|nature_reserve|beach|peak|recreation/, /park|trail|boardwalk|forest|lake|canyon|dunes|beach|falls/i)) return 'nature';
  if (is(/shop|mall|marketplace|retail/, /mall|market|outlet|shop/i)) return 'shopping';
  if (is(/attraction|theme_park|zoo|historic|monument|entertainment/, /visitor center|monument|memorial|zoo|castle/i)) return 'attraction';
  return 'place';
}
// Untyped stops are guessed from the name; a bare town with "Lunch" in its note is a meal.
const kindOf = s => (KINDS[s.kind] ? s.kind : guessKind(s.name) !== 'place' ? guessKind(s.name) : /\b(breakfast|brunch|lunch|dinner)\b/i.test(s.note || '') ? 'restaurant' : 'place');
const kindColor = s => `var(--wt-kind-${KINDS[kindOf(s)].group})`;
const kindIcon = (s, size = 16) => WaythreadIcons.svg(KINDS[kindOf(s)].icon, size);

// ---------- Session ----------
async function boot() {
  [config, me] = await Promise.all([api('/config').catch(() => config), api('/me').catch(() => null)]);
  render();
  const msg = socialErrorMessage();
  if (msg) toast(msg);
}
function signedOut() {
  me = null; trips = null;
  closeTrip();
  closeSheet();
  render();
}
async function signOut() {
  if (me.isGuest && !confirm('You’re a guest, so signing out loses your trips on this device. Sign out anyway?')) return;
  await api('/auth/sign-out', { method: 'POST', body: {} }).catch(() => {});
  location.hash = '#/';
  signedOut();
}
// Come back to the same screen (a share link, say) after Google, whether it worked or not.
const callbackURL = () => location.pathname + location.hash;
async function signInSocial(provider) {
  try {
    const { url } = await api('/auth/sign-in/social', { method: 'POST', body: { provider, callbackURL: callbackURL(), errorCallbackURL: callbackURL() } });
    location.href = url;
  } catch (err) { toast(failMsg(err, 'Sign-in is unavailable right now.')); }
}
// Better Auth returns a failed provider sign-in as ?error=…; say what happened, then tidy the address.
// An existing password account isn't joined to Google automatically, since its email was never verified.
function socialErrorMessage() {
  const code = params.get('error');
  if (!code) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  if (code === 'access_denied') return null; // they cancelled
  if (code === 'account_not_linked' || code === 'unable_to_link_account') return 'This email already has a Waythread password. Use Continue with email to sign in.';
  return 'Couldn’t sign in with Google. Try again.';
}

// ---------- Routes: only the line and drive time; navigation is handed to the maps app ----------
const routes = (() => { try { return JSON.parse(localStorage.getItem(ROUTE_KEY)) || {}; } catch { return {}; } })();
// One lookup at a time, so opening a trip doesn't burst the router. Drives the screen needs go first; the other
// days' drives (preloaded so switching days is instant) wait behind them and go slowly, so a trip opened for the
// first time can't use up the per-person limit that place search shares with routes.
const BG_ROUTE_GAP = 1000; // ms between background lookups: at most 60 a minute, half the server's limit
const pending = new Map(); // key → job
const routeJobs = [];
const bgRouteFailed = new Set(); // not retried in the background this visit; retried once its day is on screen
let routeBusy = false, bgRouteNext = 0, bgRouteTimer = 0;
const legKey = (a, b) => `${(+a.lng).toFixed(5)},${(+a.lat).toFixed(5)};${(+b.lng).toFixed(5)},${(+b.lat).toFixed(5)}`;
function haversine(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function getRoute(a, b, { background = false } = {}) {
  const k = legKey(a, b);
  if (routes[k]) return routes[k];
  if (a.lat === b.lat && a.lng === b.lng) return { ok: true, duration: 0, distance: 0, coords: [[a.lat, a.lng]] };
  if (background && bgRouteFailed.has(k)) return null;
  const job = pending.get(k);
  if (!job) {
    const j = { a, b, k, background };
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
async function fetchRoute(job) {
  const { a, b, k } = job;
  try {
    const rt = await api(`/route?from=${a.lat},${a.lng}&to=${b.lat},${b.lng}`);
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
      routes[k] = { ok: false, duration: d / 22, distance: d, coords: [[a.lat, a.lng], [b.lat, b.lng]] };
    }
  }
  pending.delete(k);
  if (!job.background) scheduleRender(); // a preloaded route shows once its day does
}
// Leaving a trip drops its preloading; a lookup the screen asked for still finishes.
function dropBackgroundRoutes() {
  for (let i = routeJobs.length - 1; i >= 0; i--) {
    if (routeJobs[i].background) { pending.delete(routeJobs[i].k); routeJobs.splice(i, 1); }
  }
  bgRouteFailed.clear();
}
// Directions open in the phone's own maps app: Apple Maps on iOS, Google Maps everywhere else.
const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
function directionsURL(from, to) {
  return IS_APPLE
    ? `https://maps.apple.com/?saddr=${from.lat},${from.lng}&daddr=${to.lat},${to.lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
}

// ---------- Trips ----------
let tripLoad = null; // the id being fetched, so a slow reply for a trip you've left is dropped
async function openTrip(id) {
  tripLoad = id;
  let next;
  try { next = fromSnapshot(await api(`/trips/${id}`)); } catch (e) { next = { id, error: e.code || 'offline' }; }
  if (tripLoad !== id) return;
  tripLoad = null;
  cur = next;
  if (!cur.error) connectLive(id);
  render();
}
async function reloadTrip() {
  const id = cur?.id;
  if (!id) return;
  try {
    const next = fromSnapshot(await api(`/trips/${id}`));
    if (cur?.id === id) { cur = next; scheduleRender(); }
  } catch (e) {
    if (cur?.id === id && ['gone', 'not_member', 'not_found'].includes(e.code)) { closeTrip(); cur = { id, error: e.code }; render(); }
  }
}
function closeTrip() {
  disconnectLive();
  cur = null;
  tripLoad = null;
  pendingStops.clear();
}
async function loadTrips() {
  try { trips = await api('/trips'); } catch { trips = trips || []; }
  if (parseHash().page === 'home' && me) render();
}
let joining = null;
async function join(token) {
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

// ---------- Live edits from co-editors ----------
let live = null, liveTimer = 0, liveTries = 0;
function connectLive(id) {
  disconnectLive();
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/trips/${id}/live`);
  let ping = 0;
  live = ws;
  ws.onopen = () => {
    if (liveTries) reloadTrip(); // catch up on edits made while disconnected
    liveTries = 0;
    ping = setInterval(() => ws.send('ping'), 30000);
  };
  ws.onmessage = e => { if (e.data !== 'pong') onEvent(JSON.parse(e.data)); };
  ws.onclose = e => {
    clearInterval(ping);
    if (live !== ws) return; // closed on purpose or replaced
    live = null;
    if (e.code === 4410) return; // the trip was deleted
    liveTimer = setTimeout(() => { if (cur?.id === id) connectLive(id); }, Math.min(30000, 1000 * 2 ** liveTries++));
  };
}
function disconnectLive() {
  clearTimeout(liveTimer);
  const ws = live;
  live = null;
  ws?.close();
}
// Phones drop sockets while asleep; reconnect as soon as the app is back on screen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cur?.stops && !live) { liveTries = Math.max(liveTries, 1); connectLive(cur.id); }
});

function onEvent(m) {
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

// ---------- Routing (hash) ----------
function parseHash() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  if (p[0] === 'trip' && p[1]) return { page: 'trip', id: decodeURIComponent(p[1]) };
  if (p[0] === 'join' && p[1]) return { page: 'join', token: p[1] };
  return { page: 'home' };
}
// setTimeout rather than rAF: rAF is paused in background tabs, and co-editors' changes should land there too
let renderTimer = 0;
function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 16); }

const messageHTML = msg => `<p class="wt-empty">${esc(msg)} <a href="#/">All trips</a></p>`;
const TRIP_ERRORS = {
  not_member: 'You’re not on this trip. Ask someone on it to send you the link.',
  not_found: 'This trip doesn’t exist.',
  gone: 'This trip was deleted.',
  offline: 'Couldn’t load this trip. Check your connection.',
};

function render() {
  const r = parseHash();
  document.title = 'Waythread';
  if (!me) { closeTrip(); teardownTrip(); $app.dataset.page = 'signin'; renderSignIn(r); return; }
  if (r.page === 'join') { teardownTrip(); join(r.token); return; }
  if (r.page !== 'trip') {
    if (cur) closeTrip();
    teardownTrip();
    if (trips === null) loadTrips();
    $app.dataset.page = 'home';
    $app.innerHTML = homeHTML();
    return;
  }
  trips = null; // the home list reloads on the way back
  if (cur?.id !== r.id) {
    if (tripLoad === r.id) return;
    closeTrip();
    teardownTrip();
    $app.dataset.page = 'trip';
    $app.innerHTML = '';
    openTrip(r.id);
    return;
  }
  const trip = cur;
  if (trip.error) { teardownTrip(); $app.dataset.page = 'message'; $app.innerHTML = messageHTML(TRIP_ERRORS[trip.error] || TRIP_ERRORS.offline); return; }
  if ($app.dataset.trip !== trip.id) mountTrip(trip);
  document.title = `${trip.name} · Waythread`;
  const el = $app.querySelector('.trip');
  el.querySelector('.wt-trip-head__name').textContent = trip.name;
  const bar = el.querySelector('.wt-day-bar');
  const topH = el.querySelector('.wt-sheet__top').offsetHeight;
  bar.innerHTML = dayBarHTML(trip);
  bar.hidden = !trip.stops.length;
  renderList(trip);
  renderAddBar(trip);
  if (!el.querySelector('.wt-sheet').style.height || topH !== el.querySelector('.wt-sheet__top').offsetHeight) applySnap();
  for (const id of state.flash) el.querySelector(`.wt-tl-stop[data-id="${id}"]`)?.classList.add('is-flash');
  state.flash.clear();
  drawMap(trip);
  updateFitBtn();
  schedulePreload();
}

// ---------- Sign in ----------
/* One choice per screen. Start: Google, email, or guest. The email step asks only for the address,
   then goes where it leads: the password for an existing account, "use Google" for a Google account,
   or a new account. A guest gives only a name. The same steps run in the Account sheet when a guest
   saves their trips (without the guest option, and without asking their name again). */
let invite = { token: null, name: null };
function renderSignIn(r) {
  const joining = r.page === 'join';
  $app.innerHTML = `
    <header class="home-head"><h1 class="signin-title">${joining ? esc(invite.token === r.token && invite.name ? `Join ${invite.name}` : 'Join the trip') : 'Waythread'}</h1></header>
    <main class="signin"></main>`;
  authFlow($app.querySelector('.signin'), { joining, guest: true });
  if (joining && invite.token !== r.token) {
    invite = { token: r.token, name: null };
    api(`/invite/${encodeURIComponent(r.token)}`).then(({ name }) => {
      invite.name = name;
      const h = $app.querySelector('.signin-title');
      if (h && parseHash().token === r.token) h.textContent = `Join ${name}`;
    }, () => {});
  }
}

// Google's mark, in its own colors as Google's sign-in guidelines ask; the only colored icon in the app.
const GOOGLE_MARK = '<svg class="wt-icon" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const googleBtnHTML = `<button type="button" class="wt-btn wt-btn--secondary wt-btn--block" data-action="social" data-provider="google">${GOOGLE_MARK}Continue with Google</button>`;
const appleBtnHTML = '<button type="button" class="wt-btn wt-btn--secondary wt-btn--block" data-action="social" data-provider="apple">Continue with Apple</button>';
// A password field with a Show button, so a typo is easy to spot on a phone keyboard
const passwordHTML = (autocomplete, placeholder) => `<div class="signin__pw">
  <input class="wt-input" name="password" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" ${autocomplete === 'new-password' ? 'minlength="8"' : ''} maxlength="128" required aria-label="Password">
  <button type="button" class="signin__show" data-show aria-label="Show password">Show</button></div>`;
// Password managers pair a password with the address it belongs to
const usernameHTML = email => `<input class="wt-visually-hidden" type="email" name="username" autocomplete="username" value="${esc(email)}" tabindex="-1" aria-hidden="true">`;

// Better Auth's codes (and ours), in words
const AUTH_ERRORS = {
  INVALID_EMAIL_OR_PASSWORD: 'That password isn’t right.',
  INVALID_EMAIL: 'That email address doesn’t look right.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  invalid: 'That email address doesn’t look right.',
};

function authFlow(root, { joining = false, guest = false } = {}) {
  const s = { step: 'start', email: '' };
  const head = (title, back) => `<div class="signin__head">
    <button type="button" class="wt-icon-btn signin__back" data-to="${back}" aria-label="Back">${ICON.back}</button>
    <h2 class="signin__title">${title}</h2></div>`;
  const emailLine = () => `<p class="signin__text">${esc(s.email)} · <button type="button" class="signin__link" data-to="email">Change</button></p>`;
  const errorHTML = '<p class="signin__error" role="alert" hidden></p>';
  const STEPS = {
    start: () => `
      ${guest ? `<p class="signin__text">${joining ? 'Everyone on the trip can see and edit the plan.' : 'Plan a trip together, in one place.'}</p>` : ''}
      ${config.google ? googleBtnHTML : ''}
      ${config.apple ? appleBtnHTML : ''}
      ${config.password ? '<button type="button" class="wt-btn wt-btn--secondary wt-btn--block" data-to="email">Continue with email</button>' : ''}
      ${guest ? `<button type="button" class="wt-btn wt-btn--ghost wt-btn--block" data-to="guest">${joining ? 'Join as a guest' : 'Continue as a guest'}</button>
      <p class="signin__hint signin__hint--center">No account needed, but you can only reach your trips from this browser.</p>` : ''}`,
    email: () => `${head('Continue with email', 'start')}
      <form data-submit="lookup">
        <input class="wt-input" name="email" type="email" placeholder="you@example.com" autocomplete="email" required aria-label="Email" value="${esc(s.email)}">
        ${errorHTML}<button class="wt-btn wt-btn--primary wt-btn--block">Continue</button></form>`,
    password: () => `${head('Welcome back', 'email')}${emailLine()}
      <form data-submit="sign-in">${usernameHTML(s.email)}
        ${passwordHTML('current-password', 'Password')}
        ${errorHTML}<button class="wt-btn wt-btn--primary wt-btn--block">Sign in</button></form>
      <p class="signin__hint">Forgot it? Password reset isn’t available yet.</p>`,
    'sign-up': () => `${head('Create your account', 'email')}${emailLine()}
      <form data-submit="sign-up">${usernameHTML(s.email)}
        ${me?.isGuest ? '' : '<input class="wt-input" name="name" placeholder="Your name" autocomplete="name" maxlength="40" required aria-label="Your name">'}
        ${passwordHTML('new-password', 'Choose a password')}
        <p class="signin__hint">At least 8 characters.${me?.isGuest ? ' Your trips move to this account.' : ''}</p>
        ${errorHTML}<button class="wt-btn wt-btn--primary wt-btn--block">Create account</button></form>`,
    google: () => `${head('Use Google for this email', 'email')}
      <p class="signin__text">${esc(s.email)} signs in with Google.</p>${googleBtnHTML}`,
    guest: () => `${head(joining ? 'Join as a guest' : 'Continue as a guest', 'start')}
      <form data-submit="guest">
        <input class="wt-input" name="name" placeholder="Your name" autocomplete="given-name" maxlength="40" required aria-label="Your name">
        <p class="signin__hint">Others on the trip see this name.</p>
        ${errorHTML}<button class="wt-btn wt-btn--primary wt-btn--block">${joining ? 'Join the trip' : 'Continue'}</button></form>`,
  };
  const go = (step, patch) => {
    Object.assign(s, patch, { step });
    root.innerHTML = STEPS[step]();
    if (step !== 'start') root.querySelector('input:not([tabindex="-1"])')?.focus();
  };
  // Signed in: a guest who saved their trips lands back where they were, now with an account
  const done = async msg => {
    me = await api('/me');
    trips = null;
    closeSheet();
    render();
    if (msg) toast(msg);
  };
  // Shown under the form; thrown by a step to explain something that isn't an API error
  const say = message => Object.assign(new Error(message), { local: true });
  const ACTIONS = {
    lookup: async F => {
      const email = F.email.value.trim();
      const { account } = await api('/sign-in-options', { method: 'POST', body: { email } });
      go(account === 'password' ? 'password' : account === 'none' ? 'sign-up' : 'google', { email });
    },
    'sign-in': async F => {
      const wasGuest = me?.isGuest;
      await api('/auth/sign-in/email', { method: 'POST', body: { email: s.email, password: F.password.value } });
      await done(wasGuest ? 'Signed in. Your trips are saved to your account.' : null);
    },
    'sign-up': async F => {
      const wasGuest = me?.isGuest;
      const name = wasGuest ? me.name : F.name.value.trim();
      try {
        await api('/auth/sign-up/email', { method: 'POST', body: { email: s.email, password: F.password.value, name } });
      } catch (err) {
        // The account appeared a moment ago (another tab?): ask for its password instead
        if (err.code?.startsWith('USER_ALREADY_EXISTS')) { go('password'); throw say('You already have an account. Enter its password.'); }
        throw err;
      }
      await done(wasGuest ? 'Account created. Your trips are saved to it.' : null);
    },
    guest: async F => {
      // A guest session may already exist from an attempt that failed halfway; reuse it rather than
      // asking for another, which Better Auth refuses.
      if (!(await api('/auth/get-session'))) await api('/auth/sign-in/anonymous', { method: 'POST', body: {} });
      await api('/auth/update-user', { method: 'POST', body: { name: F.name.value.trim() } });
      await done();
    },
  };
  root.onclick = e => {
    const to = e.target.closest('[data-to]')?.dataset.to;
    if (to) return go(to);
    const show = e.target.closest('[data-show]');
    if (show) {
      const input = show.previousElementSibling, hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      show.textContent = hidden ? 'Hide' : 'Show';
      show.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
      input.focus();
    }
  };
  root.onsubmit = async e => {
    e.preventDefault();
    const f = e.target, submit = f.querySelector('button:not([type])');
    submit.disabled = true;
    f.querySelector('.signin__error').hidden = true;
    try { await ACTIONS[f.dataset.submit](f.elements); } catch (err) {
      // The step may have changed (sign-up → password); explain on whatever form is showing now
      const box = root.querySelector('.signin__error');
      if (box) { box.textContent = err.local ? err.message : AUTH_ERRORS[err.code] || failMsg(err, 'Couldn’t sign in.'); box.hidden = false; }
      const btn = root.querySelector('form button:not([type])');
      if (btn) btn.disabled = false;
    }
  };
  go('start');
}

// ---------- Home ----------
function homeHTML() {
  return `
    <header class="home-head"><h1>Waythread</h1>
      <button class="wt-icon-btn" data-action="account" aria-label="Account">${avatarHTML({ name: me.name, identity: 1 })}</button></header>
    <main class="home">
      ${(trips || []).map(t => `<a class="wt-trip-card" href="#/trip/${esc(t.id)}"><span class="wt-trip-card__name">${esc(t.name)}</span><span class="wt-trip-card__dates">${fmtRange(t.start, t.end)}</span></a>`).join('')}
      <button class="wt-btn wt-btn--primary wt-btn--block" data-action="new-trip">${ICON.plus}New trip</button>
      ${me.isGuest && trips?.length && canSignIn() ? '<button class="wt-btn wt-btn--ghost wt-btn--block home-guest" data-action="account">Sign in to keep your trips</button>' : ''}
    </main>`;
}

// ---------- Trip screen: map + one day of the plan ----------
// Stadia answers a domain it doesn't know with a "401" picture instead of an error, which Leaflet
// can't tell from a real tile; ask once per visit whether it will serve this site.
let stadiaCheck = null;
const stadiaServes = () => (stadiaCheck ??= fetch('https://tiles.stadiamaps.com/tiles/alidade_smooth/0/0/0.png').then(r => r.ok, () => false));
let map = null, layer = null, fitKey = '';
let camPlaced = false; // the new map has been framed once: its first framing is placed, not flown to
let camTarget = null; // where the camera is flying, and until when
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let camMoving = false, drawPending = false; // the camera is flying, or Leaflet is scaling the map for a zoom (a wheel, a double tap, a pinch)
// The map's credits live in trip settings rather than over the map.
const CREDIT = {
  stadia: '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  osm: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
let mapCredit = CREDIT.stadia;
// Leaflet fetches only the tiles in view, so a zoom waits on a whole fresh set and a pan shows blank edges.
// This layer also loads a ring of tiles around the view, and once the view's tiles are in, it fetches the
// next zoom level in (where a zoom-in lands) and the one out (a quarter as many) so the browser has them cached.
// Stadia tiles only. Skipped when the browser asks to save data. `_getTiledPixelBounds` is Leaflet-internal: check it on upgrade.
// The trip's other days are preloaded too (see preloadTrip), behind these and a few tiles at a time.
const EDGE_TILES = 1;
const PREFETCH_ZOOMS = [1, -1];
const TILE_PRELOAD_PARALLEL = 4;
const fetchedTiles = new Set(); // asked for once per visit; after that the browser's cache has them
let tileQueue = [], tilesInFlight = 0;
function pumpTiles() {
  while (tilesInFlight < TILE_PRELOAD_PARALLEL && tileQueue.length) {
    const img = new Image();
    tilesInFlight++;
    img.onload = img.onerror = () => { tilesInFlight--; pumpTiles(); };
    img.src = tileQueue.shift();
  }
}
function bufferedTileLayer(url, opts) {
  const t = L.tileLayer(url, { keepBuffer: 4, ...opts });
  const inView = t._getTiledPixelBounds;
  t._getTiledPixelBounds = function (center) {
    const b = inView.call(this, center), pad = this.getTileSize().multiplyBy(EDGE_TILES);
    return L.bounds(b.min.subtract(pad), b.max.add(pad));
  };
  // Every tile under pixel bounds `b` at zoom `z`: now, or with `later`, queued behind everything else
  t.prefetchArea = (b, z, later = false) => {
    if (z < t.options.minZoom || z > t.options.maxZoom) return;
    const size = t.getTileSize(), n = 2 ** z;
    const lo = b.min.unscaleBy(size).floor(), hi = b.max.unscaleBy(size).ceil();
    for (let y = Math.max(lo.y, 0); y < Math.min(hi.y, n); y++) {
      for (let x = lo.x; x < hi.x; x++) {
        const src = L.Util.template(url, { ...t.options, r: L.Browser.retina ? '@2x' : '', x: ((x % n) + n) % n, y, z });
        if (fetchedTiles.has(src)) continue;
        fetchedTiles.add(src);
        if (later) tileQueue.push(src); else new Image().src = src;
      }
    }
    if (later) pumpTiles();
  };
  t.on('load', () => {
    const m = t._map;
    if (!m || navigator.connection?.saveData) return;
    const z0 = Math.round(m.getZoom()), view = m.getBounds();
    for (const dz of PREFETCH_ZOOMS) {
      const z = z0 + dz;
      // A zoom in centers on the pointer or pinch, so cover the whole view; a zoom out shows a view-sized area around the center
      t.prefetchArea(dz > 0 ? L.bounds(m.project(view.getNorthWest(), z), m.project(view.getSouthEast(), z)) : m.getPixelBounds(m.getCenter(), z), z);
    }
  });
  return t;
}
let tiles = null; // the Stadia layer, when it's the one showing: the OpenStreetMap fallback isn't preloaded

// ---------- Preloading the trip's other days ----------
// Once the day on screen has settled, load every other day's drives and the map tiles where its camera will land,
// nearest days first, so stepping to another day shows its routes and map at once.
// Tiles are only the part of the view you can see (not under the list), at the day's zoom.
let preloadTimer = 0;
function schedulePreload() { clearTimeout(preloadTimer); preloadTimer = setTimeout(preloadTrip, 1500); }
function preloadTrip() {
  const trip = cur?.stops ? cur : null;
  if (!map || !trip || $app.dataset.trip !== trip.id) return;
  const d0 = currentDay(trip);
  if (!d0) return;
  // the next day, then the one before, then outward
  const dist = d => Math.abs(daysBetween(d0, d)) * 2 - (d > d0 ? 1 : 0);
  const days = daysOf(trip).filter(d => d !== d0).sort((a, b) => dist(a) - dist(b));
  for (const d of days) {
    const plan = dayPlan(trip, d);
    for (let i = 1; i < plan.length; i++) getRoute(plan[i - 1].place, plan[i].place, { background: true });
  }
  // the camera depends on how much of the map the open stop covers; wait until it's closed
  if (!tiles || navigator.connection?.saveData || state.draft) return;
  if (tiles.isLoading()) { tiles.once('load', schedulePreload); return; } // the day on screen comes first
  const size = map.getSize(), shown = L.point(size.x, size.y - coveredBottom());
  if (shown.x <= 0 || shown.y <= 0) return;
  for (const d of days) {
    const v = dayView(trip, d);
    if (!v) continue;
    const z = Math.round(v.zoom), c = map.project(v.center, z), tl = c.subtract(size.divideBy(2));
    tiles.prefetchArea(L.bounds(tl, tl.add(shown)), z, true);
  }
}

function teardownTrip() {
  if (map) { map.remove(); map = null; layer = null; fitKey = ''; }
  tiles = null;
  tileQueue = [];
  clearTimeout(preloadTimer);
  clearTimeout(mapTapTimer);
  dayShown = false;
  dropBackgroundRoutes();
  const left = $app.dataset.trip;
  delete $app.dataset.trip;
  state.sel = state.selRow = state.leg = state.hoverLeg = state.day = state.draft = null;
  state.snap = 'half';
  camFree = false;
  // the stop sheet leaves the header in reach, so Home can be tapped while it's open
  if (left && $sheets.innerHTML) closeSheet();
}
function mountTrip(trip) {
  teardownTrip();
  $app.dataset.trip = trip.id;
  $app.dataset.page = 'trip';
  // The plan is the page: a header with the trip's name, the map, and a sheet with one day of the plan.
  // On a phone the header spans the top and the sheet is half or all of the screen below it, with Map/List in
  // the header to switch. On a wide screen the header and the sheet are a side panel next to the map.
  $app.innerHTML = `<div class="trip">
    <header class="wt-trip-head">
      <a class="wt-icon-btn" href="#/" aria-label="All trips">${ICON.home}</a>
      <h1 class="wt-trip-head__name"></h1>
      <button class="wt-icon-btn" data-action="settings" aria-label="Trip settings and sharing">${ICON.settings}</button>
    </header>
    <div id="map"></div>
    <button class="wt-icon-btn wt-map-btn trip-fit" data-action="fit-day" aria-label="Show the whole day on the map" title="Whole day" hidden>${ICON.fit}</button>
    <section class="wt-sheet" aria-label="Plan">
      <div class="wt-sheet__top">
        <button class="wt-sheet__grab" data-action="grab"></button>
        <div class="wt-day-bar" hidden></div>
      </div>
      <div class="wt-sheet__body wt-tl"></div>
      <div class="wt-add-bar"></div>
    </section>
  </div>`;
  const list = $app.querySelector('.wt-sheet__body');
  list.addEventListener('scroll', updateFades, { passive: true });
  new ResizeObserver(updateFades).observe(list); // the sheet changing height
  if (!window.L) return;
  // double-tap zoom is our own (see mapGestures), so it works over routes and pins too
  map = L.map($app.querySelector('#map'), { zoomControl: false, attributionControl: false, doubleClickZoom: false }).setView([32.6, -106.1], 8);
  camPlaced = false;
  camTarget = null;
  camMoving = drawPending = false;
  // Pins and routes drawn while the camera moves aren't placed where the moving map is: during Leaflet's zoom
  // animation a new pin sits at the end of the move while the map is still getting there, and during a flight a
  // new route is drawn at the wrong scale. drawMap waits for the move to end.
  map.on('zoomanim', () => { camMoving = true; });
  map.on('moveend', () => {
    camMoving = false;
    if (drawPending && cur?.stops) { drawPending = false; drawMap(cur); }
  });
  // A quiet basemap so routes lead. Stadia needs no key on localhost; in production, register the
  // domain with Stadia. Fall back to OpenStreetMap if it's refused.
  const m = map, dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const osm = () => {
    // No prefetch here: OpenStreetMap's tile policy discourages loading tiles nobody looks at
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    mapCredit = CREDIT.osm;
    $app.querySelector('.trip')?.classList.add('osm-tiles');
  };
  stadiaServes().then(ok => {
    if (map !== m) return; // left the trip meanwhile
    if (!ok) return osm();
    mapCredit = CREDIT.stadia;
    const quiet = bufferedTileLayer(`https://tiles.stadiamaps.com/tiles/alidade_smooth${dark ? '_dark' : ''}/{z}/{x}/{y}{r}.png`, { maxZoom: 20 }).addTo(m);
    tiles = quiet;
    quiet.once('tileerror', () => { m.removeLayer(quiet); tiles = null; tileQueue = []; osm(); });
    schedulePreload();
  });
  layer = L.layerGroup().addTo(map);
  // once you've touched the map, a new sheet height leaves the camera where you put it
  map.getContainer().addEventListener('pointerdown', () => { camFree = true; });
  // Zooming the map is looking at the map: the list gets out of the way, down to its peek.
  // A wheel doesn't fire pointerdown; without this, the re-frame for the new height would fight the zoom you asked for.
  const zooming = () => { camFree = true; if (!state.draft && state.snap === 'half' && !isWide()) setSnap('peek'); };
  map.getContainer().addEventListener('wheel', zooming, { passive: true });
  map.getContainer().addEventListener('touchstart', e => { if (e.touches.length > 1) zooming(); }, { passive: true });
  mapGestures(map, zooming);
  // Tapping empty map clears the selection; a route's preview goes back to the whole day.
  // While a stop is open, the map is there to look at, so taps leave everything as it is.
  map.on('click', () => onMapTap(() => {
    if (state.draft || (!state.sel && !state.leg)) return;
    if (state.leg) fitKey = '';
    state.sel = state.selRow = state.leg = null;
    render();
  }));
  map.on('moveend', () => { dayShown = dayFramed(); updateFitBtn(); });
}

// ---------- Map gestures, as in a maps app ----------
// Double-tap (or double-click) zooms in a step around that spot, anywhere on the map. Leaflet's own double-click zoom
// misses routes and pins, which keep their taps to themselves, and they're what you'd want a closer look at.
// The first tap still does what a tap does; the second only zooms. Shift-double-click zooms out.
// A two-finger tap zooms out a step, around the fingers.
const DOUBLE_TAP_MS = 300, DOUBLE_TAP_PX = 32, TAP_SLOP_PX = 10;
let mapTapTimer = 0;
// A tap on the map, a pin or a route waits out a double-tap's second tap before it acts, as in a maps app: picking a pin
// or a route, or clearing one, can move the camera, and the second tap would then zoom somewhere else.
function onMapTap(fn) {
  clearTimeout(mapTapTimer);
  const m = map;
  mapTapTimer = setTimeout(() => { if (map === m) fn(); }, DOUBLE_TAP_MS);
}
function mapGestures(m, zooming) {
  const el = m.getContainer();
  let down = null, last = null, two = null;
  el.addEventListener('pointerdown', e => { if (e.isPrimary) down = { x: e.clientX, y: e.clientY }; }, true);
  // In the capture phase, so the second tap can be kept from the pin, route or map under it
  el.addEventListener('click', e => {
    if (!e.detail) return; // a keyboard "click"
    // the end of a pan isn't a tap
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_SLOP_PX) { last = null; return; }
    const p = m.mouseEventToContainerPoint(e), now = performance.now();
    if (!last || now - last.t > DOUBLE_TAP_MS || p.distanceTo(last.p) > DOUBLE_TAP_PX) { last = { t: now, p }; return; }
    last = null;
    e.stopImmediatePropagation();
    clearTimeout(mapTapTimer);
    m.setZoomAround(p, m.getZoom() + (e.shiftKey ? -1 : 1));
    zooming();
  }, true);
  el.addEventListener('touchstart', e => {
    two = e.touches.length === 2 ? { t: performance.now(), z: m.getZoom(), at: [...e.touches].map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY })) } : null;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (two && [...e.touches].some(t => { const a = two.at.find(a => a.id === t.identifier); return a && Math.hypot(t.clientX - a.x, t.clientY - a.y) > TAP_SLOP_PX; })) two = null;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!two || e.touches.length) return;
    const [a, b] = two.at;
    if (performance.now() - two.t < DOUBLE_TAP_MS && m.getZoom() === two.z) m.setZoomAround(m.mouseEventToContainerPoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }), two.z - 1);
    two = null;
  });
  el.addEventListener('touchcancel', () => { two = null; });
}

// ---------- Whole day: the map back on the day's route ----------
// A button over the map, once you've moved the map off the day or are looking at one drive, as a maps app's
// route overview button does. It isn't there over the whole-day list, which hides the map, or while a stop is open.
let dayShown = false; // the camera is where dayView puts it for the day on screen
function dayFramed() {
  const trip = cur?.stops ? cur : null, day = trip && currentDay(trip), v = map && day && dayView(trip, day);
  if (!v) return true;
  return Math.abs(map.getZoom() - v.zoom) < 0.01 && map.latLngToContainerPoint(v.center).distanceTo(map.getSize().divideBy(2)) < 3;
}
function updateFitBtn() {
  const btn = $app.querySelector('.trip-fit');
  if (!btn) return;
  const trip = cur?.stops ? cur : null;
  btn.hidden = !map || !trip || !currentDay(trip) || !!state.draft || (!isWide() && state.snap === 'full') || (dayShown && !state.leg);
}
function showWholeDay() {
  state.leg = null;
  fitKey = '';
  render();
}

const timeHTML = t => fmtTime(t).replace(/ (AM|PM)$/, '<span class="wt-tl-meridiem">$1</span>');
const markerHTML = (s, cls) => `<i class="wt-marker ${cls}" role="img" aria-label="${KINDS[kindOf(s)].label}" style="--wt-kind-color: ${kindColor(s)}">${kindIcon(s)}</i>`;

// ---------- Timeline: rail · stop · time. Each stop's marker is its pin on the map: same icon, same color. ----------
const gapMin = (a, b) => (toDate(b.time) - toDate(a.time)) / 60000;
// A drive reads as a sentence ("1 hr 49 min drive"), with a small car on the rail, says when it won't make it,
// and has a Directions icon button. Tapping the row shows the route on the map.
// Rows take `row`: { key, past (over: dimmed), now (happening now: highlighted), sel (the selected row) }.
const rowState = (past, now) => `${past ? ' is-past' : ''}${now ? ' is-now' : ''}`;
function driveItem(day, leg) {
  const { r, from, to, fromEntry, toEntry } = leg, late = lateMin(leg);
  const cls = ['wt-tl-drive', state.leg === leg.key ? 'is-active' : '', late > 0 ? 'is-late' : ''];
  return {
    // when you set off (until the route is in, no earlier than you arrive); the drive back to the hotel has no time, so it comes last
    start: leg.leave || leg.arrive || (toEntry.role === 'night' ? `${day}T23:58` : fromEntry.place.time),
    html: ({ past, now }) => `<div class="${cls.join(' ')}${rowState(past, now)}" data-leg="${esc(leg.key)}" data-action="leg" tabindex="0" role="group" aria-label="${r ? fmtDur(r.duration) : ''} drive to ${esc(to.name)}. Show the route on the map">
      <span class="wt-tl-rail"><i class="wt-tl-car">${ICON.car}</i></span>
      <span class="wt-tl-drive__body">
        <span class="wt-tl-drive__what"><b>${r ? fmtDur(r.duration) : '…'}</b> drive</span>
        ${late > 0 ? `<span class="wt-tl-drive__late">Arrives ${fmtDur(late * 60)} late</span>` : ''}
      </span>
      <a class="wt-icon-btn wt-tl-drive__go" href="${directionsURL(from, to)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(to.name)} in your maps app" title="Directions">${ICON.directions}</a>
    </div>`,
  };
}
// A stop row: marker · name · time, with its notes below across the name and time. A hotel on its check-in day says how many nights.
// A row from another day than the one on screen can say which day in place of the time.
// Tapping it selects it: the row and its pin are highlighted, and Add stop becomes Edit stop. Tapping it again clears that.
function stopRow(s, { key, past, now, sel }, note, time, timeDay) {
  const notes = note.filter(Boolean);
  return `<button class="wt-tl-stop${sel ? ' is-selected' : ''}${rowState(past, now)}" data-action="select" data-id="${esc(s.id)}" data-row="${esc(key)}" aria-pressed="${!!sel}" style="--wt-kind-color: ${kindColor(s)}">
      <span class="wt-tl-rail">${markerHTML(s, 'wt-tl-marker')}</span>
      <span class="wt-tl-name">${esc(s.name)}</span>${notes.length ? `<span class="wt-tl-notes">${notes.map(n => `<span class="wt-tl-note">${esc(n)}</span>`).join('')}</span>` : ''}
      <span class="wt-tl-time">${time ? timeHTML(time) : ''}${timeDay ? `<span class="wt-tl-time__day">${esc(timeDay)}</span>` : ''}</span>
    </button>`;
}
function stopItem(trip, s) {
  const stay = kindOf(s) === 'hotel' && staysOf(trip).find(st => st.s === s);
  const nights = stay && `${stay.nights} ${stay.nights === 1 ? 'night' : 'nights'}`;
  return { start: s.time, html: row => stopRow(s, row, [nights, s.note], s.time) };
}
// The hotel at either end of a day: where you wake up, and where you go back to at night. It has no time,
// except on check-out morning, the one with something to do: `Check out`, at the check-out time. Tapping it selects the hotel.
function hotelItem(day, entry) {
  return {
    start: entry.role === 'night' ? `${day}T23:59` : `${day}T00:00`,
    html: row => stopRow(entry.place, row, [entry.role === 'checkout' && 'Check out'], entry.role === 'checkout' ? `${day}T${checkoutOf(entry.place)}` : null),
  };
}
// With no hotel last night, the day opens where the day before ended: that stop, with `Yesterday` where the time goes
// (or the weekday, when there's a day with no stops in between).
function fromItem(day, entry) {
  const d = dayOf(entry.place), when = d === addDays(day, -1) ? 'Yesterday' : DAYS[toDate(d).getDay()];
  return { start: `${day}T00:00`, html: row => stopRow(entry.place, row, [], null, when) };
}
// The selected stop, if it's still in the trip (a co-editor may have deleted it).
const selectedStop = trip => (state.sel && trip.stops.find(s => s.id === state.sel)) || null;
// Below the list, always in reach: Add stop, or, with a stop selected, Edit stop and a small + so adding stays one tap away.
function addBarHTML(trip) {
  const s = selectedStop(trip);
  return s
    ? `<button class="wt-btn wt-btn--primary wt-btn--block" data-action="edit" data-id="${esc(s.id)}">${ICON.edit}Edit stop</button><button class="wt-btn wt-btn--secondary wt-btn--icon" data-action="add" aria-label="Add stop" title="Add stop">${ICON.plus}</button>`
    : `<button class="wt-btn wt-btn--primary wt-btn--block" data-action="add">${ICON.plus}Add stop</button>`;
}
function renderAddBar(trip) {
  const bar = $app.querySelector('.wt-add-bar'), html = addBarHTML(trip);
  // only when it changes, so a focused button keeps its focus through the minute's re-render
  if (bar.wtHTML !== html) { bar.innerHTML = html; bar.wtHTML = html; }
}
// One day's rows, from the day's plan, each marked `past` or `now`. On today, the row you're in now
// (the latest thing that has started) is now, and everything before it is past; earlier days are past throughout.
// The map dims the same drives and stops.
function dayItems(trip, day) {
  const now = nowStamp(), today = now.slice(0, 10);
  const legs = new Map(dayLegs(trip, day).map(l => [l.key, l]));
  const items = [];
  const plan = dayPlan(trip, day);
  plan.forEach((e, i) => {
    const leg = legs.get(e.key);
    if (leg && !(leg.r && leg.r.distance === 0)) items.push({ leg: leg.key, ...driveItem(day, leg) });
    if (e.role === 'stop') items.push({ entry: e, ...stopItem(trip, e.place) });
    // where you start, unless the day's first stop is the same place
    else if (e.role === 'from') { if (!samePlace(e.place, plan[i + 1].place)) items.push({ entry: e, ...fromItem(day, e) }); }
    else items.push({ entry: e, ...hotelItem(day, e) });
  });
  const cur = day === today ? items.findLastIndex(it => it.start <= now) : -1;
  items.forEach((it, i) => { it.past = day < today || i < cur; it.now = i === cur; });
  return items;
}
function listHTML(trip, day) {
  if (!day) return '<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>';
  const items = dayItems(trip, day);
  if (!items.length) return '<p class="wt-empty">Nothing planned this day yet.</p>';
  // Only one row is selected: the one tapped, or, from a pin, the stop's first row (a hotel can start and end the day)
  const rows = items.filter(it => it.entry?.place.id === state.sel);
  const sel = (rows.find(it => it.entry.key === state.selRow) || rows[0])?.entry.key;
  return items.map(it => it.html({ key: it.entry?.key, past: it.past, now: it.now, sel: !!it.entry && it.entry.key === sel })).join('');
}
// The list fades out at an edge with more of the day past it, so it's clear there are stops to scroll to.
function updateFades() {
  const body = $app.querySelector('.wt-sheet__body');
  if (!body) return;
  body.classList.toggle('is-more-above', body.scrollTop > 1);
  body.classList.toggle('is-more-below', body.scrollTop + body.clientHeight < body.scrollHeight - 1);
}
function renderList(trip) {
  const body = $app.querySelector('.wt-sheet__body'), day = currentDay(trip);
  body.innerHTML = listHTML(trip, day);
  updateFades();
  if (body.dataset.day === day) return;
  // a new day starts at the top, or, on today, at what's happening now, a little above center
  body.dataset.day = day;
  body.scrollTop = 0;
  // after this render sizes the sheet, so the sheet's height is known
  setTimeout(() => {
    const row = body.querySelector('.is-now');
    if (row) body.scrollTop += row.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 3;
  });
}
// Keep the highlight and the dimming current while the trip is open.
setInterval(() => { if ($app.dataset.trip) scheduleRender(); }, 60000);

// ---------- Day bar: ‹ day › to step, or tap the day to pick from all of them ----------
function dayBarHTML(trip) {
  const days = daysOf(trip), d = currentDay(trip), i = days.indexOf(d);
  if (!d) return '';
  return `<button class="wt-icon-btn wt-day-bar__step" data-action="prev-day" aria-label="Previous day"${i > 0 ? '' : ' disabled'}>${ICON.back}</button>
    <button class="wt-day-bar__title" data-action="days" aria-label="${dayName(d)}. Pick a day">
      <span class="wt-day-bar__label">${dayName(d)}${ICON.chevronDown}</span>
    </button>
    <button class="wt-icon-btn wt-day-bar__step" data-action="next-day" aria-label="Next day"${i < days.length - 1 ? '' : ' disabled'}>${ICON.forward}</button>`;
}
// "Today, Nov 21" on today, so it's easy to find your way back to it; otherwise "Sat, Nov 21".
const dayName = d => (d === nowStamp().slice(0, 10) ? `Today, ${fmtDay(d).split(', ')[1]}` : fmtDay(d));
// Every day of the trip, with the icons of its stops and the hotel you sleep at, so you can see what each day holds.
function openDays(trip) {
  const cur = currentDay(trip);
  openSheet(`${modalHead('Days')}
    <ul class="wt-day-list">${daysOf(trip).map(d => {
      const places = [...new Set(dayPlan(trip, d).filter(e => e.role === 'stop' || e.role === 'night').map(e => e.place))];
      return `<li><button class="wt-day-list__item" data-action="pick-day" data-day="${d}"${d === cur ? ' aria-current="date"' : ''}>
        <span class="wt-day-list__name">${dayName(d)}</span>
        <span class="wt-day-list__kinds">${places.slice(0, 6).map(x => markerHTML(x, 'wt-marker--sm')).join('')}</span>
      </button></li>`;
    }).join('')}</ul>`);
}
function setDay(d) {
  const trip = cur?.stops ? cur : null;
  if (!trip || !daysOf(trip).includes(d) || d === state.day) return;
  state.day = d;
  state.sel = state.selRow = state.leg = state.hoverLeg = null;
  render();
}
function stepDay(n) {
  const trip = cur?.stops ? cur : null;
  if (!trip) return;
  const days = daysOf(trip);
  setDay(days[days.indexOf(currentDay(trip)) + n]);
}

// Wide: the plan is a side panel (the design system's wt-trip container query), so there's nothing to snap or drag.
const WIDE = 768;
const isWide = () => ($app.querySelector('.trip')?.clientWidth || 0) >= WIDE;
// The list has three heights on a phone, like a maps app's sheet: peek (the day bar only, so the map has the
// screen), half (the default), and full (the whole day, docked under the header). It never hides.
// You move it by dragging: the grab handle, the day bar, or the list itself. Dragging the list up grows the sheet
// before the list scrolls; at full, pulling the list down from its top shrinks the sheet again.
const SNAPS = ['peek', 'half', 'full'];
// Half is about half the screen, but tall enough for the list to show a stop with the stops before and after it
// (three stops and the two drives between them), so a selected stop, centered, has its neighbors in view.
// On a short screen that's taller than half, though never more than HALF_MAX of it, so the map keeps some room.
const HALF_LIST = 3 * 45 + 2 * 32 + 16, HALF_MAX = 0.62; // + a little room for the fades at its edges
function snaps() {
  const H = $app.querySelector('.trip').clientHeight;
  const chrome = $app.querySelector('.wt-sheet__top').offsetHeight + $app.querySelector('.wt-add-bar').offsetHeight;
  // peeking keeps only the day bar, with the add bar's bottom padding (and the safe area) below it; Add stop alone
  // under an empty sheet looked like a day with no stops
  const pad = parseFloat(getComputedStyle($app.querySelector('.wt-add-bar')).paddingBottom) || 0;
  const half = Math.min(Math.max(H * 0.48, chrome + HALF_LIST), H * HALF_MAX, H - headBottom());
  return { peek: Math.round($app.querySelector('.wt-sheet__top').offsetHeight + pad), half: Math.round(half), full: H - headBottom() };
}
const GRAB_LABEL = { peek: "Show the day's plan", half: 'Show the whole day', full: 'Show more of the map' };
function applySnap() {
  const trip = $app.querySelector('.trip'), sheet = trip?.querySelector('.wt-sheet');
  if (!sheet) return;
  const wide = isWide(), h = wide ? 0 : snaps()[state.snap];
  sheet.style.height = h ? `${h}px` : '';
  sheet.classList.toggle('is-full', !wide && state.snap === 'full');
  sheet.classList.toggle('is-peek', !wide && state.snap === 'peek');
  // The header floats over the map as a card; with the whole day showing, it docks and joins the list.
  trip.querySelector('.wt-trip-head').classList.toggle('is-docked', !wide && state.snap === 'full');
  trip.style.setProperty('--bottom-h', `${h}px`);
  trip.querySelector('.wt-sheet__grab').setAttribute('aria-label', GRAB_LABEL[state.snap]);
  // the day's view depends on the room the list leaves; a re-frame (setSnap) puts the camera there again
  if (map) { dayShown = dayFramed(); updateFitBtn(); }
}
// A new height re-frames the map for what's left of it, unless you've moved the map yourself since.
function setSnap(snap) {
  const changed = state.snap !== snap;
  state.snap = snap;
  applySnap();
  if (changed && snap !== 'full') reframe();
}
let camFree = false; // you've touched the map since it was last framed
function reframe() {
  const trip = cur?.stops ? cur : null;
  if (camFree || state.draft || !trip) return;
  fitKey = '';
  drawMap(trip);
}
const drag = { active: false, moved: false, list: null, mode: null, y0: 0, h0: 0, lastY: 0, lastT: 0, v: 0, suppressClick: false };
function dragStart(y, list) {
  const sheet = $app.querySelector('.wt-sheet');
  Object.assign(drag, { active: true, moved: false, list, mode: list ? null : 'sheet', y0: y, h0: sheet.offsetHeight, lastY: y, lastT: performance.now(), v: 0 });
}
function dragMove(y) {
  const now = performance.now(), dy = drag.y0 - y;
  drag.v = (drag.lastY - y) / Math.max(1, now - drag.lastT); // px per ms, up is positive
  drag.lastY = y;
  drag.lastT = now;
  if (!drag.moved && Math.abs(dy) < 6) return;
  drag.moved = true;
  const sheet = $app.querySelector('.wt-sheet'), s = snaps();
  sheet.classList.add('is-dragging');
  const h = Math.max(s.peek, Math.min(s.full, drag.h0 + dy));
  sheet.style.height = `${h}px`;
  $app.querySelector('.trip').style.setProperty('--bottom-h', `${h}px`); // what floats over the map rides with the sheet
}
function dragEnd() {
  drag.active = false;
  const sheet = $app.querySelector('.wt-sheet');
  if (!sheet || !drag.moved) return;
  sheet.classList.remove('is-dragging');
  // A flick goes on to the next height its way; a slower drag settles at the nearest one.
  const s = snaps(), h = sheet.offsetHeight, v = performance.now() - drag.lastT > 100 ? 0 : drag.v;
  const snap = v > 0.4 ? SNAPS.find(k => s[k] > h + 1) || 'full'
    : v < -0.4 ? [...SNAPS].reverse().find(k => s[k] < h - 1) || 'peek'
      : SNAPS.reduce((a, k) => (Math.abs(s[k] - h) < Math.abs(s[a] - h) ? k : a));
  setSnap(snap);
  drag.suppressClick = true;
  setTimeout(() => { drag.suppressClick = false; }, 50);
}
// The sheet's top (grab handle and day bar), with a finger or a mouse
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.wt-sheet__top') || isWide()) return;
  dragStart(e.clientY, null);
});
document.addEventListener('pointermove', e => { if (drag.active && !drag.list) dragMove(e.clientY); });
document.addEventListener('pointerup', () => { if (drag.active && !drag.list) dragEnd(); });
// The list, with a finger: below full it moves the sheet; at full, only a pull down from its top does,
// and otherwise it scrolls as usual.
document.addEventListener('touchstart', e => {
  const list = e.target.closest?.('.wt-sheet__body');
  if (!list || e.touches.length > 1 || isWide()) return;
  dragStart(e.touches[0].clientY, list);
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!drag.active || !drag.list) return;
  const y = e.touches[0].clientY, dy = drag.y0 - y;
  if (!drag.mode) {
    if (Math.abs(dy) < 6) return;
    drag.mode = state.snap !== 'full' || (dy < 0 && drag.list.scrollTop <= 0) ? 'sheet' : 'scroll';
  }
  if (drag.mode !== 'sheet') return;
  if (e.cancelable) e.preventDefault();
  dragMove(y);
}, { passive: false });
for (const t of ['touchend', 'touchcancel']) document.addEventListener(t, () => { if (drag.active && drag.list) dragEnd(); });
document.addEventListener('click', e => {
  if (drag.suppressClick) { drag.suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
  // Peeking, the sheet is the day bar: its buttons work, and a tap anywhere else on it opens it to half.
  if (state.snap === 'peek' && !isWide() && e.target.closest('.wt-sheet') && !e.target.closest('button, a')) { e.stopPropagation(); setSnap('half'); }
}, true);
addEventListener('resize', () => {
  $sheets.classList.toggle('wt-modal-root--side', isWide());
  if (!$app.dataset.trip) return;
  applySnap();
  map?.invalidateSize();
  fitKey = '';
  scheduleRender();
});

// How much of the map's bottom is covered: by the open stop's sheet, or else by the list. At full the map
// doesn't show, so the camera is placed for half, where the list goes back to. Nothing covers the map on a wide screen.
function coveredBottom() {
  if (isWide()) return 0;
  const panel = state.draft && $sheets.querySelector('.wt-modal');
  return panel ? panel.offsetHeight : snaps()[state.snap === 'peek' ? 'peek' : 'half'];
}
// The header card covers the map's top on a phone; on a wide screen it sits in the side panel.
const headBottom = () => { const h = $app.querySelector('.wt-trip-head'); return h.offsetTop + h.offsetHeight; };
const coveredTop = () => (isWide() ? 0 : headBottom());
// Is this point in the part of the map you can see, with room to spare for its label?
function inView(ll, margin = 40) {
  const top = coveredTop();
  const p = map.latLngToContainerPoint(ll), size = map.getSize();
  return p.x > margin && p.x < size.x - margin && p.y > top + margin && p.y < size.y - coveredBottom() - margin;
}

// ---------- Camera ----------
// Every camera move the app makes goes through here, so they all look the same: one flyTo that pans and zooms
// together, timed by how far it goes. Leaflet's setView, fitBounds and panTo each pick an animation by distance:
// a 250ms slide within a screen, a CSS scale for a zoom of up to 4 levels around an on-screen point, and otherwise
// a jump with no animation. And a zoom asked for while one of those scales is still running is dropped.
function moveCamera(center, zoom) {
  if (!map) return;
  center = L.latLng(center);
  zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), zoom));
  const z0 = map.getZoom(), px = map.project(center, z0).distanceTo(map.project(map.getCenter(), z0)), dz = Math.abs(zoom - z0);
  const now = performance.now();
  // already there, or already on the way there: don't restart the flight
  if (camTarget && now < camTarget.until && camTarget.center.equals(center, 1e-7) && camTarget.zoom === zoom) return;
  if (px < 1 && dz < 0.01) { camTarget = null; return; }
  // A new map is placed where it belongs rather than flown in from its default view
  if (!camPlaced || reduceMotion.matches) {
    camPlaced = true;
    camTarget = null;
    map.setView(center, zoom, { animate: false });
    return;
  }
  // A move within the screen takes about as long as the sheet does to change height; a hop to another region, under a second
  const size = map.getSize(), screens = px / Math.max(1, Math.hypot(size.x, size.y));
  const duration = Math.min(0.9, 0.3 + 0.15 * Math.log2(1 + screens) + 0.06 * dz);
  camTarget = { center, zoom, until: now + duration * 1000 };
  camMoving = true;
  map.flyTo(center, zoom, { duration });
}
// The center and zoom that fit `bounds` into the map with `tl` and `br` (points, in pixels) kept clear at the
// top left and bottom right: fitBounds worked out by hand, as Leaflet does it, without moving the map.
function frameBounds(bounds, tl, br, maxZoom) {
  const zoom = Math.min(map.getBoundsZoom(bounds, false, tl.add(br)), maxZoom);
  const sw = map.project(bounds.getSouthWest(), zoom), ne = map.project(bounds.getNorthEast(), zoom);
  return { center: map.unproject(sw.add(ne).divideBy(2).add(br.subtract(tl).divideBy(2)), zoom), zoom };
}

function drawMap(trip) {
  if (!map) return;
  // Mid-move, only where the camera is going can change now; the pins and routes are redrawn when it stops
  if (camMoving) { drawPending = true; return frameMap(trip); }
  layer.clearLayers();
  // Only the day on screen, from its plan: the hotel at either end is a pin like any stop.
  // With no hotel last night, the day before's last stop is a quiet pin, so the first drive leads somewhere.
  const day = currentDay(trip);
  if (!day) return drawDraft();
  const plan = dayPlan(trip, day);
  const start = plan.find(e => e.role === 'from')?.place;
  const legs = dayLegs(trip, day);
  const active = legs.find(l => l.key === (state.leg || state.hoverLeg));
  // The stop being edited is drawn where the draft puts it; if it has moved, its drives are out of date until it's saved.
  const draft = state.draft, editing = s => draft?.id && s.id === draft.id;
  const moved = draft?.id && draft.lat != null && plan.some(e => editing(e.place) && !samePlace(e.place, draft));
  const places = plan.map(e => e.place).filter(s => !editing(s));
  // what the list dims, the map dims: past drives go grey, and a place is past once all its rows are
  const items = dayItems(trip, day);
  const pastLeg = new Set(items.filter(it => it.leg && it.past).map(it => it.leg));
  const isPast = s => { const rows = items.filter(it => it.entry?.place === s); return rows.length > 0 && rows.every(it => it.past); };
  const C = { on: token('--wt-route-active'), muted: token('--wt-route-muted'), route: token('--wt-route'), done: token('--wt-route-done'), casing: token('--wt-route-casing') };
  // past routes first, so they sit under the rest; the active route last, on top
  const order = l => (l === active ? 2 : pastLeg.has(l.key) ? 0 : 1);
  for (const l of [...legs].sort((a, b) => order(a) - order(b))) {
    const rt = l.r, isOn = l === active, stale = moved && (editing(l.from) || editing(l.to));
    const color = isOn ? C.on : active || stale ? C.muted : pastLeg.has(l.key) ? C.done : C.route;
    const coords = legCoords(l);
    L.polyline(coords, { color: C.casing, weight: isOn ? 11 : 8, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(coords, { color, weight: isOn ? 7 : 4.5, dashArray: rt?.ok && !stale ? null : '1 9', lineCap: 'round', interactive: false }).addTo(layer);
    // wide invisible line so the route is easy to tap
    L.polyline(coords, { opacity: 0, weight: 24, bubblingMouseEvents: false })
      .on('click', () => onMapTap(() => { if (!state.draft) previewLeg(l, { fromMap: true }); })).addTo(layer);
  }
  // A route on show names both its ends, and its time sits on the route.
  const ends = active ? [active.from, active.to] : [];
  const lower = active && (map.latLngToContainerPoint(active.to).y > map.latLngToContainerPoint(active.from).y ? active.to : active.from);
  if (active) {
    const late = lateMin(active);
    L.marker(midpoint(legCoords(active)), {
      interactive: false, keyboard: false, zIndexOffset: 2000,
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="wt-route-tag"><i class="wt-route-tag__car">${WaythreadIcons.svg('car', 14)}</i>${active.r ? fmtDur(active.r.duration) : '…'}${late > 0 ? `<span class="wt-route-tag__late">· ${fmtDur(late * 60)} late</span>` : ''}</div>` }),
    }).addTo(layer);
  }
  // places at the same spot (fly in and out of one airport, a hotel morning and night) share one pin
  const groups = new Map();
  for (const s of places) {
    const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    if (!groups.has(k)) groups.set(k, []);
    if (!groups.get(k).includes(s)) groups.get(k).push(s);
  }
  for (const all of groups.values()) {
    // quiet: only the start, which belongs to the day before, or a place you're done with,
    // or, while a route is on show, any place it doesn't start or end at
    const g = all.filter(s => s !== start), end = all.find(s => ends.includes(s));
    const quiet = !g.length || g.every(isPast) || (active && !end);
    // the selected stop can be the day's start, from the day before's row at the top of the list
    const focus = end || all.find(s => s.id === state.sel);
    const cls = [focus ? 'wt-pin--selected' : '', quiet && !focus ? 'wt-pin--muted' : ''].join(' ');
    const label = focus ? `<span class="wt-pin__label${end && end === lower ? ' wt-pin__label--below' : ''}">${esc(focus.name)}</span>` : '';
    L.marker([all[0].lat, all[0].lng], {
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="wt-pin ${cls}">${markerHTML(focus || g[0] || start, 'wt-pin__marker')}${label}</div>` }),
      zIndexOffset: focus ? 1000 : quiet ? -1000 : 0, title: all[0].name,
    }).on('click', () => onMapTap(() => {
      if (state.draft) return;
      if (g.length) selectStop(g[0]); else { setDay(dayOf(start)); selectStop(start); }
    })).addTo(layer);
  }
  drawDraft();
  frameMap(trip);
}
// Frame the day on screen, or the drive on show, when either has changed since the map was last framed.
function frameMap(trip) {
  const day = currentDay(trip);
  if (!day) return;
  const key = [trip.id, day, dayPlan(trip, day).length].join('|');
  if (key === fitKey || state.draft) return;
  fitKey = key;
  camFree = false;
  const leg = state.leg && dayLegs(trip, day).find(l => l.key === state.leg);
  if (leg) return fitLeg(leg);
  const v = dayView(trip, day);
  if (v) moveCamera(v.center, v.zoom);
  dayShown = true;
}
// Where the camera goes for a day: around all its places, clear of the list. Preloading uses it to fetch the
// tiles a day will land on, so it works the view out without moving the map.
function dayView(trip, day) {
  const pts = dayPlan(trip, day).map(e => [e.place.lat, e.place.lng]);
  if (!pts.length) return null;
  if (new Set(pts.map(String)).size === 1) return { center: L.latLng(pts[0]), zoom: 13 };
  // the side panel sits beside the map, not on it; on a phone, the list covers the bottom
  return frameBounds(L.latLngBounds(pts), L.point(32, coveredTop() + 24), L.point(32, coveredBottom() + 24), 15);
}
// The stop being edited, where it would go: its new place and type, named.
function drawDraft() {
  const d = state.draft;
  if (!d || d.lat == null) return;
  L.marker([d.lat, d.lng], {
    interactive: false, keyboard: false, zIndexOffset: 1500,
    icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="wt-pin wt-pin--selected">${markerHTML(d, 'wt-pin__marker')}${d.name ? `<span class="wt-pin__label">${esc(d.name)}</span>` : ''}</div>` }),
  }).addTo(layer);
}
const legCoords = l => (l.r ? l.r.coords : [[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]]);
// Minutes a drive runs past the next stop's time, between two of the day's stops
const lateMin = l => (l.r && l.fromEntry.role === 'stop' && l.toEntry.role === 'stop' ? Math.round(l.r.duration / 60 - gapMin(l.from, l.to)) : 0);
// Halfway along a route, by distance
function midpoint(coords) {
  const pts = coords.map(c => L.latLng(c));
  if (pts.length < 2) return pts[0];
  const seg = pts.slice(1).map((p, i) => pts[i].distanceTo(p));
  let half = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i]) { const t = seg[i] ? half / seg[i] : 0; return L.latLng(pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, pts[i].lng + (pts[i + 1].lng - pts[i].lng) * t); }
    half -= seg[i];
  }
  return pts.at(-1);
}
// Fit a route into the part of the map you can see, with room for its end labels.
// From a tap on the map, only when an end is out of view, so the map doesn't jump under your finger.
function fitLeg(l, onlyIfHidden = false) {
  if (!map || (onlyIfHidden && inView(l.from) && inView(l.to))) return;
  camFree = false;
  const v = frameBounds(L.latLngBounds(legCoords(l)), L.point(72, coveredTop() + 48), L.point(72, coveredBottom() + 48), 15);
  moveCamera(v.center, v.zoom);
}
// Show a drive's route: highlighted, both ends named, its time on it, and the map moved to fit it.
// Tapping the same drive in the list again goes back to the whole day.
function previewLeg(l, { fromMap = false } = {}) {
  if (!fromMap && state.leg === l.key) {
    state.leg = null;
    fitKey = '';
    render();
    return;
  }
  state.leg = l.key;
  state.sel = state.selRow = null;
  const shrink = state.snap === 'full';
  if (shrink) setSnap('half'); // the whole-day list covers the map; peeking, the map already has the screen
  render();
  fitLeg(l, fromMap);
  centerRow(`.wt-tl-drive[data-leg="${CSS.escape(l.key)}"]`, shrink);
}
// Scroll the list so a row sits in its middle, with what comes before and after it in view on both sides
// (the list's ends can't scroll past, so a first or last row stays near its end). When the sheet is changing
// height, wait for it to settle, or the middle is measured from the old height.
function centerRow(selector, resizing) {
  setTimeout(() => {
    const body = $app.querySelector('.wt-sheet__body'), row = body?.querySelector(selector);
    if (!row) return;
    const off = row.getBoundingClientRect().top - body.getBoundingClientRect().top;
    body.scrollTo({ top: body.scrollTop + off - (body.clientHeight - row.offsetHeight) / 2, behavior: 'smooth' });
  }, resizing ? 260 : 0);
}
// Hovering a drive in the list previews its route on the map, without moving the map.
document.addEventListener('mouseover', e => {
  const id = e.target.closest?.('.wt-tl-drive')?.dataset.leg || null;
  if (id === state.hoverLeg) return;
  state.hoverLeg = id;
  if (cur?.stops) drawMap(cur);
});
// Select a stop: its row and its pin are highlighted, and Add stop becomes Edit stop.
// Tapping a pin or a row scrolls the row to the middle of the list. Tapping a row (`row`, its key) moves the pin into view if it's
// off the map you can see, keeping the zoom; tapping the selected row again clears the selection.
function selectStop(s, row = null) {
  if (row && state.sel === s.id && $app.querySelector('.wt-tl-stop.is-selected')?.dataset.row === row) {
    state.sel = state.selRow = null;
    render();
    return;
  }
  if (state.leg) fitKey = '';
  state.leg = null;
  state.sel = s.id;
  state.selRow = row;
  const shrink = state.snap === 'full', resizing = state.snap !== 'half' && !isWide();
  // coming down from the whole day re-frames the map for the day, which already shows this stop
  const framed = shrink && !camFree && !isWide();
  setSnap('half'); // the whole-day list covers the map; peeking, it's opened to show the stop's row
  render();
  if (row && !framed && map && s.lat != null && !inView([s.lat, s.lng])) {
    const z = map.getZoom(), p = map.project([s.lat, s.lng], z).add([0, (coveredBottom() - coveredTop()) / 2]);
    moveCamera(map.unproject(p, z), z);
  }
  // in the middle of the list, so the stops before and after it show too
  centerRow('.wt-tl-stop.is-selected', resizing);
}
// Move a place into the middle of the map you can see: above the stop sheet on a phone, the whole map on a wide screen.
function focusStop(s) {
  if (!map || s.lat == null) return;
  const z = Math.max(map.getZoom(), 13);
  const p = map.project([s.lat, s.lng], z).add([0, (coveredBottom() - coveredTop()) / 2]);
  moveCamera(map.unproject(p, z), z);
}

// ---------- Edits ----------
function addStop(trip, data) {
  const stop = { id: uid(), ...data, done: false, by: me.id, updatedAt: Date.now() };
  openTripOf(trip.id)?.stops.push(stop);
  render();
  writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PUT', body: data }));
}
// Only the fields this person changed (against the stop as they opened it) are sent, so a
// co-editor's edit to another field of the same stop survives.
function editStop(trip, stop, fields) {
  const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => stop[k] !== v));
  if (!Object.keys(changed).length) return;
  const target = openTripOf(trip.id)?.stops.find(s => s.id === stop.id);
  if (target) Object.assign(target, changed, { by: me.id });
  render();
  writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PATCH', body: changed }));
}
function deleteStop(trip, stop) {
  const t = openTripOf(trip.id);
  if (t) t.stops = t.stops.filter(s => s.id !== stop.id);
  render();
  save(api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'DELETE' }));
  // Undo puts the same stop back under its old id
  toast(`Deleted ${stop.name}`, 'Undo', () => {
    const { name, address, lat, lng, time, note, kind, nights, checkout = null } = stop;
    openTripOf(trip.id)?.stops.push({ ...stop, by: me.id });
    render();
    writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PUT', body: { name, address, lat, lng, time, note, kind, nights, checkout } }));
  });
}

// ---------- Sheets ----------
const closeBtn = `<button class="wt-icon-btn" data-action="close-sheet" aria-label="Close">${ICON.close}</button>`;
// A long form's head can stay put while its fields scroll (sticky), so Close is always in reach
const modalHead = (title, sticky) => `<div class="wt-modal__head${sticky ? ' wt-modal__head--sticky' : ''}"><h2 class="wt-modal__title">${title}</h2>${closeBtn}</div>`;
// A panel (the stop sheet) has no backdrop, so the map stays in view and usable beside or above it.
// onClose runs however the sheet goes away: closed, replaced by another sheet, or left with the trip.
let onSheetClose = null;
function openSheet(html, mount, { panel = false, onClose = null } = {}) {
  runSheetClose();
  // over the trip's side panel on a wide screen; a dialog in the middle elsewhere, a bottom sheet on a phone
  $sheets.classList.toggle('wt-modal-root--side', isWide());
  $sheets.classList.toggle('wt-modal-root--panel', panel);
  $sheets.innerHTML = `${panel ? '' : '<div class="wt-modal__backdrop" data-action="close-sheet"></div>'}<div class="wt-modal" role="dialog" aria-modal="${!panel}">${html}</div>`;
  onSheetClose = onClose;
  mount?.($sheets.querySelector('.wt-modal'));
  requestAnimationFrame(() => requestAnimationFrame(() => $sheets.classList.add('is-open')));
}
function closeSheet() {
  $sheets.classList.remove('is-open', 'wt-modal-root--panel');
  $sheets.innerHTML = '';
  runSheetClose();
}
function runSheetClose() { const f = onSheetClose; onSheetClose = null; f?.(); }

function openNewTrip() {
  openSheet(`${modalHead('New trip')}
    <form><input class="wt-input" name="title" placeholder="Trip to White Sands, NM" autocomplete="off" required maxlength="120" aria-label="Trip name">
    <div class="wt-modal__actions"><button class="wt-btn wt-btn--primary">Create</button></div></form>`, el => {
    const f = el.querySelector('form');
    f.elements.title.focus();
    f.onsubmit = async e => {
      e.preventDefault();
      f.elements[1].disabled = true;
      try {
        const snap = await api('/trips', { method: 'POST', body: { name: f.elements.title.value.trim() } });
        closeTrip();
        cur = fromSnapshot(snap);
        connectLive(cur.id);
        closeSheet();
        location.hash = `#/trip/${cur.id}`;
      } catch (err) {
        f.elements[1].disabled = false;
        if (err.status !== 401) toast('Couldn’t create the trip. Check your connection.');
      }
    };
  });
}

// Everything about the trip that isn't the plan: its name, who's on it, the share link, deleting it, and the map's credits.
function openSettings(trip) {
  openSheet(`${modalHead('Trip settings')}
    <form class="settings-name">
      <label class="wt-field"><span class="wt-field__label">Name</span>
        <input class="wt-input" name="title" autocomplete="off" required maxlength="120"></label>
    </form>
    <div class="wt-field"><span class="wt-field__label">People</span>
      <ul class="wt-people">${trip.members.map(m => `<li class="wt-people__item">${avatarHTML(m)}${esc(m.name)}${m.id === me.id ? ' (you)' : ''}</li>`).join('')}</ul></div>
    <div class="wt-field"><span class="wt-field__label">Share link</span>
      <p class="wt-modal__text">Anyone with the link can join and edit this trip.</p>
      <div class="wt-copy-row"><input class="wt-input" readonly value="" placeholder="Loading…" aria-label="Trip link"><button class="wt-btn wt-btn--primary" data-action="copy" disabled>Copy</button></div>
      <button class="wt-btn wt-btn--ghost settings-new-link" data-new-link>Make a new link</button></div>
    <div class="wt-modal__actions"><button class="wt-btn wt-btn--danger" data-del>Delete trip</button></div>
    <p class="wt-credit">Map ${mapCredit}</p>`, async el => {
    // The name saves when you leave the field or press Return; no separate button
    const f = el.querySelector('.settings-name');
    f.elements.title.value = trip.name;
    f.onsubmit = e => { e.preventDefault(); f.elements.title.blur(); };
    f.elements.title.addEventListener('change', () => {
      const name = f.elements.title.value.trim();
      if (!name || name === trip.name) { f.elements.title.value = trip.name; return; }
      const t = openTripOf(trip.id);
      if (t) t.name = name;
      render();
      save(api(`/trips/${trip.id}`, { method: 'PATCH', body: { name } })).then(r => { if (r !== undefined) toast('Name saved'); });
    });
    // Deleting is for everyone, so it asks first; it can still be undone from the notice.
    el.querySelector('[data-del]').onclick = async () => {
      if (!confirm(`Delete “${trip.name}” for everyone?`)) return;
      try { await api(`/trips/${trip.id}`, { method: 'DELETE' }); } catch (err) {
        if (err.status !== 401) toast('Couldn’t delete the trip. Check your connection.');
        return;
      }
      closeSheet();
      closeTrip();
      location.hash = '#/';
      toast(`Deleted ${trip.name}`, 'Undo', async () => {
        try { await api(`/trips/${trip.id}/restore`, { method: 'POST' }); location.hash = `#/trip/${trip.id}`; } catch { toast('Couldn’t restore the trip'); }
      });
    };
    const input = el.querySelector('.wt-copy-row input'), copy = el.querySelector('[data-action="copy"]');
    const show = url => { input.value = url; copy.dataset.text = url; copy.disabled = false; };
    // A new link is for when the old one went somewhere it shouldn't have: the old one stops working.
    el.querySelector('[data-new-link]').onclick = async () => {
      if (!confirm('Make a new link? The current link stops working. Everyone already on the trip stays on it.')) return;
      try { show((await api(`/trips/${trip.id}/invite/rotate`, { method: 'POST' })).url); toast('New link ready'); } catch { toast('Couldn’t make a new link'); }
    };
    try { show((await api(`/trips/${trip.id}/invite`)).url); } catch { input.placeholder = 'Couldn’t load the link'; }
  });
}

// Your name as others on your trips see it; guests are offered a real sign-in, which keeps their
// trips; everyone can sign out.
function openAccount() {
  const upgrade = me.isGuest && canSignIn();
  openSheet(`${modalHead('Account')}
    <form class="account-name">
      <label class="wt-field"><span class="wt-field__label">Your name${me.isGuest ? ' (guest)' : ''}</span>
        <input class="wt-input" name="name" autocomplete="name" maxlength="40" required></label>
    </form>
    ${upgrade ? `<h3 class="account-keep">Keep your trips</h3>
    <p class="wt-modal__text">As a guest, you can only reach your trips from this browser. Sign in to keep them on any device.</p>
    <div class="signin"></div>` : ''}
    <div class="wt-modal__actions"><button class="wt-btn wt-btn--danger" data-action="sign-out">Sign out</button></div>`, el => {
    const f = el.querySelector('.account-name');
    f.elements.name.value = me.name;
    // Saves when you leave the field or press Return; no separate button
    const saveName = async () => {
      const name = f.elements.name.value.trim().replace(/\s+/g, ' ');
      if (!name || name === me.name) { f.elements.name.value = me.name; return; }
      try {
        await api('/auth/update-user', { method: 'POST', body: { name } });
        me.name = name;
        toast('Name saved');
        render();
      } catch (err) { toast(failMsg(err, 'Couldn’t save your name.')); }
    };
    f.onsubmit = e => { e.preventDefault(); f.elements.name.blur(); };
    f.elements.name.addEventListener('change', saveName);
    if (upgrade) authFlow(el.querySelector('.signin'));
  });
}

// Two hours after the day's last stop; 9 AM on a day with none yet (a hotel day), or 9 AM tomorrow for an empty trip.
function defaultTime(trip) {
  const day = currentDay(trip), s = dayStops(trip, day);
  let d;
  if (s.length) { d = toDate(s.at(-1).time); d.setHours(Math.min(d.getHours() + 2, 22), 0, 0, 0); }
  else if (day) { d = toDate(day); d.setHours(9, 0, 0, 0); }
  else { d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  return toInput(d);
}
// Search leans toward where the trip already is
function nearParam(trip) {
  if (!trip.stops.length) return '';
  const lat = trip.stops.reduce((a, s) => a + s.lat, 0) / trip.stops.length;
  const lng = trip.stops.reduce((a, s) => a + s.lng, 0) / trip.stops.length;
  return `&near=${lat.toFixed(4)},${lng.toFixed(4)}`;
}

// A hotel you add starts at a 3 PM check-in, and checks out at 11 AM unless you set another time.
const HOTEL_CHECK_IN = '15:00', HOTEL_CHECK_OUT = '11:00';
const checkoutOf = s => s.checkout || HOTEL_CHECK_OUT;

// The stop sheet is a panel: the map stays in view (above it on a phone, beside it on a wide screen) and shows
// the stop as you edit it, at the place you picked, with the type you chose.
// The first line is the place: it shows the stop's name (as in the list) and searching it changes the place.
// Type is one row that opens the types on a page of their own; it starts as a guess from the place you pick,
// until you choose one yourself.
function openStopSheet(trip, stop) {
  if ($sheets.innerHTML) closeSheet();
  const draft = stop ? { ...stop, kind: kindOf(stop) } : { lat: null, lng: null, address: '', name: '', kind: 'place' };
  let chosen = !!stop, saved = false;
  const camera = map && { center: map.getCenter(), zoom: map.getZoom() };
  state.leg = null;
  if (state.sel !== stop?.id) state.selRow = null;
  state.sel = stop?.id || null;
  state.draft = draft;
  $app.querySelector('.trip')?.classList.add('is-editing');
  render();
  const option = ([k, v]) => `<li><button type="button" class="wt-option" role="radio" data-kind="${k}">${markerHTML({ kind: k }, '')}<span class="wt-option__label">${v.label}</span>${ICON.check}</button></li>`;
  openSheet(`<div class="stop-main">${modalHead(stop ? 'Edit stop' : 'Add stop', true)}
    <form>
      <label class="wt-field"><span class="wt-field__label">Place</span><input class="wt-input" name="title" type="search" placeholder="Search a place" autocomplete="off" required maxlength="200"></label>
      <ul class="wt-results"></ul>
      <div class="wt-field"><span class="wt-field__label" id="kind-label">Type</span>
        <button type="button" class="wt-picker" data-kind-open aria-describedby="kind-label"></button></div>
      <label class="wt-field"><span class="wt-field__label" data-when>When</span><input class="wt-input" name="time" type="datetime-local" required></label>
      <div class="wt-field-row wt-stay" hidden>
        <div class="wt-field wt-nights"><span class="wt-field__label">Nights</span>
          <div class="wt-nights__row"><button type="button" class="wt-icon-btn wt-nights__step" data-nights="-1" aria-label="One night fewer">−</button><output class="wt-nights__n" aria-live="polite"></output><button type="button" class="wt-icon-btn wt-nights__step" data-nights="1" aria-label="One more night">+</button></div>
        </div>
        <div class="wt-field"><span class="wt-field__label" id="checkout-label">Check-out</span>
          <label class="wt-input wt-input-group"><span class="wt-input-group__prefix" data-checkout-day></span><input name="checkout" type="time" aria-labelledby="checkout-label"></label></div>
      </div>
      <label class="wt-field"><span class="wt-field__label">Note</span><textarea class="wt-input" name="note" rows="2" maxlength="2000" placeholder="Confirmation #, tickets, tips…"></textarea></label>
      <div class="wt-modal__actions wt-modal__actions--sticky">${stop ? '<button type="button" class="wt-btn wt-btn--danger" data-del>Delete</button>' : ''}<button class="wt-btn wt-btn--primary">${stop ? 'Save' : 'Add'}</button></div>
    </form></div>
    <div class="stop-kinds" hidden>
      <div class="wt-modal__head wt-modal__head--sub wt-modal__head--sticky"><button type="button" class="wt-icon-btn" data-kind-back aria-label="Back">${ICON.back}</button><h2 class="wt-modal__title">Type</h2></div>
      <ul class="wt-options" role="radiogroup" aria-label="Type">${Object.entries(KINDS).map(option).join('')}</ul>
    </div>`, el => {
    const results = el.querySelector('.wt-results'), f = el.querySelector('form'), F = f.elements;
    const main = el.querySelector('.stop-main'), kindsPage = el.querySelector('.stop-kinds'), picker = el.querySelector('[data-kind-open]');
    // The time is yours once you've touched it; until then a new hotel's starts at check-in time
    let timeTouched = !!stop;
    if (stop) { F.title.value = stop.name; F.time.value = stop.time; F.note.value = stop.note || ''; }
    else { F.time.value = defaultTime(trip); setTimeout(() => F.title.focus(), 280); }
    F.checkout.value = stop ? checkoutOf(stop) : HOTEL_CHECK_OUT;

    // ----- Type: the picker row, and its page -----
    const showKind = () => {
      picker.innerHTML = `${markerHTML(draft, '')}<span class="wt-picker__value">${KINDS[draft.kind].label}</span>${ICON.forward}`;
      for (const b of kindsPage.querySelectorAll('[data-kind]')) b.setAttribute('aria-checked', b.dataset.kind === draft.kind);
    };
    let scrollBack = 0;
    const showKinds = open => {
      if (open) scrollBack = el.scrollTop;
      main.hidden = open;
      kindsPage.hidden = !open;
      el.scrollTop = open ? 0 : scrollBack;
      (open ? kindsPage.querySelector('[aria-checked="true"]') : picker).focus();
    };
    picker.addEventListener('click', () => showKinds(true));
    kindsPage.addEventListener('click', e => {
      if (e.target.closest('[data-kind-back]')) return showKinds(false);
      const b = e.target.closest('[data-kind]');
      if (!b) return;
      chosen = true;
      setKind(b.dataset.kind);
      showKinds(false);
    });
    function setKind(kind) {
      draft.kind = kind;
      // A new hotel starts at check-in time; anything else goes back to the usual default.
      if (!timeTouched) F.time.value = kind === 'hotel' ? `${F.time.value.slice(0, 10)}T${HOTEL_CHECK_IN}` : defaultTime(trip);
      showKind();
      showNights();
      if (cur?.stops) drawMap(cur);
    }

    // ----- A hotel is a stay: When becomes check-in, then Nights and Check-out. Left alone, nights follow the trip
    // (until the next hotel, or the last day), and the number shown is that. -----
    let nights = stop?.nights >= 1 ? stop.nights : null;
    const stay = el.querySelector('.wt-stay');
    function autoNights() {
      const day = F.time.value.slice(0, 10), later = stopsOf(trip).filter(s => s.id !== stop?.id && dayOf(s) > day);
      const nextHotel = later.find(s => kindOf(s) === 'hotel');
      return Math.max(1, daysBetween(day, nextHotel ? dayOf(nextHotel) : later.length ? dayOf(later.at(-1)) : addDays(day, 1)));
    }
    function showNights() {
      const hotel = draft.kind === 'hotel', n = nights ?? autoNights();
      stay.hidden = !hotel;
      el.querySelector('[data-when]').textContent = hotel ? 'Check-in' : 'When';
      el.querySelector('.wt-nights__n').textContent = n;
      el.querySelector('[data-checkout-day]').textContent = F.time.value ? fmtDay(addDays(F.time.value.slice(0, 10), n)) : '';
      el.querySelector('[data-nights="-1"]').disabled = n <= 1;
    }
    stay.addEventListener('click', e => {
      const b = e.target.closest('[data-nights]');
      if (b) { nights = Math.min(30, Math.max(1, (nights ?? autoNights()) + +b.dataset.nights)); showNights(); }
    });
    F.time.addEventListener('input', () => { timeTouched = true; showNights(); });
    showKind();
    showNights();

    // ----- Place search: picking a place moves the pin there, on the map you can see -----
    let timer, ctrl, list = [];
    F.title.addEventListener('input', () => {
      clearTimeout(timer);
      const v = F.title.value.trim();
      if (v.length < 3) { results.innerHTML = ''; return; }
      timer = setTimeout(() => search(v), 350);
    });
    async function search(v) {
      ctrl?.abort();
      ctrl = new AbortController();
      results.innerHTML = '<li class="wt-results__msg">Searching…</li>';
      try {
        list = await api(`/places?q=${encodeURIComponent(v)}${nearParam(trip)}`, { signal: ctrl.signal });
        results.innerHTML = list.length ? list.map((p, i) =>
          `<li><button type="button" class="wt-results__item" data-i="${i}"><span class="wt-results__name">${esc(p.name)}</span><span class="wt-results__detail">${esc(p.address)}</span></button></li>`,
        ).join('') : '<li class="wt-results__msg">No places found</li>';
      } catch (e) {
        if (e.name !== 'AbortError') results.innerHTML = `<li class="wt-results__msg">${e.code === 'rate_limited' ? 'Too many searches. Wait a moment.' : 'Search is unavailable right now'}</li>`;
      }
    }
    results.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const p = list[+b.dataset.i];
      Object.assign(draft, { lat: p.lat, lng: p.lng, address: p.address, name: p.name });
      F.title.value = p.name;
      results.innerHTML = '';
      if (!chosen) setKind(guessKind(p.name, p.category));
      else if (cur?.stops) drawMap(cur);
      focusStop(draft);
    });

    f.onsubmit = e => {
      e.preventDefault();
      if (draft.lat == null) { results.innerHTML = '<li class="wt-results__msg">Pick a place from the search results</li>'; return; }
      const hotel = draft.kind === 'hotel';
      const data = {
        name: F.title.value.trim(), address: draft.address, lat: draft.lat, lng: draft.lng, time: F.time.value, note: F.note.value.trim(),
        kind: draft.kind, nights: hotel ? nights : null, checkout: hotel ? F.checkout.value || null : null,
      };
      state.day = dayOf(data); // follow the stop to its day
      saved = true;
      state.draft = null; // so the list and map show the saved stop, not the draft
      if (stop) editStop(trip, stop, data); else addStop(trip, data);
      closeSheet();
    };
    f.querySelector('[data-del]')?.addEventListener('click', () => {
      saved = true;
      closeSheet();
      deleteStop(trip, stop);
    });
  }, {
    panel: true,
    // Closed without saving: the map goes back to where it was.
    onClose: () => {
      state.draft = null;
      $app.querySelector('.trip')?.classList.remove('is-editing');
      if (!saved && map && camera) moveCamera(camera.center, camera.zoom);
      if ($app.dataset.trip && cur?.stops) render();
    },
  });
  if (stop) focusStop(stop);
}

// ---------- Toast ----------
const $toast = Object.assign(document.createElement('div'), { className: 'wt-toast', role: 'status' });
document.body.append($toast);
let toastTimer;
function toast(msg, label, onAction) {
  $toast.innerHTML = `<span>${esc(msg)}</span>${label ? `<button class="wt-toast__action">${esc(label)}</button>` : ''}`;
  if (label) $toast.querySelector('button').onclick = () => { $toast.classList.remove('is-visible'); onAction(); };
  $toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('is-visible'), label ? 5000 : 2800);
}

// ---------- Events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const trip = cur?.stops ? cur : null;
  const stop = trip && el.dataset.id && trip.stops.find(s => s.id === el.dataset.id);
  switch (el.dataset.action) {
    case 'new-trip': openNewTrip(); break;
    case 'add': openStopSheet(trip); break;
    case 'select': if (stop) selectStop(stop, el.dataset.row); break;
    case 'edit': if (stop) openStopSheet(trip, stop); break;
    case 'settings': openSettings(trip); break;
    case 'prev-day': stepDay(-1); break;
    case 'next-day': stepDay(1); break;
    case 'days': openDays(trip); break;
    case 'pick-day': closeSheet(); setDay(el.dataset.day); break;
    case 'leg': {
      if (e.target.closest('a')) break; // Directions opens the maps app; the rest of the row shows the route
      const l = dayLegs(trip, currentDay(trip)).find(x => x.key === el.dataset.leg);
      if (l) previewLeg(l);
      break;
    }
    case 'account': openAccount(); break;
    case 'social': signInSocial(el.dataset.provider); break;
    case 'sign-out': signOut(); break;
    case 'close-sheet': closeSheet(); break;
    case 'fit-day': showWholeDay(); break;
    case 'grab': setSnap(state.snap === 'half' ? 'full' : 'half'); break; // peek and full go to half; half goes to full
    case 'copy': navigator.clipboard?.writeText(el.dataset.text).then(() => toast('Link copied'), () => toast('Copy failed')); break;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // with no sheet open, Esc clears the selection, like tapping empty map
    if (!$sheets.innerHTML && $app.dataset.trip && (state.sel || state.leg)) {
      if (state.leg) fitKey = '';
      state.sel = state.selRow = state.leg = null;
      render();
    }
    closeSheet();
  }
  // A drive row is focusable: Enter or Space shows its route, like a tap
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.wt-tl-drive')) { e.preventDefault(); e.target.click(); }
  // ← → change day on the trip screen, unless typing or a sheet is open
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && $app.dataset.trip && !$sheets.innerHTML && !e.target.closest('input, textarea')) stepDay(e.key === 'ArrowRight' ? 1 : -1);
});
addEventListener('hashchange', render);

boot();
