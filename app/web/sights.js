/* Sights: what's worth seeing nearby once the map is zoomed in, and a sight's card. */
import { $app, ICON, esc, state } from './core.js';
import { cur } from './trips.js';
import { api } from './backend.js';
import { IDEAS, KINDS, ideasOf, kindColor, kindIcon, samePlace } from './plan.js';
import { needsConnection, offlineNow } from './offline.js';
import { addMarker, focusStop, map, mapSize, mapZoom, onMapTap, pins, routeCells, sightsShown, toScreen, viewBounds } from './map.js';
import { latLng, tileOf } from './geo.js';
import { coveredBottom, coveredTop, inView } from './sheet.js';
import { closeSheet, modalHead, openSheet } from './sheets.js';
import { addIdea } from './edits.js';
import { currentDay } from './timeline.js';
import { ON_THE_WAY_KM, kmOff, kmPerDeg, openStopSheet } from './stopsheet.js';

// ---------- Sights: what's worth seeing nearby, once the map is zoomed in ----------
// As a maps app shows its places: zoomed in to a town or closer, the map marks the best known attractions, museums,
// viewpoints and nature in view, each a small marker tinted with its type's color, with its icon and no name: the map's
// own names stay readable, and a tap says the rest. They're part of the map, not the plan, so they give way to it: they
// sit over the map's names but under the trip's pins, and none goes on a pin or on a route, so the day's line runs
// unbroken from stop to stop. Tapping one opens its card (see openSight). Places already on the trip aren't repeated.
// None while a stop is open, nor offline. They come from /api/sights a tile at a time (zoom 12), kept for the visit.
const SIGHTS_FROM_ZOOM = 12;
const SIGHT_TILE_ZOOM = 12;
const SIGHTS_MAX = 12; // in view at once, at most, so they never crowd out the plan
const SIGHT_GAP = 4; // px between two sights' markers, and around the trip's pins
const SIGHT_R = 11; // px, a sight's marker's radius
const SIGHT_ROUTE_CELL = 6; // px, the grid a route's cells are counted in: a sight keeps a cell or so off the line
// A Map that keeps only the `max` entries used last: get() and set() make an entry the newest, and set() drops the
// oldest past `max`. For what the map loads as you move it around, which would otherwise grow for as long as the page is open.
class Recent extends Map {
  constructor(max) { super(); this.max = max; }
  get(k) {
    if (!super.has(k)) return undefined;
    const v = super.get(k);
    super.delete(k);
    super.set(k, v);
    return v;
  }
  set(k, v) {
    super.delete(k);
    super.set(k, v);
    while (this.size > this.max) super.delete(this.keys().next().value);
    return this;
  }
}
const sightTiles = new Recent(200); // "x/y" → its sights; a promise while it loads; { retry } after it failed, until then
let sightsPausedUntil = 0; // after the server says too many, until then
function loadSightTile(k) {
  const t = sightTiles.get(k);
  if (t && !(t.retry && Date.now() > t.retry)) return;
  if (Date.now() < sightsPausedUntil) return;
  sightTiles.set(k, api(`/sights?tile=${SIGHT_TILE_ZOOM}/${k}`).then(list => {
    // Still being looked up (Overpass can take half a minute or more for a tile no one has looked at yet): ask again in a
    // while, not so often that it uses up the per-person limit search and routes share
    if (!Array.isArray(list)) { sightTiles.set(k, { retry: Date.now() + 8000 }); setTimeout(drawSights, 8500); return; }
    sightTiles.set(k, list);
    drawSights();
  }, err => {
    if (err?.code === 'rate_limited') sightsPausedUntil = Date.now() + 60000;
    sightTiles.set(k, { retry: Date.now() + 30000 });
  }));
}
export function drawSights() {
  if (!map) return;
  const trip = cur?.stops ? cur : null, z = mapZoom();
  const show = new Map();
  if (trip && !state.draft && !offlineNow() && z >= SIGHTS_FROM_ZOOM - 0.01) {
    // The tiles under the view
    const view = viewBounds(), found = new Map();
    const lo = tileOf({ lat: view.north, lng: view.west }, SIGHT_TILE_ZOOM), hi = tileOf({ lat: view.south, lng: view.east }, SIGHT_TILE_ZOOM);
    for (let y = lo.y; y <= hi.y; y++) {
      for (let x = lo.x; x <= hi.x; x++) {
        const k = `${x}/${y}`, list = sightTiles.get(k);
        if (Array.isArray(list)) for (const s of list) found.set(s.id, s); else loadSightTile(k);
      }
    }
    // The best known first, each where it fits: in the part of the map you can see, clear of the trip's pins, its routes
    // and the sights already placed. Its box is its marker.
    const size = mapSize(), top = coveredTop(), bottom = size.y - coveredBottom();
    const taken = pins.filter(p => !p.hidden).map(p => { const c = toScreen(p.ll), r = p.r + SIGHT_GAP; return [c.x - r, c.y - r, c.x + r, c.y + r]; });
    const onTrip = s => sightOnTrip(trip, s);
    const overlaps = (a, c) => a[0] < c[2] && c[0] < a[2] && a[1] < c[3] && c[1] < a[3];
    const onRoutes = routeCells(SIGHT_ROUTE_CELL), G = SIGHT_ROUTE_CELL;
    const onRoute = b => {
      for (let y = Math.floor(b[1] / G); y <= Math.floor(b[3] / G); y++) for (let x = Math.floor(b[0] / G); x <= Math.floor(b[2] / G); x++) if (onRoutes.has(`${x},${y}`)) return true;
      return false;
    };
    for (const s of [...found.values()].sort((a, c) => c.rank - a.rank || a.id.localeCompare(c.id))) {
      const p = toScreen(s);
      if (p.x < 0 || p.x > size.x || p.y < top || p.y > bottom || onTrip(s)) continue;
      const r = SIGHT_R + SIGHT_GAP / 2, box = [p.x - r, p.y - r, p.x + r, p.y + r];
      if (taken.some(t => overlaps(t, box)) || onRoute(box)) continue;
      taken.push(box);
      show.set(s.id, s);
      if (show.size === SIGHTS_MAX) break;
    }
  }
  // Only what changed, so the sights still in view stay put as the map moves
  for (const [id, m] of sightsShown) if (!show.has(id)) { m.remove(); sightsShown.delete(id); }
  for (const [id, s] of show) {
    if (sightsShown.has(id)) continue;
    // over the map's names, behind the trip's pins (see PIN_Z)
    const m = addMarker(s, { html: sightHTML(s), z: 1, label: `${s.name}, ${KINDS[s.kind].label}. Show more`, tap: () => onMapTap(() => openSight(s)) });
    m.getElement().classList.add('wt-sight-marker');
    sightsShown.set(id, m);
  }
}
const sightHTML = s => `<div class="wt-sight${s.id === sightOpen?.id ? ' is-selected' : ''}" style="--wt-kind-color: ${kindColor(s)}"><i class="wt-sight__marker">${kindIcon(s, 12)}</i><span class="wt-sight__name">${esc(s.name)}</span></div>`;
// Add stop, with the sight as its place and type
function addSight(s) {
  const trip = cur?.stops ? cur : null;
  if (!trip || state.draft || !needsConnection()) return;
  openStopSheet(trip, null, { name: s.name, address: s.address, lat: s.lat, lng: s.lng, kind: s.kind, ...(s.wikidata && { wikidata: s.wikidata }) });
}

