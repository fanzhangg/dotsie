'use strict';

/* Waythread prototype — vanilla JS, no build step.
   One trip screen: a full-screen map with the stop list as a draggable sheet on top.
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
const state = { sel: null, leg: null, hoverLeg: null, snap: 'half', day: null, flash: new Set() };

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const avatarHTML = u => `<span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-${USERS[u].identity})">${USERS[u].name[0]}</span>`;
// Map drawing can't use CSS classes, so it reads the design tokens directly (theme-aware).
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Icons (design system) ----------
const ICON = Object.fromEntries(['home', 'settings', 'back', 'forward', 'chevron-down', 'close', 'plus', 'car', 'external', 'directions']
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
const kindColor = s => `var(--kind-${KINDS[kindOf(s)].group})`;
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
  const bar = el.querySelector('.day-bar');
  const topH = el.querySelector('.wt-sheet__top').offsetHeight;
  bar.innerHTML = dayBarHTML(trip);
  bar.hidden = !trip.spots.length;
  renderList(trip);
  // the day bar is the sheet's top, so peek height changes when it comes or goes
  if (!el.querySelector('.wt-sheet').style.height || topH !== el.querySelector('.wt-sheet__top').offsetHeight) applySnap();
  for (const id of state.flash) el.querySelector(`.tl-stop[data-id="${id}"]`)?.classList.add('is-flash');
  state.flash.clear();
  drawMap(trip);
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
  delete $app.dataset.trip;
  state.sel = state.leg = state.hoverLeg = state.day = null;
  state.snap = 'half';
}
function mountTrip(trip) {
  teardownTrip();
  $app.dataset.trip = trip.id;
  // The plan is the page: two floating buttons over the map, and a sheet with one day of the plan.
  $app.innerHTML = `<div class="trip">
    <div id="map"></div>
    <nav class="map-bar">
      <a class="wt-icon-btn map-btn" href="#/" aria-label="All trips">${ICON.home}</a>
      <button class="wt-icon-btn map-btn" data-action="settings" aria-label="Trip settings and sharing">${ICON.settings}</button>
    </nav>
    <section class="wt-sheet" aria-label="${esc(trip.name)}">
      <div class="wt-sheet__top"><div class="wt-sheet__grab"></div><div class="day-bar" hidden></div></div>
      <div class="wt-sheet__body tl"></div>
      ${addBarHTML}
    </section>
  </div>`;
  if (!window.L) return;
  map = L.map($app.querySelector('#map'), { zoomControl: false, attributionControl: false }).setView([32.6, -106.1], 8);
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
  map.on('click', () => {
    if (!state.sel && !state.leg) return;
    state.sel = state.leg = null;
    render();
  });
}

// Is today one of the trip's days? Then the trip opens on today, with what's happening now highlighted.
function onTrip(trip) {
  const days = daysOf(trip);
  const today = TODAY || toInput(new Date()).slice(0, 10);
  return days.length > 0 && today >= days[0] && today <= days.at(-1);
}
const timeHTML = t => fmtTime(t).replace(/ (AM|PM)$/, '<span class="wt-stop__meridiem">$1</span>');
const markerHTML = (s, cls) => `<i class="${cls}" role="img" aria-label="${KINDS[kindOf(s)].label}" style="--kind: ${kindColor(s)}">${kindIcon(s)}</i>`;

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
// Rows take `past` (over: dimmed) and `now` (happening now: highlighted).
const rowState = (past, now) => `${past ? ' is-past' : ''}${now ? ' is-now' : ''}`;
function driveItem(day, leg) {
  const { r, from, to, fromEntry, toEntry } = leg;
  const lateMin = r && fromEntry.role === 'stop' && toEntry.role === 'stop' ? Math.round(r.duration / 60 - gapMin(from, to)) : 0;
  const cls = ['tl-drive', state.leg === leg.key ? 'is-active' : '', lateMin > 0 ? 'is-late' : ''];
  return {
    // when you set off; the drive back to the hotel has no time, so it comes last
    start: leg.leave || (toEntry.role === 'night' ? `${day}T23:58` : fromEntry.place.time),
    html: (past, now) => `<div class="${cls.join(' ')}${rowState(past, now)}" data-leg="${leg.key}" data-action="leg">
      <span class="tl-rail"><i class="tl-car">${WaythreadIcons.svg('car', 14)}</i></span>
      <span class="tl-drive__body">
        <span class="tl-drive__what"><b>${r ? fmtDur(r.duration) : '…'}</b> drive</span>
        ${fromEntry.role === 'from' ? `<span class="tl-drive__from">from ${esc(from.name)}</span>` : ''}
        ${lateMin > 0 ? `<span class="tl-drive__late">Arrives ${fmtDur(lateMin * 60)} late</span>` : ''}
      </span>
      <a class="wt-icon-btn tl-drive__go" href="${directionsURL(from, to)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(to.name)} in your maps app" title="Directions">${ICON.directions}</a>
    </div>`,
  };
}
// A stop row: marker · name and note · time. A hotel on its check-in day says how many nights.
function stopRow(s, past, now, note, time) {
  return `<button class="tl-stop${s.id === state.sel ? ' is-selected' : ''}${rowState(past, now)}" data-action="edit" data-id="${s.id}" style="--kind: ${kindColor(s)}">
      <span class="tl-rail">${markerHTML(s, 'tl-marker')}</span>
      <span class="tl-body"><span class="tl-name">${esc(s.name)}</span>${note.filter(Boolean).map(n => `<span class="tl-note">${esc(n)}</span>`).join('')}</span>
      <span class="tl-time">${time ? timeHTML(time) : ''}</span>
    </button>`;
}
function stopItem(trip, s) {
  const stay = kindOf(s) === 'hotel' && staysOf(trip).find(st => st.s === s);
  const nights = stay && `${stay.nights} ${stay.nights === 1 ? 'night' : 'nights'}`;
  return { start: s.time, html: (past, now) => stopRow(s, past, now, [nights, s.note], s.time) };
}
// The hotel at either end of a day: where you wake up, and where you go back to at night. It has no time;
// only check-out morning says anything, since that's the one with something to do. Tapping it opens the hotel.
function hotelItem(day, entry) {
  return {
    start: entry.role === 'night' ? `${day}T23:59` : `${day}T00:00`,
    html: (past, now) => stopRow(entry.place, past, now, [entry.role === 'checkout' && 'Check out'], null),
  };
}
// One "Add stop", pinned to the bottom of the sheet so it's always in reach.
const addBarHTML = `<div class="wt-add-bar"><button class="wt-btn wt-btn--primary wt-btn--block" data-action="add">${ICON.plus}Add stop</button></div>`;
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
  return items.map(it => it.html(it.past, it.now)).join('');
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
  return `<button class="wt-icon-btn day-bar__step" data-action="prev-day" aria-label="Previous day"${i > 0 ? '' : ' disabled'}>${ICON.back}</button>
    <button class="day-bar__title" data-action="days" aria-label="${dayName(d)}. Pick a day">
      <span class="day-bar__label">${dayName(d)}${ICON.chevronDown}</span>
    </button>
    <button class="wt-icon-btn day-bar__step" data-action="next-day" aria-label="Next day"${i < days.length - 1 ? '' : ' disabled'}>${ICON.forward}</button>`;
}
// "Today, Nov 21" on today, so it's easy to find your way back to it; otherwise "Sat, Nov 21".
const dayName = d => (d === nowStamp().slice(0, 10) ? `Today, ${fmtDay(d).split(', ')[1]}` : fmtDay(d));
// Every day of the trip, with the icons of its stops and the hotel you sleep at, so you can see what each day holds.
function openDays(trip) {
  const cur = currentDay(trip);
  openSheet(`${modalHead('Days')}
    <ul class="day-list">${daysOf(trip).map(d => {
      const places = [...new Set(dayPlan(trip, d).filter(e => e.role === 'stop' || e.role === 'night').map(e => e.place))];
      return `<li><button class="day-list__item" data-action="pick-day" data-day="${d}"${d === cur ? ' aria-current="date"' : ''}>
        <span class="day-list__name">${dayName(d)}</span>
        <span class="day-list__kinds">${places.slice(0, 6).map(x => markerHTML(x, 'mini-marker')).join('')}</span>
      </button></li>`;
    }).join('')}</ul>`);
}
function setDay(d) {
  const trip = db.trips[parseHash().id];
  if (!trip || !daysOf(trip).includes(d) || d === state.day) return;
  state.day = d;
  state.sel = state.leg = state.hoverLeg = null;
  render();
}
function stepDay(n) {
  const trip = db.trips[parseHash().id];
  if (!trip) return;
  const days = daysOf(trip);
  setDay(days[days.indexOf(currentDay(trip)) + n]);
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
    // Pulled down, the sheet is mostly the day bar's buttons: any tap on it opens the sheet back up, before anything else.
    if (state.snap === 'peek') {
      state.snap = 'half';
      applySnap();
      drag.suppressClick = true;
      setTimeout(() => { drag.suppressClick = false; }, 50);
    } else if (!e.target.closest?.('button, a')) { state.snap = 'peek'; applySnap(); }
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
  // Only the day on screen, from its plan: the hotel at either end is a pin like any stop.
  // With no hotel last night, the day before's last stop is a quiet pin, so the first drive leads somewhere.
  const day = currentDay(trip);
  const plan = dayPlan(trip, day);
  const start = plan.find(e => e.role === 'from')?.place;
  const places = plan.map(e => e.place);
  const active = state.leg || state.hoverLeg;
  const legs = dayLegs(trip, day);
  // what the list dims, the map dims: past drives go grey, and a place is past once all its rows are
  const items = dayItems(trip, day);
  const pastLeg = new Set(items.filter(it => it.leg && it.past).map(it => it.leg));
  const isPast = s => { const rows = items.filter(it => it.entry?.place === s); return rows.length > 0 && rows.every(it => it.past); };
  const C = { on: token('--wt-route-active'), muted: token('--wt-route-muted'), route: token('--wt-route'), done: token('--wt-route-done'), casing: token('--wt-route-casing') };
  // past routes first, so they sit under the rest; the active route last, on top
  const order = l => (l.key === active ? 2 : pastLeg.has(l.key) ? 0 : 1);
  for (const l of [...legs].sort((a, b) => order(a) - order(b))) {
    const rt = l.r, isOn = l.key === active;
    const color = isOn ? C.on : active ? C.muted : pastLeg.has(l.key) ? C.done : C.route;
    const coords = rt ? rt.coords : [[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]];
    L.polyline(coords, { color: C.casing, weight: isOn ? 11 : 8, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(coords, { color, weight: isOn ? 7 : 4.5, dashArray: rt?.ok ? null : '1 9', lineCap: 'round', interactive: false }).addTo(layer);
    // wide invisible line so the route is easy to tap
    L.polyline(coords, { opacity: 0, weight: 24, bubblingMouseEvents: false })
      .on('click', () => selectLeg(l)).addTo(layer);
  }
  // places at the same spot (fly in and out of one airport, a hotel morning and night) share one pin
  const groups = new Map();
  for (const s of places) {
    const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    if (!groups.has(k)) groups.set(k, []);
    if (!groups.get(k).includes(s)) groups.get(k).push(s);
  }
  for (const all of groups.values()) {
    // quiet: only the start, which belongs to the day before, or a place you're done with
    const g = all.filter(s => s !== start), quiet = !g.length || g.every(isPast);
    const focus = g.find(s => s.id === state.sel);
    const cls = [focus ? 'wt-pin--selected' : '', quiet ? 'wt-pin--muted' : ''].join(' ');
    L.marker([all[0].lat, all[0].lng], {
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="wt-pin stop-pin ${cls}">${markerHTML(focus || g[0] || start, 'stop-pin__marker')}${focus ? `<span class="wt-pin__label">${esc(focus.name)}</span>` : ''}</div>` }),
      zIndexOffset: focus ? 1000 : quiet ? -1000 : 0, title: all[0].name,
    }).on('click', () => g.length ? selectSpot(g[0]) : (setDay(dayOf(start)), selectSpot(start))).addTo(layer);
  }

  const pts = places.map(s => [s.lat, s.lng]);
  const key = [trip.id, day, pts.length].join('|');
  if (key === fitKey) return;
  fitKey = key;
  if (new Set(pts.map(String)).size === 1) map.setView(pts[0], 13);
  // the top padding keeps pins clear of the floating buttons
  else if (pts.length) map.fitBounds(pts, { paddingTopLeft: [32, 72], paddingBottomRight: [32, snaps()[state.snap] + 24], maxZoom: 15 });
}
// Tapping a route highlights it and its drive in the list — the list already holds the time and the maps link.
function selectLeg(l) {
  state.leg = l.key;
  state.sel = null;
  if (state.snap === 'peek') state.snap = 'half';
  render();
  applySnap();
  $app.querySelector(`.tl-drive[data-leg="${l.key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
// Hovering a drive in the list previews its route on the map.
document.addEventListener('mouseover', e => {
  const id = e.target.closest?.('.tl-drive')?.dataset.leg || null;
  if (id === state.hoverLeg) return;
  state.hoverLeg = id;
  const trip = db.trips[parseHash().id];
  if (trip) drawMap(trip);
});
// Tapping a pin highlights its row in the list.
function selectSpot(s) {
  state.leg = null;
  state.sel = s.id;
  if (state.snap === 'peek') state.snap = 'half';
  render();
  applySnap();
  $app.querySelector(`.tl-stop[data-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// Opening a stop moves it into the strip of map left visible above the edit sheet.
function focusSpot(s) {
  if (!map) return;
  const H = map.getSize().y, z = Math.max(map.getZoom(), 13);
  const p = map.project([s.lat, s.lng], z).add([0, H / 2 - H * 0.2]);
  map.flyTo(map.unproject(p, z), z, { duration: 0.5 });
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
    <p class="map-credit">Map ${mapCredit}</p>
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

// The first line is the place: it shows the stop's name (as in the list) and searching it changes the place.
// Type sets the stop's icon. It starts as a guess from the place you pick, until you choose one yourself.
function openSpotSheet(trip, spot) {
  const draft = spot ? { ...spot, kind: kindOf(spot) } : { lat: null, lng: null, address: '', kind: 'place' };
  let chosen = !!spot;
  state.leg = null;
  if (spot) { state.sel = spot.id; render(); focusSpot(spot); }
  openSheet(`${modalHead(spot ? 'Edit stop' : 'Add stop')}
    <form>
      <label class="wt-field"><span class="wt-field__label">Place</span><input class="wt-input" name="title" type="search" placeholder="Search a place" autocomplete="off" required></label>
      <ul class="wt-results"></ul>
      <div class="wt-field"><span class="wt-field__label" id="kind-label">Type</span>
        <div class="kinds" role="radiogroup" aria-labelledby="kind-label">${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="kinds__item" role="radio" data-kind="${k}" style="--kind: var(--kind-${v.group})"><i class="kinds__icon">${WaythreadIcons.svg(v.icon, 18)}</i>${v.label}</button>`).join('')}</div>
      </div>
      <label class="wt-field"><span class="wt-field__label" data-when>When</span><input class="wt-input" name="time" type="datetime-local" required></label>
      <div class="wt-field nights" hidden><span class="wt-field__label">Nights</span>
        <div class="nights__row"><button type="button" class="wt-icon-btn nights__step" data-nights="-1" aria-label="One night fewer">−</button><output class="nights__n" aria-live="polite"></output><button type="button" class="wt-icon-btn nights__step" data-nights="1" aria-label="One more night">+</button><span class="nights__out"></span></div>
      </div>
      <label class="wt-field"><span class="wt-field__label">Note</span><textarea class="wt-input" name="note" rows="2" placeholder="Confirmation #, tickets, tips…"></textarea></label>
      <div class="wt-modal__actions">${spot ? '<button type="button" class="wt-btn wt-btn--danger" data-del>Delete</button>' : ''}<button class="wt-btn wt-btn--primary">${spot ? 'Save' : 'Add'}</button></div>
    </form>`, el => {
    const results = el.querySelector('.wt-results'), f = el.querySelector('form'), F = f.elements;
    if (spot) { F.title.value = spot.name; F.time.value = spot.time; F.note.value = spot.note || ''; }
    else { F.time.value = defaultTime(trip); setTimeout(() => F.title.focus(), 280); }
    const kinds = el.querySelector('.kinds');
    const showKind = () => { for (const b of kinds.children) b.setAttribute('aria-checked', b.dataset.kind === draft.kind); };
    kinds.addEventListener('click', e => {
      const b = e.target.closest('[data-kind]');
      if (b) { draft.kind = b.dataset.kind; chosen = true; showKind(); }
    });
    // A hotel is a stay: When becomes check-in, and Nights sets check-out. Left alone, nights follow the trip
    // (until the next hotel, or the last day), and the number shown is that.
    let nights = spot?.nights >= 1 ? spot.nights : null;
    const nightsEl = el.querySelector('.nights');
    function autoNights() {
      const day = F.time.value.slice(0, 10), later = spotsOf(trip).filter(s => s.id !== spot?.id && dayOf(s) > day);
      const nextHotel = later.find(s => kindOf(s) === 'hotel');
      return Math.max(1, daysBetween(day, nextHotel ? dayOf(nextHotel) : later.length ? dayOf(later.at(-1)) : addDays(day, 1)));
    }
    function showNights() {
      const hotel = draft.kind === 'hotel', n = nights ?? autoNights();
      nightsEl.hidden = !hotel;
      el.querySelector('[data-when]').textContent = hotel ? 'Check-in' : 'When';
      el.querySelector('.nights__n').textContent = n;
      el.querySelector('.nights__out').textContent = F.time.value ? `check out ${fmtDay(addDays(F.time.value.slice(0, 10), n))}` : '';
      el.querySelector('[data-nights="-1"]').disabled = n <= 1;
    }
    nightsEl.addEventListener('click', e => {
      const b = e.target.closest('[data-nights]');
      if (b) { nights = Math.min(30, Math.max(1, (nights ?? autoNights()) + +b.dataset.nights)); showNights(); }
    });
    F.time.addEventListener('input', showNights);
    const showType = () => { showKind(); showNights(); };
    kinds.addEventListener('click', showNights);
    showType();

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
      Object.assign(draft, { lat: +p.lat, lng: +p.lon, address: pl.address });
      F.title.value = pl.name;
      results.innerHTML = '';
      if (!chosen) { draft.kind = guessKind(pl.name, `${p.category}:${p.type}`); showType(); }
    });

    f.onsubmit = e => {
      e.preventDefault();
      if (draft.lat == null) { results.innerHTML = '<li class="wt-results__msg">Pick a place from the search results</li>'; return; }
      const data = { kind: draft.kind, name: F.title.value.trim(), address: draft.address, lat: draft.lat, lng: draft.lng, time: F.time.value, note: F.note.value.trim(), nights: draft.kind === 'hotel' ? nights : null };
      state.day = dayOf(data); // follow the stop to its day
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
      mutate(d => { const t = d.trips[trip.id]; if (t) { t.spots = t.spots.filter(s => s.id !== spot.id); t.lastBy = ME; t.updatedAt = Date.now(); } });
      closeSheet();
      toast(`Deleted ${spot.name}`, 'Undo', () => mutate(d => { d.trips[trip.id]?.spots.push({ ...spot, by: ME, updatedAt: Date.now() }); }));
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
  const r = parseHash(), trip = r.page === 'trip' ? db.trips[r.id] : null;
  const spot = trip && el.dataset.id && trip.spots.find(s => s.id === el.dataset.id);
  switch (el.dataset.action) {
    case 'new-trip': openNewTrip(); break;
    case 'add': openSpotSheet(trip); break;
    case 'edit': openSpotSheet(trip, spot); break;
    case 'settings': openSettings(trip); break;
    case 'prev-day': stepDay(-1); break;
    case 'next-day': stepDay(1); break;
    case 'days': openDays(trip); break;
    case 'pick-day': closeSheet(); setDay(el.dataset.day); break;
    case 'leg': {
      if (e.target.closest('a')) break; // Directions opens the maps app; the rest of the row shows the route
      const l = dayLegs(trip, currentDay(trip)).find(x => x.key === el.dataset.leg);
      if (l) selectLeg(l);
      break;
    }
    case 'close-sheet': closeSheet(); break;
    case 'copy': navigator.clipboard?.writeText(el.dataset.text).then(() => toast('Link copied'), () => toast('Copy failed')); break;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSheet();
  // ← → change day, unless typing or a sheet is open
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !$sheets.innerHTML && !e.target.closest('input, textarea')) stepDay(e.key === 'ArrowRight' ? 1 : -1);
});
addEventListener('hashchange', render);

render();
