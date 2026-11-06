'use strict';

/* Waythread prototype — vanilla JS, no build step. The app's frontend (app/web/app.js) with its backend swapped out:
   the sections marked "Prototype only" stand in for the server, and everything else is the same as the app's, line for line.
   One trip screen: a full-screen map with one day of the plan as a draggable sheet on top; from 768px wide,
   the plan is a side panel next to the map instead.
   Data lives in localStorage; a BroadcastChannel keeps open tabs in sync to simulate co-editing
   (open the trip with ?as=sam in a second tab). Look, components and icons come from ../design-system. */

const params = new URLSearchParams(location.search);
// ?today=YYYY-MM-DD (and &now=HH:MM) pretend it's a trip day, so today's highlight can be previewed before the trip
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(params.get('today') || '') ? params.get('today') : null;
const NOW_HM = /^\d{2}:\d{2}$/.test(params.get('now') || '') ? params.get('now') : null;

const ROUTE_KEY = 'waythread:routes:v1';
const $app = document.getElementById('app');
const $sheets = document.getElementById('sheets');
// sel: the selected stop · selRow: which of its rows was tapped (a hotel can start and end the day) · leg: the drive whose route is shown · snap: the phone's list, 'half' or 'full' ·
// draft: the stop open in the stop sheet, as edited so far, which the map shows in its place ·
// folder: the folder tapped open (a stop selected in a folder opens it too)
const state = { sel: null, selRow: null, leg: null, hoverLeg: null, day: null, snap: 'half', draft: null, folder: null, flash: new Set() };

// Who's signed in, the home list, and the open trip ({ id, name, members, stops } or { id, error })
let me = null, config = { google: false, apple: false, password: false }, trips = null, cur = null;
// Whether any real sign-in is set up; without one, guests aren't offered an upgrade they can't do.
const canSignIn = () => config.google || config.apple || config.password;
// What to do when a request fails: wait out the server's rate limit, get a connection, or try again
const failHint = err => err?.code === 'rate_limited' ? 'Too many tries. Wait a minute, then try again.'
  : err?.code === 'offline' ? 'Check your connection, then try again.' : 'Try again in a moment.';
// As one line, for a form's error text: what failed, then what to do
const failMsg = (err, what) => (err?.code === 'rate_limited' ? failHint(err) : `${what} ${failHint(err)}`);

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const memberOf = id => cur?.members?.find(m => m.id === id);
// The initial sits under the photo, so it shows while the photo loads and if it fails (see below).
// Google's photo host can refuse requests that carry a referrer.
const avatarHTML = m => `<span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-${m.identity || 1})">${esc((m.name || '?')[0].toUpperCase())}${
  m.image ? `<img class="wt-avatar__img" src="${esc(m.image)}" alt="" referrerpolicy="no-referrer">` : ''}</span>`;
// A photo that won't load (expired, offline, blocked) drops away to reveal the initial. Error events
// don't bubble, so this listens while they travel down.
document.addEventListener('error', e => { if (e.target.classList?.contains('wt-avatar__img')) e.target.remove(); }, true);
// Map drawing can't use CSS classes, so it reads the design tokens directly (theme-aware).
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Icons (design system) ----------
const ICON = Object.fromEntries(['home', 'settings', 'back', 'forward', 'chevron-down', 'chevron-up-down', 'close', 'plus', 'edit', 'car', 'directions', 'map', 'list', 'check', 'fit', 'search', 'pin', 'download', 'saved', 'cloud-off', 'alert', 'indent', 'outdent', 'stack-add']
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
// ---------- Prototype only: the app's /api, answered in the browser ----------
// Trips are saved in localStorage, so they're in this browser only. Routes come from the public OSRM demo server, and
// place search from Nominatim, as in the app's local dev without a Stadia key. Each change goes to the other open
// tabs as the server's live events (see connectLive), so two tabs work like two people on the trip.
// There's no sign-in: you're Alex, or whoever ?as= names.
const USERS = {
  alex: { id: 'alex', name: 'Alex', identity: 1 },
  sam: { id: 'sam', name: 'Sam', identity: 2 },
  jo: { id: 'jo', name: 'Jo', identity: 3 },
};
const ME = USERS[params.get('as')] ? params.get('as') : 'alex';
const DB_KEY = 'waythread:v2';
// One-time carry-over of data saved under the app's old name (Trippy)
for (const [from, to] of [['trippy:v2', DB_KEY], ['trippy:routes:v1', ROUTE_KEY]]) {
  try {
    const old = localStorage.getItem(from);
    if (old !== null && localStorage.getItem(to) === null) localStorage.setItem(to, old);
    localStorage.removeItem(from);
  } catch {}
}
// crypto.randomUUID needs https or localhost; a phone opening the prototype at the computer's address has neither
if (!crypto.randomUUID) crypto.randomUUID = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
function seed() {
  const t = Date.now();
  const s = (kind, name, address, lat, lng, time, note, by) => ({ id: uid(), kind, name, address, lat, lng, time, note, by, updatedAt: t });
  return {
    names: {},
    trips: {
      'white-sands': {
        id: 'white-sands', name: 'White Sands, NM', members: ['alex', 'sam'], createdBy: 'alex', updatedAt: t,
        spots: [
          s('airport', 'El Paso International Airport', '6701 Convair Rd, El Paso, TX', 31.8072, -106.3779, '2026-11-20T10:30', 'UA 1234 lands · rental car at Hertz', 'alex'),
          s('hotel', 'Holiday Inn Express Alamogordo', 'S White Sands Blvd, Alamogordo, NM', 32.8800, -105.9580, '2026-11-20T13:00', 'Drop bags · conf # in email', 'alex'),
          { ...s('attraction', 'White Sands Visitor Center', '19955 US-70, Alamogordo, NM', 32.7797, -106.1717, '2026-11-20T15:00', 'Buy a sled + wax', 'sam'), checkout: '16:00' },
          s('nature', 'Interdune Boardwalk', 'Dunes Dr, White Sands National Park, NM', 32.7930, -106.2110, '2026-11-20T16:30', 'Sunset ~5:00 PM', 'sam'),
          s('museum', 'New Mexico Museum of Space History', '3198 NM-2001, Alamogordo, NM', 32.9214, -105.9213, '2026-11-21T09:30', '', 'alex'),
          s('restaurant', 'Cloudcroft', 'Burro Ave, Cloudcroft, NM', 32.9573, -105.7428, '2026-11-21T12:30', 'Lunch', 'sam'),
          s('airport', 'El Paso International Airport', '6701 Convair Rd, El Paso, TX', 31.8072, -106.3779, '2026-11-22T11:00', 'Fly home · return car by 10:00', 'alex'),
        ],
      },
      'big-bend': {
        id: 'big-bend', name: 'Big Bend in spring', members: ['alex', 'jo', 'sam'], createdBy: 'jo', updatedAt: t - 1,
        spots: [
          s('airport', 'Midland International Air & Space Port', '9506 Laforce Blvd, Midland, TX', 31.9425, -102.2019, '2026-03-13T09:40', 'WN 2210 lands', 'jo'),
          s('restaurant', 'Marfa', 'Highland Ave, Marfa, TX', 30.3094, -104.0206, '2026-03-13T13:00', 'Lunch', 'sam'),
          { ...s('hotel', 'Chisos Mountains Lodge', '1 Basin Rural Station, Big Bend National Park, TX', 29.2700, -103.3005, '2026-03-13T17:30', '', 'jo'), nights: 3 },
          s('nature', 'Lost Mine Trail', 'Basin Junction Rd, Big Bend National Park, TX', 29.2728, -103.2858, '2026-03-14T08:00', 'Start early, it gets hot', 'alex'),
          s('nature', 'Santa Elena Canyon', 'Ross Maxwell Scenic Dr, Big Bend National Park, TX', 29.1672, -103.6089, '2026-03-14T14:00', '', 'sam'),
          s('nature', 'Boquillas Hot Springs', 'Hot Springs Rd, Big Bend National Park, TX', 29.1776, -102.9530, '2026-03-15T10:00', 'Bring a towel', 'jo'),
          s('attraction', 'Terlingua Ghost Town', 'Ivey St, Terlingua, TX', 29.3216, -103.6160, '2026-03-15T18:00', 'Dinner at the Starlight Theatre', 'alex'),
          s('airport', 'Midland International Air & Space Port', '9506 Laforce Blvd, Midland, TX', 31.9425, -102.2019, '2026-03-16T15:00', 'Fly home', 'jo'),
        ],
      },
    },
  };
}
const storeDB = d => { try { localStorage.setItem(DB_KEY, JSON.stringify(d)); } catch {} };
function loadDB() {
  try { const d = JSON.parse(localStorage.getItem(DB_KEY)); if (d && d.trips) return d; } catch {}
  const d = seed();
  storeDB(d);
  return d;
}
const userOf = (d, id) => ({ ...USERS[id], name: d.names?.[id] || USERS[id]?.name || 'Someone' });
// A trip as the server sends it
const snapshotOf = (d, t) => ({ trip: { id: t.id, name: t.name }, members: t.members.filter(u => USERS[u]).map(u => userOf(d, u)), stops: t.spots, folders: t.folders || [] });
const shareURL = token => `${location.origin}${location.pathname}#/join/${token}`;
const newToken = () => uid() + uid();
function inviteToken(tripId) {
  const d = loadDB(), t = d.trips[tripId];
  if (!t) return '';
  if (!t.invite) { t.invite = newToken(); storeDB(d); }
  return t.invite;
}
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('waythread') : null;
const broadcast = (trip, m) => bc?.postMessage({ trip, ...m, by: ME });

async function api(path, { method = 'GET', body, signal } = {}) {
  const [route, query = ''] = path.split('?'), q = new URLSearchParams(query);
  // With no connection the app can't reach its server, so here the trips can't be reached either: turn the network off
  // (DevTools → Network → Offline) to try a trip saved for offline. Who you are still answers, as there's no sign-in.
  if (!navigator.onLine && route !== '/me' && route !== '/config') throw new ApiError(0, 'offline');
  if (route === '/route') return osrmRoute(q.get('from'), q.get('to'));
  if (route === '/places') return searchPlaces(q.get('q'), q.get('near'), signal);
  // Read-modify-write against the latest copy, so edits from other tabs aren't clobbered
  const d = loadDB(), p = route.split('/').filter(Boolean), now = Date.now();
  const fail = (status, code) => { throw new ApiError(status, code); };
  const out = v => { storeDB(d); return v === undefined ? null : JSON.parse(JSON.stringify(v)); };
  const call = `${method} ${p[0]}`;
  if (call === 'GET config') return { google: false, apple: false, password: false };
  if (call === 'GET me') return { id: ME, name: userOf(d, ME).name, isGuest: false };
  if (call === 'POST auth' && p[1] === 'update-user') {
    (d.names ||= {})[ME] = body.name;
    for (const t of Object.values(d.trips)) if (t.members.includes(ME)) broadcast(t.id, { type: 'member.updated', member: userOf(d, ME) });
    return out({ status: true });
  }
  if (call === 'GET trips' && !p[1]) {
    return Object.values(d.trips).filter(t => !t.deleted && t.members.includes(ME)).sort((a, b) => b.updatedAt - a.updatedAt).map(t => {
      const times = t.spots.map(s => s.time).sort();
      const stops = t.spots.map(({ id, name, lat, lng, time, kind, nights }) => ({ id, name, lat, lng, time, kind, nights }));
      return { id: t.id, name: t.name, start: times[0] || null, end: times.at(-1) || null, members: snapshotOf(d, t).members, stops };
    });
  }
  if (call === 'POST trips' && !p[1]) {
    const t = { id: uid(), name: body.name, members: [ME], createdBy: ME, spots: [], updatedAt: now };
    d.trips[t.id] = t;
    return out(snapshotOf(d, t));
  }
  if (call === 'POST join') {
    const t = Object.values(d.trips).find(x => x.invite === p[1]);
    if (!t) fail(404, 'invalid');
    if (t.deleted) fail(410, 'gone');
    if (!t.members.includes(ME)) { t.members.push(ME); broadcast(t.id, { type: 'member.joined', member: userOf(d, ME) }); }
    return out(snapshotOf(d, t));
  }
  // Connected assistants, in Account. There's no MCP server here, so there's nothing to connect.
  if (p[0] === 'assistants') return out(method === 'GET' ? { url: `${location.origin}/api/mcp`, connections: [] } : undefined);
  if (p[0] !== 'trips') fail(404, 'not_found');
  const t = d.trips[p[1]];
  if (!t) fail(404, 'not_found');
  if (p[2] === 'restore' && method === 'POST') { t.deleted = false; return out(); }
  if (t.deleted) fail(410, 'gone');
  if (!t.members.includes(ME)) fail(403, 'not_member');
  const touch = () => { t.updatedAt = now; };
  if (!p[2]) {
    if (method === 'GET') return out(snapshotOf(d, t));
    if (method === 'PATCH') { t.name = body.name; touch(); broadcast(t.id, { type: 'trip.updated', name: t.name }); return out({ ok: true }); }
    if (method === 'DELETE') { t.deleted = true; broadcast(t.id, { type: 'trip.deleted' }); return out(); }
  }
  if (p[2] === 'invite') {
    if (p[3] === 'rotate') t.invite = newToken();
    else t.invite ||= newToken();
    return out({ url: shareURL(t.invite) });
  }
  // Create or rename a folder; a stop goes in or out by its own folder field
  if (p[2] === 'folders' && p[3] && method === 'PUT') {
    const folder = { id: p[3], name: body.name };
    t.folders = [...(t.folders || []).filter(f => f.id !== folder.id), folder];
    broadcast(t.id, { type: 'folder.upserted', folder });
    return out(folder);
  }
  if (p[2] === 'stops' && p[3]) {
    const i = t.spots.findIndex(s => s.id === p[3]);
    if (method === 'DELETE') {
      if (i < 0) return out();
      const [gone] = t.spots.splice(i, 1);
      touch();
      broadcast(t.id, { type: 'stop.removed', id: gone.id, name: gone.name });
      return out();
    }
    if (method === 'PATCH' && i < 0) fail(404, 'not_found');
    const stop = { ...(method === 'PATCH' ? t.spots[i] : {}), ...body, id: p[3], by: ME, updatedAt: now };
    if (i < 0) t.spots.push(stop); else t.spots[i] = stop;
    touch();
    broadcast(t.id, { type: 'stop.upserted', stop });
    return out(stop);
  }
  fail(404, 'not_found');
}
// Fetched as the app's local dev does it (app/src/maps.ts), in the same shapes
async function fetchJSON(url, signal) {
  let res;
  try { res = await fetch(url, { signal }); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'offline');
  }
  if (res.status === 429) throw new ApiError(429, 'rate_limited');
  if (!res.ok) throw new ApiError(502, 'unavailable');
  return res.json();
}
async function osrmRoute(from, to) {
  const [a, b] = [from, to].map(x => x.split(',').map(Number)); // lat,lng
  const j = await fetchJSON(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`);
  if (j.code !== 'Ok') throw new ApiError(502, 'unavailable');
  const rt = j.routes[0];
  return { duration: rt.duration, distance: rt.distance, coords: rt.geometry.coordinates.map(([x, y]) => [+y.toFixed(5), +x.toFixed(5)]) };
}
async function searchPlaces(text, near, signal) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ format: 'jsonv2', limit: '5', addressdetails: '1', q: text }).toString();
  if (near) { const [lat, lng] = near.split(',').map(Number); u.searchParams.set('viewbox', `${lng - 1.5},${lat + 1.5},${lng + 1.5},${lat - 1.5}`); }
  const list = await fetchJSON(u, signal);
  return list.map(p => {
    const a = p.address ?? {};
    return {
      name: p.name || p.display_name.split(', ')[0],
      address: [[a.house_number, a.road].filter(Boolean).join(' '), a.city || a.town || a.village, a.state].filter(Boolean).join(', '),
      lat: +p.lat, lng: +p.lon,
      category: `${p.category}:${p.type}`,
    };
  });
}
// In trip settings: links to try co-editing as someone else, and to preview a trip day
function protoNoteHTML(trip) {
  const base = location.origin + location.pathname, token = inviteToken(trip.id), first = stopsOf(trip)[0];
  const others = Object.values(USERS).filter(u => u.id !== ME);
  return `<div class="proto-note"><b>Prototype:</b> try co-editing: open this trip
    ${others.map(u => `<a href="${base}?as=${u.id}#/join/${token}" target="_blank">as ${u.name}</a>`).join(' or ')} in another tab.
    ${first ? `Trip days highlight what's happening now: <a href="${base}?today=${dayOf(first)}&now=14:10#/trip/${trip.id}">preview day 1 at 2:10 PM</a>.` : ''}</div>`;
}
// The app's home cards show a map picture made by its server; with no server, they keep the route sketch
const mapImageURL = () => null;
const fromSnapshot = s => ({ id: s.trip.id, name: s.trip.name, members: s.members, stops: s.stops, folders: s.folders || [] });

// Writes show at once and save in the background. If one fails, reload the trip so the screen
// matches what's saved.
async function save(req, title = 'Couldn’t save your change') {
  try { return await req; } catch (e) {
    if (e.status === 401) return;
    failToast(e, title);
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
// The overview: every day of the trip on one page, before the first day. The day bar steps through the pages.
const ALL = 'all';
const pagesOf = trip => { const days = daysOf(trip); return days.length ? [ALL, ...days] : []; };
// Today, when it's one of the trip's days, with what's happening now highlighted; else the overview.
// If the day's stops are gone (deleted, moved), the next day that has some.
function currentDay(trip) {
  const days = daysOf(trip);
  if (!days.length) return null;
  const today = nowStamp().slice(0, 10);
  if (!state.day) state.day = days.includes(today) ? today : ALL;
  if (state.day !== ALL && !days.includes(state.day)) state.day = days.find(d => d > state.day) || days.at(-1);
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
// A page's places, drives and rows: one day's, or on the overview every day's, in order. Leg and row keys are
// unique across the trip, so the overview's map works like a day's.
const planOn = (trip, day) => (day === ALL ? daysOf(trip).flatMap(d => dayPlan(trip, d)) : dayPlan(trip, day));
const legsOn = (trip, day) => (day === ALL ? daysOf(trip).flatMap(d => dayLegs(trip, d)) : dayLegs(trip, day));
const itemsOn = (trip, day) => (day === ALL ? daysOf(trip).flatMap(d => dayItems(trip, d)) : dayItems(trip, day));

// ---------- Folders: stops that follow each other, grouped under a name ----------
// A folder isn't a place: it has a name and its stops, and no place or time of its own. A stop is in one by its `folder`,
// a folder's id. The stops in a folder follow each other by time, so a folder is a run of stops with the same folder,
// and the app keeps it that way: a stop joins only the folder right above it (or right below, from the stop sheet), only
// a folder's first or last stop can leave it, and a stop whose time moves out of its folder leaves it.
// Closed, it's one row and one pin; open, its stops and the drives between them hang from its name, and its own drives
// show on the map. It's open while it, or one of its stops, is selected.
const folderName = (trip, id) => trip.folders?.find(f => f.id === id)?.name || 'Folder';
// Its stops' type when they share one, else a place's
function folderKind(stops) {
  const kinds = new Set(stops.map(kindOf));
  return kinds.size === 1 ? [...kinds][0] : 'place';
}
// The folder that's open: the one tapped, or the selected stop's
function openFolderOf(trip) {
  if (state.folder) return state.folder;
  return selectedStop(trip)?.folder || null;
}
// The plan's folders: each run of stops (the stop rows, not the hotel at either end) in the same folder
function planRuns(plan) {
  const runs = [];
  let run = null;
  for (const e of plan) {
    const f = e.role === 'stop' ? e.place.folder : null;
    if (f && run?.fid === f) run.entries.push(e);
    else { run = f ? { fid: f, entries: [e] } : null; if (run) runs.push(run); }
  }
  return runs;
}
// A new folder's first name: the town its first stop is in (from its address, "street, town, ST"), else that stop's name
function suggestFolderName(s) {
  const parts = (s.address || '').split(',').map(x => x.trim()).filter(Boolean);
  const town = parts.length >= 2 ? parts.at(-2) : '';
  return town && !/\d/.test(town) ? town : s.name;
}

// ---------- Stop types: an icon and a color each (--wt-kind-<key>), shared by the list marker and the map pin ----------
// The colors skip blue (routes) and red (a drive that doesn't fit). Keep the keys in sync with KINDS in src/trip.ts.
const KINDS = {
  place: { label: 'Place', icon: 'pin' },
  airport: { label: 'Airport', icon: 'plane' },
  hotel: { label: 'Hotel', icon: 'bed' },
  restaurant: { label: 'Restaurant', icon: 'utensils' },
  cafe: { label: 'Café', icon: 'cup' },
  attraction: { label: 'Attraction', icon: 'star' },
  museum: { label: 'Museum', icon: 'museum' },
  viewpoint: { label: 'Viewpoint', icon: 'camera' },
  nature: { label: 'Nature', icon: 'tree' },
  shopping: { label: 'Shopping', icon: 'bag' },
  gas: { label: 'Gas', icon: 'fuel' },
};
// The type list, in sections a traveler thinks in: anywhere; staying and getting there; eating; seeing and doing
const KIND_SECTIONS = [['place'], ['hotel', 'airport', 'gas'], ['restaurant', 'cafe'], ['attraction', 'viewpoint', 'nature', 'museum', 'shopping']];
// Said only where a type changes the form
const KIND_HINTS = { hotel: 'Check-in and check-out' };
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
const kindColor = s => `var(--wt-kind-${kindOf(s)})`;
const kindIcon = (s, size = 16) => WaythreadIcons.svg(KINDS[kindOf(s)].icon, size);

// ---------- Session (Prototype only) ----------
// No sign-in: someone is always signed in (see USERS), and Sign out says how to be someone else.
async function boot() {
  [config, me] = await Promise.all([api('/config'), api('/me')]);
  if (anySaved()) { rememberSession(); registerOffline(); }
  render();
}
function signOut() { toast({ title: 'The prototype has no sign-in', detail: 'To be Sam or Jo, add ?as=sam or ?as=jo to the address.' }); }

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
// Directions and places open in one maps app, the one you pick in Account: Google Maps unless you choose Apple Maps.
// A web page can't ask which maps app is the default, so it's a setting. It's kept on this device, not the account,
// since which apps you have is up to the phone.
const MAPS_KEY = 'waythread:maps';
const MAPS_APPS = { google: 'Google Maps', apple: 'Apple Maps' };
let mapsApp = 'google';
try { if (localStorage.getItem(MAPS_KEY) === 'apple') mapsApp = 'apple'; } catch {}
function setMapsApp(app) {
  mapsApp = app;
  try { localStorage.setItem(MAPS_KEY, app); } catch {}
}
function directionsURL(from, to) {
  return mapsApp === 'apple'
    ? `https://maps.apple.com/?saddr=${from.lat},${from.lng}&daddr=${to.lat},${to.lng}&dirflg=d`
    : `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
}
// A place, to see that it's the right one and whether it's worth going: photos, reviews, hours. Found by name and
// address, which opens the place itself (Apple Maps searches near its coordinates); coordinates alone would open
// only a dropped pin.
function placeURL(p) {
  const q = encodeURIComponent([p.name, p.address].filter(Boolean).join(', '));
  return mapsApp === 'apple' ? `https://maps.apple.com/?q=${q}&sll=${p.lat},${p.lng}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

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
const OFFLINE_WAIT = 4000; // ms a saved trip waits for the server before showing its copy (a weak signal)
// Who's signed in and what sign-in offers, so the app opens offline, and each saved trip:
// { snap (as /api/trips/:id sends it), savedAt, style (its map's tile address), tiles, bytes, missing, noMap }
let offline = { trips: {} };
try { offline = JSON.parse(localStorage.getItem(OFFLINE_KEY)) || offline; } catch {}
const storeOffline = () => { try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(offline)); } catch {} };
const savedTrip = id => offline.trips[id] || null;
const anySaved = () => Object.keys(offline.trips).length > 0;
// The saved copy of a trip, as the trip screen holds one. `offline` marks it as maybe not the latest.
const offlineCopy = id => (savedTrip(id) ? { ...fromSnapshot(savedTrip(id).snap), offline: true } : null);
// Home's cards for the saved trips, as /api/trips sends them
const offlineCards = () => Object.values(offline.trips).sort((a, b) => b.savedAt - a.savedAt).map(({ snap }) => {
  const times = snap.stops.map(s => s.time).sort();
  return { id: snap.trip.id, name: snap.trip.name, start: times[0] || null, end: times.at(-1) || null, members: snap.members, stops: snap.stops };
});
// No connection, or the trip on screen is its saved copy because the server didn't answer
const offlineNow = () => !navigator.onLine || !!cur?.offline;
const registerOffline = () => navigator.serviceWorker?.register('sw.js').catch(() => {});
function rememberSession() {
  if (!anySaved() || !me) return;
  offline.me = me;
  offline.config = config;
  storeOffline();
}
function forgetOffline() {
  const ids = Object.keys(offline.trips);
  offline = { trips: {} };
  offlineJob = null;
  try { localStorage.removeItem(OFFLINE_KEY); } catch {}
  if (canSaveOffline) for (const name of [SHELL_CACHE, ...ids.map(tileCache)]) caches.delete(name).catch(() => {});
}

