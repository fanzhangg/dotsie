/* The prototype's backend: the same exports as app/web/backend.js, answered in the browser. index.html's import map
   puts this file in place of that one, so the prototype runs the app's own modules with no server.
   Trips are saved in localStorage, so they're in this browser only, and a BroadcastChannel carries each change to the
   other open tabs as the server's live events would, so two tabs work like two people on the trip. */
import { ApiError, params, ROUTE_KEY, uid } from '../app/web/core.js';
import { QID } from '../app/web/fields.js';
import { OVERPASS, nominatimPlaces, nominatimURL, osrmRoute, osrmURL, sightsFrom, sightsQuery, tileBounds, wikiAbout, wikiPlace } from '../app/web/places.js';
import { dayOf, stopsOf } from '../app/web/plan.js';
import { regionsMatching } from '../app/web/regions.js';
import { onEvent } from '../app/web/trips.js';
import { toast } from '../app/web/notices.js';

// Trips are saved in localStorage, so they're in this browser only. Routes come from the public OSRM demo server, and
// place search from Nominatim, as in the app's local dev without a Stadia key, and the map's sights from Overpass. Each change goes to the other open
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
          { ...s('airport', 'El Paso International Airport', '6701 Convair Rd, El Paso, TX', 31.8072, -106.3779, '2026-11-20T10:30', 'UA 1234 lands · rental car at Hertz', 'alex'),
            links: [{ url: 'https://www.united.com/en/us/flightstatus', label: 'UA 1234' }, { url: 'https://www.hertz.com/rentacar/reservation/', label: 'Hertz' }] },
          { ...s('hotel', 'Holiday Inn Express Alamogordo', 'S White Sands Blvd, Alamogordo, NM', 32.8800, -105.9580, '2026-11-20T13:00', 'Drop bags · conf # in email', 'alex'),
            links: [{ url: 'https://www.booking.com/', label: 'Booking' }] },
          { ...s('attraction', 'White Sands Visitor Center', '19955 US-70, Alamogordo, NM', 32.7797, -106.1717, '2026-11-20T15:00', 'Buy a sled + wax', 'sam'), checkout: '16:00',
            links: [{ url: 'https://www.nps.gov/whsa/planyourvisit/', label: 'Plan your visit' }, { url: 'https://www.recreation.gov/', label: '' }] },
          s('nature', 'Interdune Boardwalk', 'Dunes Dr, White Sands National Park, NM', 32.7930, -106.2110, '2026-11-20T16:30', 'Sunset ~5:00 PM', 'sam'),
          { ...s('museum', 'New Mexico Museum of Space History', '3198 NM-2001, Alamogordo, NM', 32.9214, -105.9213, '2026-11-21T09:30', '', 'alex'), wikidata: 'Q7010217' },
          { ...s('restaurant', 'Cloudcroft', 'Burro Ave, Cloudcroft, NM', 32.9573, -105.7428, '2026-11-21T12:30', 'Lunch', 'sam'), wikidata: 'Q432556' },
          s('airport', 'El Paso International Airport', '6701 Convair Rd, El Paso, TX', 31.8072, -106.3779, '2026-11-22T11:00', 'Fly home · return car by 10:00', 'alex'),
        ],
        // Want to go: places saved with no day yet
        ideas: [
          { id: uid(), kind: 'nature', name: 'Oliver Lee Memorial State Park', address: 'Dog Canyon Rd, Alamogordo, NM', lat: 32.7486, lng: -105.9145,
            note: 'Dog Canyon trail, if we have a morning', links: [], wikidata: null, by: 'sam', updatedAt: t - 2 },
          { id: uid(), kind: 'attraction', name: 'Three Rivers Petroglyph Site', address: 'County Rd B30, Three Rivers, NM', lat: 33.3456, lng: -105.9864,
            note: '', links: [{ url: 'https://www.blm.gov/visit/three-rivers-petroglyph-site', label: 'BLM' }], wikidata: null, by: 'alex', updatedAt: t - 1 },
        ],
      },
      'big-bend': {
        id: 'big-bend', name: 'Big Bend in spring', members: ['alex', 'jo', 'sam'], createdBy: 'jo', updatedAt: t - 1,
        spots: [
          s('airport', 'Midland International Air & Space Port', '9506 Laforce Blvd, Midland, TX', 31.9425, -102.2019, '2026-03-13T09:40', 'WN 2210 lands', 'jo'),
          { ...s('restaurant', 'Marfa', 'Highland Ave, Marfa, TX', 30.3094, -104.0206, '2026-03-13T13:00', 'Lunch', 'sam'), wikidata: 'Q982507' },
          { ...s('hotel', 'Chisos Mountains Lodge', '1 Basin Rural Station, Big Bend National Park, TX', 29.2700, -103.3005, '2026-03-13T17:30', '', 'jo'), nights: 3, wikidata: 'Q105444692' },
          { ...s('nature', 'Lost Mine Trail', 'Basin Junction Rd, Big Bend National Park, TX', 29.2728, -103.2858, '2026-03-14T08:00', 'Start early, it gets hot', 'alex'), wikidata: 'Q132200719' },
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
const snapshotOf = (d, t) => ({ trip: { id: t.id, name: t.name, owner: t.createdBy }, members: t.members.filter(u => USERS[u]).map(u => userOf(d, u)), stops: t.spots, ideas: t.ideas || [] });
const shareURL = token => `${location.origin}${location.pathname}#/join/${token}`;
const newToken = () => uid() + uid();
function inviteToken(tripId) {
  const d = loadDB(), t = d.trips[tripId];
  if (!t) return '';
  if (!t.invite) { t.invite = newToken(); storeDB(d); }
  return t.invite;
}
// A sight's photo and a few lines about it, straight from Wikidata, English Wikipedia and Wikimedia Commons, asked as
// the app's server asks them (see wikiAbout in app/web/places.js), with origin=* as a page on another site must. The
// app keeps each for the visit.
const wikiGet = async (host, params, signal) => {
  let res;
  try {
    res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
  } catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(e.name === 'TimeoutError' ? 503 : 0, e.name === 'TimeoutError' ? 'unavailable' : 'offline'); }
  if (!res.ok) throw new ApiError(503, 'unavailable');
  return res.json();
};
// A place with no Wikidata item, by its name and where it is (see wikiPlace in app/web/places.js)
async function findPlaceAbout(name, where, signal) {
  const [lat, lng] = (where || '').split(',').map(Number);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new ApiError(400, 'invalid');
  const qid = await wikiPlace((host, params) => wikiGet(host, params, signal), name, { lat, lng });
  return qid ? findAbout(qid, signal) : null;
}
async function findAbout(qid, signal) {
  if (!QID.test(qid || '')) throw new ApiError(400, 'invalid');
  return wikiAbout((host, params) => wikiGet(host, params, signal), qid);
}
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('waythread') : null;
const broadcast = (trip, m) => bc?.postMessage({ trip, ...m, by: ME });

export async function api(path, { method = 'GET', body, signal } = {}) {
  const [route, query = ''] = path.split('?'), q = new URLSearchParams(query);
  // With no connection the app can't reach its server, so here the trips can't be reached either: turn the network off
  // (DevTools → Network → Offline) to try a trip saved for offline. Who you are still answers, as there's no sign-in.
  if (!navigator.onLine && route !== '/me' && route !== '/config') throw new ApiError(0, 'offline');
  if (route === '/route') return findRoute(q.get('from'), q.get('to'), q.get('mode') || 'drive');
  if (route === '/places') return searchPlaces(q.get('q'), q.get('near'), signal);
  if (route === '/sights') return findSights(q.get('tile'), signal);
  if (route === '/about') return q.has('id') ? findAbout(q.get('id'), signal) : findPlaceAbout(q.get('name'), q.get('at'), signal);
  if (route.startsWith('/spots/')) return spots(route.split('/').slice(2).map(decodeURIComponent), q);
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
      const stops = t.spots.map(({ id, name, lat, lng, time, kind, nights, travel, back, wikidata = null }) => ({ id, name, lat, lng, time, kind, nights, travel, back, wikidata }));
      return { id: t.id, name: t.name, start: times[0] || null, end: times.at(-1) || null, members: snapshotOf(d, t).members, stops };
    });
  }
  if (call === 'POST trips' && !p[1]) {
    const t = { id: uid(), name: body.name, members: [ME], createdBy: ME, spots: [], ideas: [], updatedAt: now };
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
  if (p[2] === 'restore' && method === 'POST') {
    if (t.createdBy !== ME) fail(403, 'not_owner');
    t.deleted = false;
    return out();
  }
  if (t.deleted) fail(410, 'gone');
  if (!t.members.includes(ME)) fail(403, 'not_member');
  const touch = () => { t.updatedAt = now; };
  if (!p[2]) {
    if (method === 'GET') return out(snapshotOf(d, t));
    if (method === 'PATCH') { t.name = body.name; touch(); broadcast(t.id, { type: 'trip.updated', name: t.name }); return out({ ok: true }); }
    if (method === 'DELETE') {
      if (t.createdBy !== ME) fail(403, 'not_owner');
      t.deleted = true;
      broadcast(t.id, { type: 'trip.deleted' });
      return out();
    }
  }
  // Anyone but the owner can leave; their stops stay
  if (p[2] === 'leave' && method === 'POST') {
    if (t.createdBy === ME) fail(400, 'invalid');
    t.members = t.members.filter(u => u !== ME);
    broadcast(t.id, { type: 'member.left', id: ME, name: userOf(d, ME).name });
    return out();
  }
  if (p[2] === 'invite') {
    if (p[3] === 'rotate') t.invite = newToken();
    else t.invite ||= newToken();
    return out({ url: shareURL(t.invite) });
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
  // Want to go: written whole, in the order they're saved (a place saved again goes to the end, as the server keeps them)
  if (p[2] === 'ideas' && p[3]) {
    t.ideas ||= [];
    const i = t.ideas.findIndex(x => x.id === p[3]);
    if (method === 'DELETE') {
      if (i < 0) return out();
      const [gone] = t.ideas.splice(i, 1);
      touch();
      broadcast(t.id, { type: 'idea.removed', id: gone.id, name: gone.name });
      return out();
    }
    if (method !== 'PUT') fail(404, 'not_found');
    if (!body?.name?.trim() || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) fail(400, 'invalid');
    const { name, address = '', lat, lng, note = '', kind = '', links = [], wikidata = null } = body;
    const idea = { id: p[3], name: name.trim(), address, lat, lng, note, kind, links, wikidata, by: ME, updatedAt: now };
    if (i >= 0) t.ideas.splice(i, 1);
    t.ideas.push(idea);
    touch();
    broadcast(t.id, { type: 'idea.upserted', idea });
    return out(idea);
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
async function findRoute(from, to, mode) {
  const [a, b] = [from, to].map(x => { const [lat, lng] = x.split(',').map(Number); return { lat, lng }; });
  const j = await fetchJSON(osrmURL(mode, a, b));
  try { return osrmRoute(j); } catch { throw new ApiError(502, 'unavailable'); }
}
async function searchPlaces(text, near, signal) {
  const at = near && near.split(',').map(Number);
  return nominatimPlaces(await fetchJSON(nominatimURL(text, at && { lat: at[0], lng: at[1] }), signal));
}
// What's worth seeing in a map tile, straight from OpenStreetMap's Overpass API, asked as the app's server asks it (see
// app/web/places.js): the same servers, query, kinds and ranks. The app keeps each tile for the visit.
async function findSights(tile, signal) {
  const [, x, y] = (tile || '').split('/').map(Number);
  // Both servers at once, the first good answer, each given a minute, as the app's server asks them
  const q = sightsQuery(tileBounds(x, y), 60);
  const done = new AbortController();
  let offline = false;
  const ask = async url => {
    try {
      const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.any([done.signal, AbortSignal.timeout(75000), ...(signal ? [signal] : [])]) });
      if (!res.ok) throw new Error(res.status);
      const got = await res.json();
      if (/error/i.test(got.remark || '')) throw new Error(got.remark);
      return got.elements;
    } catch (e) { if (e.name === 'TypeError') offline = true; throw e; }
  };
  let elements;
  try { elements = await Promise.any(OVERPASS.map(ask)); } catch {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    throw new ApiError(offline ? 0 : 503, offline ? 'offline' : 'unavailable');
  } finally { done.abort(); }
  return sightsFrom(elements);
}
// In trip settings: links to try co-editing as someone else, and to preview a trip day
export function settingsNoteHTML(trip) {
  const base = location.origin + location.pathname, token = inviteToken(trip.id), first = stopsOf(trip)[0];
  const others = Object.values(USERS).filter(u => u.id !== ME);
  return `<div class="proto-note"><b>Prototype:</b> try co-editing: open this trip
    ${others.map(u => `<a href="${base}?as=${u.id}#/join/${token}" target="_blank">as ${u.name}</a>`).join(' or ')} in another tab.
    ${first ? `Trip days highlight what's happening now: <a href="${base}?today=${dayOf(first)}&now=14:10#/trip/${trip.id}">preview day 1 at 2:10 PM</a>.` : ''}</div>`;
}

// ---------- Spots: a few sample places in place of the guide's (the app's come from the spots data, pipeline/guides.py) ----------
// Written for the prototype, and the views are made up, roughly in proportion; each searches, sorts and filters as the app's
// /api/spots does. Their photos are the lead photos of their Wikipedia articles, found by name and place as Home's
// cards find a stop's (see findPlaceAbout), once a visit; with none (offline, or in the tests), the card shows a pin.
const SPOT_CITIES = [
  { id: 'seattle', name: 'Seattle', state: 'WA', country: 'US' },
  { id: 'alamogordo', name: 'Alamogordo', state: 'NM', country: 'US' },
  { id: 'vancouver', name: 'Vancouver', state: 'BC', country: 'CA' },
];
const wiki = title => `https://en.wikipedia.org/wiki/${title}`;
const spot = (city, id, rank, name, lat, lng, views, oneLiner, paragraphs, practical = [], website = null) =>
  ({ city, source: 'sample', id, rank, name, lat, lng, views, oneLiner, website, practical,
    paragraphs: paragraphs.map(text => ({ text, sources: [wiki(name.replace(/ /g, '_'))] })), sources: [{ url: wiki(name.replace(/ /g, '_')), kind: 'wikipedia' }] });
const SPOTS = [
  spot('seattle', 'space-needle', 2, 'Space Needle', 47.6205, -122.3493, 1900000,
    'The 1962 World’s Fair tower, with the city, the Sound and Mount Rainier at your feet.',
    ['Built for the 1962 World’s Fair, the Space Needle rises 605 feet over Seattle Center. A lift takes you up to the observation level in under a minute.',
      'Up top, the views take in downtown, Elliott Bay and, on a clear day, Mount Rainier. The level below has a glass floor that turns.'],
    [{ label: 'Getting there', value: 'Seattle Center, a short ride on the Monorail from Westlake Center.' }], 'https://www.spaceneedle.com/'),
  spot('seattle', 'pike-place-market', 1, 'Pike Place Market', 47.6097, -122.3422, 1400000,
    'Fish, flowers and farm stalls over the waterfront, since 1907.',
    ['Pike Place Market opened in 1907, and is one of the oldest public farmers’ markets in the US still running. Its stalls sell produce, flowers, crafts and seafood.',
      'Come early to see it wake up, then take the stairs at the back down to the waterfront.']),
  spot('seattle', 'chihuly-garden-and-glass', 3, 'Chihuly Garden and Glass', 47.6206, -122.3504, 420000,
    'Dale Chihuly’s glass, in galleries, a glasshouse and a garden under the Space Needle.',
    ['Opened in 2012 beside the Space Needle, the museum shows the work of Dale Chihuly, a glass artist from nearby Tacoma.',
      'The Glasshouse, a tall hall of glass, holds one of his largest hanging pieces; outside, glass grows among the plants.']),
  spot('seattle', 'discovery-park', 4, 'Discovery Park', 47.6573, -122.4057, 160000,
    'Seattle’s biggest park: meadows, forest and beaches on a headland over Puget Sound.',
    ['Discovery Park covers 534 acres of the Magnolia headland, on what was Fort Lawton.',
      'A loop trail runs through forest and meadow, and a path drops to the beach and the West Point Lighthouse.']),
  spot('alamogordo', 'white-sands', 1, 'White Sands National Park', 32.7872, -106.3257, 900000,
    'Waves of white gypsum, the largest field of such dunes on Earth.',
    ['White Sands holds the world’s largest gypsum dunefield: about 275 square miles of white sand in the Tularosa Basin. It became a national park in 2019.',
      'Dunes Drive runs eight miles into the dunes, with boardwalks and trails along the way. Bring a sled: the slopes are made for it.'],
    [{ label: 'Bring', value: 'Water, sun protection and a sled (the visitor center sells them).' }]),
  spot('alamogordo', 'museum-of-space-history', 2, 'New Mexico Museum of Space History', 32.9214, -105.9213, 60000,
    'A golden cube on the hillside, home to the International Space Hall of Fame.',
    ['The museum looks out over Alamogordo from a five-story cube of golden glass, and holds the International Space Hall of Fame.',
      'Rockets stand in the park outside, and the exhibits tell of the rocket and space research done around White Sands.']),
  spot('vancouver', 'stanley-park', 1, 'Stanley Park', 49.3043, -123.1443, 700000,
    'A forest at the edge of downtown, ringed by the seawall.',
    ['Stanley Park covers about 400 hectares at the tip of the downtown peninsula, most of it forest.',
      'The seawall around it is about 9 km of path for walking and cycling, past beaches, totem poles and views of the North Shore mountains.']),
];
const heroes = new Map(); // spot id → Promise of its photo, or null
const heroOf = p => {
  if (!heroes.has(p.id)) {
    heroes.set(p.id, Promise.race([
      findPlaceAbout(p.name, `${p.lat},${p.lng}`).then(a => a?.image ? { thumb: a.image.src, width: a.image.width, height: a.image.height,
        author: a.image.credit, licence: a.image.license, page: a.image.page, caption: a.title } : null),
      new Promise(r => setTimeout(r, 5000, null)),
    ]).catch(() => null));
  }
  return heroes.get(p.id);
};
const cityOf = p => SPOT_CITIES.find(c => c.id === p.city);
async function spots([a, b, ...rest], q) {
  if (a === 'cities') return SPOT_CITIES.map(c => ({ ...c, spots: SPOTS.filter(p => p.city === c.id).length }));
  if (a === 'search') {
    const text = (q.get('q') || '').trim().toLowerCase(), offset = Number(q.get('offset') || 0), limit = Number(q.get('limit') || 50);
    const regions = regionsMatching(text);
    const hits = SPOTS.filter(p => {
      const c = cityOf(p);
      return (!text || [p.name, p.oneLiner, c.name].some(x => x.toLowerCase().includes(text)) || regions.includes(`${c.country}-${c.state}`))
        && (!q.get('country') || c.country === q.get('country')) && (!q.get('state') || c.state === q.get('state')) && (!q.get('city') || c.id === q.get('city'));
    }).sort((x, y) => (q.get('city') ? x.rank - y.rank : 0) || y.views - x.views || x.rank - y.rank || x.name.localeCompare(y.name));
    const page = hits.slice(offset, offset + limit);
    const photos = await Promise.all(page.map(heroOf));
    return { results: page.map((p, i) => { const c = cityOf(p); return { source: p.source, id: p.id, name: p.name, oneLiner: p.oneLiner, hero: photos[i],
      rank: p.rank, city: { id: c.id, name: c.name }, state: c.state, country: c.country, views: p.views }; }), total: hits.length, more: hits.length > offset + limit };
  }
  const p = SPOTS.find(x => x.city === a && x.source === b && x.id === rest.join('/'));
  if (!p) throw new ApiError(404, 'not_found');
  const c = cityOf(p);
  return { destination: { ...c }, source: p.source, id: p.id, state: c.state, name: p.name, rank: p.rank, reason: null, oneLiner: p.oneLiner,
    paragraphs: p.paragraphs, practical: p.practical, sources: p.sources, images: { hero: await heroOf(p), inline: [] }, overlap: null,
    lat: p.lat, lng: p.lng, url: null, wikipedia: p.name, website: p.website, views: p.views, model: null, prompt: null, createdAt: null, license: 'CC BY-SA 4.0' };
}

// ---------- Live edits: the other open tabs' changes come over the BroadcastChannel (see api), as the server's events would ----------
let live = null;
export function connectLive(id) { live = id; }
export function disconnectLive() { live = null; }
if (bc) bc.onmessage = ({ data: m }) => { if (m.trip === live) onEvent(m); };

// ---------- Session: no sign-in. Someone is always signed in (see USERS), and Sign out says how to be someone else ----------
export function signOut() { toast({ title: 'The prototype has no sign-in', detail: 'To be Sam or Jo, add ?as=sam or ?as=jo to the address.' }); }
