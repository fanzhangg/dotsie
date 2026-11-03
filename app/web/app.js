'use strict';

/* Waythread — vanilla JS, no build step.
   One trip screen: a full-screen map with the stop list as a draggable sheet on top.
   Data comes from the Worker's /api. Edits show at once and save in the background; the open trip
   keeps a WebSocket so co-editors' changes land live. Look, components and icons come from design-system/. */

const params = new URLSearchParams(location.search);
// ?today=YYYY-MM-DD pretends it's a trip day, so the check-off UI can be previewed before the trip
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '') ? params.get('today') : null;

const ROUTE_KEY = 'waythread:routes:v1';
const $app = document.getElementById('app');
const $sheets = document.getElementById('sheets');
const state = { sel: null, leg: null, hoverLeg: null, snap: 'half', flash: new Set() };

// Who's signed in, the home list, and the open trip ({ id, name, members, stops } or { id, error })
let me = null, config = { google: false, apple: false }, trips = null, cur = null;

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const memberOf = id => cur?.members?.find(m => m.id === id);
const avatarHTML = m => `<span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-${m.identity || 1})">${esc((m.name || '?')[0].toUpperCase())}</span>`;
// Map drawing can't use CSS classes, so it reads the design tokens directly (theme-aware).
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Icons (design system) ----------
const ICON = Object.fromEntries(['back', 'close', 'plus', 'person-add', 'edit', 'check', 'car', 'external']
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
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error);
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
function legsOf(trip) {
  const s = stopsOf(trip);
  return s.slice(1).map((to, i) => ({ from: s[i], to }));
}