// The plan, saved again as it changes while the trip is open online. Not from a saved copy: an edit made offline
// hasn't reached the server, so it isn't saved as if it had.
let planTimer = 0;
function keepOfflinePlan() {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => {
    const trip = cur?.stops ? cur : null, t = trip && savedTrip(trip.id);
    if (!t || trip.offline) return;
    const snap = { trip: { id: trip.id, name: trip.name }, members: trip.members, stops: trip.stops, folders: trip.folders };
    if (JSON.stringify(snap) !== JSON.stringify(t.snap)) { t.snap = snap; t.savedAt = Date.now(); storeOffline(); }
  }, 1000);
}

// The map tiles a saved trip needs: each day's view, and the overview's, at its zoom (with a tile to spare around it),
// a level out and a level in; and a street-level patch around each place. About 1–5 MB a day.
function offlineTileURLs(trip) {
  if (!map || !tiles) return [];
  const urls = new Set([STADIA_CHECK]), size = map.getSize(), spare = L.point(128, 128), street = L.point(256, 256);
  const add = (center, z, half) => { const c = map.project(center, z); for (const u of tiles.tileURLs(L.bounds(c.subtract(half), c.add(half)), z)) urls.add(u); };
  for (const d of pagesOf(trip)) {
    const v = dayView(trip, d);
    if (!v) continue;
    // a level in covers the whole view, where a zoom in can land; a level out, a view-sized area around its middle
    for (const dz of [-1, 0, 1]) add(v.center, Math.round(v.zoom) + dz, size.multiplyBy(Math.max(1, 2 ** dz) / 2).add(spare));
  }
  for (const s of trip.stops) for (const z of [15, 16]) add(L.latLng(s.lat, s.lng), z, street);
  return [...urls];
}

