'use strict';

/* Trippy prototype — vanilla JS, no build step.
   One trip screen: a full-screen map with the stop list as a draggable sheet on top.
   Data lives in localStorage; a BroadcastChannel keeps open tabs in sync to simulate co-editing
   (open the app with ?as=sam in a second tab). Routes come from the public OSRM demo server,
   place search from Nominatim. */

// ---------- People (no auth in the prototype) ----------
const USERS = {
  alex: { id: 'alex', name: 'Alex', color: '#2563eb' },
  sam: { id: 'sam', name: 'Sam', color: '#d9480f' },
  jo: { id: 'jo', name: 'Jo', color: '#0f766e' },
};
const params = new URLSearchParams(location.search);
const ME = USERS[params.get('as')] ? params.get('as') : 'alex';
if (ME !== 'alex') document.title += ` (${USERS[ME].name})`;
// ?today=YYYY-MM-DD pretends it's a trip day, so the check-off UI can be previewed before the trip
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '') ? params.get('today') : null;

const DB_KEY = 'trippy:v2';
const ROUTE_KEY = 'trippy:routes:v1';
const $app = document.getElementById('app');
const $sheets = document.getElementById('sheets');
const state = { sel: null, leg: null, hoverLeg: null, snap: 'half', flash: new Set() };

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');

