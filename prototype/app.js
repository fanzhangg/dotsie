'use strict';

/* Waythread prototype — vanilla JS, no build step.
   One trip screen: a header with the trip's name, the map, and one day of the plan in a sheet over the map,
   half the screen or the whole day.
   Data lives in localStorage; a BroadcastChannel keeps open tabs in sync to simulate co-editing
   (open the app with ?as=sam in a second tab). Routes come from the public OSRM demo server,
   place search from Nominatim. Look, components and icons come from ../design-system. */

// ---------- People (no auth in the prototype) ----------
const USERS = {
  alex: { id: 'alex', name: 'Alex', identity: 1 },
  sam: { id: 'sam', name: 'Sam', identity: 2 },
  jo: { id: 'jo', name: 'Jo', identity: 3 },
};
const params = new URLSearchParams(location.search);
const ME = USERS[params.get('as')] ? params.get('as') : 'alex';
if (ME !== 'alex') document.title += ` (${USERS[ME].name})`;
// ?today=YYYY-MM-DD pretends it's a trip day, so today's highlight can be previewed before the trip
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '') ? params.get('today') : null;

const DB_KEY = 'waythread:v2';
const ROUTE_KEY = 'waythread:routes:v1';
// One-time carry-over of data saved under the app's old name (Trippy)
for (const [from, to] of [['trippy:v2', DB_KEY], ['trippy:routes:v1', ROUTE_KEY]]) {
  try {
    const old = localStorage.getItem(from);
    if (old !== null && localStorage.getItem(to) === null) localStorage.setItem(to, old);
    localStorage.removeItem(from);
  } catch {}
}
const $app = document.getElementById('app');
const $sheets = document.getElementById('sheets');
// sel: the selected stop · selRow: which of its rows was tapped (a hotel can start and end the day) · leg: the drive whose route is shown · snap: the list, 'half' or 'full' ·
// draft: the stop open in the stop sheet, as edited so far, which the map shows in its place
const state = { sel: null, selRow: null, leg: null, hoverLeg: null, snap: 'half', day: null, draft: null, flash: new Set() };

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const avatarHTML = u => `<span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-${USERS[u].identity})">${USERS[u].name[0]}</span>`;
// Map drawing can't use CSS classes, so it reads the design tokens directly (theme-aware).
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Icons (design system) ----------
const ICON = Object.fromEntries(['home', 'settings', 'back', 'forward', 'chevron-down', 'close', 'plus', 'edit', 'car', 'external', 'directions', 'map', 'list', 'check', 'fit']
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
function fmtRange(trip) {
  const s = spotsOf(trip);
  if (!s.length) return '';
  const a = toDate(s[0].time), b = toDate(s.at(-1).time);
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

// ---------- Data ----------
function seed() {
  const t = Date.now();
  const s = (kind, name, address, lat, lng, time, note, by) => ({ id: uid(), kind, name, address, lat, lng, time, note, by, updatedAt: t });
  return {
    trips: {
      'white-sands': {
        id: 'white-sands', name: 'White Sands, NM', members: ['alex', 'sam'], createdBy: 'alex', updatedAt: t,
        spots: [
          s('airport', 'El Paso International Airport', '6701 Convair Rd, El Paso, TX', 31.8072, -106.3779, '2026-11-20T10:30', 'UA 1234 lands · rental car at Hertz', 'alex'),
          s('hotel', 'Holiday Inn Express Alamogordo', 'S White Sands Blvd, Alamogordo, NM', 32.8800, -105.9580, '2026-11-20T13:00', 'Drop bags · conf # in email', 'alex'),
          s('attraction', 'White Sands Visitor Center', '19955 US-70, Alamogordo, NM', 32.7797, -106.1717, '2026-11-20T15:00', 'Buy a sled + wax', 'sam'),
          s('nature', 'Interdune Boardwalk', 'Dunes Dr, White Sands National Park, NM', 32.7930, -106.2110, '2026-11-20T16:30', 'Sunset ~5:00 PM', 'sam'),
          s('museum', 'New Mexico Museum of Space History', '3198 NM-2001, Alamogordo, NM', 32.9214, -105.9213, '2026-11-21T09:30', '', 'alex'),
          s('restaurant', 'Cloudcroft', 'Burro Ave, Cloudcroft, NM', 32.9573, -105.7428, '2026-11-21T12:30', 'Lunch', 'sam'),
          s('airport', 'El Paso International Airport', '6701 Convair Rd, El Paso, TX', 31.8072, -106.3779, '2026-11-22T11:00', 'Fly home · return car by 10:00', 'alex'),
        ],
      },
    },
  };
}
function loadDB() {
  try { const d = JSON.parse(localStorage.getItem(DB_KEY)); if (d && d.trips) return d; } catch {}
  const d = seed();
  localStorage.setItem(DB_KEY, JSON.stringify(d));
  return d;
}
let db = loadDB();

// Read-modify-write against the latest copy so edits from other tabs aren't clobbered.
function mutate(fn) {
  db = loadDB();
  fn(db);
  localStorage.setItem(DB_KEY, JSON.stringify(db));
  bc?.postMessage({ type: 'sync' });
  render();
}
function editSpot(tripId, spotId, fields) {
  mutate(d => {
    const t = d.trips[tripId], s = t?.spots.find(x => x.id === spotId);
    if (!s) return;
    Object.assign(s, fields, { by: ME, updatedAt: Date.now() });
    t.updatedAt = Date.now();
    t.lastBy = ME;
  });
}

const spotsOf = trip => [...trip.spots].sort((a, b) => a.time.localeCompare(b.time));

// ---------- Days: the trip screen shows one day at a time ----------
const dayOf = s => s.time.slice(0, 10);
function addDays(day, n) { const d = toDate(day); d.setDate(d.getDate() + n); return toInput(d).slice(0, 10); }
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
const samePlace = (a, b) => a.lat === b.lat && a.lng === b.lng;

// Hotels are stays, not just stops: you check in, sleep there, and start the next morning from there.
// A hotel lasts its nights; left unset, it lasts until the next hotel, or the trip's last day.
function staysOf(trip) {
  const spots = spotsOf(trip), hotels = spots.filter(s => kindOf(s) === 'hotel');
  const lastDay = spots.length ? dayOf(spots.at(-1)) : null;
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
  const days = new Set(spotsOf(trip).map(dayOf));
  for (const st of staysOf(trip)) for (let d = st.checkIn; d <= st.checkOut; d = addDays(d, 1)) days.add(d);
  return [...days].sort();
}
// Today on a trip day, else the first day. If the day's stops are gone (deleted, moved), the next day that has some.
function currentDay(trip) {
  const days = daysOf(trip);
  if (!days.length) return null;
  if (!state.day) state.day = onTrip(trip) ? TODAY || toInput(new Date()).slice(0, 10) : days[0];
  if (!days.includes(state.day)) state.day = days.find(d => d > state.day) || days.at(-1);
  return state.day;
}
const daySpots = (trip, day) => spotsOf(trip).filter(s => dayOf(s) === day);

// A day as you'll live it: wake up at last night's hotel, the day's stops, then back to tonight's hotel.
// Each entry is a place with a role. With no hotel the night before, the day starts from the day before's last stop.
function dayPlan(trip, day) {
  const stops = daySpots(trip, day), plan = [];
  const morning = stayOnNight(trip, addDays(day, -1));
  if (morning) plan.push({ key: `wake:${morning.s.id}:${day}`, place: morning.s, role: morning.checkOut === day ? 'checkout' : 'wake' });
  else {
    const prev = spotsOf(trip).filter(s => dayOf(s) < day).at(-1);
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
// The colors skip blue (routes) and red (a drive that doesn't fit).
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
// A first guess from the place's name, and from its OpenStreetMap category when it came from search.
function guessKind(name = '', osm = '') {
  const is = (tags, words) => tags.test(osm) || words.test(name);
  if (is(/aerodrome|airport/, /airport|\bintl\b/i)) return 'airport';
  if (is(/hotel|motel|hostel|guest_house|camp_site|chalet/, /hotel|\binn\b|motel|lodge|resort|hostel/i)) return 'hotel';
  if (is(/cafe/, /caf[eé]|coffee|bakery/i)) return 'cafe';
  if (is(/restaurant|fast_food|food_court|:bar|:pub/, /restaurant|grill|diner|bistro|pizz|taco|bbq|kitchen/i)) return 'restaurant';
  if (is(/museum|gallery/, /museum|gallery/i)) return 'museum';
  if (is(/viewpoint/, /viewpoint|overlook|lookout|vista/i)) return 'viewpoint';
  if (is(/fuel/, /\bgas\b|fuel/i)) return 'gas';
  if (is(/natural|:park|nature_reserve|beach|peak/, /park|trail|boardwalk|forest|lake|canyon|dunes|beach|falls/i)) return 'nature';
  if (is(/shop|mall|marketplace/, /mall|market|outlet|shop/i)) return 'shopping';
  if (is(/attraction|theme_park|zoo|historic|monument/, /visitor center|monument|memorial|zoo|castle/i)) return 'attraction';
  return 'place';
}
// Untyped stops are guessed from the name; a bare town with "Lunch" in its note is a meal.
const kindOf = s => (KINDS[s.kind] ? s.kind : guessKind(s.name) !== 'place' ? guessKind(s.name) : /\b(breakfast|brunch|lunch|dinner)\b/i.test(s.note || '') ? 'restaurant' : 'place');
const kindColor = s => `var(--wt-kind-${KINDS[kindOf(s)].group})`;
const kindIcon = (s, size = 16) => WaythreadIcons.svg(KINDS[kindOf(s)].icon, size);

// ---------- Routes (OSRM): only the line and drive time; navigation is handed to the maps app ----------
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
    routeQueue = routeQueue.then(() => fetchRoute(a, b, k)); // one at a time: the demo server is rate limited
  }
  return null;
}
async function fetchRoute(a, b, k) {
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${k}?overview=full&geometries=geojson`);
    const j = await res.json();
    if (j.code !== 'Ok') throw new Error(j.code);
    const rt = j.routes[0];
    routes[k] = {
      ok: true, duration: rt.duration, distance: rt.distance,
      coords: rt.geometry.coordinates.map(([x, y]) => [+y.toFixed(5), +x.toFixed(5)]),
    };
    try { localStorage.setItem(ROUTE_KEY, JSON.stringify(Object.fromEntries(Object.entries(routes).filter(([, v]) => v.ok)))); } catch {}
  } catch {
    // Offline or rate limited: straight-line estimate so the plan still reads. Not persisted, so it retries next load.
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

// ---------- Sync between tabs ----------
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('waythread') : null;
if (bc) bc.onmessage = ({ data: m }) => {
  if (m.type !== 'sync') return;
  const old = db;
  db = loadDB();
  announce(old, db);
  scheduleRender();
};
function announce(a0, b0) {
  const id = parseHash().id;
  const a = a0.trips[id], b = b0.trips[id];
  if (!a || !b) return;
  const before = new Map(a.spots.map(s => [s.id, s]));
  const after = new Set(b.spots.map(s => s.id));
  const msgs = [];
  for (const s of b.spots) {
    const o = before.get(s.id);
    if (s.by === ME || (o && o.updatedAt === s.updatedAt)) continue;
    const verb = o ? 'updated' : 'added';
    msgs.push(`${USERS[s.by]?.name || 'Someone'} ${verb} ${s.name}`);
    state.flash.add(s.id);
  }
  if (b.lastBy !== ME) for (const o of a.spots) if (!after.has(o.id)) msgs.push(`${USERS[b.lastBy]?.name || 'Someone'} removed ${o.name}`);
  if (msgs.length) toast(msgs.length === 1 ? msgs[0] : `${msgs[0]} + ${msgs.length - 1} more`);
}

// ---------- Routing (hash) ----------
function parseHash() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  if (p[0] === 'trip' && p[1]) return { page: 'trip', id: decodeURIComponent(p[1]) };
  return { page: 'home' };
}
// setTimeout rather than rAF: rAF is paused in background tabs, and co-editors' changes should land there too
let renderTimer = 0;
function scheduleRender() { if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 16); }

function render() {
  const r = parseHash();
  if (r.page !== 'trip') { teardownTrip(); $app.innerHTML = homeHTML(); return; }
  const trip = db.trips[r.id];
  if (!trip) {
    teardownTrip();
    $app.innerHTML = '<p class="wt-empty">Trip not found. <a href="#/">All trips</a></p>';
    return;
  }
  if (!trip.members.includes(ME)) { // opening a shared link is the invite
    mutate(d => d.trips[trip.id].members.push(ME));
    toast(`You joined ${trip.name}`);
    return;
  }
  if ($app.dataset.trip !== trip.id) mountTrip(trip);
  const el = $app.querySelector('.trip');
  el.querySelector('.wt-trip-head__name').textContent = trip.name;
  const bar = el.querySelector('.wt-day-bar');
  const topH = el.querySelector('.wt-sheet__top').offsetHeight;
  bar.innerHTML = dayBarHTML(trip);
  bar.hidden = !trip.spots.length;
  renderList(trip);
  renderAddBar(trip);
  if (!el.querySelector('.wt-sheet').style.height || topH !== el.querySelector('.wt-sheet__top').offsetHeight) applySnap();
  for (const id of state.flash) el.querySelector(`.wt-tl-stop[data-id="${id}"]`)?.classList.add('is-flash');
  state.flash.clear();
  drawMap(trip);
  updateFitBtn();
}

// ---------- Home ----------
function homeHTML() {
  const trips = Object.values(db.trips).filter(t => t.members.includes(ME)).sort((a, b) => b.updatedAt - a.updatedAt);
  return `
    <header class="home-head"><h1>Waythread</h1></header>
    <main class="home">
      ${trips.map(t => `<a class="wt-trip-card" href="#/trip/${t.id}"><span class="wt-trip-card__name">${esc(t.name)}</span><span class="wt-trip-card__dates">${fmtRange(t)}</span></a>`).join('')}
      <button class="wt-btn wt-btn--primary wt-btn--block" data-action="new-trip">${ICON.plus}New trip</button>
    </main>`;
}

// ---------- Trip screen: map + list sheet ----------
let map = null, layer = null, fitKey = '';
// The map's credits live in trip settings rather than over the map.
const CREDIT = {
  stadia: '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  osm: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
let mapCredit = CREDIT.stadia;
function teardownTrip() {
  if (map) { map.remove(); map = null; layer = null; fitKey = ''; }
  const left = $app.dataset.trip;
  delete $app.dataset.trip;
  state.sel = state.selRow = state.leg = state.hoverLeg = state.day = state.draft = null;
  state.snap = 'half';
  camFree = false;
  clearTimeout(mapTapTimer);
  dayShown = false;
  // the stop sheet leaves the header in reach, so Home can be tapped while it's open
  if (left && $sheets.innerHTML) closeSheet();
}
function mountTrip(trip) {
  teardownTrip();
  $app.dataset.trip = trip.id;
  // The plan is the page: a header with the trip's name, the map under it, and a sheet with one day of the plan,
  // half the screen or the whole day. Map/List in the header switches between them.
  $app.innerHTML = `<div class="trip">
    <header class="wt-trip-head">
      <a class="wt-icon-btn" href="#/" aria-label="All trips">${ICON.home}</a>
      <h1 class="wt-trip-head__name"></h1>
      <button class="wt-icon-btn" data-action="settings" aria-label="Trip settings and sharing">${ICON.settings}</button>
    </header>
    <div id="map"></div>
    <button class="wt-icon-btn wt-map-btn trip-fit" data-action="fit-day" aria-label="Show the whole day on the map" title="Whole day" hidden>${ICON.fit}</button>
    <section class="wt-sheet" aria-label="Plan">
      <div class="wt-sheet__top"><button class="wt-sheet__grab" data-action="grab"></button><div class="wt-day-bar" hidden></div></div>
      <div class="wt-sheet__body wt-tl"></div>
      <div class="wt-add-bar"></div>
    </section>
  </div>`;
  if (!window.L) return;
  // double-tap zoom is our own (see mapGestures), so it works over routes and pins too
  map = L.map($app.querySelector('#map'), { zoomControl: false, attributionControl: false, doubleClickZoom: false }).setView([32.6, -106.1], 8);
  // A quiet basemap so routes lead (Stadia needs no key on localhost); fall back to OpenStreetMap if it's refused.
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  mapCredit = CREDIT.stadia;
  const quiet = L.tileLayer(`https://tiles.stadiamaps.com/tiles/alidade_smooth${dark ? '_dark' : ''}/{z}/{x}/{y}{r}.png`, { maxZoom: 20 }).addTo(map);
  quiet.once('tileerror', () => {
    map.removeLayer(quiet);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    mapCredit = CREDIT.osm;
    $app.querySelector('.trip')?.classList.add('osm-tiles');
  });
  layer = L.layerGroup().addTo(map);
  // once you've touched the map, a new sheet height leaves the camera where you put it
  map.getContainer().addEventListener('pointerdown', () => { camFree = true; });
  // Zooming the map is looking at the map: the list gets out of the way, down to its peek.
  const zooming = () => { if (!state.draft && state.snap === 'half') setSnap('peek'); };
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
  const trip = db.trips[parseHash().id], day = trip && currentDay(trip), v = map && day && dayView(trip, day);
  if (!v) return true;
  return Math.abs(map.getZoom() - v.zoom) < 0.01 && map.latLngToContainerPoint(v.center).distanceTo(map.getSize().divideBy(2)) < 3;
}
function updateFitBtn() {
  const btn = $app.querySelector('.trip-fit');
  if (!btn) return;
  const trip = db.trips[parseHash().id];
  btn.hidden = !map || !trip || !currentDay(trip) || !!state.draft || state.snap === 'full' || (dayShown && !state.leg);
}
function showWholeDay() {
  state.leg = null;
  fitKey = '';
  render();
}

// Is today one of the trip's days? Then the trip opens on today, with what's happening now highlighted.
function onTrip(trip) {
  const days = daysOf(trip);
  const today = TODAY || toInput(new Date()).slice(0, 10);
  return days.length > 0 && today >= days[0] && today <= days.at(-1);
}
const timeHTML = t => fmtTime(t).replace(/ (AM|PM)$/, '<span class="wt-tl-meridiem">$1</span>');
const markerHTML = (s, cls) => `<i class="wt-marker ${cls}" role="img" aria-label="${KINDS[kindOf(s)].label}" style="--wt-kind-color: ${kindColor(s)}">${kindIcon(s)}</i>`;

// ---------- Timeline: time · rail · stop. Each stop's marker is its pin on the map: same icon, same color. ----------
const gapMin = (a, b) => (toDate(b.time) - toDate(a.time)) / 60000;
// "Now" as a "YYYY-MM-DDTHH:MM" stamp; ?today= and ?now=HH:MM pretend, to preview a trip day.
const NOW_HM = /^\d{2}:\d{2}$/.test(params.get('now') || '') ? params.get('now') : null;
function nowStamp() {
  const real = toInput(new Date());
  return `${TODAY || real.slice(0, 10)}T${NOW_HM || real.slice(11)}`;
}
// A drive reads as a sentence ("1 hr 49 min drive"), with a small car on the rail, says when it won't make it,
// and has a Directions icon button. Tapping the row shows the route on the map.
// With no hotel last night, the first drive names where it starts.
// Rows take `row`: { key, past (over: dimmed), now (happening now: highlighted), sel (the selected row) }.
const rowState = (past, now) => `${past ? ' is-past' : ''}${now ? ' is-now' : ''}`;
function driveItem(day, leg) {
  const { r, from, to, fromEntry, toEntry } = leg, late = lateMin(leg);
  const cls = ['wt-tl-drive', state.leg === leg.key ? 'is-active' : '', late > 0 ? 'is-late' : ''];
  return {
    // when you set off (until the route is in, no earlier than you arrive); the drive back to the hotel has no time, so it comes last
    start: leg.leave || leg.arrive || (toEntry.role === 'night' ? `${day}T23:58` : fromEntry.place.time),
    html: ({ past, now }) => `<div class="${cls.join(' ')}${rowState(past, now)}" data-leg="${leg.key}" data-action="leg" tabindex="0" role="group" aria-label="${r ? fmtDur(r.duration) : ''} drive to ${esc(to.name)}. Show the route on the map">
      <span class="wt-tl-rail"><i class="wt-tl-car">${ICON.car}</i></span>
      <span class="wt-tl-drive__body">
        <span class="wt-tl-drive__what"><b>${r ? fmtDur(r.duration) : '…'}</b> drive</span>
        ${fromEntry.role === 'from' ? `<span class="wt-tl-drive__from">from ${esc(from.name)}</span>` : ''}
        ${late > 0 ? `<span class="wt-tl-drive__late">Arrives ${fmtDur(late * 60)} late</span>` : ''}
      </span>
      <a class="wt-icon-btn wt-tl-drive__go" href="${directionsURL(from, to)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(to.name)} in your maps app" title="Directions">${ICON.directions}</a>
    </div>`,
  };
}
// A stop row: marker · name · time, with its notes below across the name and time. A hotel on its check-in day says how many nights.
// Tapping it selects it: the row and its pin are highlighted, and Add stop becomes Edit stop. Tapping it again clears that.
function stopRow(s, { key, past, now, sel }, note, time) {
  const notes = note.filter(Boolean);
  return `<button class="wt-tl-stop${sel ? ' is-selected' : ''}${rowState(past, now)}" data-action="select" data-id="${s.id}" data-row="${esc(key)}" aria-pressed="${!!sel}" style="--wt-kind-color: ${kindColor(s)}">
      <span class="wt-tl-rail">${markerHTML(s, 'wt-tl-marker')}</span>
      <span class="wt-tl-name">${esc(s.name)}</span>${notes.length ? `<span class="wt-tl-notes">${notes.map(n => `<span class="wt-tl-note">${esc(n)}</span>`).join('')}</span>` : ''}
      <span class="wt-tl-time">${time ? timeHTML(time) : ''}</span>
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
// The selected stop, if it's still in the trip (another tab may have deleted it).
const selectedSpot = trip => (state.sel && trip.spots.find(s => s.id === state.sel)) || null;
// Pinned to the bottom of the sheet, always in reach: Add stop, or, with a stop selected, Edit stop and a small +
// so adding stays one tap away.
function addBarHTML(trip) {
  const s = selectedSpot(trip);
  return s
    ? `<button class="wt-btn wt-btn--primary wt-btn--block" data-action="edit" data-id="${s.id}">${ICON.edit}Edit stop</button><button class="wt-btn wt-btn--secondary wt-btn--icon" data-action="add" aria-label="Add stop" title="Add stop">${ICON.plus}</button>`
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
  for (const e of dayPlan(trip, day)) {
    const leg = legs.get(e.key);
    if (leg && !(leg.r && leg.r.distance === 0)) items.push({ leg: leg.key, ...driveItem(day, leg) });
    if (e.role === 'stop') items.push({ entry: e, ...stopItem(trip, e.place) });
    else if (e.role !== 'from') items.push({ entry: e, ...hotelItem(day, e) });
  }
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

function renderList(trip) {
  const body = $app.querySelector('.wt-sheet__body'), day = currentDay(trip);
  body.innerHTML = listHTML(trip, day);
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
  const trip = db.trips[parseHash().id];
  if (!trip || !daysOf(trip).includes(d) || d === state.day) return;
  state.day = d;
  state.sel = state.selRow = state.leg = state.hoverLeg = null;
  render();
}
function stepDay(n) {
  const trip = db.trips[parseHash().id];
  if (!trip) return;
  const days = daysOf(trip);
  setDay(days[days.indexOf(currentDay(trip)) + n]);
}

// The list has three heights on a phone, like a maps app's sheet: peek (the day bar only, so the map has the
// screen), half (the default), and full (the whole day, docked under the header). It never hides.
// You move it by dragging: the grab handle, the day bar, or the list itself. Dragging the list up grows the sheet
// before the list scrolls; at full, pulling the list down from its top shrinks the sheet again.
const SNAPS = ['peek', 'half', 'full'];
function snaps() {
  const H = $app.querySelector('.trip').clientHeight;
  // peeking keeps only the day bar, with the add bar's bottom padding (and the safe area) below it; Add stop alone
  // under an empty sheet looked like a day with no stops
  const pad = parseFloat(getComputedStyle($app.querySelector('.wt-add-bar')).paddingBottom) || 0;
  return { peek: Math.round($app.querySelector('.wt-sheet__top').offsetHeight + pad), half: Math.round(H * 0.48), full: H - headBottom() };
}
const GRAB_LABEL = { peek: "Show the day's plan", half: 'Show the whole day', full: 'Show more of the map' };
function applySnap() {
  const trip = $app.querySelector('.trip'), sheet = trip?.querySelector('.wt-sheet');
  if (!sheet) return;
  const wide = false, h = wide ? 0 : snaps()[state.snap];
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
  const trip = db.trips[parseHash().id];
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
  if (!e.target.closest('.wt-sheet__top')) return;
  dragStart(e.clientY, null);
});
document.addEventListener('pointermove', e => { if (drag.active && !drag.list) dragMove(e.clientY); });
document.addEventListener('pointerup', () => { if (drag.active && !drag.list) dragEnd(); });
// The list, with a finger: below full it moves the sheet; at full, only a pull down from its top does,
// and otherwise it scrolls as usual.
document.addEventListener('touchstart', e => {
  const list = e.target.closest?.('.wt-sheet__body');
  if (!list || e.touches.length > 1) return;
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
  if (state.snap === 'peek' && e.target.closest('.wt-sheet') && !e.target.closest('button, a')) { e.stopPropagation(); setSnap('half'); }
}, true);
addEventListener('resize', () => {
  if (!$app.dataset.trip) return;
  applySnap();
  map?.invalidateSize();
  fitKey = '';
  scheduleRender();
});

// How much of the map's bottom is covered: by the open stop's sheet, or else by the list. At full the map
// doesn't show, so the camera is placed for half, where the list goes back to.
function coveredBottom() {
  const panel = state.draft && $sheets.querySelector('.wt-modal');
  return panel ? panel.offsetHeight : snaps()[state.snap === 'peek' ? 'peek' : 'half'];
}
// The header card covers the map's top on a phone.
const headBottom = () => { const h = $app.querySelector('.wt-trip-head'); return h.offsetTop + h.offsetHeight; };
const coveredTop = () => (headBottom());
// Is this point in the part of the map you can see, with room to spare for its label?
function inView(ll, margin = 40) {
  const top = coveredTop();
  const p = map.latLngToContainerPoint(ll), size = map.getSize();
  return p.x > margin && p.x < size.x - margin && p.y > top + margin && p.y < size.y - coveredBottom() - margin;
}

function drawMap(trip) {
  if (!map) return;
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
    const focus = end || g.find(s => s.id === state.sel);
    const cls = [focus ? 'wt-pin--selected' : '', quiet && !focus ? 'wt-pin--muted' : ''].join(' ');
    const label = focus ? `<span class="wt-pin__label${end && end === lower ? ' wt-pin__label--below' : ''}">${esc(focus.name)}</span>` : '';
    L.marker([all[0].lat, all[0].lng], {
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="wt-pin ${cls}">${markerHTML(focus || g[0] || start, 'wt-pin__marker')}${label}</div>` }),
      zIndexOffset: focus ? 1000 : quiet ? -1000 : 0, title: all[0].name,
    }).on('click', () => onMapTap(() => {
      if (state.draft) return;
      if (g.length) selectSpot(g[0]); else { setDay(dayOf(start)); selectSpot(start); }
    })).addTo(layer);
  }
  drawDraft();

  const key = [trip.id, day, plan.length].join('|');
  if (key === fitKey || state.draft) return;
  fitKey = key;
  camFree = false;
  if (active && state.leg) return fitLeg(active);
  const v = dayView(trip, day);
  if (v) map.setView(v.center, v.zoom);
  dayShown = true;
}
// Where the camera goes for a day: around all its places, clear of the header and the list.
// This is fitBounds worked out by hand (as Leaflet does it), so Whole day can tell whether the map is already there.
function dayView(trip, day) {
  const pts = dayPlan(trip, day).map(e => [e.place.lat, e.place.lng]);
  if (!pts.length) return null;
  if (new Set(pts.map(String)).size === 1) return { center: L.latLng(pts[0]), zoom: 13 };
  const tl = L.point(32, coveredTop() + 24), br = L.point(32, coveredBottom() + 24), bounds = L.latLngBounds(pts);
  const zoom = Math.min(map.getBoundsZoom(bounds, false, tl.add(br)), 15);
  const sw = map.project(bounds.getSouthWest(), zoom), ne = map.project(bounds.getNorthEast(), zoom);
  return { center: map.unproject(sw.add(ne).divideBy(2).add(br.subtract(tl).divideBy(2)), zoom), zoom };
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
  map.fitBounds(legCoords(l), { paddingTopLeft: [72, coveredTop() + 48], paddingBottomRight: [72, coveredBottom() + 48], maxZoom: 15 });
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
  // once the list has shrunk, so the row stays in what's left of it
  setTimeout(() => $app.querySelector(`.wt-tl-drive[data-leg="${CSS.escape(l.key)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), shrink ? 260 : 0);
}
// Hovering a drive in the list previews its route on the map, without moving the map.
document.addEventListener('mouseover', e => {
  const id = e.target.closest?.('.wt-tl-drive')?.dataset.leg || null;
  if (id === state.hoverLeg) return;
  state.hoverLeg = id;
  const trip = db.trips[parseHash().id];
  if (trip) drawMap(trip);
});
// Select a stop: its row and its pin are highlighted, and Add stop becomes Edit stop.
// Tapping a pin scrolls its row into view. Tapping a row (`row`, its key) moves the pin into view if it's
// off the map you can see, keeping the zoom; tapping the selected row again clears the selection.
function selectSpot(s, row = null) {
  if (row && state.sel === s.id && $app.querySelector('.wt-tl-stop.is-selected')?.dataset.row === row) {
    state.sel = state.selRow = null;
    render();
    return;
  }
  if (state.leg) fitKey = '';
  state.leg = null;
  state.sel = s.id;
  state.selRow = row;
  const shrink = state.snap === 'full';
  // coming down from the whole day re-frames the map for the day, which already shows this stop
  const framed = shrink && !camFree;
  setSnap('half'); // the whole-day list covers the map
  render();
  if (row && !framed && map && s.lat != null && !inView([s.lat, s.lng])) {
    const z = map.getZoom(), p = map.project([s.lat, s.lng], z).add([0, (coveredBottom() - coveredTop()) / 2]);
    map.panTo(map.unproject(p, z), { duration: 0.5 });
  }
  // once the list has shrunk, so the row stays in what's left of it
  setTimeout(() => $app.querySelector('.wt-tl-stop.is-selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), shrink ? 260 : 0);
}
// Move a place into the middle of the map you can see, above the stop sheet.
function focusSpot(s) {
  if (!map || s.lat == null) return;
  const z = Math.max(map.getZoom(), 13);
  const p = map.project([s.lat, s.lng], z).add([0, (coveredBottom() - coveredTop()) / 2]);
  map.flyTo(map.unproject(p, z), z, { duration: 0.5 });
}

// ---------- Sheets ----------
const closeBtn = `<button class="wt-icon-btn" data-action="close-sheet" aria-label="Close">${ICON.close}</button>`;
// A long form's head can stay put while its fields scroll (sticky), so Close is always in reach
const modalHead = (title, sticky) => `<div class="wt-modal__head${sticky ? ' wt-modal__head--sticky' : ''}"><h2 class="wt-modal__title">${title}</h2>${closeBtn}</div>`;
// A panel (the stop sheet) has no backdrop, so the map stays in view and usable above it.
// onClose runs however the sheet goes away: closed, replaced by another sheet, or left with the trip.
let onSheetClose = null;
function openSheet(html, mount, { panel = false, onClose = null } = {}) {
  runSheetClose();
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
    <form><input class="wt-input" name="title" placeholder="Trip to White Sands, NM" autocomplete="off" required aria-label="Trip name">
    <div class="wt-modal__actions"><button class="wt-btn wt-btn--primary">Create</button></div></form>`, el => {
    const f = el.querySelector('form');
    f.elements.title.focus();
    f.onsubmit = e => {
      e.preventDefault();
      const id = uid();
      mutate(d => { d.trips[id] = { id, name: f.elements.title.value.trim(), members: [ME], createdBy: ME, spots: [], updatedAt: Date.now() }; });
      closeSheet();
      location.hash = `#/trip/${id}`;
    };
  });
}

// Everything about the trip that isn't the plan: its name, who's on it, sharing, and deleting it.
function openSettings(trip) {
  const base = location.origin + location.pathname;
  const link = `${base}#/trip/${trip.id}`;
  const others = Object.values(USERS).filter(u => u.id !== ME);
  openSheet(`${modalHead('Trip settings')}
    <form>
      <label class="wt-field"><span class="wt-field__label">Name</span><input class="wt-input" name="title" autocomplete="off" required></label>
      <div class="wt-field"><span class="wt-field__label">People</span>
        <ul class="wt-people">${trip.members.filter(u => USERS[u]).map(u => `<li class="wt-people__item">${avatarHTML(u)}${USERS[u].name}${u === ME ? ' (you)' : ''}</li>`).join('')}</ul>
      </div>
      <p class="wt-modal__text">Anyone with the link can edit this trip.</p>
      <div class="wt-copy-row"><input class="wt-input" readonly value="${esc(link)}" aria-label="Trip link"><button type="button" class="wt-btn wt-btn--secondary" data-action="copy" data-text="${esc(link)}">Copy</button></div>
      <div class="wt-modal__actions"><button type="button" class="wt-btn wt-btn--danger" data-del>Delete trip</button><button class="wt-btn wt-btn--primary">Save</button></div>
    </form>
    <p class="wt-credit">Map ${mapCredit}</p>
    <div class="proto-note"><b>Prototype:</b> try co-editing — open this trip
      ${others.map(u => `<a href="${base}?as=${u.id}#/trip/${trip.id}" target="_blank">as ${u.name}</a>`).join(' or ')} in another tab.
      ${trip.spots.length ? `Trip days highlight what's happening now: <a href="${base}?today=${spotsOf(trip)[0].time.slice(0, 10)}&now=14:10#/trip/${trip.id}">preview day 1 at 2:10 PM</a>.` : ''}</div>`, el => {
    const f = el.querySelector('form');
    f.elements.title.value = trip.name;
    f.onsubmit = e => {
      e.preventDefault();
      mutate(d => { const t = d.trips[trip.id]; if (t) { t.name = f.elements.title.value.trim(); t.updatedAt = Date.now(); t.lastBy = ME; } });
      closeSheet();
    };
    f.querySelector('[data-del]').onclick = () => {
      if (!confirm(`Delete “${trip.name}” for everyone?`)) return;
      mutate(d => { delete d.trips[trip.id]; });
      closeSheet();
      location.hash = '#/';
    };
  });
}