let offlineJob = null; // the trip being saved: { id, done, total, quiet, first (not saved before) }
const toppedUp = new Set(); // saved trips brought up to date this visit
// Save a trip, or bring a saved one up to date (`quiet`: on its own, when the trip opens). Only what isn't saved yet
// is fetched, so bringing it up to date is cheap. The plan is saved first, so it's there even if the map isn't finished.
async function saveOffline(trip, { quiet = false } = {}) {
  if (!canSaveOffline || offlineJob?.id === trip.id || trip.offline) return;
  const id = trip.id, urls = offlineTileURLs(trip), legs = new Map();
  for (const d of daysOf(trip)) {
    const plan = dayPlan(trip, d);
    for (let i = 1; i < plan.length; i++) {
      const a = plan[i - 1].place, b = plan[i].place, k = legKey(a, b);
      if (!samePlace(a, b) && !routes[k]?.ok) legs.set(k, { a, b, k });
    }
  }
  const job = offlineJob = { id, done: 0, total: urls.length + legs.size, quiet, first: !savedTrip(id) };
  if (!quiet) navigator.storage?.persist?.().catch(() => {});
  registerOffline();
  const t = offline.trips[id] ||= { tiles: 0, bytes: 0 };
  t.snap = { trip: { id, name: trip.name }, members: trip.members, stops: trip.stops };
  t.savedAt = Date.now();
  if (tiles) t.style = tiles._url;
  t.noMap = !tiles;
  rememberSession();
  showOffline();
  // The app's own files: the page, its scripts and styles
  const shell = caches.open(SHELL_CACHE).then(c => Promise.all([location.pathname, ...[...document.querySelectorAll('script[src], link[rel="stylesheet"]')].map(el => el.src || el.href)]
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
  storeOffline();
  showOffline();
  if (!quiet) {
    toast(t.missing ? { icon: ICON.download, title: 'Part of the map didn’t download', detail: 'The plan is saved. Try again in trip settings when the signal is better.' }
      : { icon: ICON.saved, title: 'Available offline', detail: `${trip.name} is saved on this device.` });
  }
}
// A saved trip, brought up to date once a visit, after the day on screen has loaded
function topUpOffline(trip) {
  if (!savedTrip(trip.id) || trip.offline || toppedUp.has(trip.id) || !navigator.onLine) return;
  toppedUp.add(trip.id);
  saveOffline(trip, { quiet: true });
}
function removeOffline(trip) {
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
let statusSay = null;
function renderOfflineStatus(trip) {
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
  const ios = navigator.standalone === false ? '<p class="wt-section__hint">On iPhone, Safari clears saved trips you haven’t opened in a week. To keep this one, add Waythread to your Home Screen, open it from there and save the trip again.</p>' : '';
  const map = t.noMap ? ' The map can’t be saved with this map provider.' : t.missing ? ' Part of the map didn’t download.' : '';
  return { kind: 'saved', html: `${head(`Saved on this device (${fmtMB(t.bytes)}), updated ${fmtAgo(t.savedAt)}. It updates whenever you open the trip online.${map}`)}${ios}
      ${t.missing && !trip.offline ? '<button class="wt-btn wt-btn--secondary" data-offline-save>Try again</button>' : ''}
      <button class="wt-btn wt-btn--secondary" data-offline-remove>Remove from this device</button>` };
}
function showOffline() {
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
function needsConnection() {
  if (!offlineNow()) return true;
  toast(offlineNotice(cur));
  return false;
}
// Back online: a trip showing its saved copy loads the server's, and the header stops saying offline.
// Either way, the add bar's buttons follow.
addEventListener('online', () => { if (cur?.offline) reloadTrip(); showOffline(); if (cur?.stops) scheduleRender(); });
addEventListener('offline', () => { showOffline(); if (cur?.stops) scheduleRender(); });

// ---------- Trips ----------
let tripLoad = null; // the id being fetched, so a slow reply for a trip you've left is dropped
async function openTrip(id) {
  tripLoad = id;
  // A trip saved for offline opens from its copy with no connection, or while the server is slow to answer (a weak
  // signal); the server's copy replaces it once it comes.
  const copy = offlineCopy(id);
  const early = copy && setTimeout(() => { if (tripLoad === id && cur?.id !== id) { cur = copy; render(); } }, OFFLINE_WAIT);
  let next;
  try { next = fromSnapshot(await api(`/trips/${id}`)); } catch (e) { next = (e.code === 'offline' && copy) || { id, error: e.code || 'offline' }; }
  clearTimeout(early);
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
  // with no connection, the trips saved on this device
  try { trips = await api('/trips'); } catch (e) { trips = e.code === 'offline' && anySaved() ? offlineCards() : trips || []; }
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
// Prototype only: the other open tabs' changes come over the BroadcastChannel (see api), as the server's events would.
let live = null;
function connectLive(id) { live = id; }
function disconnectLive() { live = null; }
if (bc) bc.onmessage = ({ data: m }) => { if (m.trip === live) onEvent(m); };

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
    case 'folder.upserted': {
      // a new folder comes with its stops' own changes, which say what happened; a rename shows in place
      const i = cur.folders.findIndex(f => f.id === m.folder.id);
      if (i < 0) cur.folders.push(m.folder); else cur.folders[i] = m.folder;
      break;
    }
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
  if (swipe?.lock) { swipe.missed = true; return; }
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
  renderOfflineStatus(trip);
  if (savedTrip(trip.id)) keepOfflinePlan();
  const bar = el.querySelector('.wt-day-bar');
  const topH = el.querySelector('.wt-sheet__top').offsetHeight;
  bar.innerHTML = dayBarHTML(trip);
  bar.hidden = !trip.stops.length;
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


// ---------- Home ----------
// One card per trip: a sketch of its route, its name and dates, and who's on it. Trips that are over go under Past,
// below the rest; each group keeps the server's order, last edited first.
function homeHTML() {
  const today = nowStamp().slice(0, 10), list = trips || [];
  const over = t => !!t.end && t.end.slice(0, 10) < today;
  // What's next first: under way, then soonest; trips with no dates yet last. What's over: the latest first.
  const ahead = list.filter(t => !over(t)).sort((a, b) => (a.start ? 0 : 1) - (b.start ? 0 : 1) || (a.start || '').localeCompare(b.start || ''));
  const past = list.filter(over).sort((a, b) => b.end.localeCompare(a.end));
  const group = (title, ts, done) => `<section class="home-group"><h2 class="home-group__title">${title}</h2>
    <div class="home-grid">${ts.map(t => tripCardHTML(t, done, today)).join('')}</div></section>`;
  const newTrip = cls => `<button class="wt-btn wt-btn--primary ${cls}" data-action="new-trip">${ICON.plus}New trip</button>`;
  return `
    <header class="home-head"><h1>Waythread</h1>
      <div class="home-head__actions">${newTrip('home-new')}
        <button class="wt-icon-btn" data-action="account" aria-label="Account">${avatarHTML({ name: me.name, image: me.image, identity: 1 })}</button>
      </div></header>
    <main class="home">
      ${trips && !list.length ? '<p class="wt-empty">No trips yet. Start one with New trip, or open the link a friend sent you.</p>' : ''}
      ${ahead.length ? group('Upcoming', ahead, false) : ''}
      ${past.length ? group('Past', past, true) : ''}
      ${me.isGuest && trips?.length && canSignIn() ? '<button class="wt-btn wt-btn--secondary wt-btn--block home-guest" data-action="account">Sign in to keep your trips</button>' : ''}
    </main>
    <div class="wt-add-bar home-add">${newTrip('wt-btn--block')}</div>`;
}
const HOME_AVATARS = 4; // past this, the rest are a "+N"
// When a trip is, next to its dates: how soon, or which day of it today is (in primary ink, like the row happening now)
function tripWhen(t, today) {
  if (!t.start) return null;
  const start = t.start.slice(0, 10), end = (t.end || t.start).slice(0, 10);
  if (end < today) return null;
  if (start <= today) return { now: true, text: `Day ${daysBetween(start, today) + 1} of ${daysBetween(start, end) + 1}` };
  const d = daysBetween(today, start);
  return { text: d === 1 ? 'Tomorrow' : d < 14 ? `In ${d} days` : d < 60 ? `In ${Math.round(d / 7)} weeks` : `In ${Math.round(d / 30.4)} months` };
}
function tripCardHTML(t, past, today) {
  const people = t.members || [], shown = people.slice(0, people.length > HOME_AVATARS ? HOME_AVATARS - 1 : HOME_AVATARS);
  const more = people.length - shown.length, when = tripWhen(t, today);
  // Another year's trip says which; one over New Year says both
  const end = t.end || t.start, y1 = t.start?.slice(0, 4), y2 = end?.slice(0, 4);
  const dates = !t.start ? 'No dates yet' : y1 !== y2 ? `${fmtRange(t.start, t.start)}, ${y1} – ${fmtRange(end, end)}, ${y2}`
    : `${fmtRange(t.start, end)}${y1 !== today.slice(0, 4) ? `, ${y1}` : ''}`;
  return `<a class="wt-trip-card${past ? ' is-past' : ''}${when?.now ? ' is-now' : ''}" href="#/trip/${esc(t.id)}">
    ${tripMapHTML(t, past)}
    <span class="wt-trip-card__body">
      <span class="wt-trip-card__text"><span class="wt-trip-card__name">${esc(t.name)}</span>
        <span class="wt-trip-card__dates">${dates}${when ? ` · <span class="wt-trip-card__when">${when.text}</span>` : ''}</span></span>
      ${people.length ? `<span class="wt-avatar-stack wt-trip-card__people" aria-hidden="true">${shown.map(avatarHTML).join('')}${more ? `<span class="wt-avatar wt-avatar--more">+${more}</span>` : ''}</span>
      <span class="wt-visually-hidden">, with ${esc(people.map(m => m.name).join(', '))}</span>` : ''}
    </span></a>`;
}
// A trip's route for its card: a map picture with the drives and places drawn on it (see mapImageURL), and under it, a
// sketch of the same, which shows while the picture loads and stays if it can't load. Like the overview's map, they
// show each day's drives, along the roads where they've been looked up already (Home never looks routes up, so as not
// to use up the limit), straight otherwise, and a dot for each place in its type's color, with north up.
const SKETCH_W = 320, SKETCH_H = 128, SKETCH_PAD = 16, SKETCH_MIN_SPAN = 0.01; // the sketch's own units (5:2, as its box); degrees
const mercY = lat => -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI; // down the page
function tripMapHTML(t, past) {
  const stops = t.stops || [];
  if (!stops.length) return '<span class="wt-trip-card__map wt-trip-card__map--empty">No stops yet</span>';
  const trip = { stops }, legs = [];
  for (const d of daysOf(trip)) {
    const plan = dayPlan(trip, d);
    for (let i = 1; i < plan.length; i++) if (!samePlace(plan[i - 1].place, plan[i].place)) legs.push([plan[i - 1].place, plan[i].place]);
  }
  const places = stops.filter((s, i) => stops.findIndex(o => samePlace(o, s)) === i);
  const hex = name => token(name).replace('#', '');
  const query = new URLSearchParams({
    theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    route: hex(past ? '--wt-route-done' : '--wt-route'),
    legs: legs.map(([a, b]) => `${stops.indexOf(a)}-${stops.indexOf(b)}`).join(','),
    dots: places.map(s => `${stops.indexOf(s)}:${hex(past ? '--wt-kind-past' : `--wt-kind-${kindOf(s)}`)}`).join(','),
    v: stops.map(s => `${s.lat},${s.lng}`).join(';').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0).toString(36), // a new picture when a place moves
  }).toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
  const src = mapImageURL(t.id, query);
  return `<span class="wt-trip-card__map" aria-hidden="true">${routeSketchSVG(legs, places, past)}${src ? `<img class="wt-trip-card__photo" src="${esc(src)}" alt="" loading="lazy" decoding="async">` : ''}</span>`;
}
function routeSketchSVG(legs, places, past) {
  const lines = legs.map(([a, b]) => { const r = routes[legKey(a, b)]; return r?.ok && r.coords.length > 1 ? { road: true, coords: r.coords } : { road: false, coords: [[a.lat, a.lng], [b.lat, b.lng]] }; });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lat, lng] of [...places.map(s => [s.lat, s.lng]), ...lines.flatMap(l => l.coords)]) {
    const y = mercY(lat);
    x0 = Math.min(x0, lng); x1 = Math.max(x1, lng); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const k = Math.min((SKETCH_W - 2 * SKETCH_PAD) / Math.max(x1 - x0, SKETCH_MIN_SPAN), (SKETCH_H - 2 * SKETCH_PAD) / Math.max(y1 - y0, SKETCH_MIN_SPAN));
  const at = (lat, lng) => [SKETCH_W / 2 + (lng - (x0 + x1) / 2) * k, SKETCH_H / 2 + (mercY(lat) - (y0 + y1) / 2) * k];
  const xy = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  // A road's points closer together than a unit or so don't show at this size
  const pathOf = ls => ls.map(({ coords: l }) => {
    const pts = [at(...l[0])];
    for (let i = 1; i < l.length; i++) {
      const p = at(...l[i]), q = pts.at(-1);
      if (i === l.length - 1 || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 1.5) pts.push(p);
    }
    return `M${pts.map(xy).join('L')}`;
  }).join('');
  const roads = pathOf(lines.filter(l => l.road)), guesses = pathOf(lines.filter(l => !l.road));
  const dots = places.map(s => `M${xy(at(s.lat, s.lng))}h0`); // a dot is a path of no length, drawn by its round cap
  const line = (d, cls) => (d ? `<path class="wt-trip-card__casing${cls}" d="${d}"/><path class="wt-trip-card__route${cls}" d="${d}"/>` : '');
  return `<svg viewBox="0 0 ${SKETCH_W} ${SKETCH_H}" preserveAspectRatio="xMidYMid meet">
    ${line(roads, '')}${line(guesses, ' is-estimate')}
    <path class="wt-trip-card__ring" d="${dots.join('')}"/>
    ${places.map((s, i) => `<path class="wt-trip-card__stop" style="--wt-kind-color: ${past ? 'var(--wt-kind-past)' : kindColor(s)}" d="${dots[i]}"/>`).join('')}
  </svg>`;
}
// The picture fades in over the sketch once it's loaded; if it can't load, the sketch stays.
// (load and error don't bubble, and load never reaches window, so these listen on the document, on the way down.)
document.addEventListener('load', e => { if (e.target.classList?.contains('wt-trip-card__photo')) e.target.classList.add('is-loaded'); }, true);
document.addEventListener('error', e => { if (e.target.classList?.contains('wt-trip-card__photo')) e.target.remove(); }, true);

// ---------- Trip screen: map + one day of the plan ----------
// Stadia answers a domain it doesn't know with a "401" picture instead of an error, which Leaflet
// can't tell from a real tile; ask once per visit whether it will serve this site. With no connection there's no
// answer: use Stadia, whose tiles a trip saved for offline has (the tile asked for is saved with them), and ask again next time.
const STADIA_CHECK = 'https://tiles.stadiamaps.com/tiles/alidade_smooth/0/0/0.png';
let stadiaCheck = null;
const stadiaServes = () => (stadiaCheck ??= fetch(STADIA_CHECK).then(r => r.ok, () => { stadiaCheck = null; return true; }));
let map = null, layer = null, routeLayer = null, fitKey = '';
let camPlaced = false; // the new map has been framed once: its first framing is placed, not flown to
let camTarget = null; // where the camera is flying, and until when
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let zoomAnim = false, drawPending = false; // Leaflet is sliding the map to a new zoom (a wheel, a double tap, the end of a pinch)

// ---------- Routes on the map ----------
// Leaflet's own vector layers draw a route once each time the map stops, and while the map moves they scale that
// picture with CSS: lines fatten as the map zooms in and thin out as it zooms out, and whatever lay outside the view
// they were drawn for is missing until the map stops. This layer draws the routes itself, on every frame of a move,
// at the map's real scale, so a line keeps its width and reaches the edge of the map the whole way:
// - a flight (flyTo), a pinch, a drag and its glide move the map frame by frame, and each frame is drawn as it comes;
// - Leaflet's short zoom animation (a wheel, a double tap, the end of a pinch) slides the tiles and pins with a CSS
//   transition, so each frame is drawn where that transition has them by then.
// Routes are kept by key: one that changes its look (shown, muted, over) eases into it, and one that comes or goes
// (another day, a route that has come in) fades.
const SVG_NS = 'http://www.w3.org/2000/svg';
const ROUTE_PAD = 0.3; // drawn this far past each edge of the map (a share of its size), so a drag doesn't reach the end
const ROUTE_FADE = 250; // ms, as --wt-duration-base
const ZOOM_ANIM = 250; // ms: Leaflet's zoom transition, transform .25s cubic-bezier(0, 0, .25, 1) in leaflet.css
// How far along Leaflet's zoom transition is at `t` (0–1): cubic-bezier(0, 0, .25, 1), solved for x = t
function zoomEase(t) {
  let lo = 0, hi = 1, u = t;
  for (let i = 0; i < 24; i++) {
    u = (lo + hi) / 2;
    if (0.75 * u * u * (1 - u) + u * u * u < t) lo = u; else hi = u;
  }
  return 3 * u * u * (1 - u) + u * u * u;
}
const svgEl = (tag, cls) => { const el = document.createElementNS(SVG_NS, tag); if (cls) el.setAttribute('class', cls); return el; };
// Where the routes are drawn from: a point on the map is at `world * s - o` in Leaflet's layer pixels, where `world`
// is its place at zoom 0. Every view the map passes through, flying, pinching or in a zoom transition, is one of these.
const viewOf = m => { const o = m.getPixelOrigin(); return { s: m.getZoomScale(m.getZoom(), 0), ox: o.x, oy: o.y }; };
const RouteLayer = window.L && L.Layer.extend({
  options: { pane: 'overlayPane' },
  initialize() { this._routes = new Map(); this._leaving = new Set(); },
  onAdd(map) {
    this._svg = svgEl('svg', 'wt-routes');
    this._base = svgEl('g');
    this._top = svgEl('g'); // the route on show, over the others where they cross
    this._svg.append(this._base, this._top);
    this.getPane().appendChild(this._svg);
    this._view = this._bounds = this._size = null;
    this._draw(viewOf(map));
  },
  onRemove() {
    cancelAnimationFrame(this._anim);
    this._svg.remove();
    this._routes.clear();
    this._leaving.clear();
  },
  getEvents() {
    return { zoom: this._onMove, move: this._onMove, moveend: this._onMove, viewreset: this._onMove, resize: this._onResize, zoomanim: this._onZoomAnim };
  },
  // The routes to show, bottom first: { key, coords: [[lat, lng], …], color, width, casing, casingWidth, dash, top, onClick }.
  // A route under the same key with other coordinates (the drive came in, or moved) is a new route: the old one fades out.
  setRoutes(list) {
    const next = new Map();
    for (const r of list) {
      const sig = `${r.coords.length}|${r.coords[0]}|${r.coords.at(-1)}`;
      let route = this._routes.get(r.key);
      if (route && route.sig !== sig) { this._leave(route); route = null; }
      this._routes.delete(r.key);
      if (!route) route = this._enter(r, sig);
      else if (route.coords !== r.coords) this._project(route, r.coords);
      this._style(route, r);
      next.set(r.key, route);
    }
    for (const route of this._routes.values()) this._leave(route);
    this._routes = next;
    // in the order asked, moving routes only when the order has changed (a move restarts a route's transitions)
    for (const g of [this._base, this._top]) {
      const want = [...next.values()].filter(route => route.g.parentNode === g || (!route.g.parentNode && route.top === (g === this._top))).map(route => route.g);
      const have = [...g.children].filter(el => !el.classList.contains('is-leaving'));
      if (want.length !== have.length || want.some((el, i) => el !== have[i])) for (const el of want) g.appendChild(el);
    }
    for (const route of next.values()) {
      if (this._view && !route.drawn) this._drawRoute(route);
      if (route.entering && !reduceMotion.matches) route.g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ROUTE_FADE, easing: 'ease-out' });
      route.entering = false;
    }
  },
  _enter(r, sig) {
    const g = svgEl('g', 'wt-route');
    const casing = svgEl('path', 'wt-route__casing'), line = svgEl('path', 'wt-route__line');
    g.append(casing, line);
    const route = { key: r.key, sig, g, paths: [casing, line], top: !!r.top, drawn: false, entering: true };
    if (r.onClick) {
      // a wide line nobody sees, so the route is easy to tap
      const hit = svgEl('path', 'wt-route__hit leaflet-interactive');
      g.append(hit);
      route.paths.push(hit);
      hit.addEventListener('click', e => {
        e.stopPropagation(); // the map's own click clears the selection
        if (!this._map?.dragging?.moved()) route.onClick?.();
      });
    }
    this._project(route, r.coords);
    return route;
  },
  _leave(route) {
    route.g.classList.add('is-leaving');
    this._leaving.add(route);
    const done = () => { route.g.remove(); this._leaving.delete(route); };
    if (reduceMotion.matches || !route.g.parentNode) return done();
    const from = getComputedStyle(route.g).opacity;
    route.g.animate([{ opacity: from }, { opacity: 0 }], { duration: ROUTE_FADE, easing: 'ease-in', fill: 'forwards' }).finished.then(done, done);
  },
  _style(route, r) {
    const [casing, line] = route.paths;
    route.onClick = r.onClick;
    casing.style.stroke = r.casing;
    casing.style.strokeWidth = `${r.casingWidth}px`;
    line.style.stroke = r.color;
    line.style.strokeWidth = `${r.width}px`;
    line.style.strokeDasharray = r.dash || 'none';
  },
  // Each point at zoom 0, once: every frame after that is a multiply and a subtract
  _project(route, coords) {
    const m = this._map, w = new Float64Array(coords.length * 2);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    coords.forEach((c, i) => {
      const p = m.project(c, 0);
      w[i * 2] = p.x; w[i * 2 + 1] = p.y;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    });
    Object.assign(route, { coords, world: w, box: [x0, y0, x1, y1] });
  },
  _onMove() {
    const m = this._map;
    if (!m || m._animatingZoom) return; // the zoom transition's frames draw themselves
    cancelAnimationFrame(this._anim);
    const v = viewOf(m), last = this._view;
    // a drag moves the drawing with the map; it's only drawn again once the map nears its edge
    if (!this._dirty && last && v.s === last.s && v.ox === last.ox && v.oy === last.oy && this._covers()) return;
    this._draw(v);
  },
  _onResize() { this._dirty = true; this._onMove(); },
  // Leaflet moves the map to its new zoom at once and lets a CSS transition slide the tiles and pins there; on every frame
  // of it, each point is that far between where it was and where it's going, so draw the routes at that view.
  _onZoomAnim(e) {
    const m = this._map, from = viewOf(m), o = m._getNewPixelOrigin(e.center, e.zoom);
    const to = { s: m.getZoomScale(e.zoom, 0), ox: o.x, oy: o.y }, pane = m.getPane('mapPane'), t0 = document.timeline?.currentTime ?? performance.now();
    let css = null;
    cancelAnimationFrame(this._anim);
    const frame = now => {
      if (!m._animatingZoom) return; // over: the map's own zoom and move events have drawn the end
      // Timed by the tiles' and pins' own transition when there is one: the browser can start it a frame later than
      // it was asked for, and the curve is steep at the start, so a frame early would put the routes well ahead of the pins.
      css ||= pane.getAnimations?.({ subtree: true }).find(a => a.transitionProperty === 'transform');
      const t = css ? (css.currentTime ?? 0) : now - t0;
      const k = zoomEase(Math.min(1, Math.max(0, t) / ZOOM_ANIM));
      this._draw({ s: from.s + (to.s - from.s) * k, ox: from.ox + (to.ox - from.ox) * k, oy: from.oy + (to.oy - from.oy) * k });
      if (k < 1) this._anim = requestAnimationFrame(frame);
    };
    this._anim = requestAnimationFrame(frame);
  },
  // Does the drawing still reach past every edge of the map?
  _covers() {
    const m = this._map, tl = m.containerPointToLayerPoint([0, 0]);
    return !!this._bounds && this._bounds.contains(tl) && this._bounds.contains(tl.add(m.getSize()));
  },
  _draw(v) {
    const m = this._map, size = m.getSize(), pad = size.multiplyBy(ROUTE_PAD).round();
    const min = m.containerPointToLayerPoint([0, 0]).subtract(pad).round(), dim = size.add(pad.multiplyBy(2));
    this._view = v;
    this._dirty = false;
    this._bounds = L.bounds(min, min.add(dim));
    if (!this._size?.equals(dim)) {
      this._size = dim;
      this._svg.setAttribute('width', dim.x);
      this._svg.setAttribute('height', dim.y);
    }
    L.DomUtil.setPosition(this._svg, min);
    this._svg.setAttribute('viewBox', `${min.x} ${min.y} ${dim.x} ${dim.y}`);
    for (const route of this._routes.values()) this._drawRoute(route);
    for (const route of this._leaving) this._drawRoute(route);
  },
  // The route as a path at the current view: points less than a pixel apart are merged, and the line is cut where it
  // leaves the drawing, so a long drive at a close zoom stays a short path.
  _drawRoute(route) {
    const { s, ox, oy } = this._view, b = this._bounds, w = route.world, [x0, y0, x1, y1] = route.box;
    route.drawn = true;
    let d = '';
    if (x1 * s - ox >= b.min.x && x0 * s - ox <= b.max.x && y1 * s - oy >= b.min.y && y0 * s - oy <= b.max.y) {
      const pts = [], n = w.length / 2;
      for (let i = 0; i < n; i++) {
        const x = w[i * 2] * s - ox, y = w[i * 2 + 1] * s - oy, last = pts.at(-1);
        if (last && i < n - 1 && Math.abs(x - last.x) < 1 && Math.abs(y - last.y) < 1) continue;
        pts.push(L.point(x, y));
      }
      let part = false;
      for (let i = 0; i < pts.length - 1; i++) {
        const seg = L.LineUtil.clipSegment(pts[i], pts[i + 1], b, i > 0, false);
        if (!seg) { part = false; continue; }
        if (!part) d += `M${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
        d += `L${seg[1].x.toFixed(1)} ${seg[1].y.toFixed(1)}`;
        part = seg[1] === pts[i + 1]; // cut off at the edge: the next piece starts a new line
      }
      if (pts.length === 1) d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}l0 0`;
    }
    if (d !== route.d) { route.d = d; for (const p of route.paths) p.setAttribute('d', d); }
  },
});
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
  // The address of every tile under pixel bounds `b` at zoom `z`
  t.tileURLs = (b, z) => {
    if (z < t.options.minZoom || z > t.options.maxZoom) return [];
    const size = t.getTileSize(), n = 2 ** z, out = [];
    const lo = b.min.unscaleBy(size).floor(), hi = b.max.unscaleBy(size).ceil();
    for (let y = Math.max(lo.y, 0); y < Math.min(hi.y, n); y++) {
      for (let x = lo.x; x < hi.x; x++) out.push(L.Util.template(url, { ...t.options, r: L.Browser.retina ? '@2x' : '', x: ((x % n) + n) % n, y, z }));
    }
    return out;
  };
  // Every tile under pixel bounds `b` at zoom `z`: now, or with `later`, queued behind everything else
  t.prefetchArea = (b, z, later = false) => {
    for (const src of t.tileURLs(b, z)) {
      if (fetchedTiles.has(src)) continue;
      fetchedTiles.add(src);
      if (later) tileQueue.push(src); else new Image().src = src;
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
  // the next page, then the one before, then outward. The overview is a page too: its drives are every day's.
  const pages = pagesOf(trip), i0 = pages.indexOf(d0);
  const dist = d => { const i = pages.indexOf(d); return Math.abs(i - i0) * 2 - (i > i0 ? 1 : 0); };
  const days = pages.filter(d => d !== d0).sort((a, b) => dist(a) - dist(b));
  for (const d of days) {
    if (d === ALL) continue;
    const plan = dayPlan(trip, d);
    for (let i = 1; i < plan.length; i++) getRoute(plan[i - 1].place, plan[i].place, { background: true });
  }
  // the camera depends on how much of the map the open stop covers; wait until it's closed
  if (!tiles || navigator.connection?.saveData || state.draft) return;
  if (tiles.isLoading()) { tiles.once('load', schedulePreload); return; } // the day on screen comes first
  topUpOffline(trip);
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
  if (map) { map.remove(); map = null; layer = routeLayer = null; fitKey = ''; }
  tiles = null;
  tileQueue = [];
  clearTimeout(preloadTimer);
  clearTimeout(mapTapTimer);
  dayShown = false;
  dropBackgroundRoutes();
  const left = $app.dataset.trip;
  delete $app.dataset.trip;
  state.sel = state.selRow = state.leg = state.hoverLeg = state.day = state.draft = state.folder = null;
  state.snap = 'half';
  camFree = false;
  // the stop sheet leaves the header in reach, so Home can be tapped while it's open
  if (left && $sheets.innerHTML) closeSheet();
}
function mountTrip(trip) {
  teardownTrip();
  $app.dataset.trip = trip.id;
  $app.dataset.page = 'trip';
  scrollTo(0, 0); // Home may have been scrolled; the trip screen starts at the top of the window
  // The plan is the page: a header with the trip's name, the map, and a sheet with one day of the plan.
  // On a phone the header spans the top and the sheet is half or all of the screen below it, with Map/List in
  // the header to switch. On a wide screen the header and the sheet are a side panel next to the map.
  $app.innerHTML = `<div class="trip">
    <header class="wt-trip-head">
      <a class="wt-icon-btn" href="#/" aria-label="All trips">${ICON.home}</a>
      <h1 class="wt-trip-head__name"></h1>
      <button class="wt-icon-btn wt-trip-head__status" data-action="offline-status" hidden></button>
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
  listTop = 0;
  list.addEventListener('scroll', onListScroll, { passive: true });
  new ResizeObserver(updateFades).observe(list); // the sheet changing height
  if (!window.L) return;
  // double-tap zoom is our own (see mapGestures), so it works over routes and pins too
  map = L.map($app.querySelector('#map'), { zoomControl: false, attributionControl: false, doubleClickZoom: false }).setView([32.6, -106.1], 8);
  map.getPane('markerPane').classList.add('wt-pins'); // so the other pins step back while one is selected
  camPlaced = false;
  camTarget = null;
  zoomAnim = drawPending = false;
  // A pin added during Leaflet's zoom animation is placed where the map is going, while the map is still sliding
  // there, so drawMap waits the quarter second for it to end. A flight is drawn as it goes: pins follow the map
  // frame by frame, and so do routes (see RouteLayer).
  map.on('zoomanim', () => { zoomAnim = true; });
  map.on('moveend', () => {
    zoomAnim = false;
    if (drawPending && cur?.stops) { drawPending = false; drawMap(cur); }
  });
  map.on('zoom zoomend moveend', fitPins); // pins get their numbers back as you zoom in, and give them up as you zoom out or pan to a crowd
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
    // A trip opened from its saved copy shows the map that was saved with it, light or dark, whichever the phone is now
    const style = (trip.offline && savedTrip(trip.id)?.style) || `https://tiles.stadiamaps.com/tiles/alidade_smooth${dark ? '_dark' : ''}/{z}/{x}/{y}{r}.png`;
    const quiet = bufferedTileLayer(style, { maxZoom: 20 }).addTo(m);
    tiles = quiet;
    // A tile that fails with no connection is one that wasn't saved, not Stadia refusing the site: keep the rest
    const fallBack = () => {
      if (offlineNow()) return;
      quiet.off('tileerror', fallBack);
      m.removeLayer(quiet); tiles = null; tileQueue = []; osm();
    };
    quiet.on('tileerror', fallBack);
    schedulePreload();
  });
  routeLayer = new RouteLayer().addTo(map);
  layer = L.layerGroup().addTo(map);
  // once you've touched the map, a new sheet height leaves the camera where you put it
  map.getContainer().addEventListener('pointerdown', () => { camFree = true; });
  // Zooming the map is touching it: the camera stays where you put it when the sheet changes height.
  // A wheel doesn't fire pointerdown; without this, the re-frame for the new height would fight the zoom you asked for.
  const zooming = () => { camFree = true; };
  map.getContainer().addEventListener('wheel', zooming, { passive: true });
  map.getContainer().addEventListener('touchstart', e => { if (e.touches.length > 1) zooming(); }, { passive: true });
  mapGestures(map, zooming);
  // Tapping empty map clears the selection; a route's preview goes back to the whole day.
  // While a stop is open, the map is there to look at, so taps leave everything as it is.
  map.on('click', () => onMapTap(() => {
    if (state.draft || (!state.sel && !state.leg && !state.folder)) return;
    if (state.leg || openFolderOf(cur)) fitKey = '';
    state.sel = state.selRow = state.leg = state.folder = null;
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
// A button over the map, as a maps app's route overview button is. It's always there with the map, and greyed out while
// the map already shows the whole day, since then it would do nothing. It isn't there over the whole-day list, which
// hides the map, or while a stop is open.
let dayShown = false; // the camera is where dayView puts it for the day on screen
function dayFramed() {
  const trip = cur?.stops ? cur : null, day = trip && currentDay(trip), v = map && day && dayView(trip, day);
  if (!v) return true;
  return Math.abs(map.getZoom() - v.zoom) < 0.01 && map.latLngToContainerPoint(v.center).distanceTo(map.getSize().divideBy(2)) < 3;
}
function updateFitBtn() {
  const btn = $app.querySelector('.trip-fit');
  if (!btn) return;
  const trip = cur?.stops ? cur : null, day = trip && currentDay(trip);
  btn.hidden = !map || !day || !!state.draft || (!isWide() && state.snap === 'full');
  btn.disabled = dayShown && !state.leg;
  // on the overview, it's the whole trip
  const label = day === ALL ? ['Whole trip', 'Show the whole trip on the map'] : ['Whole day', 'Show the whole day on the map'];
  if (btn.title !== label[0]) { btn.title = label[0]; btn.setAttribute('aria-label', label[1]); }
}
function showWholeDay() {
  state.leg = state.folder = null;
  fitKey = '';
  render();
}

const timeHTML = t => fmtTime(t).replace(/ (AM|PM)$/, '<span class="wt-tl-meridiem">$1</span>');
const markerHTML = (s, cls) => `<i class="wt-marker ${cls}" role="img" aria-label="${KINDS[kindOf(s)].label}" style="--wt-kind-color: ${kindColor(s)}">${kindIcon(s)}</i>`;

// ---------- Timeline: rail · stop · time. Each stop's marker is its pin on the map: same icon, same color. ----------
const gapMin = (a, b) => (toDate(b) - toDate(a)) / 60000;
// A drive reads as a sentence ("1 hr 49 min drive"), with a small car on the rail, and says when it won't make it.
// Tapping the row shows the route on the map, and the bar below the list offers Directions in the maps app.
// Rows take `row`: { key, past (over: dimmed), now (happening now: highlighted), sel (the selected row) }.
const rowState = (past, now) => `${past ? ' is-past' : ''}${now ? ' is-now' : ''}`;
function driveItem(day, leg) {
  const { r, to, fromEntry, toEntry } = leg, late = lateMin(leg);
  const cls = ['wt-tl-drive', state.leg === leg.key ? 'is-active' : '', late > 0 ? 'is-late' : ''];
  return {
    // when you set off (until the route is in, no earlier than you arrive); the drive back to the hotel has no time, so it comes last
    start: leg.leave || leg.arrive || (toEntry.role === 'night' ? `${day}T23:58` : fromEntry.place.time),
    html: ({ past, now, inFolder }) => `<div class="${cls.join(' ')}${inFolder ? ` wt-tl-drive--in${inFolder}` : ''}${rowState(past, now)}" data-leg="${esc(leg.key)}" data-action="leg" tabindex="0" role="button" aria-pressed="${state.leg === leg.key}" aria-label="${r ? fmtDur(r.duration) : ''} drive to ${esc(to.name)}. Show the route on the map">
      ${inFolder ? `<span class="wt-tl-rail"></span><span class="wt-tl-thread"><i class="wt-tl-car">${ICON.car}</i></span>` : `<span class="wt-tl-rail"><i class="wt-tl-car">${ICON.car}</i></span>`}
      <span class="wt-tl-drive__body">
        <span class="wt-tl-drive__what"><b>${r ? fmtDur(r.duration) : '…'}</b> drive</span>
        ${late > 0 ? `<span class="wt-tl-drive__late">Arrives ${fmtDur(late * 60)} late</span>` : ''}
      </span>
    </div>`,
  };
}
// Links in a note can be tapped. Each shows only its site (booking.com), so a long link doesn't fill the row;
// punctuation right after one ("see https://…).") stays text.
const LINK_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
function noteHTML(text) {
  let html = '', at = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const url = m[0].replace(/[.,;:!?)\]}，。；：！？）】」』]+$/, '');
    let site;
    try { site = new URL(url).hostname.replace(/^www\./, ''); } catch { continue; }
    html += `${esc(text.slice(at, m.index))}<a href="${esc(url)}" target="_blank" rel="noopener">${esc(site)}</a>`;
    at = m.index + url.length;
  }
  return html + esc(text.slice(at));
}
// A stop row: marker · name · time, with its notes below across the name and time. A hotel on its check-in day says how many nights.
// A row from another day than the one on screen can say which day in place of the time.
// Tapping it selects it: the row and its pin are highlighted, and Add stop becomes Open in Maps and Edit stop. Tapping it again keeps it selected.
// It's a div acting as a button, like a drive, since a link in its note can't sit inside a <button>.
// In an open folder (`inFolder`, with ' is-first' or ' is-last' where the folder's thread starts and ends), it hangs
// from the folder's name, and its name leaves out the folder's when it starts with it (Visitor Center, in White Sands).
function stopRow(s, { key, past, now, sel, inFolder, folder }, note, time, timeDay) {
  const notes = note.filter(Boolean), marker = markerHTML(s, 'wt-tl-marker');
  const name = folder && s.name.startsWith(`${folder} `) ? s.name.slice(folder.length + 1) : s.name;
  return `<div class="wt-tl-stop${inFolder ? ` wt-tl-stop--in${inFolder}` : ''}${sel ? ' is-selected' : ''}${rowState(past, now)}" data-action="select" data-id="${esc(s.id)}" data-row="${esc(key)}"${key === s.id ? ' data-stop' : ''} tabindex="0" role="button" aria-pressed="${!!sel}" style="--wt-kind-color: ${kindColor(s)}">
      ${inFolder ? `<span class="wt-tl-rail"></span><span class="wt-tl-thread">${marker}</span>` : `<span class="wt-tl-rail">${marker}</span>`}
      <span class="wt-tl-name">${esc(name)}</span>${notes.length ? `<span class="wt-tl-notes">${notes.map(n => `<span class="wt-tl-note">${noteHTML(n)}</span>`).join('')}</span>` : ''}
      <span class="wt-tl-time">${time ? timeHTML(time) : ''}${timeDay ? `<span class="wt-tl-time__day">${esc(timeDay)}</span>` : ''}</span>
    </div>`;
}
// `note` false leaves out the stop's own note (the overview), keeping a hotel's nights.
function stopItem(trip, s, { note = true } = {}) {
  const stay = kindOf(s) === 'hotel' && staysOf(trip).find(st => st.s === s);
  const nights = stay && `${stay.nights} ${stay.nights === 1 ? 'night' : 'nights'}`;
  return { start: s.time, html: row => stopRow(s, row, [nights, note && s.note], s.time) };
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
// Below the list, always in reach: Add stop; with a stop selected, Open in Maps (the place in the maps app, to see what it is)
// and a round Edit stop; with a drive's route shown, Directions to the drive's end in the maps app. Either way a small + at the
// end keeps adding one tap away. Each button has a `data-key`, the same in every set, so a change of set can morph (morphRow).
// Offline, adding and editing are greyed out (aria-disabled), and a tap says why (see needsConnection).
function addBarHTML(trip) {
  const s = selectedStop(trip), off = offlineNow() ? ' aria-disabled="true"' : '';
  const leg = !s && state.leg && legsOn(trip, currentDay(trip)).find(l => l.key === state.leg);
  const plus = `<button class="wt-btn wt-btn--secondary wt-btn--icon" data-key="add" data-action="add"${off} aria-label="Add stop" title="Add stop">${ICON.plus}</button>`;
  // A folder isn't a place, so there's nothing to open in Maps: Add stop, and a round Rename folder
  if (!s && !leg && state.folder && trip.stops.some(x => x.folder === state.folder)) {
    return `<button class="wt-btn wt-btn--primary wt-btn--block" data-key="add" data-action="add"${off}>${ICON.plus}Add stop</button><button class="wt-btn wt-btn--secondary wt-btn--icon" data-key="edit" data-action="rename-folder" data-folder="${esc(state.folder)}"${off} aria-label="Rename folder" title="Rename folder">${ICON.edit}</button>`;
  }
  if (leg) return `<a class="wt-btn wt-btn--primary wt-btn--block" data-key="main" href="${directionsURL(leg.from, leg.to)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(leg.to.name)} in your maps app">${ICON.directions}Directions</a>${plus}`;
  return s
    ? `<a class="wt-btn wt-btn--primary wt-btn--block" data-key="main" href="${esc(placeURL(s))}" target="_blank" rel="noopener" aria-label="Open ${esc(s.name)} in your maps app">${ICON.map}Open in Maps</a><button class="wt-btn wt-btn--secondary wt-btn--icon" data-key="edit" data-action="edit" data-id="${esc(s.id)}"${off} aria-label="Edit stop" title="Edit stop">${ICON.edit}</button>${plus}`
    : `<button class="wt-btn wt-btn--primary wt-btn--block" data-key="add" data-action="add"${off}>${ICON.plus}Add stop</button>`;
}
function renderAddBar(trip) {
  const bar = $app.querySelector('.wt-add-bar'), html = addBarHTML(trip);
  // only when it changes, so a focused button keeps its focus through the minute's re-render
  if (bar.wtHTML === html) return;
  const before = bar.wtHTML !== undefined && [...bar.querySelectorAll(':scope > [data-key]')].map(el => ({ key: el.dataset.key, el, r: el.getBoundingClientRect() }));
  bar.innerHTML = html; bar.wtHTML = html;
  if (before) morphRow(bar, before);
}
// A row of buttons changing to another set morphs into it, on --wt-duration-base (see "Motion" in the design system's README).
// `before` is the old buttons and where they were. A button in both sets (the same data-key) moves and stretches from where it
// was to where it goes, its old look fading out over it in the first 60%: full-width Add stop shrinks into the + at the row's end, and back.
// A new button fades in, a wide one growing from its left edge, a round one from smaller; one that's gone fades out where it
// was, under the rest. While it runs the row is .is-morphing: its buttons are placed absolutely, here, and it keeps its height.
function morphRow(row, before) {
  const ms = parseFloat(token('--wt-duration-base')) || 0, id = row.wtMorph = {};
  row.classList.remove('is-morphing'); row.style.height = '';
  row.querySelectorAll(':scope > *').forEach(el => el.removeAttribute('style'));
  const box = row.getBoundingClientRect();
  const after = [...row.querySelectorAll(':scope > [data-key]')].map(el => ({ key: el.dataset.key, el, r: el.getBoundingClientRect() }));
  const was = new Map(before.map(b => [b.key, b])), keys = new Set(after.map(a => a.key));
  const still = after.length === before.length && after.every(a => was.get(a.key)?.r.left === a.r.left && was.get(a.key).r.width === a.r.width);
  if (!ms || still || !box.width || before.some(b => !b.r.width)) return;
  const x = r => `${r.left - box.left}px`, place = (el, r) => Object.assign(el.style, { left: x(r), top: `${r.top - box.top}px`, width: `${r.width}px` });
  const ghost = b => {
    const g = b.el.cloneNode(true);
    g.removeAttribute('style'); g.removeAttribute('data-key'); g.removeAttribute('data-action');
    g.classList.add('is-ghost'); g.inert = true; g.setAttribute('aria-hidden', 'true'); g.tabIndex = -1;
    place(g, b.r);
    return g;
  };
  const opts = { duration: ms, easing: token('--wt-ease-out') || 'ease-out' }, runs = [];
  const gone = { ...opts, fill: 'forwards' }; // a ghost stays faded out until it's removed
  row.style.height = `${box.height}px`; row.classList.add('is-morphing');
  for (const a of after) place(a.el, a.r);
  for (const b of before) if (!keys.has(b.key)) { const g = ghost(b); row.prepend(g); runs.push(g.animate({ opacity: [1, 0] }, gone)); }
  for (const a of after) {
    const b = was.get(a.key), to = { left: x(a.r), width: `${a.r.width}px` };
    if (b) {
      const from = { left: x(b.r), width: `${b.r.width}px` };
      runs.push(a.el.animate([from, to], opts));
      if (b.el.className !== a.el.className || b.el.innerHTML !== a.el.innerHTML) {
        const g = ghost(b); a.el.after(g);
        runs.push(g.animate([{ ...from, opacity: 1 }, { opacity: 0, offset: 0.6 }, { ...to, opacity: 0 }], gone));
      }
    } else if (a.el.matches('.wt-btn--icon')) runs.push(a.el.animate({ opacity: [0, 1], transform: ['scale(.6)', 'none'] }, opts));
    else runs.push(a.el.animate({ opacity: [0, 1], width: [`${Math.min(a.r.height, a.r.width)}px`, to.width] }, opts));
  }
  Promise.all(runs.map(r => r.finished)).then(() => {
    if (row.wtMorph !== id) return;
    row.querySelectorAll(':scope > .is-ghost').forEach(g => g.remove());
    row.querySelectorAll(':scope > *').forEach(el => el.removeAttribute('style'));
    row.classList.remove('is-morphing'); row.style.height = '';
  }, () => {});
}
// One day's rows, from the day's plan, each marked `past` or `now`. On today, the row you're in now
// (the latest thing that has started) is now, and everything before it is past; earlier days are past throughout.
// The map dims the same drives and stops.
// `note` false leaves out the stops' own notes, as on the overview.
function dayItems(trip, day, { note = true } = {}) {
  const now = nowStamp(), today = now.slice(0, 10);
  const legs = new Map(dayLegs(trip, day).map(l => [l.key, l]));
  const items = [];
  const plan = dayPlan(trip, day);
  plan.forEach((e, i) => {
    const leg = legs.get(e.key);
    if (leg && !(leg.r && leg.r.distance === 0)) items.push({ leg: leg.key, ...driveItem(day, leg) });
    if (e.role === 'stop') items.push({ entry: e, ...stopItem(trip, e.place, { note }) });
    // where you start, unless the day's first stop is the same place
    else if (e.role === 'from') { if (!samePlace(e.place, plan[i + 1].place)) items.push({ entry: e, ...fromItem(day, e) }); }
    else items.push({ entry: e, ...hotelItem(day, e) });
  });
  const cur = day === today ? items.findLastIndex(it => it.start <= now) : -1;
  items.forEach((it, i) => { it.past = day < today || i < cur; it.now = i === cur; });
  return items;
}
// The overview: every day under its name, with its stops and their times, and the drives between them, as on a day,
// so the whole trip reads at a glance. Notes are left to the day's own page, and so are the hotel you wake up at and
// go back to, with the drives to and from it (the map still shows every drive). A day with no stops of its own,
// in the middle of a stay, shows the hotel you wake up at. Tapping a day's name opens the day; tapping a stop
// selects it, and tapping a drive shows its route, as on a day. Past and now are worked out as on a day, among the rows shown.
function overviewItems(trip) {
  const now = nowStamp(), today = now.slice(0, 10), items = [];
  for (const d of daysOf(trip)) {
    const all = dayItems(trip, d, { note: false }), legs = new Map(dayLegs(trip, d).map(l => [l.key, l]));
    let rows = all.filter(it => it.entry && (it.entry.role === 'stop' || it.entry.role === 'checkout'));
    if (!rows.length) rows = all.filter(it => it.entry?.role === 'wake');
    const shown = new Set(rows.map(it => it.entry.key));
    const its = all.filter(it => (it.leg ? shown.has(legs.get(it.leg).fromEntry.key) && shown.has(it.leg) : shown.has(it.entry.key)));
    const at = d === today ? its.findLastIndex(it => it.start <= now) : -1;
    its.forEach((it, i) => { it.past = d < today || i < at; it.now = i === at; });
    items.push({ html: () => dayHeadHTML(d, d < today) }, ...its);
  }
  return items;
}
// The list's folders: each run of stop rows in the same folder, with the drives between them, becomes one item.
// The drive into a folder and the one out of it stay on the day's rail.
function folderItems(items) {
  const out = [];
  let run = null;
  items.forEach((it, i) => {
    if (it.leg) {
      const next = items[i + 1];
      if (run && next?.entry?.role === 'stop' && next.entry.place.folder === run.fid) run.items.push(it);
      else { run = null; out.push(it); }
      return;
    }
    const f = it.entry?.role === 'stop' ? it.entry.place.folder : null;
    if (f && run?.fid === f) { run.items.push(it); return; }
    run = f ? { fid: f, items: [it] } : null;
    out.push(run || it);
  });
  return out;
}
// A folder's row: its stops' marker with a second disc piled behind it, its name, and closed, what's in it and when it
// starts. Tapping it opens it (and selects it), and again closes it, as a folder in a file tree does.
// Open, its stops and drives follow it, hanging from its name.
function folderHTML(trip, run, row) {
  const stops = run.items.filter(it => it.entry).map(it => it.entry.place), name = folderName(trip, run.fid);
  const open = openFolderOf(trip) === run.fid, past = run.items.every(it => it.past), now = !open && run.items.some(it => it.now);
  const sel = open && !state.sel && !state.leg, count = `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}`;
  const short = s => (s.name.startsWith(`${name} `) ? s.name.slice(name.length + 1) : s.name);
  let html = `<div class="wt-tl-stop wt-tl-stop--folder${sel ? ' is-selected' : ''}${rowState(past, now)}" data-action="folder" data-folder="${esc(run.fid)}" tabindex="0" role="button" aria-expanded="${open}" aria-label="${esc(name)}, a folder of ${count}" style="--wt-kind-color: var(--wt-kind-${folderKind(stops)})">
      <span class="wt-tl-rail"><i class="wt-marker wt-marker--stack wt-tl-marker" role="img" aria-label="Folder">${kindIcon({ kind: folderKind(stops) })}</i></span>
      <span class="wt-tl-name">${esc(name)}</span>${open ? '' : `<span class="wt-tl-notes"><span class="wt-tl-note wt-tl-note--quiet">${count}: ${stops.map(s => esc(short(s))).join(', ')}</span></span>`}
      <span class="wt-tl-time">${open ? '' : timeHTML(stops[0].time)}</span>
    </div>`;
  if (!open) return html;
  const last = run.items.length - 1;
  run.items.forEach((it, i) => {
    html += it.html({ ...row(it), inFolder: `${i === 0 ? ' is-first' : ''}${i === last ? ' is-last' : ''}` || ' ', folder: name });
  });
  return html;
}

// Its action is said in words, "View day", not with a ›: the day bar's ‹ › just above it step through the days.
const dayHeadHTML = (d, past) => `<button class="wt-tl-day${past ? ' is-past' : ''}" data-action="pick-day" data-day="${d}" aria-label="${dayName(d)}. Open this day">
    <span class="wt-tl-day__name">${dayName(d)}</span><span class="wt-tl-day__open" aria-hidden="true">View day</span></button>`;
function listHTML(trip, day) {
  if (!day) return '<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>';
  const items = day === ALL ? overviewItems(trip) : dayItems(trip, day);
  if (!items.length) return '<p class="wt-empty">Nothing planned this day yet.</p>';
  // Only one row is selected: the one tapped, or, from a pin, the stop's first row (a hotel can start and end the day)
  const rows = items.filter(it => it.entry?.place.id === state.sel);
  const sel = (rows.find(it => it.entry.key === state.selRow) || rows[0])?.entry.key;
  const row = it => ({ key: it.entry?.key, past: it.past, now: it.now, sel: !!it.entry && it.entry.key === sel });
  return folderItems(items).map(it => (it.fid ? folderHTML(trip, it, row) : it.html(row(it)))).join('');
}
// The list fades out at an edge with more of the day past it, so it's clear there are stops to scroll to.
function updateFades() {
  const body = $app.querySelector('.wt-sheet__body');
  if (!body) return;
  body.classList.toggle('is-more-above', body.scrollTop > 1);
  body.classList.toggle('is-more-below', body.scrollTop + body.clientHeight < listContentHeight(body) - 1);
}
function renderList(trip) {
  const body = $app.querySelector('.wt-sheet__body'), day = currentDay(trip);
  // the row with the keyboard's focus keeps it (a stop's row, a folder's, a drive's), wherever it is now
  const had = body.contains(document.activeElement) && document.activeElement;
  const key = had && ['row', 'folder', 'leg'].map(k => had.dataset[k] && `[data-${k}="${CSS.escape(had.dataset[k])}"]`).find(Boolean);
  body.innerHTML = listHTML(trip, day);
  if (key) (body.querySelector(key) || (had.dataset.id && body.querySelector(`[data-id="${CSS.escape(had.dataset.id)}"]`)))?.focus({ preventScroll: true });
  const same = body.dataset.day === day;
  // The same day stays where the app had it (as far as its new rows go): on an iPhone, new rows could leave the list
  // at its end, and the movement a tap starts set off from there, so the list flew to the end and back.
  // A new day starts at the top, or, on today, with what's happening now in the middle (render centers it).
  body.dataset.day = day;
  setListTop(same ? Math.max(0, Math.min(listTop, body.scrollHeight - body.clientHeight)) : 0);
  if (!same) holdScroll(0);
  updateFades();
  return !same;
}
// Keep the highlight and the dimming current while the trip is open.
setInterval(() => { if ($app.dataset.trip) scheduleRender(); }, 60000);

// ---------- Day bar: ‹ day › to step, or tap the day to pick from all of them. All days comes before the first. ----------
function dayBarHTML(trip) {
  const days = pagesOf(trip), d = currentDay(trip), i = days.indexOf(d);
  if (!d) return '';
  return `<button class="wt-icon-btn wt-day-bar__step" data-action="prev-day" aria-label="Previous day"${i > 0 ? '' : ' disabled'}>${ICON.back}</button>
    <button class="wt-day-bar__title" data-action="days" aria-label="${dayName(d)}. Pick a day">
      <span class="wt-day-bar__label">${dayName(d)}${ICON.chevronUpDown}</span>
    </button>
    <button class="wt-icon-btn wt-day-bar__step" data-action="next-day" aria-label="Next day"${i < days.length - 1 ? '' : ' disabled'}>${ICON.forward}</button>`;
}
// "Today, Nov 21" on today, so it's easy to find your way back to it; otherwise "Sat, Nov 21". The overview is "All days".
const dayName = d => (d === ALL ? 'All days' : d === nowStamp().slice(0, 10) ? `Today, ${fmtDay(d).split(', ')[1]}` : fmtDay(d));
// All days, then every day of the trip, with the icons of its stops and the hotel you sleep at, so you can see what each day holds.
function openDays(trip) {
  const cur = currentDay(trip);
  openSheet(`${modalHead('Days')}
    <ul class="wt-day-list">${pagesOf(trip).map(d => {
      const places = d === ALL ? [] : [...new Set(dayPlan(trip, d).filter(e => e.role === 'stop' || e.role === 'night').map(e => e.place))];
      return `<li><button class="wt-day-list__item" data-action="pick-day" data-day="${d}"${d === cur ? ` aria-current="${d === ALL ? 'page' : 'date'}"` : ''}>
        <span class="wt-day-list__name">${dayName(d)}</span>
        <span class="wt-day-list__kinds">${places.slice(0, 6).map(x => markerHTML(x, 'wt-marker--sm')).join('')}</span>
      </button></li>`;
    }).join('')}</ul>`);
}
function setDay(d) {
  const trip = cur?.stops ? cur : null;
  if (!trip || !pagesOf(trip).includes(d) || d === state.day) return;
  state.day = d;
  state.sel = state.selRow = state.leg = state.hoverLeg = state.folder = null;
  render();
}
function stepDay(n) {
  const trip = cur?.stops ? cur : null;
  if (!trip) return;
  const pages = pagesOf(trip);
  setDay(pages[pages.indexOf(currentDay(trip)) + n]);
}

// Wide: the plan is a side panel (the design system's wt-trip container query), so there's nothing to snap or drag.
const WIDE = 768;
const isWide = () => ($app.querySelector('.trip')?.clientWidth || 0) >= WIDE;
// The list has two heights on a phone: half (the default) and full (the whole day, docked under the header).
// It never hides. (A lower height, the day bar with one row, was tried: half, with the focus's neighbors and the
// add bar, was preferred.)
// You move it by dragging: the grab handle, the day bar, or the list itself. Dragging the list up grows the sheet
// before the list scrolls; at full, pulling the list down from its top shrinks the sheet again.
// At half the list doesn't scroll by hand at all: the app keeps its focused row in the middle (see centerFocus).
const SNAPS = ['half', 'full'];
// Half is one fixed height, the same on every day: the list fits exactly three stops and the two drives between
// them, so a selected stop, centered, has its neighbors in view. A stop is counted with one line of notes, as a phone
// shows them unselected (.wt-tl-stop: 12px padding, the name, a 19px note line; .wt-tl-drive: 32px). It used to be
// measured from each day's rows and was at least 48% of the screen, so it changed from day to day.
// On a short screen it's never more than HALF_MAX of it, so the map keeps some room.
const HALF_STOP = 68, HALF_DRIVE = 32, HALF_LIST = 3 * HALF_STOP + 2 * HALF_DRIVE, HALF_MAX = 0.62;
function snaps() {
  const H = $app.querySelector('.trip').clientHeight;
  const chrome = $app.querySelector('.wt-sheet__top').offsetHeight + $app.querySelector('.wt-add-bar').offsetHeight;
  const half = Math.min(chrome + HALF_LIST, H * HALF_MAX, H - headBottom());
  return { half: Math.round(half), full: H - headBottom(), chrome };
}
const GRAB_LABEL = { half: 'Show the whole day', full: 'Show more of the map' };
const GRAB_LABEL_ALL = { half: 'Show the whole trip', full: 'Show more of the map' };
const grabLabel = () => (state.day === ALL ? GRAB_LABEL_ALL : GRAB_LABEL)[state.snap];
// `animate`: slide to the new height (a new snap); otherwise it's placed there at once (a first render, a resize).
function applySnap(animate = false) {
  const trip = $app.querySelector('.trip'), sheet = trip?.querySelector('.wt-sheet');
  if (!sheet) return;
  const wide = isWide(), h = wide ? 0 : snaps()[state.snap];
  if (wide) { stopMotion(); sheet.style.height = ''; setBottom(0); }
  else if (animate) moveSheet({ h });
  else { stopMotion(); setSheetHeight(h); }
  sheet.classList.toggle('is-full', !wide && state.snap === 'full');
  // The header floats over the map as a card; with the whole day showing, it docks and joins the list.
  trip.querySelector('.wt-trip-head').classList.toggle('is-docked', !wide && state.snap === 'full');
  trip.querySelector('.wt-sheet__grab').setAttribute('aria-label', grabLabel());
  // the day's view depends on the room the list leaves; a re-frame (setSnap) puts the camera there again
  if (map) { dayShown = dayFramed(); updateFitBtn(); }
}
// A new height re-frames the map for what's left of it, unless you've moved the map yourself since.
// `draw` false: the caller renders next, and that render frames the map, so it isn't drawn twice.
// Arriving at half puts the focused row in the middle of the list, in the same movement as the sheet's.
function setSnap(snap, draw = true) {
  const changed = state.snap !== snap;
  state.snap = snap;
  applySnap(true);
  if (changed && snap !== 'full') {
    if (draw) reframe();
    else if (!camFree && !state.draft) fitKey = '';
  }
  if (snap !== 'full') centerFocus();
}
let camFree = false; // you've touched the map since it was last framed
function reframe() {
  const trip = cur?.stops ? cur : null;
  if (camFree || state.draft || !trip) return;
  fitKey = '';
  drawMap(trip);
}

// ---------- Sheet motion ----------
// The sheet's height and the list's scroll move together, frame by frame, on one timeline (--wt-duration-base,
// --wt-ease-out). A row being centered while the sheet changes height goes straight to the middle and never leaves
// the list: both are the same blend of where they start and where they end. (The sheet used to slide by a CSS
// transition and the list scrolled after it, so a row tapped on the whole day slid off the list and came back.)
// A new target part way (a second tap) starts the movement again from where everything is, with a whole quarter
// second to get there. (It used to keep the old timeline, so a tap late in a movement had only what was left of it,
// and the list jumped.) Targets asked for before the first frame, as one tap asks for the height and then the scroll,
// are one movement, and asking again for where it's already going changes nothing.
// The clock starts with the first frame, not when the movement is asked for: a tap redraws the list and the map
// before any frame, and on a slow phone that took up the start of the quarter second, so the first frame jumped.
// The list's scroll always has a target, even when only the height is changing: a taller list has less room to
// scroll, so near the end of the day the browser would cut the scroll back part way through the movement, and the
// list would seem to scroll by itself, its rows riding with the sheet and then stopping short. Instead the scroll goes,
// on the same timeline, to the nearest place it can be at the new height; on the way, it's always within its room.
function cubicBezier(x1, y1, x2, y2) {
  const at = (a, b, u) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  return t => {
    if (t <= 0 || t >= 1) return Math.max(0, Math.min(1, t));
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 24; i++) { u = (lo + hi) / 2; if (at(x1, x2, u) < t) lo = u; else hi = u; }
    return at(y1, y2, u);
  };
}
const sheetEase = cubicBezier(0.2, 0.8, 0.2, 1); // --wt-ease-out
const motion = { raf: 0, t0: null, dur: 0, h0: 0, h1: null, s0: 0, s1: null };
const FRAME = 1000 / 60;
// What floats over the map (Whole day) rides with the sheet.
const setBottom = h => $app.querySelector('.trip-fit')?.style.setProperty('--bottom-h', `${h}px`);
function setSheetHeight(h) {
  const sheet = $app.querySelector('.wt-sheet');
  if (!sheet) return;
  sheet.style.height = `${h}px`;
  setBottom(h);
}
// Where the sheet is going: the end of a movement under way, or else where it is.
const sheetTarget = () => (motion.raf && motion.h1 != null ? motion.h1 : $app.querySelector('.wt-sheet')?.offsetHeight || 0);
function stopMotion() {
  cancelAnimationFrame(motion.raf);
  motion.raf = 0;
  setRoom(false);
}
// How tall the list's rows are, with its padding. Not scrollHeight: that's never less than the list itself (with the
// whole day showing, a short day looked as tall as the list, and there seemed to be room to scroll that wasn't there),
// and it counts the room the list is given while the sheet moves.
function listContentHeight(body) {
  const last = body.lastElementChild;
  if (!last) return 0;
  const end = last.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop;
  return end + (parseFloat(getComputedStyle(body).paddingBottom) || 0);
}
// While the sheet moves, the list has room to scroll past its last row (--sheet-room, styles.css): enough for any
// height between half and full. Where a short day doesn't fill the list, its scroll would otherwise have to wait for
// the list to come down to its rows, and they'd ride with the sheet and then stop. Every movement ends where the list
// can scroll without the room (see moveSheet), so taking it away moves nothing.
function setRoom(on) {
  const body = $app.querySelector('.wt-sheet__body'), s = on && snaps();
  body?.style.setProperty('--sheet-room', s ? `${s.full - s.half}px` : '0px');
}
// The furthest the list can scroll with the sheet at height `h` (`chrome`: the sheet's top and add bar, see snaps)
const maxScrollAt = (body, h, chrome) => Math.max(0, listContentHeight(body) - (h - chrome));
// Where the list is scrolled to, as the app has it. Movements set off from here, not from the list's scrollTop:
// on an iPhone, replacing the list's rows could leave its scrollTop at the end of the list for a moment, and a
// movement that read it there went from the end of the list back to its row. The list follows listTop; only you,
// scrolling the whole day or the side panel by hand, move listTop by scrolling the list.
let listTop = 0;
function setListTop(s) {
  listTop = s;
  const body = $app.querySelector('.wt-sheet__body');
  if (body && Math.abs(body.scrollTop - s) >= 0.5) body.scrollTop = s;
}
function onListScroll() {
  const body = $app.querySelector('.wt-sheet__body');
  if (!body) return;
  // you scrolled it: the whole day or the side panel, while the app isn't moving it
  if ((state.snap === 'full' || isWide()) && !motion.raf && !drag.moved) listTop = body.scrollTop;
  // anything else (at half nothing scrolls it by hand) is put back
  else if (Math.abs(body.scrollTop - listTop) >= 1) body.scrollTop = listTop;
  updateFades();
}
// A movement under way keeps the list's scroll at `s` from now on (a new day, or a scroll placed at once)
function holdScroll(s) {
  if (motion.raf) motion.s0 = motion.s1 = s;
}
// Move the sheet to height `h` and/or the list to scroll position `s`; leave either out to keep where it's going.
function moveSheet({ h, s }) {
  const sheet = $app.querySelector('.wt-sheet'), body = sheet?.querySelector('.wt-sheet__body');
  if (!sheet) return;
  const running = !!motion.raf;
  let h1 = h !== undefined ? h : running ? motion.h1 : null;
  let s1 = s !== undefined ? s : running ? motion.s1 : null;
  // where the list's scroll can be at the new height: where it's going, or else where it is, cut back to its room
  if (h1 != null) s1 = Math.min(s1 ?? listTop, maxScrollAt(body, h1, snaps().chrome));
  const same = (a, b) => (a == null ? b == null : b != null && Math.abs(a - b) < 0.5);
  if (running && same(h1, motion.h1) && same(s1, motion.s1)) return; // already on its way there
  const dur = parseFloat(token('--wt-duration-base')) || 0;
  if (!dur) { // reduced motion: straight there
    stopMotion();
    if (h1 != null) setSheetHeight(h1);
    if (s1 != null) setListTop(s1);
    return;
  }
  // from where everything is now, with the clock to start on the next frame
  Object.assign(motion, { t0: null, dur, h0: parseFloat(sheet.style.height) || sheet.offsetHeight, s0: listTop, h1, s1 });
  setRoom(h1 != null);
  if (!running) motion.raf = requestAnimationFrame(motionFrame);
}
// Timed by performance.now(), as moveSheet is, not by the frame's timestamp: that's when the frame began, which can be
// before the movement was asked for.
function motionFrame() {
  const sheet = $app.querySelector('.wt-sheet'), body = sheet?.querySelector('.wt-sheet__body');
  if (!sheet) { motion.raf = 0; return; }
  const now = performance.now();
  if (motion.t0 == null) motion.t0 = now - FRAME; // the first frame is a frame in
  const p = Math.max(0, Math.min(1, (now - motion.t0) / motion.dur)), q = sheetEase(p);
  // height first, then the scroll, so the frame is laid out once
  if (motion.h1 != null) setSheetHeight(motion.h0 + (motion.h1 - motion.h0) * q);
  if (motion.s1 != null) setListTop(motion.s0 + (motion.s1 - motion.s0) * q);
  motion.raf = p < 1 ? requestAnimationFrame(motionFrame) : 0;
  if (!motion.raf && !drag.moved) setRoom(false);
}

// ---------- The focused row ----------
// The half list is about one row, its focus: the selected stop, or else the drive on show, or else, on today,
// the row happening now. Whenever the sheet is at half, the focus sits in the middle
// of the list, with the rows before and after it in view: on opening a day, selecting a stop or a drive, clearing it,
// saving a stop, coming to half from full, and when the plan changes under it. The list can't scroll past
// its ends, so a first or last row stays near its edge; a row taller than the list shows from its top.
// At full the list is yours to scroll; `force` centers it there too (a new day, a stop just saved), and on a wide screen.
const FADE = 24; // the list's edge fades (.is-more-above, .is-more-below)
function centerFocus({ force = false, animate = true } = {}) {
  const sheet = $app.querySelector('.wt-sheet'), body = sheet?.querySelector('.wt-sheet__body');
  if (!body || drag.moved) return;
  const wide = isWide(), snap = state.snap;
  if (!wide && !force && snap === 'full') return;
  if (wide && !force) return;
  const row = body.querySelector('.is-selected, .is-active') || body.querySelector('.is-now');
  if (!row) return;
  // the list's height once the sheet has settled
  const s = wide ? null : snaps();
  const listH = wide ? body.clientHeight : s[snap] - s.chrome;
  const top = row.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  // an open folder, selected, is its row and the stops under it
  const end = row.matches('.wt-tl-stop--folder') ? [...body.querySelectorAll('.wt-tl-stop--in, .wt-tl-drive--in')].at(-1) || row : row;
  const h = end.getBoundingClientRect().bottom - row.getBoundingClientRect().top;
  const want = h > listH - 2 * FADE ? top - FADE : top + h / 2 - listH / 2;
  const to = Math.round(Math.max(0, Math.min(want, listContentHeight(body) - listH)));
  if (!animate) {
    holdScroll(to); // a sheet movement under way carries on, leaving the list here
    setListTop(to);
    return;
  }
  if (Math.abs(to - listTop) < 1 && (!motion.raf || motion.s1 == null)) return;
  moveSheet({ s: to });
}

// ---------- Dragging the sheet ----------
// The sheet follows the finger once a frame. The height range is measured once, when the drag starts.
// Dragged up, the list has less room to scroll the taller it gets. Near the end of the day, the browser cut its
// scroll back as soon as it ran out, so the rows rode up with the finger and then stopped, and the list seemed to scroll
// by itself. Instead the scroll comes down evenly with the height, from where it was to where it can be at full.
const drag = { active: false, moved: false, list: null, mode: null, y0: 0, h0: 0, y: 0, s: null, sc0: 0, scFull: 0, pts: [], frame: 0, suppressClick: false };
function dragStart(y, list) {
  cancelAnimationFrame(drag.frame);
  Object.assign(drag, { active: true, moved: false, list, mode: list ? null : 'sheet', y0: y, y, h0: 0, s: null, pts: [], frame: 0 });
}
const dragHeight = () => Math.max(drag.s.half, Math.min(drag.s.full, drag.h0 + drag.y0 - drag.y));
function dragTo(h) {
  setSheetHeight(h);
  const body = $app.querySelector('.wt-sheet__body');
  const sc = h > drag.h0 ? drag.sc0 + (drag.scFull - drag.sc0) * (h - drag.h0) / Math.max(1, drag.s.full - drag.h0) : drag.sc0;
  if (body) setListTop(sc);
}
function dragMove(y) {
  const now = performance.now();
  drag.pts.push([now, y]);
  while (drag.pts.length > 2 && now - drag.pts[0][0] > 100) drag.pts.shift();
  drag.y = y;
  if (!drag.moved) {
    if (Math.abs(drag.y0 - y) < 6) return;
    // From here the sheet follows the finger: stop any movement under way and pick it up where it is.
    const sheet = $app.querySelector('.wt-sheet');
    stopMotion();
    Object.assign(drag, { moved: true, h0: sheet.offsetHeight, y0: y, s: snaps() });
    sheet.classList.add('is-dragging');
    const body = sheet.querySelector('.wt-sheet__body');
    drag.sc0 = listTop;
    drag.scFull = Math.min(drag.sc0, maxScrollAt(body, drag.s.full, drag.s.chrome));
    setRoom(true);
  }
  if (!drag.frame) drag.frame = requestAnimationFrame(() => { drag.frame = 0; if (drag.active) dragTo(dragHeight()); });
}
function dragEnd() {
  drag.active = false;
  cancelAnimationFrame(drag.frame);
  drag.frame = 0;
  const sheet = $app.querySelector('.wt-sheet');
  if (!sheet || !drag.moved) return;
  const s = drag.s, h = dragHeight();
  dragTo(h);
  drag.moved = false;
  sheet.classList.remove('is-dragging');
  // The finger's speed over its last 100ms (none if it rested before letting go), up is positive.
  // A flick goes on to the next height its way; a slower drag settles at the nearest one.
  const now = performance.now(), pts = drag.pts.filter(p => now - p[0] <= 100);
  const v = pts.length > 1 ? (pts[0][1] - pts.at(-1)[1]) / Math.max(1, pts.at(-1)[0] - pts[0][0]) : 0;
  const snap = v > 0.4 ? SNAPS.find(k => s[k] > h + 1) || 'full'
    : v < -0.4 ? [...SNAPS].reverse().find(k => s[k] < h - 1) || 'half'
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
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { if (drag.active && !drag.list) dragEnd(); });
// The list, with a finger: below full it moves the sheet (it can't scroll there); at full, only a pull down from
// its top does, and otherwise it scrolls as usual.
document.addEventListener('touchstart', e => {
  const list = e.target.closest?.('.wt-sheet__body');
  if (!list || e.touches.length > 1 || isWide()) return;
  dragStart(e.touches[0].clientY, list);
}, { passive: true });
document.addEventListener('touchmove', e => {
  if (!drag.active || !drag.list) return;
  // a row being swiped sideways: not the sheet's, and not a scroll
  if (swipe?.lock) { drag.mode = 'swipe'; if (e.cancelable) e.preventDefault(); return; }
  const y = e.touches[0].clientY, dy = drag.y0 - y;
  if (!drag.mode) {
    const pullDown = state.snap === 'full' && dy < 0 && drag.list.scrollTop <= 0;
    // claim a pull down from the top at once, before the browser starts its own scroll (and, on iPhone, its bounce)
    if (pullDown && e.cancelable) e.preventDefault();
    if (Math.abs(dy) < 6) return;
    drag.mode = state.snap !== 'full' || pullDown ? 'sheet' : 'scroll';
  }
  if (drag.mode !== 'sheet') return;
  if (e.cancelable) e.preventDefault();
  dragMove(y);
}, { passive: false });
for (const t of ['touchend', 'touchcancel']) document.addEventListener(t, () => { if (drag.active && drag.list) dragEnd(); });
document.addEventListener('click', e => {
  if (drag.suppressClick) { drag.suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
}, true);
// iPhone: the keyboard scrolls the window to show the field being typed in, and with the page's own scrolling off while a
// trip is open, Safari and Chrome can leave it scrolled once the keyboard's gone. The trip screen, pinned to the window,
// then sits too high: its header under the address bar and a gap under the sheet. Put the window back at the top whenever
// it has moved and nothing is being typed in (not while zoomed in: that's the person's own doing).
function unshiftTrip() {
  if ($app.dataset.page !== 'trip' || document.activeElement?.matches('input, textarea, select, [contenteditable]')) return;
  const vv = window.visualViewport;
  if (vv && vv.scale > 1.01) return;
  if (scrollX || scrollY || vv?.offsetTop || vv?.offsetLeft) scrollTo(0, 0);
}
addEventListener('scroll', unshiftTrip);
window.visualViewport?.addEventListener('resize', unshiftTrip);
window.visualViewport?.addEventListener('scroll', unshiftTrip);
document.addEventListener('focusout', () => requestAnimationFrame(unshiftTrip));
addEventListener('resize', () => {
  $sheets.classList.toggle('wt-modal-root--side', isWide());
  if (!$app.dataset.trip) return;
  applySnap();
  centerFocus({ animate: false });
  map?.invalidateSize();
  fitKey = '';
  scheduleRender();
});

// How much of the map's bottom is covered: by the open stop's sheet, or else by the list. At full the map
// doesn't show, so the camera is placed for half, where the list goes back to. Nothing covers the map on a wide screen.
function coveredBottom() {
  if (isWide()) return 0;
  const panel = state.draft && $sheets.querySelector('.wt-modal');
  return panel ? panel.offsetHeight : snaps().half;
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
  // Mid zoom animation, only where the camera is going can change now; the pins and routes are redrawn when it ends
  if (zoomAnim) { drawPending = true; return frameMap(trip); }
  layer.clearLayers();
  pins = [];
  // Only the day on screen, from its plan: the hotel at either end is a pin like any stop.
  // With no hotel last night, the day before's last stop is a quiet pin, so the first drive leads somewhere.
  // The overview draws every day this way: all the trip's places and drives. Its days' starts are stops of the day before, so none is quiet.
  const day = currentDay(trip);
  if (!day) { routeLayer.setRoutes([]); return drawDraft(); }
  const plan = planOn(trip, day);
  const start = day === ALL ? null : plan.find(e => e.role === 'from')?.place;
  // A closed folder is one pin, at its first stop, and its own drives don't show. An open one shows its stops (pins
  // without numbers: the folder has the number) and its drives, and the rest of the page steps back.
  const runs = planRuns(plan), openFid = openFolderOf(trip);
  const runOf = new Map(runs.flatMap(r => r.entries.map(e => [e.key, r])));
  const inside = l => { const r = runOf.get(l.toEntry.key); return !!r && r === runOf.get(l.fromEntry.key); };
  const hidden = new Set(runs.filter(r => r.fid !== openFid).flatMap(r => r.entries.map(e => e.key)));
  const legs = legsOn(trip, day).filter(l => !inside(l) || runOf.get(l.toEntry.key).fid === openFid);
  const active = legs.find(l => l.key === (state.leg || state.hoverLeg));
  // The stop being edited is drawn where the draft puts it; if it has moved, its drives are out of date until it's saved.
  const draft = state.draft, editing = s => draft?.id && s.id === draft.id;
  const moved = draft?.id && draft.lat != null && plan.some(e => editing(e.place) && !samePlace(e.place, draft));
  const places = plan.filter(e => !hidden.has(e.key)).map(e => e.place).filter(s => !editing(s));
  // what the list dims, the map dims: past drives go grey, and a place is past once all its rows are
  const items = itemsOn(trip, day);
  const pastLeg = new Set(items.filter(it => it.leg && it.past).map(it => it.leg));
  const isPast = s => { const rows = items.filter(it => it.entry?.place === s); return rows.length > 0 && rows.every(it => it.past); };
  const C = { on: token('--wt-route-active'), muted: token('--wt-route-muted'), route: token('--wt-route'), done: token('--wt-route-done'), casing: token('--wt-route-casing') };
  // Past routes first, so they sit under the rest. The route on show widens and darkens in place, and a copy of it
  // fades in on top, over any route it crosses; moving the route itself to the top would cut its transition short.
  const style = (l, isOn) => {
    const stale = moved && (editing(l.from) || editing(l.to));
    return {
      coords: legCoords(l), casing: C.casing, casingWidth: isOn ? 11 : 8, width: isOn ? 7 : 4.5,
      color: isOn ? C.on : active || stale || (openFid && !inside(l)) ? C.muted : pastLeg.has(l.key) ? C.done : C.route,
      dash: l.r?.ok && !stale ? null : '1 9',
    };
  };
  const order = l => (pastLeg.has(l.key) ? 0 : 1);
  const drawn = [...legs].sort((a, b) => order(a) - order(b)).map(l => ({
    key: l.key, ...style(l, l === active),
    onClick: () => onMapTap(() => { if (!state.draft) previewLeg(l, { fromMap: true }); }),
  }));
  if (active) drawn.push({ key: `on:${active.key}`, top: true, ...style(active, true) });
  routeLayer.setRoutes(drawn);
  // The map has only the routes and the pins: names, times and drive times are in the list, so the map doesn't repeat them.
  // A route on show enlarges the pins at its ends.
  const ends = active ? [active.from, active.to] : [];
  // Stops are numbered in order: the day's, or on All days the whole trip's, as its list reads. The hotel you wake up
  // in or come back to isn't one of them.
  // A folder takes one number, for all its stops.
  const nums = new Map(), folderNums = new Map();
  let n = 0;
  for (const e of plan.filter(x => x.role === 'stop')) {
    const r = runOf.get(e.key);
    if (r) { if (r.entries[0] === e) folderNums.set(r, ++n); continue; }
    if (!nums.has(e.place.id)) nums.set(e.place.id, ++n);
  }
  draftNum = draft?.id ? nums.get(draft.id) : null;
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
    const cls = [focus ? 'wt-pin--selected' : '', quiet && !focus ? 'wt-pin--muted' : '', openFid && all.some(s => s.folder === openFid) ? 'wt-pin--open' : ''].join(' ');
    addPin(L.marker([all[0].lat, all[0].lng], {
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: pinHTML(focus || g[0] || start, all.map(s => nums.get(s.id)).find(Boolean), cls) }),
      zIndexOffset: focus ? 1000 : quiet ? -1000 : 0, title: all[0].name,
    }).on('click', () => onMapTap(() => {
      if (state.draft) return;
      if (g.length) selectStop(g[0]); else { setDay(dayOf(start)); selectStop(start); }
    })), focus ? 16 : quiet ? 10 : 12);
  }
  for (const r of runs) {
    if (r.fid === openFid) continue;
    const stops = r.entries.map(e => e.place), s = stops[0];
    const quiet = (active && !stops.some(x => ends.includes(x))) || stops.every(isPast);
    addPin(L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: folderPinHTML(trip, r.fid, stops, folderNums.get(r), quiet ? 'wt-pin--muted' : '') }),
      zIndexOffset: quiet ? -1000 : 0, title: folderName(trip, r.fid),
    }).on('click', () => onMapTap(() => { if (!state.draft) selectFolder(r.fid); })), quiet ? 10 : 12);
  }
  // While a folder is open, the pins outside it fade, as they do around a selected stop
  map.getPane('markerPane').classList.toggle('is-folder-open', !!openFid && runs.some(r => r.fid === openFid));
  drawDraft();
  frameMap(trip);
  fitPins();
}
// Frame the day on screen, or the drive on show, when either has changed since the map was last framed.
function frameMap(trip) {
  const day = currentDay(trip);
  if (!day) return;
  const key = [trip.id, day, planOn(trip, day).length].join('|');
  if (key === fitKey || state.draft) return;
  fitKey = key;
  camFree = false;
  const leg = state.leg && legsOn(trip, day).find(l => l.key === state.leg);
  if (leg) return fitLeg(leg);
  const v = dayView(trip, day);
  if (v) moveCamera(v.center, v.zoom);
  dayShown = true;
}
// Where the camera goes for a day (or the overview): around all its places, clear of the list. Preloading uses it to
// fetch the tiles a day will land on, so it works the view out without moving the map.
function dayView(trip, day) {
  const pts = planOn(trip, day).map(e => [e.place.lat, e.place.lng]);
  if (!pts.length) return null;
  if (new Set(pts.map(String)).size === 1) return { center: L.latLng(pts[0]), zoom: 13 };
  // the side panel sits beside the map, not on it; on a phone, the list covers the bottom
  // a pin is centered on its place, so leave half a selected pin clear around the edges
  return frameBounds(L.latLngBounds(pts), L.point(32, coveredTop() + 24), L.point(32, coveredBottom() + 24), 15);
}
// A map pin: a round dot in the stop's type color, centered on the place, with the stop's number inside.
// A place that isn't one of the numbered stops (the hotel at either end of a day, the day before's last stop) has a dot instead.
const pinHTML = (s, n, cls = '') => `<div class="wt-pin ${cls}" role="img" aria-label="${n ? `${n}. ` : ''}${esc(s.name)}, ${KINDS[kindOf(s)].label}" style="--wt-kind-color: ${kindColor(s)}">`
  + `${n ? `<b class="wt-pin__num">${n}</b>` : '<i class="wt-pin__dot"></i>'}</div>`;