// ---------- Session ----------
async function boot() {
  [config, me] = await Promise.all([api('/config').catch(() => config), api('/me').catch(() => null)]);
  render();
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
// Come back to the same screen (a share link, say) after the provider or the email link.
const callbackURL = () => location.pathname + location.hash;
async function signInSocial(provider) {
  try {
    const { url } = await api('/auth/sign-in/social', { method: 'POST', body: { provider, callbackURL: callbackURL() } });
    location.href = url;
  } catch { toast('Sign-in is unavailable right now'); }
}

// ---------- Routes: only the line and drive time; navigation is handed to the maps app ----------
const routes = (() => { try { return JSON.parse(localStorage.getItem(ROUTE_KEY)) || {}; } catch { return {}; } })();
const pending = new Set();
let routeQueue = Promise.resolve();
const legKey = (a, b) => `${(+a.lng).toFixed(5)},${(+a.lat).toFixed(5)};${(+b.lng).toFixed(5)},${(+b.lat).toFixed(5)}`;
function haversine(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function getRoute(a, b) {
  const k = legKey(a, b);
  if (routes[k]) return routes[k];
  if (a.lat === b.lat && a.lng === b.lng) return { ok: true, duration: 0, distance: 0, coords: [[a.lat, a.lng]] };
  if (!pending.has(k)) {
    pending.add(k);
    routeQueue = routeQueue.then(() => fetchRoute(a, b, k)); // one at a time, so opening a trip doesn't burst the router
  }
  return null;
}
async function fetchRoute(a, b, k) {
  try {
    const rt = await api(`/route?from=${a.lat},${a.lng}&to=${b.lat},${b.lng}`);
    routes[k] = { ok: true, ...rt };
    try { localStorage.setItem(ROUTE_KEY, JSON.stringify(Object.fromEntries(Object.entries(routes).filter(([, v]) => v.ok)))); } catch {}
  } catch {
    // Offline or unavailable: straight-line estimate so the plan still reads. Not persisted, so it retries next load.
    const d = haversine(a, b) * 1.3;
    routes[k] = { ok: false, duration: d / 22, distance: d, coords: [[a.lat, a.lng], [b.lat, b.lng]] };
  }
  pending.delete(k);
  scheduleRender();
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
        note(`${who} ${!old ? 'added' : old.done !== m.stop.done ? (m.stop.done ? 'checked off' : 'unchecked') : 'updated'} ${m.stop.name}`);
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
  if (!me) { closeTrip(); teardownTrip(); renderSignIn(r); return; }
  if (r.page === 'join') { teardownTrip(); join(r.token); return; }
  if (r.page !== 'trip') {
    if (cur) closeTrip();
    teardownTrip();
    if (trips === null) loadTrips();
    $app.innerHTML = homeHTML();
    return;
  }
  trips = null; // the home list reloads on the way back
  if (cur?.id !== r.id) {
    if (tripLoad === r.id) return;
    closeTrip();
    teardownTrip();
    $app.innerHTML = '';
    openTrip(r.id);
    return;
  }
  const trip = cur;
  if (trip.error) { teardownTrip(); $app.innerHTML = messageHTML(TRIP_ERRORS[trip.error] || TRIP_ERRORS.offline); return; }
  if ($app.dataset.trip !== trip.id) mountTrip(trip);
  const el = $app.querySelector('.trip');
  el.querySelector('.wt-sheet__head').innerHTML = sheetHeadHTML(trip);
  el.querySelector('.wt-sheet__body').innerHTML = listHTML(trip);
  if (!el.querySelector('.wt-sheet').style.height) applySnap();
  for (const id of state.flash) el.querySelector(`.wt-stop[data-id="${id}"]`)?.classList.add('wt-stop--flash');
  state.flash.clear();
  drawMap(trip);
  linkVisiblePins();
}

// ---------- Sign in ----------
// Opening a share link signed out shows what you're joining; joining as a guest takes only a name.
let invite = { token: null, name: null };
function renderSignIn(r) {
  const joining = r.page === 'join';
  $app.innerHTML = `
    <header class="home-head"><h1 class="signin-title">${joining ? esc(invite.token === r.token && invite.name ? `Join ${invite.name}` : 'Join the trip') : 'Waythread'}</h1></header>
    <main class="signin">
      <p class="signin__text">${joining ? 'Everyone on the trip can see and edit the plan.' : 'Plan a trip together, in one place.'}</p>
      ${authHTML({ guest: true, joining })}
    </main>`;
  mountAuth($app);
  if (joining && invite.token !== r.token) {
    invite = { token: r.token, name: null };
    api(`/invite/${encodeURIComponent(r.token)}`).then(({ name }) => {
      invite.name = name;
      const h = $app.querySelector('.signin-title');
      if (h && parseHash().token === r.token) h.textContent = `Join ${name}`;
    }, () => {});
  }
}
// Google and Apple, then an emailed link, then (on the sign-in screen) going in as a guest.
function authHTML({ guest, joining }) {
  return `
    ${config.google ? '<button class="wt-btn wt-btn--secondary wt-btn--block" data-action="social" data-provider="google">Continue with Google</button>' : ''}
    ${config.apple ? '<button class="wt-btn wt-btn--secondary wt-btn--block" data-action="social" data-provider="apple">Continue with Apple</button>' : ''}
    <form class="auth-email">
      <input class="wt-input" name="email" type="email" placeholder="you@example.com" autocomplete="email" required aria-label="Email">
      <button class="wt-btn wt-btn--secondary wt-btn--block">Email me a sign-in link</button>
    </form>
    ${guest ? `<p class="signin__or">or</p>
    <form class="auth-guest">
      <input class="wt-input" name="name" placeholder="Your name" autocomplete="given-name" maxlength="40" required aria-label="Your name">
      <button class="wt-btn wt-btn--primary wt-btn--block">${joining ? 'Join as a guest' : 'Continue as a guest'}</button>
    </form>` : ''}`;
}
function mountAuth(root) {
  const email = root.querySelector('.auth-email');
  email.onsubmit = async e => {
    e.preventDefault();
    const addr = email.elements.email.value.trim();
    email.elements[1].disabled = true;
    try {
      // A guest keeps the name they gave if this email is new
      await api('/auth/sign-in/magic-link', { method: 'POST', body: { email: addr, callbackURL: callbackURL(), ...(me?.isGuest && { name: me.name }) } });
      email.outerHTML = `<p class="signin__text">Check your email. We sent a sign-in link to <b>${esc(addr)}</b>.</p>`;
    } catch {
      email.elements[1].disabled = false;
      toast('Couldn’t send the email. Try again.');
    }
  };
  const guest = root.querySelector('.auth-guest');
  if (guest) guest.onsubmit = async e => {
    e.preventDefault();
    guest.elements[1].disabled = true;
    try {
      // A guest session may already exist from an attempt that failed halfway; reuse it rather than
      // asking for another, which Better Auth refuses.
      if (!(await api('/auth/get-session'))) await api('/auth/sign-in/anonymous', { method: 'POST', body: {} });
      await api('/auth/update-user', { method: 'POST', body: { name: guest.elements.name.value.trim() } });
      me = await api('/me');
      render();
    } catch (err) {
      guest.elements[1].disabled = false;
      toast(err.code === 'offline' ? 'Couldn’t continue. Check your connection.' : 'Couldn’t continue. Try again.');
    }
  };
}

// ---------- Home ----------
function homeHTML() {
  return `
    <header class="home-head"><h1>Waythread</h1>
      <button class="wt-icon-btn" data-action="account" aria-label="Account">${avatarHTML({ name: me.name, identity: 1 })}</button></header>
    <main class="home">
      ${(trips || []).map(t => `<a class="wt-trip-card" href="#/trip/${esc(t.id)}"><span class="wt-trip-card__name">${esc(t.name)}</span><span class="wt-trip-card__dates">${fmtRange(t.start, t.end)}</span></a>`).join('')}
      <button class="wt-btn wt-btn--primary wt-btn--block" data-action="new-trip">${ICON.plus}New trip</button>
    </main>`;
}

// ---------- Trip screen: map + list sheet ----------
let map = null, layer = null, fitKey = '';
function teardownTrip() {
  if (map) { map.remove(); map = null; layer = null; fitKey = ''; }
  delete $app.dataset.trip;
  state.sel = state.leg = state.hoverLeg = null;
  state.snap = 'half';
}
function mountTrip(trip) {
  teardownTrip();
  $app.dataset.trip = trip.id;
  $app.innerHTML = `<div class="trip">
    <div id="map"></div>
    <section class="wt-sheet" aria-label="Stops">
      <div class="wt-sheet__top"><div class="wt-sheet__grab"></div><div class="wt-sheet__head"></div></div>
      <div class="wt-sheet__body"></div>
    </section>
  </div>`;
  $app.querySelector('.wt-sheet__body').addEventListener('scroll', linkVisiblePins, { passive: true });
  if (!window.L) return;
  map = L.map($app.querySelector('#map'), { zoomControl: false }).setView([32.6, -106.1], 8);
  // A quiet basemap so routes lead. Stadia needs no key on localhost; in production, register the
  // domain with Stadia. Fall back to OpenStreetMap if it's refused.
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const quiet = L.tileLayer(`https://tiles.stadiamaps.com/tiles/alidade_smooth${dark ? '_dark' : ''}/{z}/{x}/{y}{r}.png`, {
    attribution: '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 20,
  }).addTo(map);
  quiet.once('tileerror', () => {
    map.removeLayer(quiet);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19,
    }).addTo(map);
    $app.querySelector('.trip')?.classList.add('osm-tiles');
  });
  layer = L.layerGroup().addTo(map);
  map.on('click', () => {
    if (!state.sel && !state.leg) return;
    state.sel = state.leg = null;
    render();
  });
}