// ---------- Icons ----------
const svg = (d, size = 22, sw = 2) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const ICON = {
  back: svg('M15 18l-6-6 6-6'),
  close: svg('M18 6L6 18M6 6l12 12', 20),
  plus: svg('M12 5v14M5 12h14'),
  personAdd: svg('M15 19a6 6 0 00-12 0M9 11a4 4 0 100-8 4 4 0 000 8zM19 8v6M16 11h6', 20),
  edit: svg('M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z', 18),
  check: svg('M5 12.5l4.5 4.5L19 7.5', 16, 3),
  car: svg('M5 16h14M6 16v2.5M18 16v2.5M3.5 16v-3.5L6 7h12l2.5 5.5V16', 16),
  ext: svg('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5', 14),
};

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
  const s = (name, address, lat, lng, time, note, by) => ({ id: uid(), name, address, lat, lng, time, note, by, done: false, updatedAt: t });
  return {
    trips: {
      'white-sands': {
        id: 'white-sands', name: 'White Sands, NM', members: ['alex', 'sam'], createdBy: 'alex', updatedAt: t,
        spots: [
          s('El Paso International Airport', '6701 Convair Rd, El Paso, TX', 31.8072, -106.3779, '2026-11-20T10:30', 'UA 1234 lands · rental car at Hertz', 'alex'),
          s('Holiday Inn Express Alamogordo', 'S White Sands Blvd, Alamogordo, NM', 32.8800, -105.9580, '2026-11-20T13:00', 'Drop bags · conf # in email', 'alex'),
          s('White Sands Visitor Center', '19955 US-70, Alamogordo, NM', 32.7797, -106.1717, '2026-11-20T15:00', 'Buy a sled + wax', 'sam'),
          s('Interdune Boardwalk', 'Dunes Dr, White Sands National Park, NM', 32.7930, -106.2110, '2026-11-20T16:30', 'Sunset ~5:00 PM', 'sam'),
          s('New Mexico Museum of Space History', '3198 NM-2001, Alamogordo, NM', 32.9214, -105.9213, '2026-11-21T09:30', '', 'alex'),
          s('Cloudcroft', 'Burro Ave, Cloudcroft, NM', 32.9573, -105.7428, '2026-11-21T12:30', 'Lunch', 'sam'),
          s('El Paso International Airport', '6701 Convair Rd, El Paso, TX', 31.8072, -106.3779, '2026-11-22T11:00', 'Fly home · return car by 10:00', 'alex'),
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
function legsOf(trip) {
  const s = spotsOf(trip);
  return s.slice(1).map((to, i) => ({ from: s[i], to }));
}

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
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('trippy') : null;
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
    const verb = !o ? 'added' : o.done !== s.done ? (s.done ? 'checked off' : 'unchecked') : 'updated';
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
    $app.innerHTML = '<div class="empty">Trip not found. <a href="#/">All trips</a></div>';
    return;
  }
  if (!trip.members.includes(ME)) { // opening a shared link is the invite
    mutate(d => d.trips[trip.id].members.push(ME));
    toast(`You joined ${trip.name}`);
    return;
  }
  if ($app.dataset.trip !== trip.id) mountTrip(trip);
  const el = $app.querySelector('.trip');
  el.querySelector('.sl-head').innerHTML = sheetHeadHTML(trip);
  el.querySelector('.sl-body').innerHTML = listHTML(trip);
  if (!el.querySelector('.list-sheet').style.height) applySnap();
  for (const id of state.flash) el.querySelector(`.row[data-id="${id}"]`)?.classList.add('flash');
  state.flash.clear();
  drawMap(trip);
  linkVisiblePins();
}

// ---------- Home ----------
function homeHTML() {
  const trips = Object.values(db.trips).filter(t => t.members.includes(ME)).sort((a, b) => b.updatedAt - a.updatedAt);
  return `
    <header class="home-head"><h1>Trippy</h1></header>
    <main class="home">
      ${trips.map(t => `<a class="trip-card" href="#/trip/${t.id}"><b>${esc(t.name)}</b><span>${fmtRange(t)}</span></a>`).join('')}
      <button class="btn primary block" data-action="new-trip">${ICON.plus} New trip</button>
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
    <section class="list-sheet">
      <div class="sl-top"><div class="grab"></div><div class="sl-head"></div></div>
      <div class="sl-body"></div>
    </section>
  </div>`;
  $app.querySelector('.sl-body').addEventListener('scroll', linkVisiblePins, { passive: true });
  if (!window.L) return;
  map = L.map($app.querySelector('#map'), { zoomControl: false }).setView([32.6, -106.1], 8);
  // A quiet basemap so routes lead (Stadia needs no key on localhost); fall back to OpenStreetMap if it's refused.
  const quiet = L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', {
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
  const people = trip.members.filter(u => USERS[u]);
  return `
    <a class="icon-btn" href="#/" aria-label="All trips">${ICON.back}</a>
    <span class="sl-title">${esc(trip.name)}</span>
    <button class="icon-btn edit-btn" data-action="rename" aria-label="Edit trip">${ICON.edit}</button>
    <button class="people-btn" data-action="share" aria-label="People and sharing">${people.length > 1
      ? people.map(u => `<span class="face" style="--c:${USERS[u].color}">${USERS[u].name[0]}</span>`).join('')
      : ICON.personAdd}</button>`;
}
// Check-off only matters while travelling: show it on trip days.
function onTrip(trip) {
  const s = spotsOf(trip);
  if (!s.length) return false;
  const today = TODAY || toInput(new Date()).slice(0, 10);
  return today >= s[0].time.slice(0, 10) && today <= s.at(-1).time.slice(0, 10);
}
const timeHTML = t => fmtTime(t).replace(/ (AM|PM)$/, '<small>$1</small>');
function driveHTML(from, to) {
  const r = getRoute(from, to);
  if (r && r.distance === 0) return '';
  // red when the drive is longer than the gap between the two stops — no extra element, just the color
  const late = r && r.duration > (toDate(to.time) - toDate(from.time)) / 1000;
  return `<a class="drive${state.leg === to.id ? ' on' : ''}${late ? ' late' : ''}" data-leg="${to.id}" href="${directionsURL(from, to)}" target="_blank" rel="noopener">
    <span class="dr-in" aria-label="Directions in maps app${late ? ' — not enough time before the next stop' : ''}">${ICON.car}${r ? fmtDur(r.duration) : '…'}${ICON.ext}</span>
  </a>`;
}
// One "Add stop", pinned to the bottom of the sheet so it's always in reach.
const addBarHTML = `<div class="add-bar"><button class="add-btn" data-action="add">${ICON.plus}Add stop</button></div>`;
// Three layers: day heading, a card per stop (time · name), and drive connectors between cards.
function listHTML(trip) {
  const spots = spotsOf(trip);
  if (!spots.length) return `<p class="empty">Add a flight, a hotel, or a place to see.</p>${addBarHTML}`;
  const checks = onTrip(trip);
  let html = '', day = '';
  spots.forEach((s, i) => {
    const d = s.time.slice(0, 10);
    if (d !== day) { day = d; html += `<h3 class="day">${fmtDay(s.time)}</h3>`; }
    if (i > 0) html += driveHTML(spots[i - 1], s);
    html += `<div class="row${s.done ? ' done' : ''}${s.id === state.sel ? ' sel' : ''}" data-id="${s.id}">
      <button class="row-main" data-action="edit" data-id="${s.id}">
        <span class="time">${timeHTML(s.time)}</span>
        <span class="what"><b>${esc(s.name)}</b>${s.note ? `<span class="note">${esc(s.note)}</span>` : ''}</span>
      </button>
      ${checks ? `<button class="check" data-action="toggle-done" data-id="${s.id}" aria-label="${s.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${!!s.done}">${ICON.check}</button>` : ''}
    </div>`;
  });
  return html + addBarHTML;
}

// Sheet snaps between peek (header only), half, and full; drag the top or tap it to toggle.
function snaps() {
  const H = $app.querySelector('.trip').clientHeight;
  return { peek: $app.querySelector('.sl-top').offsetHeight, half: Math.round(H * 0.48), full: H - 48 };
}
function applySnap() {
  const sheet = $app.querySelector('.list-sheet');
  if (!sheet) return;
  const h = snaps()[state.snap];
  sheet.style.height = `${h}px`;
  $app.querySelector('.trip').style.setProperty('--bottom-h', `${h}px`);
  setTimeout(linkVisiblePins, 300); // after the height transition
}
const drag = { active: false, moved: false, y0: 0, h0: 0, suppressClick: false };
document.addEventListener('pointerdown', e => {
  const top = e.target.closest('.sl-top');
  if (!top) return;
  Object.assign(drag, { active: true, moved: false, y0: e.clientY, h0: parseFloat(top.parentElement.style.height) || top.parentElement.offsetHeight });
});
document.addEventListener('pointermove', e => {
  if (!drag.active) return;
  const dy = drag.y0 - e.clientY;
  if (!drag.moved && Math.abs(dy) < 6) return;
  drag.moved = true;
  const sheet = $app.querySelector('.list-sheet'), s = snaps();
  sheet.classList.add('dragging');
  sheet.style.height = `${Math.max(s.peek, Math.min(s.full, drag.h0 + dy))}px`;
});
document.addEventListener('pointerup', e => {
  if (!drag.active) return;
  drag.active = false;
  const sheet = $app.querySelector('.list-sheet');
  if (!sheet) return;
  sheet.classList.remove('dragging');
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
  const spots = spotsOf(trip);
  const active = state.leg || state.hoverLeg;
  const legs = legsOf(trip);
  // draw the active route last so it sits on top
  for (const l of [...legs.filter(l => l.to.id !== active), ...legs.filter(l => l.to.id === active)]) {
    const rt = getRoute(l.from, l.to), isOn = l.to.id === active;
    const color = isOn ? '#0b57d0' : l.to.done ? '#b4b4b4' : active ? '#9dbbec' : '#1a73e8';
    const coords = rt ? rt.coords : [[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]];
    L.polyline(coords, { color: '#fff', weight: isOn ? 11 : 8, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(coords, { color, weight: isOn ? 7 : 4.5, dashArray: rt?.ok ? null : '1 9', lineCap: 'round', interactive: false }).addTo(layer);
    // wide invisible line so the route is easy to tap
    L.polyline(coords, { opacity: 0, weight: 24, bubblingMouseEvents: false })
      .on('click', () => selectLeg(l)).addTo(layer);
  }
  // stops at the same place (fly in and out of one airport) share one pin
  const groups = new Map();
  for (const s of spots) {
    const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  pins = [];
  for (const g of groups.values()) {
    const focus = g.find(s => s.id === state.sel);
    const cls = [focus ? 'on' : '', g.every(s => s.done) ? 'done' : ''].join(' ');
    const m = L.marker([g[0].lat, g[0].lng], {
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="pin ${cls}"><i></i>${focus ? `<span>${esc(focus.name)}</span>` : ''}</div>` }),
      zIndexOffset: focus ? 1000 : 0, title: g[0].name,
    }).on('click', () => selectSpot(g.find(s => !s.done) || g[0])).addTo(layer);
    pins.push({ ids: g.map(s => s.id), el: m.getElement()?.querySelector('.pin') });
  }

  const pts = spots.map(s => [s.lat, s.lng]);
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
  $app.querySelector(`.drive[data-leg="${l.to.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
// Pins for the stops scrolled into view stay strong; the rest step back, so list and map read as one.
let pins = [];
function linkVisiblePins() {
  const body = $app.querySelector('.sl-body');
  if (!body || !pins.length) return;
  const box = body.getBoundingClientRect();
  const rows = [...body.querySelectorAll('.row')];
  const vis = new Set(rows.filter(r => { const b = r.getBoundingClientRect(); return b.bottom > box.top + 40 && b.top < box.bottom; }).map(r => r.dataset.id));
  const linked = vis.size > 0 && vis.size < rows.length;
  $app.querySelector('.trip').classList.toggle('pins-linked', linked);
  for (const p of pins) p.el?.classList.toggle('vis', p.ids.some(id => vis.has(id)));
}
// Hovering a drive in the list previews its route on the map.
document.addEventListener('mouseover', e => {
  const id = e.target.closest?.('.drive')?.dataset.leg || null;
  if (id === state.hoverLeg) return;
  state.hoverLeg = id;
  const trip = db.trips[parseHash().id];
  if (trip) { drawMap(trip); linkVisiblePins(); }
});
// Tapping a pin highlights its row in the list.
function selectSpot(s) {
  state.leg = null;
  state.sel = s.id;
  if (state.snap === 'peek') state.snap = 'half';
  render();
  applySnap();
  $app.querySelector(`.row[data-id="${s.id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
// Opening a stop moves it into the strip of map left visible above the edit sheet.
function focusSpot(s) {
  if (!map) return;
  const H = map.getSize().y, z = Math.max(map.getZoom(), 13);
  const p = map.project([s.lat, s.lng], z).add([0, H / 2 - H * 0.2]);
  map.flyTo(map.unproject(p, z), z, { duration: 0.5 });
}

// ---------- Sheets ----------
const closeBtn = `<button class="icon-btn" data-action="close-sheet" aria-label="Close">${ICON.close}</button>`;
function openSheet(html, mount) {
  $sheets.innerHTML = `<div class="backdrop" data-action="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  mount?.($sheets.querySelector('.sheet'));
  requestAnimationFrame(() => requestAnimationFrame(() => $sheets.classList.add('open')));
}
function closeSheet() { $sheets.classList.remove('open'); $sheets.innerHTML = ''; }

function openNewTrip() {
  openSheet(`<div class="sheet-head"><h2>New trip</h2>${closeBtn}</div>
    <form><input name="title" placeholder="Trip to White Sands, NM" autocomplete="off" required>
    <div class="actions"><button class="btn primary">Create</button></div></form>`, el => {
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

function openRename(trip) {
  openSheet(`<div class="sheet-head"><h2>Edit trip</h2>${closeBtn}</div>
    <form><input name="title" autocomplete="off" required>
    <div class="actions"><button type="button" class="btn danger" data-del>Delete trip</button><button class="btn primary">Save</button></div></form>`, el => {
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

function openShare(trip) {
  const base = location.origin + location.pathname;
  const link = `${base}#/trip/${trip.id}`;
  const others = Object.values(USERS).filter(u => u.id !== ME);
  openSheet(`<div class="sheet-head"><h2>Share</h2>${closeBtn}</div>
    <p class="muted">Anyone with the link can edit this trip.</p>
    <div class="copy-row"><input readonly value="${esc(link)}"><button class="btn primary" data-action="copy" data-text="${esc(link)}">Copy</button></div>
    <ul class="people">${trip.members.filter(u => USERS[u]).map(u => `<li><span class="face" style="--c:${USERS[u].color}">${USERS[u].name[0]}</span>${USERS[u].name}${u === ME ? ' (you)' : ''}</li>`).join('')}</ul>
    <div class="proto"><b>Prototype:</b> try co-editing — open this trip
      ${others.map(u => `<a href="${base}?as=${u.id}#/trip/${trip.id}" target="_blank">as ${u.name}</a>`).join(' or ')} in another tab.
      ${trip.spots.length ? `Check-off shows on trip days: <a href="${base}?today=${spotsOf(trip)[0].time.slice(0, 10)}#/trip/${trip.id}">preview day 1</a>.` : ''}</div>`);
}

// Two hours after the last stop; 9 AM tomorrow for an empty trip.
function defaultTime(trip) {
  const s = spotsOf(trip);
  let d;
  if (s.length) { d = toDate(s.at(-1).time); d.setHours(Math.min(d.getHours() + 2, 22), 0, 0, 0); }
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
function openSpotSheet(trip, spot) {
  const draft = spot ? { ...spot } : { lat: null, lng: null, address: '' };
  state.leg = null;
  if (spot) { state.sel = spot.id; render(); focusSpot(spot); }
  openSheet(`<div class="sheet-head"><h2>${spot ? 'Edit stop' : 'Add stop'}</h2>${closeBtn}</div>
    <form>
      <label class="field"><span>Place</span><input name="title" type="search" placeholder="Search a place" autocomplete="off" required></label>
      <ul class="results"></ul>
      <label class="field"><span>When</span><input name="time" type="datetime-local" required></label>
      <label class="field"><span>Note</span><textarea name="note" rows="2" placeholder="Confirmation #, tickets, tips…"></textarea></label>
      <div class="actions">${spot ? '<button type="button" class="btn danger" data-del>Delete</button>' : ''}<button class="btn primary">${spot ? 'Save' : 'Add'}</button></div>
    </form>`, el => {
    const results = el.querySelector('.results'), f = el.querySelector('form'), F = f.elements;
    if (spot) { F.title.value = spot.name; F.time.value = spot.time; F.note.value = spot.note || ''; }
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
      results.innerHTML = '<li class="muted">Searching…</li>';
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(v)}${viewbox(trip)}`, { signal: ctrl.signal });
        list = await res.json();
        results.innerHTML = list.length ? list.map((p, i) => {
          const pl = placeOf(p);
          return `<li><button type="button" data-i="${i}"><b>${esc(pl.name)}</b><span>${esc(pl.address)}</span></button></li>`;
        }).join('') : '<li class="muted">No places found</li>';
      } catch (e) {
        if (e.name !== 'AbortError') results.innerHTML = '<li class="muted">Search is unavailable right now</li>';
      }
    }
    results.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      const p = list[+b.dataset.i], pl = placeOf(p);
      Object.assign(draft, { lat: +p.lat, lng: +p.lon, address: pl.address });
      F.title.value = pl.name;
      results.innerHTML = '';
    });

    f.onsubmit = e => {
      e.preventDefault();
      if (draft.lat == null) { results.innerHTML = '<li class="muted">Pick a place from the search results</li>'; return; }
      const data = { name: F.title.value.trim(), address: draft.address, lat: draft.lat, lng: draft.lng, time: F.time.value, note: F.note.value.trim() };
      if (spot) editSpot(trip.id, spot.id, data);
      else mutate(d => {
        const t = d.trips[trip.id];
        if (!t) return;
        t.spots.push({ id: uid(), ...data, done: false, by: ME, updatedAt: Date.now() });
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
const $toast = Object.assign(document.createElement('div'), { id: 'toast' });
document.body.append($toast);
let toastTimer;
function toast(msg, label, onAction) {
  $toast.innerHTML = `<span>${esc(msg)}</span>${label ? `<button>${esc(label)}</button>` : ''}`;
  if (label) $toast.querySelector('button').onclick = () => { $toast.classList.remove('show'); onAction(); };
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), label ? 5000 : 2800);
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
    case 'toggle-done': editSpot(trip.id, spot.id, { done: !spot.done }); break;
    case 'share': openShare(trip); break;
    case 'rename': openRename(trip); break;
    case 'close-sheet': closeSheet(); break;
    case 'copy': navigator.clipboard?.writeText(el.dataset.text).then(() => toast('Link copied'), () => toast('Copy failed')); break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
addEventListener('hashchange', render);

render();