// A folder's pin: its number, in its stops' type color, with a second disc piled behind it, as on its row in the list
const folderPinHTML = (trip, fid, stops, n, cls = '') => `<div class="wt-pin wt-pin--folder ${cls}" role="img" aria-label="${n}. ${esc(folderName(trip, fid))}, a folder of ${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}" style="--wt-kind-color: var(--wt-kind-${folderKind(stops)})"><b class="wt-pin__num">${n}</b></div>`;
let draftNum = null; // the number of the stop being edited, so its pin keeps it
// Where pins crowd, the map shows where each place is rather than a pile of numbers: if any two pins in view are too
// close for both to show their numbers, every pin becomes a small dot (.wt-pin--dot), and they all get their numbers
// back once you zoom in far enough. All or none: a lone number among dots (the one pin with room) read as special.
// A selected pin always keeps its number. `r` is the pin's radius with its number (selected 16, normal 12, muted 10).
let pins = []; // { ll, r, el } for each pin on the map
const PIN_GAP = 4; // px of map between two numbered pins
function addPin(marker, r) {
  marker.addTo(layer);
  pins.push({ ll: marker.getLatLng(), r, el: marker.getElement()?.firstElementChild });
}
function fitPins() {
  if (!map || !pins.length) return;
  // During a flight, where it's going: the pins settle once instead of flickering through every zoom on the way
  const flying = camTarget && performance.now() < camTarget.until;
  const z = flying ? camTarget.zoom : map.getZoom();
  // Only the pins in view count: two places a street apart at the other end of the trip don't take the numbers away here
  const mid = map.project(flying ? camTarget.center : map.getCenter(), z), half = map.getSize().divideBy(2);
  const view = L.bounds(mid.subtract(half), mid.add(half));
  const seen = pins.map(p => ({ r: p.r, pt: map.project(p.ll, z) })).filter(p => view.contains(p.pt));
  const crowded = seen.some((p, i) => seen.some((q, j) => j > i && p.pt.distanceTo(q.pt) < p.r + q.r + PIN_GAP));
  pins.forEach(p => p.el?.classList.toggle('wt-pin--dot', crowded));
}
// The stop being edited, where it would go: its new place and type.
function drawDraft() {
  const d = state.draft;
  if (!d || d.lat == null) return;
  addPin(L.marker([d.lat, d.lng], {
    interactive: false, keyboard: false, zIndexOffset: 1500,
    icon: L.divIcon({ className: '', iconSize: [0, 0], html: pinHTML(d, draftNum, 'wt-pin--selected') }),
  }), 16);
}
const legCoords = l => (l.r ? l.r.coords : [[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]]);
// Minutes a drive runs past the next stop's time, between two of the day's stops
const lateMin = l => (l.r && l.fromEntry.role === 'stop' && l.toEntry.role === 'stop' ? Math.round(l.r.duration / 60 - gapMin(l.from.time, l.to.time)) : 0);
// Fit a route into the part of the map you can see, with room around its ends for their pins.
// From a tap on the map, only when an end is out of view, so the map doesn't jump under your finger.
function fitLeg(l, onlyIfHidden = false) {
  if (!map || (onlyIfHidden && inView(l.from) && inView(l.to))) return;
  camFree = false;
  const v = frameBounds(L.latLngBounds(legCoords(l)), L.point(40, coveredTop() + 32), L.point(40, coveredBottom() + 32), 15);
  moveCamera(v.center, v.zoom);
}
// Show a drive's route: highlighted, with larger pins at its ends, and the map moved to fit it.
// Tapping the same drive again keeps it shown; tapping empty map, changing the day or Esc goes back to the whole day.
function previewLeg(l, { fromMap = false } = {}) {
  // Again, at half: it's already the focus, so nothing animates. The map moves only if an end has gone out of view.
  if (state.leg === l.key && state.snap === 'half' && !isWide()) {
    fitLeg(l, true);
    centerFocus({ animate: false });
    return;
  }
  state.leg = l.key;
  state.sel = state.selRow = null;
  // a drive inside a folder keeps it open, so its row stays in the list
  const f = l.fromEntry.role === 'stop' && l.toEntry.role === 'stop' && l.from.folder === l.to.folder ? l.from.folder : null;
  state.folder = f;
  setSnap('half', false); // the whole-day list covers the map
  render();
  fitLeg(l, fromMap);
  centerFocus({ force: true }); // the drive in the middle of the list, as the sheet comes to half
}
// Hovering a drive in the list previews its route on the map, without moving the map. With a mouse only: a phone
// sends a mouseover with every tap, and the map was redrawn for it.
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse') return;
  const id = e.target.closest?.('.wt-tl-drive')?.dataset.leg || null;
  if (id === state.hoverLeg) return;
  state.hoverLeg = id;
  if (cur?.stops) drawMap(cur);
});
// Select a stop: its row and its pin are highlighted, and Add stop becomes Open in Maps and Edit stop.
// Tapping a pin or a row scrolls the row to the middle of the list. Tapping a row (`row`, its key) moves the pin into view if it's
// off the map you can see, keeping the zoom; the map is never zoomed for it. Tapping the selected row (or its pin) again keeps it selected;
// tapping empty map, changing the day or Esc clears it.
function selectStop(s, row = null) {
  // Again, at half: it's already the focus, so nothing animates. A row still brings its pin back if it's out of view.
  // (A hotel that starts and ends the day has two rows: its other row isn't the highlighted one.)
  if (state.sel === s.id && state.snap === 'half' && !isWide() && (!row || $app.querySelector('.wt-tl .is-selected')?.dataset.row === row)) {
    if (row) panTo(s);
    centerFocus({ animate: false });
    return;
  }
  const wasOpen = openFolderOf(cur);
  state.leg = state.folder = null;
  state.sel = s.id;
  state.selRow = row;
  // The map keeps its zoom: leaving a drive's preview or the whole-day list doesn't re-frame it for the day.
  // Only the pin is panned into view (Whole day brings the day back). Opening a folder fits the folder.
  const key = fitKey;
  setSnap('half', false); // the whole-day list covers the map
  fitKey = key;
  render();
  if (!(s.folder && s.folder !== wasOpen && fitFolder(cur, s.folder)) && row) panTo(s);
  // in the middle of the list, so the stops before and after it show too
  centerFocus({ force: true });
}
// Open a folder (it's selected, and its stops and drives show in the list and on the map, with the map fitted to them),
// or close it if it's the one open: tapping a folder again closes it, as in a file tree, and the map goes back to the day.
function selectFolder(fid) {
  const trip = cur?.stops ? cur : null;
  if (!trip) return;
  if (state.folder === fid && !state.sel && !state.leg) {
    state.folder = null;
    fitKey = '';
    render();
    return;
  }
  state.leg = state.sel = state.selRow = null;
  state.folder = fid;
  setSnap('half', false);
  render();
  fitFolder(trip, fid);
  centerFocus({ force: true });
}
// Fit an open folder's stops into the part of the map you can see. False if the page has none of them.
function fitFolder(trip, fid) {
  if (!map) return false;
  const pts = planOn(trip, currentDay(trip)).filter(e => e.role === 'stop' && e.place.folder === fid).map(e => [e.place.lat, e.place.lng]);
  if (!pts.length) return false;
  camFree = false;
  const v = frameBounds(L.latLngBounds(pts), L.point(40, coveredTop() + 32), L.point(40, coveredBottom() + 32), 16);
  moveCamera(v.center, v.zoom);
  return true;
}
// Pan a stop's pin into the middle of the map you can see, keeping the zoom, if it's out of view.
function panTo(s) {
  if (!map || s.lat == null || inView([s.lat, s.lng])) return;
  const z = map.getZoom(), p = map.project([s.lat, s.lng], z).add([0, (coveredBottom() - coveredTop()) / 2]);
  moveCamera(map.unproject(p, z), z);
}
// Move a place into the middle of the map you can see: above the stop sheet on a phone, the whole map on a wide screen.
function focusStop(s) {
  if (!map || s.lat == null) return;
  const z = Math.max(map.getZoom(), 13);
  const p = map.project([s.lat, s.lng], z).add([0, (coveredBottom() - coveredTop()) / 2]);
  moveCamera(map.unproject(p, z), z);
}