// People double as the share button, so the trip reads as shared at a glance.
function sheetHeadHTML(trip) {
  return `
    <a class="wt-icon-btn" href="#/" aria-label="All trips">${ICON.back}</a>
    <span class="wt-sheet__title">${esc(trip.name)}</span>
    <button class="wt-icon-btn wt-icon-btn--sm wt-icon-btn--muted" data-action="rename" aria-label="Edit trip">${ICON.edit}</button>
    <button class="wt-avatar-stack" data-action="share" aria-label="People and sharing">${trip.members.length > 1
      ? trip.members.map(avatarHTML).join('')
      : ICON.personAdd}</button>`;
}
// Check-off only matters while travelling: show it on trip days.
function onTrip(trip) {
  const s = stopsOf(trip);
  if (!s.length) return false;
  const today = TODAY || toInput(new Date()).slice(0, 10);
  return today >= s[0].time.slice(0, 10) && today <= s.at(-1).time.slice(0, 10);
}
const timeHTML = t => fmtTime(t).replace(/ (AM|PM)$/, '<span class="wt-stop__meridiem">$1</span>');
function driveHTML(from, to) {
  const r = getRoute(from, to);
  if (r && r.distance === 0) return '';
  // red when the drive is longer than the gap between the two stops — no extra element, just the color
  const late = r && r.duration > (toDate(to.time) - toDate(from.time)) / 1000;
  return `<a class="wt-drive${state.leg === to.id ? ' wt-drive--active' : ''}${late ? ' wt-drive--late' : ''}" data-leg="${to.id}" href="${directionsURL(from, to)}" target="_blank" rel="noopener">
    <span class="wt-drive__chip" aria-label="Directions in maps app${late ? ' — not enough time before the next stop' : ''}">${ICON.car}${r ? fmtDur(r.duration) : '…'}${ICON.external}</span>
  </a>`;
}
// One "Add stop", pinned to the bottom of the sheet so it's always in reach.
const addBarHTML = `<div class="wt-add-bar"><button class="wt-btn wt-btn--secondary wt-btn--block" data-action="add">${ICON.plus}Add stop</button></div>`;
// Three layers: day heading, a card per stop (time · name), and drive connectors between cards.
function listHTML(trip) {
  const stops = stopsOf(trip);
  if (!stops.length) return `<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>${addBarHTML}`;
  const checks = onTrip(trip);
  let html = '', day = '';
  stops.forEach((s, i) => {
    const d = s.time.slice(0, 10);
    if (d !== day) { day = d; html += `<h3 class="wt-day">${fmtDay(s.time)}</h3>`; }
    if (i > 0) html += driveHTML(stops[i - 1], s);
    html += `<div class="wt-stop${s.done ? ' wt-stop--done' : ''}${s.id === state.sel ? ' wt-stop--selected' : ''}" data-id="${s.id}">
      <button class="wt-stop__main" data-action="edit" data-id="${s.id}">
        <span class="wt-stop__time">${timeHTML(s.time)}</span>
        <span><span class="wt-stop__name">${esc(s.name)}</span>${s.note ? `<span class="wt-stop__note">${esc(s.note)}</span>` : ''}</span>
      </button>
      ${checks ? `<button class="wt-check" data-action="toggle-done" data-id="${s.id}" aria-label="${s.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${!!s.done}">${ICON.check}</button>` : ''}
    </div>`;
  });
  return html + addBarHTML;
}