// Saved for later, on Want to go: the card closes and the day on screen stays as it is (on Want to go, the place is selected)
function saveSight(s) {
  const trip = cur?.stops ? cur : null;
  if (!trip || state.draft || !needsConnection()) return;
  closeSheet();
  addIdea(trip, { name: s.name, address: s.address || '', lat: s.lat, lng: s.lng, kind: s.kind, wikidata: s.wikidata || null }, { select: currentDay(trip) === IDEAS });
}

// The sight at a place, with its Wikidata item, for a stop that has none (found by search, or added by an assistant):
// the same name nearby (2 km or so: a park's sight is its middle), or one name inside the other right at the place
// (100 m or so: "Museum of Art" for "New Mexico Museum of Art"). From the sights of the place's tile, loaded if they
// aren't yet; null for none, or offline before they were loaded.
// A sight that's already one of the trip's stops: at its place, or with its name close by
const sightOnTrip = (trip, s) => trip.stops.some(t => (Math.abs(t.lat - s.lat) < 0.001 && Math.abs(t.lng - s.lng) < 0.0013)
  || (t.name.toLowerCase() === s.name.toLowerCase() && Math.abs(t.lat - s.lat) < 0.02 && Math.abs(t.lng - s.lng) < 0.025));

// What place search suggests before anything's typed: sights on the way (see wayAround), within ON_THE_WAY_KM of it
// and not on the trip yet: the ALONG_PICK best known, then the nearest to where you'd be (`way.from`) first, so what's
// around you comes before what's at the other end of the drive. From the sights' tiles along the way, loaded if they aren't yet: at most
// ALONG_TILES of them, spread along a long drive, so a day's drive can't use up the per-person limit. `waiting` while
// some are still loading (or the route is still being looked up), so the page asks again.
const ALONG_TILES = 16, ALONG_PICK = 16, ALONG_MAX = 8;
export function sightsAlong(trip, way) {
  if (offlineNow()) return { list: [], waiting: false };
  const keys = new Set();
  for (const [lat, lng] of way.line) {
    const [kx, ky] = kmPerDeg(lat), dLat = ON_THE_WAY_KM / ky, dLng = ON_THE_WAY_KM / kx;
    for (const y of [-dLat, 0, dLat]) for (const x of [-dLng, 0, dLng]) {
      const t = tileOf({ lat: lat + y, lng: lng + x }, SIGHT_TILE_ZOOM);
      keys.add(`${t.x}/${t.y}`);
    }
  }
  let tiles = [...keys];
  if (tiles.length > ALONG_TILES) tiles = Array.from({ length: ALONG_TILES }, (_, i) => tiles[Math.round(i * (tiles.length - 1) / (ALONG_TILES - 1))]);
  const found = new Map();
  let waiting = !way.routed;
  for (const k of tiles) {
    loadSightTile(k);
    const list = sightTiles.get(k);
    if (Array.isArray(list)) for (const s of list) found.set(s.id, s); else waiting = true;
  }
  const list = [...found.values()].filter(s => !sightOnTrip(trip, s) && kmOff(s, way.line) <= ON_THE_WAY_KM)
    .sort((a, c) => c.rank - a.rank || a.id.localeCompare(c.id)).slice(0, ALONG_PICK);
  const here = [[+way.from.lat, +way.from.lng]];
  list.sort((a, c) => kmOff(a, here) - kmOff(c, here));
  return { list: list.slice(0, ALONG_MAX), waiting };
}