// ---------- Edits ----------
// The new stop is selected, so it's the list's focus and its pin is named.
function addStop(trip, data) {
  const stop = { id: uid(), ...data, done: false, by: me.id, updatedAt: Date.now() };
  openTripOf(trip.id)?.stops.push(stop);
  if (state.leg) fitKey = '';
  state.leg = null;
  state.sel = stop.id;
  state.selRow = null;
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
    const { name, address, lat, lng, time, note, kind, nights, checkout = null, folder = null } = stop;
    openTripOf(trip.id)?.stops.push({ ...stop, by: me.id });
    render();
    writeStop(trip.id, stop.id, api(`/trips/${trip.id}/stops/${stop.id}`, { method: 'PUT', body: { name, address, lat, lng, time, note, kind, nights, checkout, folder } }));
  });
}

// ---------- Folders: putting stops in and taking them out ----------
// A new folder, named; it holds nothing until a stop goes in.
function newFolder(trip, name) {
  const f = { id: uid(), name };
  trip.folders.push(f);
  save(api(`/trips/${trip.id}/folders/${f.id}`, { method: 'PUT', body: { name } }));
  return f.id;
}
// Moves stops in or out of folders, as [stop id, folder id or null] pairs. Each stop saves only its folder.
// Returns the moves that undo these.
function setFolders(trip, moves) {
  const undo = [];
  for (const [id, f] of moves) {
    const s = trip.stops.find(x => x.id === id);
    if (!s || (s.folder || null) === f) continue;
    undo.push([id, s.folder || null]);
    Object.assign(s, { folder: f, by: me.id });
    writeStop(trip.id, id, api(`/trips/${trip.id}/stops/${id}`, { method: 'PATCH', body: { folder: f } }));
  }
  return undo;
}
// A change to folders from a swipe, said in a toast with Undo. After it, `sel` (a stop) or `folder` is selected, which
// opens its folder; the map fits a folder that has just opened, and goes back to the day when one closes.
function changeFolders(trip, moves, msg, { sel = null, folder = null } = {}) {
  const was = { sel: state.sel, folder: state.folder, open: openFolderOf(trip) };
  const undo = setFolders(trip, moves);
  if (!undo.length) return;
  const show = (to, open) => {
    Object.assign(state, { sel: to.sel, selRow: null, folder: to.folder, leg: null });
    const now = openFolderOf(cur);
    if (!now && open) fitKey = '';
    render();
    if (now && now !== open) fitFolder(cur, now);
    centerFocus({ force: true });
  };
  show({ sel, folder }, was.open);
  toast(msg, 'Undo', () => {
    const t = openTripOf(trip.id);
    if (!t) return;
    const open = openFolderOf(t);
    setFolders(t, undo);
    show(was, open);
  });
}
// The stops of the folder `fid` on the page on screen
const folderStops = (trip, fid) => planRuns(planOn(trip, currentDay(trip))).find(r => r.fid === fid)?.entries.map(e => e.place) || [];