// Sheet snaps between peek (header only), half, and full; drag the top or tap it to toggle.
function snaps() {
  const H = $app.querySelector('.trip').clientHeight;
  return { peek: $app.querySelector('.wt-sheet__top').offsetHeight, half: Math.round(H * 0.48), full: H - 48 };
}
function applySnap() {
  const sheet = $app.querySelector('.wt-sheet');
  if (!sheet) return;
  const h = snaps()[state.snap];
  sheet.style.height = `${h}px`;
  $app.querySelector('.trip').style.setProperty('--bottom-h', `${h}px`);
  setTimeout(linkVisiblePins, 300); // after the height transition
}
const drag = { active: false, moved: false, y0: 0, h0: 0, suppressClick: false };
document.addEventListener('pointerdown', e => {
  const top = e.target.closest('.wt-sheet__top');
  if (!top) return;
  Object.assign(drag, { active: true, moved: false, y0: e.clientY, h0: parseFloat(top.parentElement.style.height) || top.parentElement.offsetHeight });
});
document.addEventListener('pointermove', e => {
  if (!drag.active) return;
  const dy = drag.y0 - e.clientY;
  if (!drag.moved && Math.abs(dy) < 6) return;
  drag.moved = true;
  const sheet = $app.querySelector('.wt-sheet'), s = snaps();
  sheet.classList.add('is-dragging');
  sheet.style.height = `${Math.max(s.peek, Math.min(s.full, drag.h0 + dy))}px`;
});
document.addEventListener('pointerup', e => {
  if (!drag.active) return;
  drag.active = false;
  const sheet = $app.querySelector('.wt-sheet');
  if (!sheet) return;
  sheet.classList.remove('is-dragging');
  if (!drag.moved) {
    if (!e.target.closest?.('button, a')) { state.snap = state.snap === 'peek' ? 'half' : 'peek'; applySnap(); }
    return;
  }
  const s = snaps(), h = parseFloat(sheet.style.height);
  state.snap = Object.keys(s).reduce((a, k) => (Math.abs(s[k] - h) < Math.abs(s[a] - h) ? k : a));
  applySnap();
  drag.suppressClick = true;
  setTimeout(() => { drag.suppressClick = false; }, 50);
});
document.addEventListener('click', e => {
  if (drag.suppressClick) { drag.suppressClick = false; e.stopPropagation(); e.preventDefault(); }
}, true);
addEventListener('resize', () => {
  if (!$app.dataset.trip) return;
  applySnap();
  map?.invalidateSize();
  fitKey = '';
  scheduleRender();
});

