/* The prototype's backend: the same exports as app/web/backend.js, answered in the browser. index.html's import map
   puts this file in place of that one, so the prototype runs the app's own modules with no server.
   Trips are saved in localStorage, so they're in this browser only, and a BroadcastChannel carries each change to the
   other open tabs as the server's live events would, so two tabs work like two people on the trip. */
import { ApiError, params, ROUTE_KEY, uid } from '../app/web/core.js';
import { QID } from '../app/web/fields.js';
import { dayOf, stopsOf } from '../app/web/plan.js';
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
const snapshotOf = (d, t) => ({ trip: { id: t.id, name: t.name, owner: t.createdBy }, members: t.members.filter(u => USERS[u]).map(u => userOf(d, u)), stops: t.spots });
const shareURL = token => `${location.origin}${location.pathname}#/join/${token}`;
const newToken = () => uid() + uid();
function inviteToken(tripId) {
  const d = loadDB(), t = d.trips[tripId];
  if (!t) return '';
  if (!t.invite) { t.invite = newToken(); storeDB(d); }
  return t.invite;
}
// A sight's photo and a few lines about it, straight from Wikidata, English Wikipedia and Wikimedia Commons, as the
// app's server asks them (see wikiAbout in app/src/maps.ts): null when there's no article. The app keeps each for the visit.
const wikiGet = async (host, params, signal) => {
  let res;
  try {
    res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params })}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
  } catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError(e.name === 'TimeoutError' ? 503 : 0, e.name === 'TimeoutError' ? 'unavailable' : 'offline'); }
  if (!res.ok) throw new ApiError(503, 'unavailable');
  return res.json();
};
// A place with no Wikidata item, by its name and where it is: the article Wikipedia's search puts first whose title
// is its name (or starts it) and whose place is within 50 km, as the app's server finds it (see wikiPlace in app/src/maps.ts)
const placeKey = n => n.replace(/\s*\([^)]*\)/g, '').replace(/,.*$/, '').replace(/^\s*the\s+/i, '').replace(/\bsaint\b/gi, 'st')
  .normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const kmBetween = (a, b) => {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371;
};
async function findPlaceAbout(name, where, signal) {
  const [lat, lng] = (where || '').split(',').map(Number), n = placeKey(name || '');
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) throw new ApiError(400, 'invalid');
  if (n.length < 4) return null;
  const pages = (await wikiGet('en.wikipedia.org', {
    action: 'query', generator: 'search', gsrsearch: name, gsrnamespace: '0', gsrlimit: '5', prop: 'coordinates|pageprops', ppprop: 'wikibase_item|disambiguation',
  }, signal)).query?.pages ?? [];
  const page = pages.sort((a, b) => a.index - b.index).find(p => {
    const t = placeKey(p.title), c = p.coordinates?.[0];
    return (t === n || (t.length >= 8 && n.startsWith(t))) && c && kmBetween({ lat, lng }, { lat: c.lat, lng: c.lon }) <= 50
      && p.pageprops?.disambiguation === undefined && QID.test(p.pageprops?.wikibase_item || '');
  });
  return page ? findAbout(page.pageprops.wikibase_item, signal) : null;
}
async function findAbout(qid, signal) {
  if (!QID.test(qid || '')) throw new ApiError(400, 'invalid');
  const get = (host, params) => wikiGet(host, params, signal);
  const item = await get('www.wikidata.org', { action: 'wbgetentities', ids: qid, props: 'sitelinks', sitefilter: 'enwiki' });
  const title = item.entities?.[qid]?.sitelinks?.enwiki?.title;
  if (!title) return null;
  const page = (await get('en.wikipedia.org', {
    action: 'query', titles: title, redirects: '1', prop: 'extracts|pageimages|info|pageprops',
    exintro: '1', explaintext: '1', exsentences: '3', piprop: 'name', pilicense: 'free', inprop: 'url', ppprop: 'disambiguation',
  })).query?.pages?.[0];
  const text = (page?.extract ?? '').replace(/\s+/g, ' ').trim();
  if (!page || page.missing || page.pageprops?.disambiguation !== undefined || !text) return null;
  let image = null;
  if (page.pageimage && !/\.svg$/i.test(page.pageimage)) {
    const info = (await get('commons.wikimedia.org', {
      action: 'query', titles: `File:${page.pageimage}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '960',
      iiextmetadatafilter: 'Artist|LicenseShortName',
    })).query?.pages?.[0]?.imageinfo?.[0];
    const meta = info?.extmetadata ?? {}, license = plainText(meta.LicenseShortName?.value ?? '');
    if (info?.thumburl && license) image = {
      src: info.thumburl, width: info.thumbwidth, height: info.thumbheight, license, page: info.descriptionurl,
      credit: plainText(meta.Artist?.value ?? '').slice(0, 100),
    };
  }
  return { title: page.title, text: text.slice(0, 1200), url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`, image };
}
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const plainText = html => html.replace(/<[^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENTITIES[e]).replace(/\s+/g, ' ').trim();
const bc = 'BroadcastChannel' in window ? new BroadcastChannel('waythread') : null;
const broadcast = (trip, m) => bc?.postMessage({ trip, ...m, by: ME });

export async function api(path, { method = 'GET', body, signal } = {}) {
  const [route, query = ''] = path.split('?'), q = new URLSearchParams(query);
  // With no connection the app can't reach its server, so here the trips can't be reached either: turn the network off
  // (DevTools → Network → Offline) to try a trip saved for offline. Who you are still answers, as there's no sign-in.
  if (!navigator.onLine && route !== '/me' && route !== '/config') throw new ApiError(0, 'offline');
  if (route === '/route') return osrmRoute(q.get('from'), q.get('to'), q.get('mode') || 'drive');
  if (route === '/places') return searchPlaces(q.get('q'), q.get('near'), signal);
  if (route === '/sights') return findSights(q.get('tile'), signal);
  if (route === '/about') return q.has('id') ? findAbout(q.get('id'), signal) : findPlaceAbout(q.get('name'), q.get('at'), signal);
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
// The OSRM demo server only drives; OpenStreetMap Germany's runs the same API on foot and by bike (as openstreetmap.org's
// directions call it: the profile in the path is always driving, the server decides)
const OSRM = {
  drive: 'https://router.project-osrm.org/route/v1/driving',
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
};
async function osrmRoute(from, to, mode) {
  const [a, b] = [from, to].map(x => x.split(',').map(Number)); // lat,lng
  const j = await fetchJSON(`${OSRM[mode]}/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`);
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
// What's worth seeing in a map tile, straight from OpenStreetMap's Overpass API, as the app's server asks it (see
// findSights in app/src/maps.ts): the same servers, query, kinds and ranks. The app keeps each tile for the visit.
const SIGHT_QUERY = [
  'nw[tourism~"^(attraction|museum|gallery|viewpoint|zoo|theme_park|aquarium)$"][name]',
  'nw[historic~"^(castle|palace|fort|monument|archaeological_site|ruins|ship|city_gate)$"][name]',
  'nw[historic=memorial][name][wikidata]',
  'nw[natural~"^(peak|volcano|beach|bay|cave_entrance|arch|cliff|hot_spring|geyser|glacier)$"][name][wikidata]',
  'nw[waterway=waterfall][name]',
  'nwr[leisure~"^(park|garden|nature_reserve)$"][name][wikidata]',
  'rel[boundary~"^(national_park|protected_area)$"][name][wikidata]',
  'nw[man_made=lighthouse][name]',
  'nw[amenity=place_of_worship][name][wikipedia]',
  'nw[tourism=information][information~"^(office|visitor_centre)$"][name]',
  'node[highway=trailhead][name]',
];
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
function sightKind(t) {
  const tourism = t.tourism, historic = t.historic;
  if (tourism === 'museum') return { kind: 'museum', worth: 3 };
  if (tourism === 'gallery') return { kind: 'museum', worth: 2 };
  if (tourism === 'viewpoint') return { kind: 'viewpoint', worth: 2 };
  if (/^(attraction|zoo|theme_park|aquarium)$/.test(tourism)) return { kind: 'attraction', worth: 3 };
  if (t.boundary === 'national_park' || t.protected_area === 'national_park' || (t.boundary === 'protected_area' && t.protect_class === '2')) return { kind: 'nature', worth: 3 };
  if (/^(castle|palace|fort)$/.test(historic)) return { kind: 'attraction', worth: 3 };
  if (/^(monument|archaeological_site|ship|city_gate)$/.test(historic)) return { kind: 'attraction', worth: 2 };
  if (t.waterway === 'waterfall' || t.natural) return { kind: 'nature', worth: 2 };
  if (t.leisure || t.boundary) return { kind: 'nature', worth: 1 };
  if (historic || t.man_made === 'lighthouse' || t.amenity === 'place_of_worship') return { kind: 'attraction', worth: 1 };
  if (tourism === 'information') return { kind: 'attraction', worth: 1 };
  if (t.highway === 'trailhead') return { kind: 'nature', worth: 1 };
  return null;
}
async function findSights(tile, signal) {
  const [z, x, y] = (tile || '').split('/').map(Number), n = 2 ** z;
  const lng = i => (i / n) * 360 - 180, lat = j => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  // Both servers at once, the first good answer, each given a minute, as the app's server asks them
  const q = `[out:json][timeout:60][bbox:${lat(y + 1)},${lng(x)},${lat(y)},${lng(x + 1)}];(${SIGHT_QUERY.join(';')};);out center tags qt;`;
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
  const out = [];
  for (const el of elements) {
    const t = el.tags || {}, at = el.center || (el.lat != null ? { lat: el.lat, lon: el.lon } : null), what = sightKind(t);
    if (!t.name || !at || !what) continue;
    out.push({
      id: `${el.type[0]}${el.id}`, wikidata: QID.test(t.wikidata || '') ? t.wikidata : undefined, name: t.name, lat: +at.lat.toFixed(5), lng: +at.lon.toFixed(5), kind: what.kind,
      rank: what.worth + (t.wikipedia ? 4 : t.wikidata ? 2 : 0) + (el.type === 'node' ? 0 : 1),
      address: [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', '),
    });
  }
  out.sort((a, b) => b.rank - a.rank);
  const kept = [], names = new Set(), items = new Set();
  for (const sg of out) {
    if (names.has(sg.name) || (sg.wikidata && items.has(sg.wikidata))) continue;
    names.add(sg.name);
    if (sg.wikidata) items.add(sg.wikidata);
    else delete sg.wikidata;
    kept.push(sg);
    if (kept.length === 80) break;
  }
  return kept;
}
// In trip settings: links to try co-editing as someone else, and to preview a trip day
export function settingsNoteHTML(trip) {
  const base = location.origin + location.pathname, token = inviteToken(trip.id), first = stopsOf(trip)[0];
  const others = Object.values(USERS).filter(u => u.id !== ME);
  return `<div class="proto-note"><b>Prototype:</b> try co-editing: open this trip
    ${others.map(u => `<a href="${base}?as=${u.id}#/join/${token}" target="_blank">as ${u.name}</a>`).join(' or ')} in another tab.
    ${first ? `Trip days highlight what's happening now: <a href="${base}?today=${dayOf(first)}&now=14:10#/trip/${trip.id}">preview day 1 at 2:10 PM</a>.` : ''}</div>`;
}

// ---------- Live edits: the other open tabs' changes come over the BroadcastChannel (see api), as the server's events would ----------
let live = null;
export function connectLive(id) { live = id; }
export function disconnectLive() { live = null; }
if (bc) bc.onmessage = ({ data: m }) => { if (m.trip === live) onEvent(m); };

// ---------- Session: no sign-in. Someone is always signed in (see USERS), and Sign out says how to be someone else ----------
export function signOut() { toast({ title: 'The prototype has no sign-in', detail: 'To be Sam or Jo, add ?as=sam or ?as=jo to the address.' }); }