// ---------- Swiping a row: into a folder, or out of one ----------
// Right puts a stop into the folder right above it, or else into a new folder of its own (never the one below). Left
// takes a folder's first or last stop out of it. A folder swiped right goes into the folder right above it, the two
// becoming one; swiped left, its stops go back into the day. The row follows the finger over what the swipe will do;
// past ARM it's armed, and letting go does it. A swipe that can't do anything resists, and says why.
// With a keyboard, Alt + → and Alt + ← on a focused row do the same.
const SWIPE_ARM = 72;
let swipe = null; // { row, x, y, pid, lock, dir, info, dx, bg }
// The row above, skipping drives (and the swipe's own background): a stop, a folder or its stop, or a day's name or the
// hotel you wake up at
function rowAbove(row) {
  let el = row.previousElementSibling;
  while (el?.matches('.wt-tl-drive, .wt-tl-swipe')) el = el.previousElementSibling;
  return el;
}
const folderOfRow = (trip, el) => (el?.matches('.wt-tl-stop--folder') ? el.dataset.folder
  : el?.matches('.wt-tl-stop--in') ? trip.stops.find(s => s.id === el.dataset.id)?.folder : null);
const folderRow = fid => `.wt-sheet__body .wt-tl-stop--folder[data-folder="${CSS.escape(fid)}"]`;
// What a swipe (or Alt + arrow) on a row does that way: { act, … } or { why }
function swipeInfo(trip, row, dir) {
  const above = folderOfRow(trip, rowAbove(row));
  if (row.matches('.wt-tl-stop--folder')) {
    const fid = row.dataset.folder;
    if (dir < 0) return { act: 'ungroup', fid };
    return above && above !== fid ? { act: 'merge', fid, into: above, target: folderRow(above) } : { why: 'There’s no folder right above to put this one in' };
  }
  const s = trip.stops.find(x => x.id === row.dataset.id);
  if (!s) return null;
  if (row.matches('.wt-tl-stop--in')) {
    if (dir > 0) return { why: 'This stop is already in a folder' };
    return row.matches('.is-first, .is-last') ? { act: 'out', s } : { why: 'Only the first or last stop can leave a folder' };
  }
  if (dir < 0) return { why: 'Swipe right to put this stop in a folder' };
  return above ? { act: 'join', s, fid: above, target: folderRow(above) } : { act: 'make', s };
}
function doSwipe(trip, info) {
  const { s } = info, name = info.fid && folderName(trip, info.fid);
  if (info.act === 'join') changeFolders(trip, [[s.id, info.fid]], `${s.name} is in ${name}`, { sel: s.id });
  else if (info.act === 'make') {
    const fid = newFolder(trip, suggestFolderName(s));
    changeFolders(trip, [[s.id, fid]], `New folder: ${folderName(trip, fid)}`, { folder: fid });
  } else if (info.act === 'out') {
    const fid = s.folder, last = folderStops(trip, fid).length === 1;
    changeFolders(trip, [[s.id, null]], last ? `${s.name} is out, and ${folderName(trip, fid)} is empty` : `${s.name} is out of ${folderName(trip, fid)}`, { sel: s.id });
  } else if (info.act === 'merge') {
    const into = folderName(trip, info.into);
    changeFolders(trip, folderStops(trip, info.fid).map(x => [x.id, info.into]), into === name ? `Merged the two ${name} folders` : `Merged ${name} into ${into}`, { folder: info.into });
  } else if (info.act === 'ungroup') {
    changeFolders(trip, folderStops(trip, info.fid).map(x => [x.id, null]), `Took the stops out of ${name}`);
  }
}
const swipeRow = el => el?.closest?.('.wt-sheet__body .wt-tl-stop[data-stop], .wt-sheet__body .wt-tl-stop--folder');
document.addEventListener('pointerdown', e => {
  const row = swipeRow(e.target);
  swipe = row && e.button <= 0 && e.isPrimary && cur?.stops && !state.draft ? { row, x: e.clientX, y: e.clientY, pid: e.pointerId, lock: false, dx: 0 } : null;
});
document.addEventListener('pointermove', e => {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
  if (!swipe.lock) {
    // the sheet's own drag took it, or it's a scroll
    if (drag.moved || Math.abs(dy) > 10) { swipe = null; return; }
    if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
    startSwipe();
  }
  moveSwipe(dx);
});
document.addEventListener('pointerup', e => endSwipe(e, true));
document.addEventListener('pointercancel', e => endSwipe(e, false));
function startSwipe() {
  // the list may have been drawn again since the finger went down (a save coming back): the same row, as it is now
  if (!swipe.row.isConnected) {
    const { id, folder } = swipe.row.dataset;
    swipe.row = $app.querySelector(id ? `.wt-sheet__body .wt-tl-stop[data-id="${CSS.escape(id)}"][data-stop]` : folderRow(folder)) || swipe.row;
  }
  const { row } = swipe;
  swipe.lock = true;
  try { row.setPointerCapture(swipe.pid); } catch {}
  getSelection()?.removeAllRanges();
  // What the swipe will do shows behind the row, where it slides away from
  const bg = swipe.bg = Object.assign(document.createElement('div'), { className: 'wt-tl-swipe' });
  bg.setAttribute('aria-hidden', 'true');
  bg.innerHTML = `<span class="wt-tl-swipe__in">${ICON.indent}${ICON.stackAdd}</span><span class="wt-tl-swipe__out">${ICON.outdent}</span>`;
  Object.assign(bg.style, { top: `${row.offsetTop}px`, left: `${row.offsetLeft}px`, width: `${row.offsetWidth}px`, height: `${row.offsetHeight}px` });
  row.before(bg);
  row.classList.add('is-swiping');
  document.documentElement.classList.add('is-swiping-row');
}
function moveSwipe(dx) {
  const dir = Math.sign(dx) || 1, a = Math.abs(dx);
  if (swipe.dir !== dir) { swipe.dir = dir; swipe.info = swipeInfo(cur, swipe.row, dir); }
  const act = swipe.info?.act;
  // past the arm point it slows; with nothing to do this way, it resists from the start
  const x = dir * (act ? (a < 120 ? a : 120 + (a - 120) * 0.3) : Math.min(a * 0.15, 22));
  swipe.dx = dx;
  swipe.row.style.transform = `translateX(${x}px)`;
  const armed = !!act && Math.abs(x) >= SWIPE_ARM;
  if (armed && !swipe.bg.classList.contains('is-armed')) navigator.vibrate?.(8);
  swipe.bg.className = `wt-tl-swipe${act ? (dir > 0 ? ' is-in' : ' is-out') : ''}${act === 'make' ? ' is-new' : ''}${armed ? ' is-armed' : ''}`;
  for (const el of document.querySelectorAll('.wt-sheet__body .is-swipe-target')) el.classList.remove('is-swipe-target');
  if (swipe.info?.target && Math.abs(x) > 16) document.querySelector(swipe.info.target)?.classList.add('is-swipe-target');
}
function endSwipe(e, up) {
  if (!swipe || e.pointerId !== swipe.pid) return;
  const s = swipe;
  swipe = null;
  if (!s.lock) return;
  document.documentElement.classList.remove('is-swiping-row');
  for (const el of document.querySelectorAll('.wt-sheet__body .is-swipe-target')) el.classList.remove('is-swipe-target');
  drag.suppressClick = true; // the click that ends a swipe isn't a tap
  setTimeout(() => { drag.suppressClick = false; }, 50);
  const done = () => { s.bg.remove(); s.row.classList.remove('is-swiping', 'is-settling'); s.row.style.transform = ''; if (s.missed) render(); };
  if (up && s.bg.classList.contains('is-armed') && cur?.stops) {
    if (!needsConnection()) { s.missed = true; return done(); }
    s.bg.remove();
    doSwipe(cur, s.info);
    if (s.missed) render();
    return;
  }
  if (up && s.info?.why && Math.abs(s.dx) > 48) showToast({ title: s.info.why });
  // back where it was, then gone
  s.row.classList.add('is-settling');
  s.row.style.transform = '';
  setTimeout(done, parseFloat(token('--wt-duration-fast')) || 0);
}
// Alt + → and Alt + ← on a focused row: the keyboard's swipe
document.addEventListener('keydown', e => {
  if (!e.altKey || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') || !cur?.stops) return;
  const row = swipeRow(e.target);
  if (!row) return;
  e.preventDefault();
  const info = swipeInfo(cur, row, e.key === 'ArrowRight' ? 1 : -1);
  if (!info?.act) { if (info?.why) showToast({ title: info.why }); return; }
  if (!needsConnection()) return;
  const id = row.dataset.id, fid = row.dataset.folder;
  doSwipe(cur, info);
  // focus stays on the row, wherever it went (a folder that's gone leaves it on the list)
  ($app.querySelector(id ? `.wt-tl-stop[data-id="${CSS.escape(id)}"]` : folderRow(info.into || fid)) || $app.querySelector('.wt-sheet__body'))?.focus({ preventScroll: true });
});

// The folders a stop can be in, where it is: none, its own, the folder right above or below it on its day, or a new one.
// A stop in the middle of its folder can only stay. For the stop sheet's Folder page.
function folderChoices(trip, stop) {
  const day = dayStops(trip, dayOf(stop)), i = day.findIndex(s => s.id === stop.id);
  const prev = day[i - 1], next = day[i + 1], f = stop.folder || null;
  const first = !f || prev?.folder !== f, last = !f || next?.folder !== f, canLeave = first || last;
  const why = 'Only the first or last stop can leave a folder';
  const kindOfFolder = id => folderKind(trip.stops.filter(s => s.folder === id));
  const marker = id => `<i class="wt-marker wt-marker--stack" style="--wt-kind-color: var(--wt-kind-${kindOfFolder(id)})">${kindIcon({ kind: kindOfFolder(id) })}</i>`;
  const out = [{ value: 'none', label: 'None', marker: '<i class="wt-marker wt-marker--none"></i>', disabled: !canLeave, detail: canLeave ? '' : why }];
  if (prev?.folder && prev.folder !== f && first) out.push({ value: prev.folder, label: folderName(trip, prev.folder), marker: marker(prev.folder), detail: 'The folder above' });
  if (f) {
    const n = trip.stops.filter(s => s.folder === f).length;
    out.push({ value: f, label: folderName(trip, f), marker: marker(f), detail: `${n} ${n === 1 ? 'stop' : 'stops'}` });
  }
  if (next?.folder && next.folder !== f && last) out.push({ value: next.folder, label: folderName(trip, next.folder), marker: marker(next.folder), detail: 'The folder below' });
  out.push({ value: 'new', label: 'New folder', marker: `<i class="wt-marker wt-marker--stack" style="--wt-kind-color: var(--wt-kind-place)">${ICON.plus}</i>`, disabled: !canLeave, detail: canLeave ? `Named ${suggestFolderName(stop)}` : why });
  return out;
}
// The folder a stop saved at `time` ends up in, so folders keep their stops together: one it's moved out of (no
// stop next to it is in it any more, and it has others) it leaves; one it's moved into the middle of (the stops before
// and after it are both in it) it joins. `id` is the stop's (none for a new one).
function folderAt(trip, id, time, folder) {
  const day = dayStops(trip, time.slice(0, 10)).filter(s => s.id !== id);
  const at = day.findIndex(s => s.time.localeCompare(time) > 0 || (s.time === time && id && s.id.localeCompare(id) > 0));
  const prev = day[(at < 0 ? day.length : at) - 1], next = at < 0 ? null : day[at];
  if (folder) {
    const others = trip.stops.some(s => s.id !== id && s.folder === folder);
    return !others || prev?.folder === folder || next?.folder === folder ? folder : null;
  }
  return prev?.folder && prev.folder === next?.folder ? prev.folder : null;
}

// Rename a folder: its name, in a small sheet
function openRenameFolder(trip, fid) {
  openSheet(`${modalHead('Rename folder')}
    <form><input class="wt-input" name="name" autocomplete="off" required maxlength="100" aria-label="Folder name">
    <div class="wt-modal__actions"><button class="wt-btn wt-btn--primary">Save</button></div></form>`, el => {
    const f = el.querySelector('form'), input = f.elements.name;
    input.value = folderName(trip, fid);
    input.focus();
    input.select();
    f.onsubmit = e => {
      e.preventDefault();
      const name = input.value.trim(), t = openTripOf(trip.id);
      closeSheet();
      if (!t || !name || name === folderName(t, fid)) return;
      const folder = t.folders.find(x => x.id === fid);
      if (folder) folder.name = name; else t.folders.push({ id: fid, name });
      render();
      save(api(`/trips/${t.id}/folders/${fid}`, { method: 'PUT', body: { name } }));
    };
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
        if (err.status !== 401) failToast(err, 'Couldn’t create the trip');
      }
    };
  });
}