// Two hours after the day's last stop; 9 AM on a day with none yet (a hotel day), or 9 AM tomorrow for an empty trip.
function defaultTime(trip) {
  const day = currentDay(trip), s = daySpots(trip, day);
  let d;
  if (s.length) { d = toDate(s.at(-1).time); d.setHours(Math.min(d.getHours() + 2, 22), 0, 0, 0); }
  else if (day) { d = toDate(day); d.setHours(9, 0, 0, 0); }
  else { d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  return toInput(d);
}
function viewbox(trip) {
  if (!trip.spots.length) return '';
  const lats = trip.spots.map(s => s.lat), lngs = trip.spots.map(s => s.lng), p = 1.5;
  return `&viewbox=${Math.min(...lngs) - p},${Math.max(...lats) + p},${Math.max(...lngs) + p},${Math.min(...lats) - p}`;
}
// Nominatim's display_name is "Name, number, street, town, county, state, zip, country": keep the useful middle.
function placeOf(p) {
  const parts = p.display_name.split(', ');
  const rest = parts.slice(1).filter(x => x !== 'United States' && !/^\d{5}(-\d{4})?$/.test(x));
  return { name: p.name || parts[0], address: rest.slice(0, 4).join(', ') };
}

// A hotel you add starts at a 3 PM check-in, and checks out at 11 AM unless you set another time.
const HOTEL_CHECK_IN = '15:00', HOTEL_CHECK_OUT = '11:00';
const checkoutOf = s => s.checkout || HOTEL_CHECK_OUT;

// The stop sheet is a panel: the map stays in view above it and shows the stop as you edit it,
// at the place you picked, with the type you chose.
// The first line is the place: it shows the stop's name (as in the list) and searching it changes the place.
// Type is one row that opens the types on a page of their own; it starts as a guess from the place you pick,
// until you choose one yourself.
function openSpotSheet(trip, spot) {
  if ($sheets.innerHTML) closeSheet();
  const draft = spot ? { ...spot, kind: kindOf(spot) } : { lat: null, lng: null, address: '', name: '', kind: 'place' };
  let chosen = !!spot, saved = false;
  const camera = map && { center: map.getCenter(), zoom: map.getZoom() };
  state.leg = null;
  if (state.sel !== spot?.id) state.selRow = null;
  state.sel = spot?.id || null;
  state.draft = draft;
  $app.querySelector('.trip')?.classList.add('is-editing');
  render();
  const option = ([k, v]) => `<li><button type="button" class="wt-option" role="radio" data-kind="${k}">${markerHTML({ kind: k }, '')}<span class="wt-option__label">${v.label}</span>${ICON.check}</button></li>`;
  openSheet(`<div class="stop-main">${modalHead(spot ? 'Edit stop' : 'Add stop', true)}
    <form>
      <label class="wt-field"><span class="wt-field__label">Place</span><input class="wt-input" name="title" type="search" placeholder="Search a place" autocomplete="off" required></label>
      <ul class="wt-results"></ul>
      <div class="wt-field"><span class="wt-field__label" id="kind-label">Type</span>
        <button type="button" class="wt-picker" data-kind-open aria-describedby="kind-label"></button></div>
      <label class="wt-field"><span class="wt-field__label" data-when>When</span><input class="wt-input" name="time" type="datetime-local" required></label>
      <label class="wt-field wt-stay" hidden><span class="wt-field__label">Check-out</span><input class="wt-input" name="checkout" type="datetime-local"></label>
      <label class="wt-field"><span class="wt-field__label">Note</span><textarea class="wt-input" name="note" rows="2" placeholder="Confirmation #, tickets, tips…"></textarea></label>
      <div class="wt-modal__actions wt-modal__actions--sticky">${spot ? '<button type="button" class="wt-btn wt-btn--danger" data-del>Delete</button>' : ''}<button class="wt-btn wt-btn--primary">${spot ? 'Save' : 'Add'}</button></div>
    </form></div>
    <div class="stop-kinds" hidden>
      <div class="wt-modal__head wt-modal__head--sub wt-modal__head--sticky"><button type="button" class="wt-icon-btn" data-kind-back aria-label="Back">${ICON.back}</button><h2 class="wt-modal__title">Type</h2></div>
      <ul class="wt-options" role="radiogroup" aria-label="Type">${Object.entries(KINDS).map(option).join('')}</ul>
    </div>`, el => {
    const results = el.querySelector('.wt-results'), f = el.querySelector('form'), F = f.elements;
    const main = el.querySelector('.stop-main'), kindsPage = el.querySelector('.stop-kinds'), picker = el.querySelector('[data-kind-open]');
    // The time is yours once you've touched it; until then a new hotel's starts at check-in time
    let timeTouched = !!spot;
    if (spot) { F.title.value = spot.name; F.time.value = spot.time; F.note.value = spot.note || ''; }
    else { F.time.value = defaultTime(trip); setTimeout(() => F.title.focus(), 280); }

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
      drawMap(trip);
    }

    // ----- A hotel is a stay: When becomes check-in, then Check-out, a day and time. The nights are the days
    // between them. Left alone, check-out follows the trip (the next hotel, or the last day). -----
    let nights = spot?.nights >= 1 ? spot.nights : null, outTime = spot ? checkoutOf(spot) : HOTEL_CHECK_OUT;
    const stay = el.querySelector('.wt-stay'), inDay = () => F.time.value.slice(0, 10);
    let shownIn = inDay();
    function autoNights() {
      const day = inDay(), later = spotsOf(trip).filter(s => s.id !== spot?.id && dayOf(s) > day);
      const nextHotel = later.find(s => kindOf(s) === 'hotel');
      return Math.max(1, daysBetween(day, nextHotel ? dayOf(nextHotel) : later.length ? dayOf(later.at(-1)) : addDays(day, 1)));
    }
    function showNights() {
      const hotel = draft.kind === 'hotel', day = inDay();
      stay.hidden = !hotel;
      F.checkout.disabled = !hotel; // so a hidden field can't block saving
      el.querySelector('[data-when]').textContent = hotel ? 'Check-in' : 'When';
      if (!day) return;
      // Check-out is at least a night after check-in, and at most 30.
      F.checkout.min = `${addDays(day, 1)}T00:00`;
      F.checkout.max = `${addDays(day, 30)}T23:59`;
      F.checkout.value = `${addDays(day, nights ?? autoNights())}T${outTime}`;
    }
    F.checkout.addEventListener('input', () => {
      const v = F.checkout.value, day = inDay();
      if (!v || !day) return;
      outTime = v.slice(11, 16);
      const n = daysBetween(day, v.slice(0, 10));
      // Changing only the time keeps nights following the trip.
      if (nights != null || n !== autoNights()) nights = Math.min(30, Math.max(1, n));
    });
    F.checkout.addEventListener('blur', showNights); // an empty or out-of-range day snaps back when you leave it
    F.time.addEventListener('input', () => {
      timeTouched = true;
      // Moving check-in keeps the check-out day, unless that would leave no nights (or too many): then the nights move with it.
      const day = inDay();
      if (nights != null && day && shownIn) {
        const n = daysBetween(day, addDays(shownIn, nights));
        if (n >= 1 && n <= 30) nights = n;
      }
      if (day) shownIn = day;
      showNights();
    });
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
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(v)}${viewbox(trip)}`, { signal: ctrl.signal });
        list = await res.json();
        results.innerHTML = list.length ? list.map((p, i) => {
          const pl = placeOf(p);
          return `<li><button type="button" class="wt-results__item" data-i="${i}"><span class="wt-results__name">${esc(pl.name)}</span><span class="wt-results__detail">${esc(pl.address)}</span></button></li>`;
        }).join('') : '<li class="wt-results__msg">No places found</li>';
      } catch (e) {
        if (e.name !== 'AbortError') results.innerHTML = '<li class="wt-results__msg">Search is unavailable right now</li>';
      }
    }
    results.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const p = list[+b.dataset.i], pl = placeOf(p);
      Object.assign(draft, { lat: +p.lat, lng: +p.lon, address: pl.address, name: pl.name });
      F.title.value = pl.name;
      results.innerHTML = '';
      if (!chosen) setKind(guessKind(pl.name, `${p.category}:${p.type}`));
      else drawMap(trip);
      focusSpot(draft);
    });

    f.onsubmit = e => {
      e.preventDefault();
      if (draft.lat == null) { results.innerHTML = '<li class="wt-results__msg">Pick a place from the search results</li>'; return; }
      const hotel = draft.kind === 'hotel';
      const data = {
        kind: draft.kind, name: F.title.value.trim(), address: draft.address, lat: draft.lat, lng: draft.lng, time: F.time.value, note: F.note.value.trim(),
        nights: hotel ? nights : null, checkout: hotel ? outTime : null,
      };
      state.day = dayOf(data); // follow the stop to its day
      saved = true;
      state.draft = null; // so the list and map show the saved stop, not the draft
      if (spot) editSpot(trip.id, spot.id, data);
      else mutate(d => {
        const t = d.trips[trip.id];
        if (!t) return;
        t.spots.push({ id: uid(), ...data, by: ME, updatedAt: Date.now() });
        t.updatedAt = Date.now();
        t.lastBy = ME;
      });
      closeSheet();
    };
    f.querySelector('[data-del]')?.addEventListener('click', () => {
      saved = true;
      closeSheet();
      mutate(d => { const t = d.trips[trip.id]; if (t) { t.spots = t.spots.filter(s => s.id !== spot.id); t.lastBy = ME; t.updatedAt = Date.now(); } });
      toast(`Deleted ${spot.name}`, 'Undo', () => mutate(d => { d.trips[trip.id]?.spots.push({ ...spot, by: ME, updatedAt: Date.now() }); }));
    });
  }, {
    panel: true,
    // Closed without saving: the map goes back to where it was.
    onClose: () => {
      state.draft = null;
      $app.querySelector('.trip')?.classList.remove('is-editing');
      if (!saved && map && camera) map.flyTo(camera.center, camera.zoom, { duration: 0.4 });
      if ($app.dataset.trip) render();
    },
  });
  if (spot) focusSpot(spot);
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
  const r = parseHash(), trip = r.page === 'trip' ? db.trips[r.id] : null;
  const spot = trip && el.dataset.id && trip.spots.find(s => s.id === el.dataset.id);
  switch (el.dataset.action) {
    case 'new-trip': openNewTrip(); break;
    case 'add': openSpotSheet(trip); break;
    case 'select': if (spot) selectSpot(spot, el.dataset.row); break;
    case 'edit': if (spot) openSpotSheet(trip, spot); break;
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
  // ← → change day, unless typing or a sheet is open
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !$sheets.innerHTML && !e.target.closest('input, textarea')) stepDay(e.key === 'ArrowRight' ? 1 : -1);
});
addEventListener('hashchange', render);

render();