function drawMap(trip) {
  if (!map) return;
  layer.clearLayers();
  const stops = stopsOf(trip);
  const active = state.leg || state.hoverLeg;
  const legs = legsOf(trip);
  const C = { on: token('--wt-route-active'), done: token('--wt-route-done'), muted: token('--wt-route-muted'), route: token('--wt-route'), casing: token('--wt-route-casing') };
  // draw the active route last so it sits on top
  for (const l of [...legs.filter(l => l.to.id !== active), ...legs.filter(l => l.to.id === active)]) {
    const rt = getRoute(l.from, l.to), isOn = l.to.id === active;
    const color = isOn ? C.on : l.to.done ? C.done : active ? C.muted : C.route;
    const coords = rt ? rt.coords : [[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]];
    L.polyline(coords, { color: C.casing, weight: isOn ? 11 : 8, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(coords, { color, weight: isOn ? 7 : 4.5, dashArray: rt?.ok ? null : '1 9', lineCap: 'round', interactive: false }).addTo(layer);
    // wide invisible line so the route is easy to tap
    L.polyline(coords, { opacity: 0, weight: 24, bubblingMouseEvents: false })
      .on('click', () => selectLeg(l)).addTo(layer);
  }
  // stops at the same place (fly in and out of one airport) share one pin
  const groups = new Map();
  for (const s of stops) {
    const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  pins = [];
  for (const g of groups.values()) {
    const focus = g.find(s => s.id === state.sel);
    const cls = [focus ? 'wt-pin--selected' : '', g.every(s => s.done) ? 'wt-pin--done' : ''].join(' ');
    const m = L.marker([g[0].lat, g[0].lng], {
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="wt-pin ${cls}"><i class="wt-pin__dot"></i>${focus ? `<span class="wt-pin__label">${esc(focus.name)}</span>` : ''}</div>` }),
      zIndexOffset: focus ? 1000 : 0, title: g[0].name,
    }).on('click', () => selectStop(g.find(s => !s.done) || g[0])).addTo(layer);
    pins.push({ ids: g.map(s => s.id), el: m.getElement()?.querySelector('.wt-pin') });
  }

  const pts = stops.map(s => [s.lat, s.lng]);
  const key = [trip.id, pts.length].join('|');
  if (key === fitKey) return;
  fitKey = key;
  if (pts.length === 1) map.setView(pts[0], 13);
  else if (pts.length) map.fitBounds(pts, { paddingTopLeft: [32, 32], paddingBottomRight: [32, snaps()[state.snap] + 24], maxZoom: 15 });
}
// Tapping a route highlights it and its drive in the list — the list already holds the time and the maps link.
function selectLeg(l) {
  state.leg = l.to.id;
  state.sel = null;
  if (state.snap === 'peek') state.snap = 'half';
  render();
  applySnap();
  $app.querySelector(`.wt-drive[data-leg="${l.to.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
// Pins for the stops scrolled into view stay strong; the rest step back, so list and map read as one.
let pins = [];
function linkVisiblePins() {
  const body = $app.querySelector('.wt-sheet__body');
  if (!body || !pins.length) return;
  const box = body.getBoundingClientRect();
  const rows = [...body.querySelectorAll('.wt-stop')];
  const vis = new Set(rows.filter(r => { const b = r.getBoundingClientRect(); return b.bottom > box.top + 40 && b.top < box.bottom; }).map(r => r.dataset.id));
  const linked = vis.size > 0 && vis.size < rows.length;
  for (const p of pins) p.el?.classList.toggle('wt-pin--muted', linked && !p.ids.some(id => vis.has(id)));
}
// Hovering a drive in the list previews its route on the map.
document.addEventListener('mouseover', e => {
  const id = e.target.closest?.('.wt-drive')?.dataset.leg || null;
  if (id === state.hoverLeg) return;
  state.hoverLeg = id;
  if (cur?.stops) { drawMap(cur); linkVisiblePins(); }
});
// Tapping a pin highlights its row in the list.
function selectStop(s) {
  state.leg = null;
  state.sel = s.id;
  if (state.snap === 'peek') state.snap = 'half';
  render();
  applySnap();
  $app.querySelector(`.wt-stop[data-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// Opening a stop moves it into the strip of map left visible above the edit sheet.
function focusStop(s) {
  if (!map) return;
  const H = map.getSize().y, z = Math.max(map.getZoom(), 13);
  const p = map.project([s.lat, s.lng], z).add([0, H / 2 - H * 0.2]);
  map.flyTo(map.unproject(p, z), z, { duration: 0.5 });
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
    const { name, address, lat, lng, time, note, done } = stop;
    openTripOf(trip.id)?.stops.push({ ...stop, by: me.id });
    render();
    writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PUT', body: { name, address, lat, lng, time, note, done } }));
  });
}

// ---------- Sheets ----------
const closeBtn = `<button class="wt-icon-btn" data-action="close-sheet" aria-label="Close">${ICON.close}</button>`;
const modalHead = title => `<div class="wt-modal__head"><h2 class="wt-modal__title">${title}</h2>${closeBtn}</div>`;
function openSheet(html, mount) {
  $sheets.innerHTML = `<div class="wt-modal__backdrop" data-action="close-sheet"></div><div class="wt-modal" role="dialog" aria-modal="true">${html}</div>`;
  mount?.($sheets.querySelector('.wt-modal'));
  requestAnimationFrame(() => requestAnimationFrame(() => $sheets.classList.add('is-open')));
}
function closeSheet() { $sheets.classList.remove('is-open'); $sheets.innerHTML = ''; }

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

function openRename(trip) {
  openSheet(`${modalHead('Edit trip')}
    <form><input class="wt-input" name="title" autocomplete="off" required maxlength="120" aria-label="Trip name">
    <div class="wt-modal__actions"><button type="button" class="wt-btn wt-btn--danger" data-del>Delete trip</button><button class="wt-btn wt-btn--primary">Save</button></div></form>`, el => {
    const f = el.querySelector('form');
    f.elements.title.value = trip.name;
    f.onsubmit = e => {
      e.preventDefault();
      const name = f.elements.title.value.trim();
      closeSheet();
      if (name === trip.name) return;
      const t = openTripOf(trip.id);
      if (t) t.name = name;
      render();
      save(api(`/trips/${trip.id}`, { method: 'PATCH', body: { name } }));
    };
    // Deleting is for everyone, so it asks first; it can still be undone from the notice.
    f.querySelector('[data-del]').onclick = async () => {
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
  });
}

function openShare(trip) {
  openSheet(`${modalHead('Share')}
    <p class="wt-modal__text">Anyone with the link can join and edit this trip.</p>
    <div class="wt-copy-row"><input class="wt-input" readonly value="" placeholder="Loading…" aria-label="Trip link"><button class="wt-btn wt-btn--primary" data-action="copy" disabled>Copy</button></div>
    <ul class="wt-people">${trip.members.map(m => `<li class="wt-people__item">${avatarHTML(m)}${esc(m.name)}${m.id === me.id ? ' (you)' : ''}</li>`).join('')}</ul>
    <div class="wt-modal__actions"><button class="wt-btn wt-btn--danger" data-new-link>Make a new link</button></div>`, async el => {
    const input = el.querySelector('input'), copy = el.querySelector('[data-action="copy"]');
    const show = url => { input.value = url; copy.dataset.text = url; copy.disabled = false; };
    // A new link is for when the old one went somewhere it shouldn't have: the old one stops working.
    el.querySelector('[data-new-link]').onclick = async () => {
      if (!confirm('Make a new link? The current link stops working. Everyone already on the trip stays on it.')) return;
      try { show((await api(`/trips/${trip.id}/invite/rotate`, { method: 'POST' })).url); toast('New link ready'); } catch { toast('Couldn’t make a new link'); }
    };
    try { show((await api(`/trips/${trip.id}/invite`)).url); } catch { input.placeholder = 'Couldn’t load the link'; }
  });
}

// Guests are offered a real sign-in, which keeps their trips; everyone can sign out.
function openAccount() {
  openSheet(`${modalHead('Account')}
    <ul class="wt-people"><li class="wt-people__item">${avatarHTML({ name: me.name, identity: 1 })}${esc(me.name)}${me.isGuest ? ' (guest)' : ''}</li></ul>
    ${me.isGuest ? `<p class="wt-modal__text account-guest">Sign in to keep your trips on every device.</p><div class="signin">${authHTML({ guest: false })}</div>` : ''}
    <div class="wt-modal__actions"><button class="wt-btn wt-btn--danger" data-action="sign-out">Sign out</button></div>`, el => {
    if (me.isGuest) mountAuth(el);
  });
}

// Two hours after the last stop; 9 AM tomorrow for an empty trip.
function defaultTime(trip) {
  const s = stopsOf(trip);
  let d;
  if (s.length) { d = toDate(s.at(-1).time); d.setHours(Math.min(d.getHours() + 2, 22), 0, 0, 0); }
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

// The first line is the place: it shows the stop's name (as in the list) and searching it changes the place.
function openStopSheet(trip, stop) {
  const draft = stop ? { ...stop } : { lat: null, lng: null, address: '' };
  state.leg = null;
  if (stop) { state.sel = stop.id; render(); focusStop(stop); }
  openSheet(`${modalHead(stop ? 'Edit stop' : 'Add stop')}
    <form>
      <label class="wt-field"><span class="wt-field__label">Place</span><input class="wt-input" name="title" type="search" placeholder="Search a place" autocomplete="off" required maxlength="200"></label>
      <ul class="wt-results"></ul>
      <label class="wt-field"><span class="wt-field__label">When</span><input class="wt-input" name="time" type="datetime-local" required></label>
      <label class="wt-field"><span class="wt-field__label">Note</span><textarea class="wt-input" name="note" rows="2" maxlength="2000" placeholder="Confirmation #, tickets, tips…"></textarea></label>
      <div class="wt-modal__actions">${stop ? '<button type="button" class="wt-btn wt-btn--danger" data-del>Delete</button>' : ''}<button class="wt-btn wt-btn--primary">${stop ? 'Save' : 'Add'}</button></div>
    </form>`, el => {
    const results = el.querySelector('.wt-results'), f = el.querySelector('form'), F = f.elements;
    if (stop) { F.title.value = stop.name; F.time.value = stop.time; F.note.value = stop.note || ''; }
    else { F.time.value = defaultTime(trip); setTimeout(() => F.title.focus(), 280); }

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
        if (e.name !== 'AbortError') results.innerHTML = '<li class="wt-results__msg">Search is unavailable right now</li>';
      }
    }
    results.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const p = list[+b.dataset.i];
      Object.assign(draft, { lat: p.lat, lng: p.lng, address: p.address });
      F.title.value = p.name;
      results.innerHTML = '';
    });

    f.onsubmit = e => {
      e.preventDefault();
      if (draft.lat == null) { results.innerHTML = '<li class="wt-results__msg">Pick a place from the search results</li>'; return; }
      const data = { name: F.title.value.trim(), address: draft.address, lat: draft.lat, lng: draft.lng, time: F.time.value, note: F.note.value.trim() };
      closeSheet();
      if (stop) editStop(trip, stop, data); else addStop(trip, data);
    };
    f.querySelector('[data-del]')?.addEventListener('click', () => {
      closeSheet();
      deleteStop(trip, stop);
    });
  });
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
    case 'edit': if (stop) openStopSheet(trip, stop); break;
    case 'toggle-done': if (stop) editStop(trip, stop, { done: !stop.done }); break;
    case 'share': openShare(trip); break;
    case 'rename': openRename(trip); break;
    case 'account': openAccount(); break;
    case 'social': signInSocial(el.dataset.provider); break;
    case 'sign-out': signOut(); break;
    case 'close-sheet': closeSheet(); break;
    case 'copy': navigator.clipboard?.writeText(el.dataset.text).then(() => toast('Link copied'), () => toast('Copy failed')); break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
addEventListener('hashchange', render);

boot();