// Everything about the trip that isn't the plan, one section each: its name, who's on it, the share link, saving it for
// offline, and deleting it. Then the map's credits.
function openSettings(trip) {
  openSheet(`${modalHead('Trip settings')}
    <form class="wt-section settings-name">
      <label class="wt-section__title" for="trip-name">Name</label>
      <input class="wt-input" id="trip-name" name="title" autocomplete="off" required maxlength="120">
    </form>
    <section class="wt-section"><h3 class="wt-section__title">People</h3>
      <ul class="wt-people">${trip.members.map(m => `<li class="wt-people__item">${avatarHTML(m)}<span>${esc(m.name)}${m.id === me.id ? ' <span class="wt-people__meta">(you)</span>' : ''}</span></li>`).join('')}</ul></section>
    <section class="wt-section"><h3 class="wt-section__title">Share link</h3>
      <p class="wt-section__text">Anyone with the link can join and edit this trip.</p>
      <div class="wt-copy-row"><input class="wt-input" readonly value="" placeholder="Loading…" aria-label="Trip link"><button class="wt-btn wt-btn--secondary" data-action="copy" disabled>Copy</button></div>
      <button class="wt-btn wt-btn--secondary" data-new-link>Make a new link</button></section>
    <section class="wt-section settings-offline"></section>
    <div class="wt-section"><button class="wt-btn wt-btn--danger" data-del>Delete trip</button></div>
    <p class="wt-credit">Map ${mapCredit}</p>${protoNoteHTML(trip)}`, async el => {
    // Offline: Save for offline, how far it's got, or what's saved
    const off = el.querySelector('.settings-offline');
    offlineField = { el: off, trip, kind: '' };
    showOffline();
    off.addEventListener('click', e => {
      if (e.target.closest('[data-offline-save]')) saveOffline(trip);
      else if (e.target.closest('[data-offline-remove]')) {
        const cancel = offlineJob?.id === trip.id && offlineJob.first;
        removeOffline(trip);
        toast(cancel ? 'Stopped saving for offline' : 'Removed from this device');
      }
    });
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
      if (!(await ask({ title: `Delete “${trip.name}”?`, detail: 'It’s deleted for everyone on the trip. You can undo right after.', action: 'Delete trip', danger: true }))) return;
      try { await api(`/trips/${trip.id}`, { method: 'DELETE' }); } catch (err) {
        if (err.status !== 401) failToast(err, 'Couldn’t delete the trip');
        return;
      }
      closeSheet();
      closeTrip();
      location.hash = '#/';
      toast(`Deleted ${trip.name}`, 'Undo', async () => {
        try { await api(`/trips/${trip.id}/restore`, { method: 'POST' }); location.hash = `#/trip/${trip.id}`; } catch (err) { failToast(err, 'Couldn’t restore the trip'); }
      });
    };
    const input = el.querySelector('.wt-copy-row input'), copy = el.querySelector('[data-action="copy"]');
    const show = url => { input.value = url; copy.dataset.text = url; copy.disabled = false; };
    // A new link is for when the old one went somewhere it shouldn't have: the old one stops working.
    el.querySelector('[data-new-link]').onclick = async () => {
      if (!(await ask({ title: 'Make a new link?', detail: 'The current link stops working. Everyone already on the trip stays on it.', action: 'Make new link' }))) return;
      try { show((await api(`/trips/${trip.id}/invite/rotate`, { method: 'POST' })).url); toast('New link ready'); } catch (err) { failToast(err, 'Couldn’t make a new link'); }
    };
    try { show((await api(`/trips/${trip.id}/invite`)).url); } catch { input.placeholder = 'Couldn’t load the link'; }
  });
}

// Your name as others on your trips see it, the maps app, and AI assistants (not for guests); guests are
// offered a real sign-in, which keeps their trips; everyone can sign out. One section each, as in trip settings.
function openAccount() {
  const upgrade = me.isGuest && canSignIn();
  openSheet(`<div class="account-main">${modalHead('Account')}
    <form class="wt-section account-name">
      <label class="wt-section__title" for="account-name">Your name</label>
      <input class="wt-input" id="account-name" name="name" autocomplete="name" maxlength="40" required aria-describedby="account-name-hint">
      <p class="wt-section__hint" id="account-name-hint">People on your trips see this name.${me.isGuest && !upgrade ? ' As a guest, you can only reach your trips from this browser.' : ''}</p>
    </form>
    ${upgrade ? `<section class="wt-section"><h3 class="wt-section__title">Keep your trips</h3>
      <p class="wt-section__text">As a guest, you can only reach your trips from this browser. Sign in to keep them on any device.</p>
      <div class="signin"></div></section>` : ''}
    <div class="wt-section"><span class="wt-section__title" id="maps-label">Maps app</span>
      <div class="wt-field"><button type="button" class="wt-picker wt-picker--text" data-maps-open aria-labelledby="maps-label maps-value"></button></div></div>
    ${me.isGuest ? '' : '<section class="wt-section account-mcp"></section>'}
    <div class="wt-section"><button class="wt-btn wt-btn--secondary" data-action="sign-out">Sign out</button></div></div>
    ${choicePageHTML('account-maps', 'Maps app', Object.entries(MAPS_APPS).map(([k, label]) => optionHTML(k, label)).join(''), 'Places and directions open in this app. Saved on this device.')}`, el => {
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
      } catch (err) { failToast(err, 'Couldn’t save your name'); }
    };
    f.onsubmit = e => { e.preventDefault(); f.elements.name.blur(); };
    f.elements.name.addEventListener('change', saveName);
    // Maps app: the picker row, and its page
    const mapsPicker = el.querySelector('[data-maps-open]');
    const maps = choicePage(el, { main: el.querySelector('.account-main'), page: el.querySelector('.account-maps'), picker: mapsPicker, onPick: app => { setMapsApp(app); showMaps(); } });
    const showMaps = () => {
      mapsPicker.innerHTML = `<span class="wt-picker__value" id="maps-value">${MAPS_APPS[mapsApp]}</span>${ICON.forward}`;
      maps.mark(mapsApp);
    };
    showMaps();
    if (!me.isGuest) assistantField(el.querySelector('.account-mcp'));
    if (upgrade) authFlow(el.querySelector('.signin'));
  });
}