const plainName = n => (n || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function sightAt(p) {
  const t = tileOf(latLng({ lat: +p.lat, lng: +p.lng }), SIGHT_TILE_ZOOM), k = `${t.x}/${t.y}`;
  if (!offlineNow()) loadSightTile(k);
  const now = sightTiles.get(k);
  return Promise.resolve(now instanceof Promise ? now : null).then(() => {
    const list = sightTiles.get(k), name = plainName(p.name);
    if (!Array.isArray(list) || name.length < 3) return null;
    const near = (s, d) => Math.abs(s.lat - p.lat) < d && Math.abs(s.lng - p.lng) < d * 1.25;
    const named = list.filter(s => s.wikidata && plainName(s.name).length >= 3);
    return named.find(s => plainName(s.name) === name && near(s, 0.02))
      || named.find(s => near(s, 0.001) && (plainName(s.name).includes(name) || name.includes(plainName(s.name)))) || null;
  });
}

// ---------- A sight's card: what it is, before you add it ----------
// Tapping a sight opens its card, as a maps app does: its name and type, then, when OpenStreetMap knows its Wikidata
// item, a photo and the first lines of its English Wikipedia article (from /api/about), with who took the photo and
// a link to the article. Add to trip opens Add stop with the place filled in. It's a panel, like the stop sheet, so the
// map stays in view with the sight marked; tapping empty map closes it. A stop added from a sight keeps its Wikidata
// item, and its own sheet shows the same lines (see aboutHTML).
export let sightOpen = null; // the sight whose card is open
export const abouts = new Recent(300); // Wikidata item (or "name@lat,lng") → what /api/about said (null for nothing), or a promise while it loads
// By its Wikidata item, or for a place with none, "name@lat,lng" (a Home card's photos)
export function loadAbout(qid) {
  if (abouts.has(qid)) return Promise.resolve(abouts.get(qid));
  if (offlineNow()) return Promise.resolve(null);
  const at = qid.lastIndexOf('@');
  const p = api(at < 0 ? `/about?id=${encodeURIComponent(qid)}` : `/about?name=${encodeURIComponent(qid.slice(0, at))}&at=${qid.slice(at + 1)}`).then(a => { abouts.set(qid, a); return a; }, () => { abouts.delete(qid); return null; });
  abouts.set(qid, p);
  return p;
}
export const photoCredit = img => `Photo: ${img.credit ? `${img.credit} · ` : ''}${img.license}`;
// A photo, the article's first lines and where they're from; `compact` puts a small photo beside them (a stop's sheet).
// Before it has loaded, grey blocks hold its place.
export function aboutHTML(a, compact) {
  const cls = `wt-about${compact ? ' wt-about--compact' : ''}`;
  if (a === undefined) return `<div class="${cls} wt-about--loading" aria-hidden="true"><span class="wt-about__photo"></span><span class="wt-about__body"><span class="wt-about__line"></span><span class="wt-about__line"></span><span class="wt-about__line"></span></span></div>`;
  const img = a.image, credit = img && photoCredit(img);
  return `<div class="${cls}">${img ? `<img class="wt-about__photo" src="${esc(img.src)}" alt="" width="${+img.width || ''}" height="${+img.height || ''}" loading="lazy">` : ''}
    <div class="wt-about__body"><p class="wt-about__text">${esc(a.text)}</p>
    <div class="wt-about__src">${img ? `<a class="wt-about__credit" href="${esc(img.page)}" target="_blank" rel="noopener" title="${esc(credit)}">${esc(credit)}</a>` : ''}<a class="wt-about__more" href="${esc(a.url)}" target="_blank" rel="noopener">Wikipedia${ICON.external}</a></div></div></div>`;
}
// What a sheet starts with for a Wikidata item: what's known already, grey blocks while it loads, or nothing (none, or
// offline before it ever loaded). showAbout then fills the blocks in.
export function aboutSlot(qid, compact) {
  const known = qid ? abouts.get(qid) : null;
  if (known === null || (known === undefined && (!qid || offlineNow()))) return '';
  return aboutHTML(known instanceof Promise ? undefined : known, compact);
}
// Fills a placeholder from aboutHTML once the lines arrive; with nothing to say, it goes
export function showAbout(box, qid, compact) {
  const done = a => { if (!box.isConnected) return; if (a) box.outerHTML = aboutHTML(a, compact); else box.remove(); };
  const now = abouts.get(qid);
  if (now !== undefined && !(now instanceof Promise)) done(now); else loadAbout(qid).then(done);
}
function markSight(s) {
  if (sightOpen) sightsShown.get(sightOpen.id)?.getElement()?.querySelector('.wt-sight')?.classList.remove('is-selected');
  sightOpen = s;
  $app.querySelector('.trip')?.classList.toggle('has-card', !!s);
  if (s) sightsShown.get(s.id)?.getElement()?.querySelector('.wt-sight')?.classList.add('is-selected');
}
// Then Save to Want to go, for a place worth going that has no day yet (the main button on Want to go itself), or, once
// it's on the list, a word that it is.
function openSight(s) {
  const trip = cur?.stops ? cur : null;
  if (!trip || state.draft) return;
  const onIdeas = currentDay(trip) === IDEAS, saved = ideasOf(trip).some(i => samePlace(i, s));
  const add = `<button class="wt-btn wt-btn--${onIdeas ? 'secondary' : 'primary'} wt-btn--block" data-add>${ICON.plus}Add to a day</button>`;
  const save = saved ? `<button class="wt-btn wt-btn--secondary wt-btn--block" disabled>${ICON.check}On Want to go</button>`
    : `<button class="wt-btn wt-btn--${onIdeas ? 'primary' : 'secondary'} wt-btn--block" data-save>${ICON.star}Save to Want to go</button>`;
  openSheet(`${modalHead(esc(s.name))}
    <p class="wt-modal__text sight-type"><i class="wt-sight__marker" style="--wt-kind-color: ${kindColor(s)}">${kindIcon(s, 12)}</i>${KINDS[s.kind].label}</p>
    ${aboutSlot(s.wikidata, false)}
    <div class="sight-add">${onIdeas ? save + add : add + save}</div>`, el => {
    el.querySelector('[data-add]').onclick = () => addSight(s);
    const saveBtn = el.querySelector('[data-save]');
    if (saveBtn) saveBtn.onclick = () => saveSight(s);
    const about = el.querySelector('.wt-about--loading');
    if (about) showAbout(about, s.wikidata, false);
  }, { panel: true, onClose: () => { markSight(null); drawSights(); } });
  markSight(s);
  // The sight in the part of the map the card leaves, if it's under it
  requestAnimationFrame(() => { if (sightOpen === s && map && !inView([s.lat, s.lng])) focusStop(s); });
}