// AI assistant, in Account: how to connect one (Waythread's MCP server address, which an assistant adds as a
// connector; it then sends you to sign in and allow it), and the assistants you've connected, each with Disconnect.
async function assistantField(box) {
  const day = ms => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
  const head = `<h3 class="wt-section__title">AI assistant</h3>
    <p class="wt-section__text">Connect Claude or another assistant that supports MCP, so it can see your trips’ stops and change them for you.</p>`;
  const show = ({ url, connections }) => {
    box.innerHTML = `${head}
      <div class="wt-copy-row"><input class="wt-input" readonly value="${esc(url)}" aria-label="Server address" aria-describedby="mcp-hint">
        <button class="wt-btn wt-btn--secondary" data-action="copy" data-text="${esc(url)}" data-copied="Address copied">Copy</button></div>
      <p class="wt-section__hint" id="mcp-hint">In Claude, add a custom connector with this address (Customize → Connectors → Add custom connector), then sign in here when it asks.</p>
      ${connections.length ? `<ul class="account-mcp__list" aria-label="Connected assistants">${connections.map(c => `<li class="account-mcp__item">
        <span class="account-mcp__name">${esc(c.name)}<span class="account-mcp__meta">${c.domain ? `${esc(c.domain)} · ` : ''}connected ${day(c.createdAt)}</span></span>
        <button class="wt-btn wt-btn--danger" data-mcp-off="${esc(c.id)}">Disconnect</button></li>`).join('')}</ul>` : ''}`;
    for (const btn of box.querySelectorAll('[data-mcp-off]')) btn.onclick = async () => {
      const c = connections.find(x => x.id === btn.dataset.mcpOff);
      if (!(await ask({ title: `Disconnect ${c.name}?`, detail: 'It won’t be able to see or change your trips. You can connect it again anytime.', action: 'Disconnect', danger: true }))) return;
      try {
        await api(`/assistants/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
        show({ url, connections: connections.filter(x => x !== c) });
        toast(`${c.name} disconnected`);
      } catch (err) { if (err.status !== 401) failToast(err, `Couldn’t disconnect ${c.name}`); }
    };
  };
  box.innerHTML = head;
  try { show(await api('/assistants')); } catch { box.innerHTML = `${head}<p class="wt-section__hint">Couldn’t load this. Check your connection.</p>`; }
}

// Two hours after the day's last stop; 9 AM on a day with none yet (a hotel day), or 9 AM tomorrow for an empty trip.
// From the overview, the trip's last day: a stop added there most often extends the trip.
function defaultTime(trip) {
  const day = currentDay(trip) === ALL ? daysOf(trip).at(-1) : currentDay(trip), s = dayStops(trip, day);
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

// ---------- Choices: every pick from a list is a picker row that opens its options ----------
// The row shows the current choice. On a phone, tapping it slides the sheet to the options, with Back in the head;
// picking one applies it and slides back, and Back slides back with nothing changed. On a computer (768px and up)
// the same options drop down under the row as a menu: one click to open, one to pick, Esc or a click outside to
// close. A stop's Type and Account's Maps app both work this way, however few the options. See "Picker" in the
// design system.
const optionHTML = (value, label, { marker = '', detail = '', disabled = false } = {}) =>
  `<li><button type="button" class="wt-option" role="radio" data-value="${esc(value)}"${disabled ? ' disabled' : ''}>${marker}<span class="wt-option__text"><span class="wt-option__label">${esc(label)}</span>${detail ? `<span class="wt-option__detail">${esc(detail)}</span>` : ''}</span>${ICON.check}</button></li>`;
// `intro` is one line on what the choice affects, when the label alone doesn't say
const choicePageHTML = (cls, title, options, intro = '') => `<div class="${cls}" hidden>
      <div class="wt-modal__head wt-modal__head--sub wt-modal__head--sticky"><button type="button" class="wt-icon-btn" data-choice-back aria-label="Back">${ICON.back}</button><h2 class="wt-modal__title">${esc(title)}</h2></div>
      ${intro ? `<p class="wt-modal__text">${esc(intro)}</p>` : ''}
      <ul class="wt-options" role="radiogroup" aria-label="${esc(title)}">${options}</ul>
    </div>`;
// Wires a picker to its options, inside `sheet`. On a phone the page takes `main`'s place while it's open, and the
// sheet's scroll comes back on return. On a computer the page moves under the picker and shows as a menu (.wt-menu),
// with the rest of the sheet still there. Focus goes to the checked option on the way in, and to the picker on the
// way out. Returns mark(value), which checks the current option.
const wideScreen = matchMedia(`(min-width: ${WIDE}px)`);
function choicePage(sheet, { main, page, picker, onPick }) {
  const home = page.parentElement, field = picker.parentElement;
  let scrollBack = 0, menu = false;
  picker.setAttribute('aria-haspopup', 'true');
  picker.setAttribute('aria-expanded', 'false');
  const outside = e => { if (!page.contains(e.target) && !picker.contains(e.target)) open(false, false); };
  const open = (on, refocus = true) => {
    if (on) {
      menu = wideScreen.matches;
      // The page lives beside `main` for a phone, and inside the field, under the picker, for a menu
      if (menu) field.append(page); else home.append(page);
      page.classList.toggle('wt-menu', menu);
      if (menu) document.addEventListener('pointerdown', outside, true);
      else { scrollBack = sheet.scrollTop; main.hidden = true; }
    } else {
      if (page.hidden) return;
      if (menu) document.removeEventListener('pointerdown', outside, true);
      else main.hidden = false;
    }
    page.hidden = !on;
    picker.setAttribute('aria-expanded', on);
    if (!menu) sheet.scrollTop = on ? 0 : scrollBack;
    if (on) (page.querySelector('[aria-checked="true"]') || page.querySelector('[data-value]')).focus();
    else if (refocus) picker.focus();
  };
  picker.addEventListener('click', () => open(page.hidden));
  // A menu closes on Esc (without closing the sheet), or when focus leaves it
  page.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu && !page.hidden) { e.stopPropagation(); open(false); }
  });
  page.addEventListener('focusout', e => {
    if (menu && !page.hidden && e.relatedTarget && !page.contains(e.relatedTarget) && e.relatedTarget !== picker) open(false, false);
  });
  // ↑ ↓ move between options, as in any radio group
  page.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...page.querySelectorAll('[data-value]')], i = all.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
  });
  page.addEventListener('click', e => {
    if (e.target.closest('[data-choice-back]')) return open(false);
    const b = e.target.closest('[data-value]');
    if (!b) return;
    onPick(b.dataset.value);
    open(false);
  });
  return { mark: value => { for (const b of page.querySelectorAll('[data-value]')) b.setAttribute('aria-checked', b.dataset.value === value); } };
}

// The stop sheet is a panel: the map stays in view (above it on a phone, beside it on a wide screen) and shows
// the stop as you edit it, at the place you picked, with the type you chose.
// The first line is the place, a row like a calendar's Location: tapping it opens a search page, as in a maps app.
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
  const option = k => optionHTML(k, KINDS[k].label, { marker: markerHTML({ kind: k }, ''), detail: KIND_HINTS[k] });
  openSheet(`<div class="stop-main">${modalHead(stop ? 'Edit stop' : 'Add stop', true)}
    <form>
      <div class="wt-field"><span class="wt-field__label" id="place-label">Place</span>
        <button type="button" class="wt-picker wt-picker--text" data-place-open aria-describedby="place-label"></button></div>
      <div class="wt-field"><span class="wt-field__label" id="kind-label">Type</span>
        <button type="button" class="wt-picker" data-kind-open aria-describedby="kind-label"></button></div>
      ${stop ? `<div class="wt-field"><span class="wt-field__label" id="folder-label">Folder</span>
        <button type="button" class="wt-picker" data-folder-open aria-describedby="folder-label"></button></div>` : ''}
      <label class="wt-field"><span class="wt-field__label" data-when>Arrive</span><input class="wt-input" name="time" type="datetime-local" required></label>
      <label class="wt-field wt-stay" hidden><span class="wt-field__label">Check-out</span><input class="wt-input" name="checkout" type="datetime-local"></label>
      <label class="wt-field"><span class="wt-field__label">Note</span><textarea class="wt-input" name="note" rows="2" maxlength="2000" placeholder="Confirmation #, tickets, tips…"></textarea></label>
      <div class="wt-modal__actions wt-modal__actions--sticky">${stop ? '<button type="button" class="wt-btn wt-btn--danger" data-del>Delete</button>' : ''}<button class="wt-btn wt-btn--primary">${stop ? 'Save' : 'Add'}</button></div>
    </form></div>
    ${choicePageHTML('stop-kinds', 'Type', KIND_SECTIONS.map(g => g.map(option).join('')).join('<li class="wt-options__sep" role="presentation"></li>'))}
    ${stop ? choicePageHTML('stop-folders', 'Folder', folderChoices(trip, stop).map(o => optionHTML(o.value, o.label, o)).join(''), 'A folder holds stops that follow each other, so only the folders next to this stop are here.') : ''}
    <div class="stop-place" hidden>
      <div class="wt-search-bar">
        <label class="wt-input wt-input-group wt-search">${ICON.search}<input id="stop-place" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="place-results" aria-label="Search a place" placeholder="Search a place" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="200"><span class="wt-spinner" hidden></span><button type="button" class="wt-search__clear" aria-label="Clear" hidden>${ICON.close}</button></label>
        <button type="button" class="wt-search-bar__cancel" data-place-cancel>Cancel</button>
      </div>
      <div class="wt-results" id="place-results" role="listbox" aria-label="Places"></div>
      <span class="wt-visually-hidden" role="status" data-place-status></span>
    </div>`, el => {
    const f = el.querySelector('form'), F = f.elements;
    const main = el.querySelector('.stop-main'), kindsPage = el.querySelector('.stop-kinds'), picker = el.querySelector('[data-kind-open]');
    // The time is yours once you've touched it; until then a new hotel's starts at check-in time
    let timeTouched = !!stop;
    if (stop) { F.time.value = stop.time; F.note.value = stop.note || ''; }
    else F.time.value = defaultTime(trip);

    // ----- Type: the picker row, and its page -----
    const showKind = () => {
      picker.innerHTML = `${markerHTML(draft, '')}<span class="wt-picker__value">${KINDS[draft.kind].label}</span>${ICON.forward}`;
      kinds.mark(draft.kind);
    };
    const kinds = choicePage(el, { main, page: kindsPage, picker, onPick: k => { chosen = true; setKind(k); } });
    function setKind(kind) {
      draft.kind = kind;
      // A new hotel starts at check-in time; anything else goes back to the usual default.
      if (!timeTouched) F.time.value = kind === 'hotel' ? `${F.time.value.slice(0, 10)}T${HOTEL_CHECK_IN}` : defaultTime(trip);
      showKind();
      showNights();
      if (cur?.stops) drawMap(cur);
    }

    // ----- A stop has one time, when you get there: Arrive. A hotel is a stay: Arrive becomes Check-in, then
    // Check-out, a day and time. The nights are the days between them. Left alone, check-out follows the trip (the
    // next hotel, or the last day). -----
    let nights = stop?.nights >= 1 ? stop.nights : null, outTime = stop && kindOf(stop) === 'hotel' ? checkoutOf(stop) : HOTEL_CHECK_OUT;
    const stay = el.querySelector('.wt-stay'), inDay = () => F.time.value.slice(0, 10);
    let shownIn = inDay();
    function autoNights() {
      const day = inDay(), later = stopsOf(trip).filter(s => s.id !== stop?.id && dayOf(s) > day);
      const nextHotel = later.find(s => kindOf(s) === 'hotel');
      return Math.max(1, daysBetween(day, nextHotel ? dayOf(nextHotel) : later.length ? dayOf(later.at(-1)) : addDays(day, 1)));
    }
    function showNights() {
      const hotel = draft.kind === 'hotel', day = inDay();
      stay.hidden = !hotel;
      F.checkout.disabled = !hotel; // so a hidden field can't block saving
      el.querySelector('[data-when]').textContent = hotel ? 'Check-in' : 'Arrive';
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

    // ----- Folder (editing a stop): a picker like Type, of the folders this stop can be in where it is: none, its own,
    // the folder right above or below it, or a new one. A stop in the middle of a folder can only stay in it. -----
    let folder = stop?.folder || null;
    const folderPicker = el.querySelector('[data-folder-open]');
    const folderMarker = f => (f === 'new' ? `<i class="wt-marker wt-marker--stack" style="--wt-kind-color: var(--wt-kind-place)">${ICON.plus}</i>`
      : f ? `<i class="wt-marker wt-marker--stack" style="--wt-kind-color: var(--wt-kind-${folderKind(trip.stops.filter(s => s.folder === f))})">${kindIcon({ kind: folderKind(trip.stops.filter(s => s.folder === f)) })}</i>`
        : '<i class="wt-marker wt-marker--none"></i>');
    const showFolder = () => {
      folderPicker.innerHTML = `${folderMarker(folder)}<span class="wt-picker__value">${esc(folder === 'new' ? `New folder: ${suggestFolderName(draft)}` : folder ? folderName(trip, folder) : 'None')}</span>${ICON.forward}`;
      folders.mark(folder || 'none');
    };
    const folders = folderPicker && choicePage(el, { main, page: el.querySelector('.stop-folders'), picker: folderPicker, onPick: v => { folder = v === 'none' ? null : v; showFolder(); } });
    if (folderPicker) showFolder();

    // ----- Place: the row shows the place's name and address. Tapping it opens the search page, as in Google or
    // Apple Maps: the field starts with the place's name, suggestions fill the page (each with the marker of the
    // type it would get), and tapping one fills it in and comes back. Cancel (or Esc) comes back unchanged; for a
    // new stop with no place yet, it closes the sheet. A new stop opens on this page. Picking moves the pin there.
    const placeRow = el.querySelector('[data-place-open]'), placePage = el.querySelector('.stop-place');
    const input = placePage.querySelector('#stop-place'), box = input.closest('.wt-search');
    const spinner = box.querySelector('.wt-spinner'), clear = box.querySelector('.wt-search__clear');
    const list = placePage.querySelector('.wt-results'), status = placePage.querySelector('[data-place-status]');

    const placeKey = p => `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`;
    const cache = new Map(); // query → places, so backspacing doesn't search again
    let timer, ctrl, found = { q: '', list: [] }, phase = 'idle', failText = '';
    let opts = [], active = -1;

    const showPlace = () => {
      placeRow.innerHTML = `<span class="wt-picker__value"><span class="wt-picker__name">${esc(draft.name)}</span>${draft.address ? `<span class="wt-picker__detail">${esc(draft.address)}</span>` : ''}</span>${ICON.forward}`;
    };
    // The search page takes the sheet's place, and on a phone the whole screen, like a maps app's search
    let placeScroll = 0;
    function showPlacePage(open) {
      if (open) placeScroll = el.scrollTop;
      main.hidden = open;
      placePage.hidden = !open;
      el.classList.toggle('is-full', open);
      el.scrollTop = open ? 0 : placeScroll;
      if (!open) { clearTimeout(timer); ctrl?.abort(); spinner.hidden = true; placeRow.focus(); return; }
      input.value = draft.name || '';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      onType();
    }
    function cancelPlace() {
      if (draft.lat == null) closeSheet(); // a new stop, with nowhere to go yet
      else showPlacePage(false);
    }
    placeRow.addEventListener('click', () => showPlacePage(true));
    placePage.querySelector('[data-place-cancel]').addEventListener('click', cancelPlace);

    function highlight(text, q) {
      const words = q.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (!words.length) return esc(text);
      let out = '', last = 0;
      for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})`, 'giu'))) {
        out += `${esc(text.slice(last, m.index))}<mark class="wt-option__match">${esc(m[0])}</mark>`;
        last = m.index + m[0].length;
      }
      return out + esc(text.slice(last));
    }
    const optionHTML = (p, i, q) => `<div class="wt-option" role="option" id="place-opt-${i}" data-i="${i}" aria-selected="false">${markerHTML(p, '')}<span class="wt-option__text"><span class="wt-option__label">${highlight(p.name, q)}</span>${p.address ? `<span class="wt-option__detail">${esc(p.address)}</span>` : ''}</span></div>`;

    // Draw the suggestions for what's typed now: the latest search results (kept on screen while the next search
    // runs, so the list doesn't flash), or a message that says what happened and what to try.
    function paint() {
      const q = input.value.trim();
      const results = q.length >= 3 ? found.list.map(p => ({ ...p, kind: guessKind(p.name, p.category) })) : [];
      let msg = '';
      if (q.length >= 3 && phase === 'error') msg = failText;
      else if (q.length >= 3 && phase === 'done' && !results.length) msg = `<b>No places match “${esc(q)}”</b>Try adding the town, or check the spelling.`;
      const prev = opts[active];
      opts = results;
      list.innerHTML = opts.map((p, i) => optionHTML(p, i, q)).join('') + (msg ? `<div class="wt-results__msg" role="presentation">${msg}</div>` : '');
      input.setAttribute('aria-expanded', String(!!opts.length));
      // Return picks the top match, or the one moved to with the arrows, which stays put as results arrive
      const kept = prev ? opts.findIndex(p => placeKey(p) === placeKey(prev) && p.name === prev.name) : -1;
      setActive(kept >= 0 ? kept : opts.length ? 0 : -1, false);
      status.textContent = msg ? list.querySelector('.wt-results__msg').textContent : opts.length ? `${opts.length} ${opts.length === 1 ? 'place' : 'places'}` : '';
    }
    function setActive(i, scroll = true) {
      active = i;
      list.querySelectorAll('[aria-selected="true"]').forEach(o => o.setAttribute('aria-selected', 'false'));
      const o = i >= 0 && list.querySelector(`#place-opt-${i}`);
      if (o) { o.setAttribute('aria-selected', 'true'); if (scroll) o.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', o.id); }
      else input.removeAttribute('aria-activedescendant');
    }

    function onType() {
      clear.hidden = !input.value;
      const q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 3) { ctrl?.abort(); spinner.hidden = true; phase = 'idle'; found = { q: '', list: [] }; return paint(); }
      if (cache.has(q.toLowerCase())) { found = { q, list: cache.get(q.toLowerCase()) }; phase = 'done'; spinner.hidden = true; return paint(); }
      phase = 'loading';
      spinner.hidden = false;
      paint();
      timer = setTimeout(() => search(q), 250);
    }
    async function search(q) {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const list = await api(`/places?q=${encodeURIComponent(q)}${nearParam(trip)}`, { signal: ctrl.signal });
        cache.set(q.toLowerCase(), list);
        found = { q, list };
        phase = 'done';
      } catch (e) {
        if (e.name === 'AbortError') return;
        phase = 'error';
        failText = e.code === 'rate_limited' ? '<b>Too many searches at once</b>Wait a moment, then keep typing.'
          : e.code === 'offline' ? '<b>Can’t search right now</b>Check your connection, then keep typing.' : '<b>Search isn’t working right now</b>Try again in a moment.';
      }
      spinner.hidden = true;
      if (input.value.trim() === q && !placePage.hidden) paint();
    }
    function pick(p) {
      Object.assign(draft, { lat: p.lat, lng: p.lng, address: p.address, name: p.name });
      showPlace();
      status.textContent = `${p.name} picked`;
      if (!chosen) setKind(p.kind);
      showPlacePage(false); // first, so the map centers the place above the sheet's real height
      if (cur?.stops) drawMap(cur);
      focusStop(draft);
    }

    input.addEventListener('input', onType);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (opts.length) setActive(e.key === 'ArrowDown' ? (active + 1) % opts.length : active <= 0 ? opts.length - 1 : active - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0) pick(opts[active]);
      } else if (e.key === 'Escape') {
        e.stopPropagation(); // Esc is Cancel here; on the form it closes the sheet
        cancelPlace();
      }
    });
    list.addEventListener('mousedown', e => e.preventDefault()); // keep the keyboard up until a place is picked
    list.addEventListener('click', e => {
      const o = e.target.closest('[data-i]');
      if (o) pick(opts[+o.dataset.i]);
    });
    clear.addEventListener('mousedown', e => e.preventDefault());
    clear.addEventListener('click', () => {
      input.value = '';
      input.focus();
      onType();
    });
    if (draft.lat != null) showPlace();
    else showPlacePage(true); // a new stop starts by finding its place

    f.onsubmit = e => {
      e.preventDefault();
      if (draft.lat == null) return showPlacePage(true);
      const hotel = draft.kind === 'hotel';
      const data = {
        name: draft.name, address: draft.address, lat: draft.lat, lng: draft.lng, time: F.time.value, note: F.note.value.trim(),
        kind: draft.kind, nights: hotel ? nights : null, checkout: hotel ? outTime : null,
      };
      const kept = folderAt(trip, stop?.id, data.time, folder === 'new' ? newFolder(trip, suggestFolderName(draft)) : folder);
      data.folder = kept;
      // its time moved it into or out of a folder: say so
      const before = folder === 'new' ? kept : folder;
      if (kept !== before) toast(kept ? `${data.name} is in ${folderName(trip, kept)}, between its stops` : `${data.name} is out of ${folderName(trip, before)}: its time is outside it now`);
      if (state.day !== ALL) state.day = dayOf(data); // follow the stop to its day; the overview has every day
      saved = true;
      state.draft = null; // so the list and map show the saved stop, not the draft
      if (stop) editStop(trip, stop, data); else addStop(trip, data);
      closeSheet();
      centerFocus({ force: true, animate: false }); // the saved stop, wherever its time put it, in the middle of the list
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

// ---------- Notices: toasts and questions (see "Messages" in the design system) ----------
// A toast is news at the top of the screen. `msg` is a line of text, or { icon, title, detail, error } for one that needs
// a second line (.wt-toast--rich): what happened, then what still works or what to do. An error gets the alert icon (or
// its own, such as offline) in red, and is read out at once. `label` and `onAction` add an action, such as Undo.
// - It stays long enough to read: a quarter second a word on top of a second, at least 3 seconds (5 with an action,
//   which takes time to reach), at most 8. The pointer on it, or focus in it, holds it there.
// - A tap or a swipe up puts it away.
// - One at a time: a new toast replaces the one showing, except that news waits behind a toast with an action, so a
//   co-editor's change arriving doesn't take Undo away.
// On the trip screen it shows below the header (--wt-toast-top in styles.css), so Home and settings stay in reach.
const $toast = Object.assign(document.createElement('div'), { className: 'wt-toast' });
$toast.setAttribute('role', 'status');
document.body.append($toast);
let toastNow = null, toastNext = null, toastTimer = 0, toastLeft = 0, toastStart = 0;
const toastHold = new Set(); // 'hover', 'focus': what's holding the toast on screen
function toast(msg, label, onAction) {
  const n = { ...(typeof msg === 'object' ? msg : { title: msg }), label, onAction };
  if (toastNow?.label && !n.label) { toastNext = n; return; }
  showToast(n);
}
// A request failed: what failed, as the heading, and what to do about it. Offline has its own icon.
function failToast(err, title) {
  toast({ error: true, icon: err?.code === 'offline' ? ICON.cloudOff : null, title, detail: failHint(err) });
}
function showToast(n) {
  toastNow = n;
  const rich = !!(n.detail || n.icon || n.error), icon = n.icon || (n.error ? ICON.alert : '');
  $toast.className = `wt-toast${rich ? ' wt-toast--rich' : ''}${n.error ? ' wt-toast--error' : ''} is-visible`;
  $toast.setAttribute('role', n.error ? 'alert' : 'status');
  $toast.innerHTML = (rich
    ? `${icon ? `<span class="wt-toast__icon">${icon}</span>` : ''}<span class="wt-toast__text"><b class="wt-toast__title">${esc(n.title)}</b>${n.detail ? `<span class="wt-toast__detail">${esc(n.detail)}</span>` : ''}</span>`
    : `<span>${esc(n.title)}</span>`) + (n.label ? `<button class="wt-toast__action">${esc(n.label)}</button>` : '');
  if (n.label) $toast.querySelector('.wt-toast__action').onclick = () => { hideToast(); n.onAction(); };
  const words = `${n.title} ${n.detail || ''}`.trim().split(/\s+/).length;
  toastLeft = Math.min(8000, Math.max(n.label ? 5000 : 3000, 1000 + words * 250));
  toastHold.delete('hover'); // a new toast hasn't been pointed at yet
  runToast();
}
function runToast() {
  clearTimeout(toastTimer);
  if (!toastNow || toastHold.size) return;
  toastStart = Date.now();
  toastTimer = setTimeout(hideToast, toastLeft);
}
function hideToast() {
  clearTimeout(toastTimer);
  $toast.classList.remove('is-visible');
  const next = toastNext;
  toastNow = toastNext = null;
  toastHold.clear();
  // the news that waited: now, or after whatever took its place (Undo's own notice, say)
  if (next) setTimeout(() => { if (!toastNow) showToast(next); else toastNext ||= next; }, 300);
}
function holdToast(why, on) {
  const was = toastHold.size;
  if (on) toastHold.add(why); else toastHold.delete(why);
  if (!was && toastHold.size) { clearTimeout(toastTimer); toastLeft = Math.max(1500, toastLeft - (Date.now() - toastStart)); }
  if (was && !toastHold.size) runToast();
}
$toast.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') holdToast('hover', true); });
$toast.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') holdToast('hover', false); });
$toast.addEventListener('focusin', () => holdToast('focus', true));
$toast.addEventListener('focusout', () => holdToast('focus', false));
// A tap puts it away; so does a swipe up, which it follows (and resists going down)
let toastDrag = null;
$toast.addEventListener('pointerdown', e => {
  if (!toastNow || e.target.closest('button')) return;
  toastDrag = { id: e.pointerId, y: e.clientY, dy: 0, moved: 0 };
  $toast.setPointerCapture(e.pointerId);
  $toast.classList.add('is-dragging');
});
$toast.addEventListener('pointermove', e => {
  if (toastDrag?.id !== e.pointerId) return;
  const dy = e.clientY - toastDrag.y;
  toastDrag.dy = dy < 0 ? dy : dy / 4;
  toastDrag.moved = Math.max(toastDrag.moved, Math.abs(dy));
  $toast.style.setProperty('--wt-toast-drag', `${toastDrag.dy}px`);
});
const endToastDrag = e => {
  if (toastDrag?.id !== e.pointerId) return;
  const { dy, moved } = toastDrag;
  toastDrag = null;
  $toast.classList.remove('is-dragging');
  $toast.style.removeProperty('--wt-toast-drag');
  if (e.type === 'pointerup' && (dy < -24 || moved < 6)) hideToast();
};
$toast.addEventListener('pointerup', endToastDrag);
$toast.addEventListener('pointercancel', endToastDrag);

// A question before an action that can't be undone, or that others will notice (.wt-dialog): the title asks it, a line
// under it says what happens, and the buttons are Cancel and one that names the action. It sits over everything, so a
// sheet can ask without closing. When the action destroys something its button is red and Cancel has the focus;
// otherwise the action has it. Esc or a tap outside cancels; Tab stays inside. Resolves to true if the action is chosen.
function ask({ title, detail = '', action, danger = false }) {
  return new Promise(resolve => {
    const back = document.activeElement, id = `ask-${uid()}`;
    const root = Object.assign(document.createElement('div'), { className: 'wt-dialog-root' });
    root.innerHTML = `<div class="wt-dialog__backdrop" data-answer="no"></div>
      <div class="wt-dialog" role="alertdialog" aria-modal="true" aria-labelledby="${id}-t"${detail ? ` aria-describedby="${id}-d"` : ''}>
        <h2 class="wt-dialog__title" id="${id}-t">${esc(title)}</h2>${detail ? `<p class="wt-dialog__text" id="${id}-d">${esc(detail)}</p>` : ''}
        <div class="wt-dialog__actions"><button type="button" class="wt-btn wt-btn--secondary" data-answer="no">Cancel</button>
          <button type="button" class="wt-btn ${danger ? 'wt-btn--destructive' : 'wt-btn--primary'}" data-answer="yes">${esc(action)}</button></div>
      </div>`;
    document.body.append(root);
    const btns = [...root.querySelectorAll('button')];
    const answer = yes => {
      document.removeEventListener('keydown', onKey, true);
      root.classList.remove('is-open');
      setTimeout(() => root.remove(), parseFloat(token('--wt-duration-base')) || 0);
      if (back?.isConnected) back.focus({ preventScroll: true });
      resolve(yes);
    };
    // Before the page's own keys: Esc here cancels the question, not the sheet under it
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false); }
      if (e.key === 'Tab') { e.preventDefault(); btns[(btns.indexOf(document.activeElement) + 1) % btns.length].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('click', e => { const a = e.target.closest('[data-answer]'); if (a) answer(a.dataset.answer === 'yes'); });
    btns[danger ? 0 : 1].focus({ preventScroll: true });
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-open')));
  });
}

// ---------- Events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const trip = cur?.stops ? cur : null;
  const stop = trip && el.dataset.id && trip.stops.find(s => s.id === el.dataset.id);
  switch (el.dataset.action) {
    case 'new-trip': openNewTrip(); break;
    case 'add': if (needsConnection()) openStopSheet(trip); break;
    case 'select': if (stop && !e.target.closest('a')) selectStop(stop, el.dataset.row); break; // a link in its note opens on its own
    case 'folder': selectFolder(el.dataset.folder); break;
    case 'rename-folder': if (needsConnection()) openRenameFolder(trip, el.dataset.folder); break;
    case 'edit': if (stop && needsConnection()) openStopSheet(trip, stop); break;
    case 'settings': openSettings(trip); break;
    case 'offline-status': if (statusSay) toast(statusSay); break;
    case 'prev-day': stepDay(-1); break;
    case 'next-day': stepDay(1); break;
    case 'days': openDays(trip); break;
    case 'pick-day': closeSheet(); setDay(el.dataset.day); break;
    case 'leg': {
      const l = legsOn(trip, currentDay(trip)).find(x => x.key === el.dataset.leg);
      if (l) previewLeg(l);
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
    // with no sheet open, Esc clears the selection, like tapping empty map
    if (!$sheets.innerHTML && $app.dataset.trip && (state.sel || state.leg || state.folder)) {
      if (state.leg || openFolderOf(cur)) fitKey = '';
      state.sel = state.selRow = state.leg = state.folder = null;
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
