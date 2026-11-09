/* The trip screen's map, drawn by MapLibre: setting it up and tearing it down, the basemap and the routes in it,
   preloading other days, gestures, and the camera and pins. Places are { lat, lng } (or [lat, lng]); MapLibre's own
   [lng, lat] stays in this file, and its sums are in geo.js. */
import { $app, $sheets, ICON, esc, state, token } from './core.js';
import { DEVICE_ZONE, fmtTime, momentOf, zoneName, zoneOf } from './time.js';
import { cur } from './trips.js';
import { ALL, KINDS, TRAVEL, dayOf, dayPlan, kindColor, kindIcon, kindOf, pagesOf, planOn, samePlace, stayOf, stopsOf } from './plan.js';
import { centerFocus, currentDay, isWide, itemsOn, overviewItems, setDay, setSnap, updateFades } from './timeline.js';
import { dropBackgroundRoutes, legRoute, legsOn } from './routes.js';
import { offlineNow, savedTrip, topUpOffline } from './offline.js';
import { render } from './app.js';
import { coveredBottom, coveredTop, inView, onListScroll, setListTop } from './sheet.js';
import { drawSights, sightOpen } from './sights.js';
import { closeSheet } from './sheets.js';
import { boundsOf, frame, latLng, project, tilesUnder, unproject } from './geo.js';
import { ROUTE_HIT, ROUTE_SOURCE, blankStyle, firstLabelLayer, osmStyle, pictureStyle, routeLayers } from './mapstyle.js';

// ---------- Trip screen: map + one day of the plan ----------
export let map = null, fitKey = '';
// Frame the map again on the next draw, as if it had just opened on this view
export const refit = () => { fitKey = ''; };
let camPlaced = false; // the new map has been framed once: its first framing is placed, not flown to
let camTarget = null; // where the camera is flying, and until when
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const MAX_ZOOM = 19;
const toGL = v => { const p = latLng(v); return [p.lng, p.lat]; };
// What the rest of the app asks of the map: its size, zoom and camera, and where a place is on it
export const mapSize = () => { const el = map.getContainer(); return { x: el.clientWidth, y: el.clientHeight }; };
export const mapZoom = () => map.getZoom();
export const toScreen = v => { const p = map.project(toGL(v)); return { x: p.x, y: p.y }; };
export function mapCamera() {
  if (!map) return null;
  const c = map.getCenter();
  return { center: { lat: c.lat, lng: c.lng }, zoom: map.getZoom() };
}
export function viewBounds() {
  const b = map.getBounds();
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}
export const resizeMap = () => map?.resize();

// ---------- Routes on the map ----------
// Drawn by MapLibre in the basemap itself, under its names (see routeLayers in mapstyle.js), from one GeoJSON source.
// Each route: { key, coords: [[lat, lng], …], color, width, casing, casingWidth, dash ('dot', 'dash' or none), top, onClick }.
let routes = [], routesDrawn = '';
const routeFeatures = () => ({
  type: 'FeatureCollection',
  features: routes.map(r => ({
    type: 'Feature',
    properties: { key: r.key, color: r.color, width: r.width, casing: r.casing, casingWidth: r.casingWidth, dash: r.dash || 'solid', top: !!r.top },
    geometry: { type: 'LineString', coordinates: r.coords.map(toGL) },
  })),
});
function setRoutes(list) {
  routes = list;
  const data = routeFeatures(), sig = JSON.stringify(data);
  if (sig === routesDrawn) return;
  const src = map.getSource(ROUTE_SOURCE);
  if (!src) return; // the style is still coming in: addRoutes draws them once it has
  routesDrawn = sig;
  src.setData(data);
}
// Every style the map is given (the blank one it starts with, Stadia's, OpenStreetMap's) gets the routes' layers
function addRoutes() {
  if (!map || map.getSource(ROUTE_SOURCE)) return;
  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: routeFeatures() });
  routesDrawn = JSON.stringify(routeFeatures());
  const before = firstLabelLayer(map.getStyle().layers);
  for (const l of routeLayers()) map.addLayer(l, before);
}
// The cells of a `cell`-pixel grid over the map that a route runs through, as "x,y": so the sights can keep off the
// routes (see drawSights). Each segment in view is walked in steps of half a cell.
export function routeCells(cell) {
  const out = new Set();
  if (!map) return out;
  const size = mapSize(), inView = (x, y) => x > -cell && y > -cell && x < size.x + cell && y < size.y + cell;
  for (const r of routes) {
    const pts = r.coords.map(toScreen);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.max(a.x, b.x) < -cell || Math.min(a.x, b.x) > size.x + cell || Math.max(a.y, b.y) < -cell || Math.min(a.y, b.y) > size.y + cell) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell / 2)));
      for (let k = 0; k <= steps; k++) {
        const x = a.x + ((b.x - a.x) * k) / steps, y = a.y + ((b.y - a.y) * k) / steps;
        if (inView(x, y)) out.add(`${Math.floor(x / cell)},${Math.floor(y / cell)}`);
      }
    }
  }
  return out;
}

// ---------- The basemap ----------
// Stadia's style, drawn by MapLibre from its vector tiles, so the routes can go under its names; OpenStreetMap's pictures
// when Stadia won't serve this site; Stadia's pictures for a trip saved for offline with those. MapLibre loads the first
// time a trip opens. The map's credits live in trip settings rather than over the map.
const CREDIT = {
  stadia: '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  osm: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
};
export let mapCredit = CREDIT.stadia;
// Served with the app (see vendor/README.md), next to this file wherever the page is: the prototype's is in another folder
export const MAPLIBRE = new URL('vendor/maplibre/maplibre-gl.js', import.meta.url).href;
let glLoaded = null;
const loadGL = () => (glLoaded ??= new Promise((done, fail) => {
  if (window.maplibregl) return done();
  const s = document.createElement('script');
  s.src = MAPLIBRE;
  s.onload = done;
  s.onerror = () => { s.remove(); fail(); };
  document.head.append(s);
}).then(() => { maplibregl.addProtocol('wt-shared', sharedFetch); return true; }, () => { glLoaded = null; return false; }));
// MapLibre is a megabyte: Home loads it once it's idle, so the trip opened next draws its map at once
let glPreload = false;
export function preloadMap() {
  if (glPreload) return;
  glPreload = true;
  if (window.requestIdleCallback) requestIdleCallback(loadGL, { timeout: 5000 }); else setTimeout(loadGL, 2000);
}
// MapLibre asks for Stadia's tiles, sprite and fonts through this, from the page rather than from its worker: so the
// service worker answers them for a trip saved for offline, and a tile preloaded for another day (see queueTiles) and
// the same tile asked for by the map share one fetch, and count once against the Stadia plan. Each gets its own copy
// of the bytes, since MapLibre hands them over to its worker. The sprite and fonts asked for are noted, so saving the
// trip for offline saves them.
const glFetches = new Map(), glUsed = new Set();
function sharedFetch({ url, type }) {
  url = url.replace(/^wt-shared:/, 'https:');
  if (!url.endsWith('.pbf') || url.includes('/fonts/')) glUsed.add(url);
  let got = glFetches.get(url);
  if (!got) {
    got = fetch(url).then(r => {
      if (r.status === 401 || r.status === 403) glRefused?.();
      return r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`));
    });
    glFetches.set(url, got);
    got.finally(() => glFetches.delete(url)).catch(() => {}); // after that the browser's cache has it
  }
  return got.then(buf => ({ data: type === 'json' ? JSON.parse(new TextDecoder().decode(buf)) : buf.slice(0) }));
}
const getJSON = url => fetch(url).then(r => (r.ok ? r.json() : null), () => null);
const glStyleURL = dark => `https://tiles.stadiamaps.com/styles/alidade_smooth${dark ? '_dark' : ''}.json`;
export const isGLStyle = url => url.endsWith('.json'); // a saved trip's map: the vector style, or the pictures' address
// A style, ready for MapLibre: { url, style, tiles (the tiles' address), minzoom, maxzoom, fonts, files (what else it reads) }.
// Its tile source's description is read once here, and everything Stadia serves for it goes through sharedFetch.
const glStyles = {};
const glStyle = url => (glStyles[url] ??= getJSON(url).then(async style => {
  const src = Object.values(style?.sources || {}).find(s => s.type === 'vector');
  const tj = src?.url ? await getJSON(src.url) : src;
  if (!tj?.tiles?.length) return null;
  const files = [url, ...(src.url ? [src.url] : [])];
  const shared = u => u.replace(/^https:/, 'wt-shared:');
  Object.assign(src, { tiles: tj.tiles.map(shared), minzoom: tj.minzoom ?? 0, maxzoom: tj.maxzoom ?? 14, attribution: tj.attribution });
  delete src.url;
  if (typeof style.sprite === 'string') style.sprite = shared(style.sprite);
  if (style.glyphs) style.glyphs = shared(style.glyphs);
  const fonts = new Set(style.layers.map(l => l.layout?.['text-font']).filter(f => Array.isArray(f) && f.every(x => typeof x === 'string')).map(f => f.join(',')));
  return { url, style, tiles: tj.tiles[0], minzoom: src.minzoom, maxzoom: src.maxzoom, fonts: [...fonts], files };
}).then(s => { if (!s) delete glStyles[url]; return s; }));
// The vector tiles MapLibre draws a box of the map (pixels at zoom `z`, from `min` to `max`) from: those of the whole
// level at or below the zoom, no closer than the tiles' highest level, where it enlarges them
export function glTileURLs(gs, min, max, z) {
  const k = Math.max(gs.minzoom, Math.min(gs.maxzoom, Math.floor(z)));
  return tilesUnder(min, max, z, k).map(([x, y]) => gs.tiles.replace('{z}', k).replace('{x}', x).replace('{y}', y));
}
// Everything else a style needs to be drawn with no connection: its own files, the sprite, and the fonts for Latin
// names (the alphabet and its accents) and for any other names drawn so far
export function glFiles(gs) {
  const sprite = gs.style.sprite?.replace(/^wt-shared:/, 'https:'), retina = devicePixelRatio > 1 ? '@2x' : '';
  const glyphs = gs.style.glyphs?.replace(/^wt-shared:/, 'https:');
  const fonts = glyphs ? gs.fonts.flatMap(f => ['0-255', '256-511'].map(r => glyphs.replace('{fontstack}', f).replace('{range}', r))) : [];
  return [...gs.files, ...(sprite ? [`${sprite}${retina}.json`, `${sprite}${retina}.png`] : []), ...fonts, ...glUsed];
}
// The vector style drawing the map, { gs: see glStyle }, for preloading and saving for offline; null while the map is
// OpenStreetMap's or a saved trip's pictures
export let basemap = null;
// Stadia gives anyone its style and fonts but refuses its tiles to a site not registered with it: a refused tile puts
// OpenStreetMap's map in its place
let glRefused = null;
// Each other day's map is fetched behind the one on screen (see preloadTrip), a few tiles at a time, each once a visit;
// after that the browser's cache has them. Skipped when the browser asks to save data.
export const TILE_PRELOAD_PARALLEL = 4;
const fetchedTiles = new Set();
let tileQueue = [], tilesInFlight = 0;
function pumpTiles() {
  while (tilesInFlight < TILE_PRELOAD_PARALLEL && tileQueue.length) {
    const src = tileQueue.shift(), done = () => { tilesInFlight--; pumpTiles(); };
    tilesInFlight++;
    sharedFetch({ url: src, type: 'arrayBuffer' }).catch(() => {}).finally(done);
  }
}
function queueTiles(urls) {
  for (const src of urls) if (!fetchedTiles.has(src)) { fetchedTiles.add(src); tileQueue.push(src); }
  pumpTiles();
}
// The map for a trip: a saved trip opened from its copy shows the map that was saved with it, light or dark, whichever
// the phone is now; otherwise Stadia's, falling back to OpenStreetMap's.
function showBasemap(m, trip) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const osm = () => { basemap = glRefused = null; mapCredit = CREDIT.osm; m.setStyle(osmStyle(dark), { diff: false }); };
  const saved = trip.offline && savedTrip(trip.id)?.style;
  if (saved && !isGLStyle(saved)) { mapCredit = CREDIT.stadia; m.setStyle(pictureStyle(saved, devicePixelRatio > 1), { diff: false }); return; }
  glStyle(saved || glStyleURL(dark)).then(gs => {
    if (map !== m) return; // left the trip meanwhile
    // With no connection and no saved style, there's no map to show: the plain one stays
    if (!gs) return offlineNow() ? null : osm();
    basemap = { gs };
    mapCredit = CREDIT.stadia;
    // A tile that fails with no connection is one that wasn't saved, not Stadia refusing the site
    glRefused = () => { if (map === m && basemap && !offlineNow()) osm(); };
    m.setStyle(structuredClone(gs.style), { diff: false }); // the style is kept for the visit, and MapLibre works on what it's given
    schedulePreload();
  });
}

// ---------- Preloading the trip's other days ----------
// Once the day on screen has settled, load every other day's drives and the map tiles where its camera will land,
// nearest days first, so stepping to another day shows its routes and map at once.
// Tiles are only the part of the view you can see (not under the list), at the day's zoom.
let preloadTimer = 0;
export function schedulePreload() { clearTimeout(preloadTimer); preloadTimer = setTimeout(preloadTrip, 1500); }
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
    for (let i = 1; i < plan.length; i++) legRoute(plan[i - 1], plan[i], { background: true });
  }
  // the camera depends on how much of the map the open stop covers; wait until it's closed
  if (!basemap || navigator.connection?.saveData || state.draft) return;
  // the day on screen comes first
  if (!map.loaded()) { map.once('idle', schedulePreload); return; }
  topUpOffline(trip);
  const size = mapSize(), shown = { x: size.x, y: size.y - coveredBottom() };
  if (shown.x <= 0 || shown.y <= 0) return;
  for (const d of days) {
    const v = dayView(trip, d);
    if (!v) continue;
    const c = project(v.center, v.zoom), tl = { x: c.x - size.x / 2, y: c.y - size.y / 2 };
    queueTiles(glTileURLs(basemap.gs, tl, { x: tl.x + shown.x, y: tl.y + shown.y }, v.zoom));
  }
}

export function teardownTrip() {
  if (map) { map.remove(); map = null; fitKey = ''; }
  sightsShown.clear();
  routes = [];
  routesDrawn = '';
  pins = [];
  basemap = glRefused = null;
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
export function mountTrip(trip) {
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
      <div class="wt-day-cal" hidden></div>
      <div class="wt-sheet__body wt-tl"></div>
      <div class="wt-add-bar"></div>
    </section>
  </div>`;
  const list = $app.querySelector('.wt-sheet__body');
  setListTop(0);
  list.addEventListener('scroll', onListScroll, { passive: true });
  new ResizeObserver(updateFades).observe(list); // the sheet changing height
  // The map comes once MapLibre has loaded (the first trip of a visit waits for it); the plan doesn't wait for the map
  const el = $app.querySelector('#map');
  loadGL().then(ok => {
    if ($app.querySelector('#map') !== el) return; // left the trip meanwhile
    if (!ok) return noMap(el, 'The map couldn’t load. Check your connection: the plan is all here.');
    try { createMap(el, trip); } catch {
      map = null;
      return noMap(el, 'This browser can’t draw the map: it needs WebGL, which is turned off or missing here. The plan is all here.');
    }
    render();
  });
}
// No map: say why where it would be. The plan works as ever.
function noMap(el, why) {
  el.innerHTML = `<p class="wt-map-none">${esc(why)}</p>`;
}
function createMap(el, trip) {
  // Double-tap zoom is our own (see mapGestures), so it works over pins and routes too. Quarter zoom levels, as
  // frame() fits a day: with whole levels only, the next level in often didn't fit, and the day showed at up to half the
  // size it could have. No turning or tilting: north stays up, as on the paper maps the plan reads like.
  const m = map = new maplibregl.Map({
    container: el, style: blankStyle(token('--wt-surface-map')), center: [-106.1, 32.6], zoom: 7, maxZoom: MAX_ZOOM,
    attributionControl: false, doubleClickZoom: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, boxZoom: false,
  });
  m.touchZoomRotate.disableRotation();
  m.keyboard.disableRotation();
  el.classList.add('wt-pins'); // so the other pins step back while one is selected
  camPlaced = false;
  camTarget = null;
  m.on('style.load', addRoutes);
  // A tile that can't be had (no connection, one not saved for offline, Stadia refusing the site: see sharedFetch) is
  // expected, and the map goes on without it. MapLibre logs every error unless something listens for them.
  m.on('error', e => { if (!e.sourceId) console.error(e.error); });
  showBasemap(m, trip);
  m.on('zoom', fitPins); // crowded pins merge as you zoom out, and come apart as you zoom in
  // once you've touched the map, a new sheet height leaves the camera where you put it
  el.addEventListener('pointerdown', () => { camFree = true; });
  // Zooming the map is touching it: the camera stays where you put it when the sheet changes height.
  // A wheel doesn't fire pointerdown; without this, the re-frame for the new height would fight the zoom you asked for.
  const zooming = () => { camFree = true; };
  el.addEventListener('wheel', zooming, { passive: true });
  el.addEventListener('touchstart', e => { if (e.touches.length > 1) zooming(); }, { passive: true });
  mapGestures(m, zooming);
  // A tap on a route shows that drive. Tapping empty map clears the selection, a route's included, and leaves the
  // camera where it is: you tapped the map you're looking at, so it doesn't fly off to the whole day (Whole day does
  // that). While a stop is open, the map is there to look at, so taps leave everything as it is.
  m.on('click', e => {
    if (e.originalEvent.target.closest?.('.wt-map-marker')) return; // a pin or a sight: its own tap
    const hit = m.getLayer(ROUTE_HIT) && m.queryRenderedFeatures(e.point, { layers: [ROUTE_HIT] })[0];
    const route = hit && routes.find(r => r.key === hit.properties.key);
    if (route?.onClick) return route.onClick();
    onMapTap(() => {
      if (sightOpen) return closeSheet();
      if (state.draft || (!state.sel && !state.leg)) return;
      state.sel = state.selRow = state.leg = null;
      render();
    });
  });
  m.on('moveend', () => { fitPins(); dayShown = dayFramed(); updateFitBtn(); drawSights(); });
}
// A pin or a sight on the map: HTML, centered on its place, over the map and its names. `tap` makes it a button (to
// the keyboard too), named by `label` or else by what's in it. `z`: which is in front where they overlap.
let downAt = null; // where the last press on the map was: a press that became a drag isn't a tap
export function addMarker(ll, { html, z = 0, label = null, tap = null }) {
  const el = document.createElement('div');
  el.className = 'wt-map-marker';
  el.innerHTML = html;
  el.style.zIndex = z;
  if (tap) {
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    if (label) el.setAttribute('aria-label', label);
    el.addEventListener('click', e => {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > TAP_SLOP_PX) return;
      tap();
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
  }
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(toGL(ll)).addTo(map);
}

// ---------- Map gestures, as in a maps app ----------
// Double-tap (or double-click) zooms in a step around that spot, anywhere on the map, pins and routes included: they're
// what you'd want a closer look at. The first tap still does what a tap does; the second only zooms.
// Shift-double-click zooms out. A two-finger tap zooms out a step, around the fingers.
const DOUBLE_TAP_MS = 300, DOUBLE_TAP_PX = 32, TAP_SLOP_PX = 10;
let mapTapTimer = 0;
// A tap on the map, a pin or a route waits out a double-tap's second tap before it acts, as in a maps app: picking a pin
// or a route, or clearing one, can move the camera, and the second tap would then zoom somewhere else.
export function onMapTap(fn) {
  clearTimeout(mapTapTimer);
  const m = map;
  mapTapTimer = setTimeout(() => { if (map === m) fn(); }, DOUBLE_TAP_MS);
}
function mapGestures(m, zooming) {
  const el = m.getContainer(), at = (x, y) => { const r = el.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
  const zoomAround = (p, z) => m.easeTo({ zoom: Math.max(0, Math.min(MAX_ZOOM, z)), around: m.unproject([p.x, p.y]), duration: reduceMotion.matches ? 0 : 250 });
  let last = null, two = null;
  el.addEventListener('pointerdown', e => { if (e.isPrimary) downAt = { x: e.clientX, y: e.clientY }; }, true);
  // In the capture phase, so the second tap can be kept from the pin, route or map under it
  el.addEventListener('click', e => {
    if (!e.detail) return; // a keyboard "click"
    // the end of a pan isn't a tap
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > TAP_SLOP_PX) { last = null; return; }
    const p = at(e.clientX, e.clientY), now = performance.now();
    if (!last || now - last.t > DOUBLE_TAP_MS || Math.hypot(p.x - last.p.x, p.y - last.p.y) > DOUBLE_TAP_PX) { last = { t: now, p }; return; }
    last = null;
    e.stopImmediatePropagation();
    clearTimeout(mapTapTimer);
    zoomAround(p, m.getZoom() + (e.shiftKey ? -1 : 1));
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
    if (performance.now() - two.t < DOUBLE_TAP_MS && m.getZoom() === two.z) zoomAround(at((a.x + b.x) / 2, (a.y + b.y) / 2), two.z - 1);
    two = null;
  });
  el.addEventListener('touchcancel', () => { two = null; });
}

// ---------- Whole day: the map back on the day's route ----------
// A button over the map, as a maps app's route overview button is. It's always there with the map, and greyed out while
// the map already shows the whole day, since then it would do nothing. It isn't there over the whole-day list, which
// hides the map, or while a stop is open.
let dayShown = false; // the camera is where dayView puts it for the day on screen
export const setDayShown = v => { dayShown = v; };
export function dayFramed() {
  const trip = cur?.stops ? cur : null, day = trip && currentDay(trip), v = map && day && dayView(trip, day);
  if (!v) return true;
  // A few pixels off still counts: turning the phone frames the day while the header is still sliding into place
  const c = toScreen(v.center), size = mapSize();
  return Math.abs(map.getZoom() - v.zoom) < 0.01 && Math.hypot(c.x - size.x / 2, c.y - size.y / 2) < 8;
}
export function updateFitBtn() {
  const btn = $app.querySelector('.trip-fit');
  if (!btn) return;
  const trip = cur?.stops ? cur : null, day = trip && currentDay(trip);
  btn.hidden = !map || !day || !!state.draft || (!isWide() && state.snap === 'full');
  btn.disabled = dayShown && !state.leg;
  // on the overview, it's the whole trip
  const label = day === ALL ? ['Whole trip', 'Show the whole trip on the map'] : ['Whole day', 'Show the whole day on the map'];
  if (btn.title !== label[0]) { btn.title = label[0]; btn.setAttribute('aria-label', label[1]); }
}
export function showWholeDay() {
  state.leg = null;
  fitKey = '';
  render();
}

export const timeHTML = t => fmtTime(t).replace(/ (AM|PM)$/, '<span class="wt-tl-meridiem">$1</span>');
// A stop's zone ("EST") shows after its time where the clocks change: when it isn't the zone of the stop before it, or,
// for the trip's first stop, of this device. Elsewhere a time is in the same zone as the one above it.
export function zoneShown(trip, s) {
  const all = stopsOf(trip), i = all.indexOf(s), ms = momentOf(s), name = zoneName(zoneOf(s), ms);
  const before = i > 0 ? zoneName(zoneOf(all[i - 1]), ms) : zoneName(DEVICE_ZONE, ms);
  return name === before ? '' : name;
}
export const markerHTML = (s, cls) => `<i class="wt-marker ${cls}" role="img" aria-label="${KINDS[kindOf(s)].label}" style="--wt-kind-color: ${kindColor(s)}">${kindIcon(s)}</i>`;
export let camFree = false; // you've touched the map since it was last framed

// ---------- Camera ----------
// Every camera move the app makes goes through here, so they all look the same: one flight that pans and zooms
// together, timed by how far it goes.
export function moveCamera(center, zoom) {
  if (!map) return;
  center = latLng(center);
  zoom = Math.max(0, Math.min(MAX_ZOOM, zoom));
  const z0 = map.getZoom(), a = project(center, z0), b = project(mapCamera().center, z0);
  const px = Math.hypot(a.x - b.x, a.y - b.y), dz = Math.abs(zoom - z0), now = performance.now();
  // already there, or already on the way there: don't restart the flight
  const same = c => Math.abs(c.lat - center.lat) < 1e-7 && Math.abs(c.lng - center.lng) < 1e-7;
  if (camTarget && now < camTarget.until && same(camTarget.center) && camTarget.zoom === zoom) return;
  if (px < 1 && dz < 0.01) { camTarget = null; return; }
  // A new map is placed where it belongs rather than flown in from its default view
  if (!camPlaced || reduceMotion.matches) {
    camPlaced = true;
    camTarget = null;
    map.jumpTo({ center: toGL(center), zoom });
    return;
  }
  // A move within the screen takes about as long as the sheet does to change height; a hop to another region, under a second
  const size = mapSize(), screens = px / Math.max(1, Math.hypot(size.x, size.y));
  const duration = Math.min(0.9, 0.3 + 0.15 * Math.log2(1 + screens) + 0.06 * dz);
  camTarget = { center, zoom, until: now + duration * 1000 };
  map.flyTo({ center: toGL(center), zoom, duration: duration * 1000, essential: true });
}
// The center and zoom that fit places into the map with `tl` and `br` (points, in pixels) kept clear at the top left
// and bottom right, without moving the map
const frameOn = (lls, tl, br, maxZoom) => frame(boundsOf(lls.map(latLng)), mapSize(), tl, br, maxZoom);

export function drawMap(trip) {
  if (!map) return;
  for (const p of pins) p.marker.remove();
  pins = [];
  // Only the day on screen, from its plan: the hotel at either end is a pin like any stop.
  // With no hotel last night, the day before's last stop is a quiet pin, so the first drive leads somewhere.
  // The overview draws every day this way: all the trip's places and drives. Its days' starts are stops of the day before, so none is quiet.
  const day = currentDay(trip);
  if (!day) { setRoutes([]); return drawDraft(); }
  const plan = planOn(trip, day);
  const start = day === ALL ? null : plan.find(e => e.role === 'from')?.place;
  const legs = legsOn(trip, day);
  const active = legs.find(l => l.key === (state.leg || state.hoverLeg));
  // The stop being edited is drawn where the draft puts it; if it has moved, its drives are out of date until it's saved.
  const draft = state.draft, editing = s => draft?.id && s.id === draft.id;
  const moved = draft?.id && draft.lat != null && plan.some(e => editing(e.place) && !samePlace(e.place, draft));
  // what the list dims, the map dims: past drives go grey, and a place is past once all its rows are
  const items = itemsOn(trip, day);
  const pastLeg = new Set(items.filter(it => it.leg && it.past).map(it => it.leg));
  const isPast = s => { const rows = items.filter(it => it.entry?.place === s); return rows.length > 0 && rows.every(it => it.past); };
  const C = { on: token('--wt-route-active'), muted: token('--wt-route-muted'), route: token('--wt-route'), done: token('--wt-route-done'), casing: token('--wt-route-casing') };
  // Past routes first, so they sit under the rest. The route on show widens and darkens, and a copy of it goes on top,
  // over any route it crosses.
  const style = (l, isOn) => {
    const stale = moved && (editing(l.from) || editing(l.to));
    return {
      coords: legCoords(l), casing: C.casing, casingWidth: isOn ? 11 : 8, width: isOn ? 7 : 4.5,
      color: isOn ? C.on : active || stale ? C.muted : pastLeg.has(l.key) ? C.done : C.route,
      // a route not looked up yet is dotted; transit and flights, which have none, are dashed
      dash: !TRAVEL[l.mode].route ? 'dash' : l.r?.ok && !stale ? null : 'dot',
    };
  };
  const order = l => (pastLeg.has(l.key) ? 0 : 1);
  const drawn = [...legs].sort((a, b) => order(a) - order(b)).map(l => ({
    key: l.key, ...style(l, l === active),
    onClick: () => onMapTap(() => { if (!state.draft) previewLeg(l, { fromMap: true }); }),
  }));
  if (active) drawn.push({ key: `on:${active.key}`, top: true, ...style(active, true) });
  setRoutes(drawn);
  // The map has only the routes and the pins: names, times and drive times are in the list, so the map doesn't repeat them.
  // A route on show enlarges the pins at its ends.
  const ends = active ? [active.from, active.to] : [];
  // Every row of the list has a number, in the order the list reads: the hotel you wake up in, the day's stops, the
  // hotel you go back to; on the overview, the trip's stops. So the numbers change when the list does, and never as you
  // zoom: where pins crowd, they merge and keep their numbers (see fitPins).
  const rows = (day === ALL ? overviewItems(trip) : items).filter(it => it.entry).map(it => it.entry);
  const num = new Map();
  let n = 0;
  for (const e of rows) if (!num.has(e.key)) num.set(e.key, ++n);
  draftNums = draft?.id && num.has(draft.id) ? [num.get(draft.id)] : [];
  // places at the same spot (fly in and out of one airport, a hotel morning and night) share one pin, with the first one's number
  const groups = new Map();
  for (const e of plan) {
    if (editing(e.place)) continue;
    const k = `${e.place.lat.toFixed(4)},${e.place.lng.toFixed(4)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const es of groups.values()) {
    const all = [...new Set(es.map(e => e.place))], nums = es.map(e => num.get(e.key)).filter(Boolean);
    // quiet: only the start, which belongs to the day before, or a place you're done with,
    // or, while a route is on show, any place it doesn't start or end at
    const g = all.filter(s => s !== start), end = all.find(s => ends.includes(s));
    const quiet = !g.length || g.every(isPast) || (active && !end);
    // the selected stop can be the day's start, from the day before's row at the top of the list
    const focus = end || all.find(s => s.id === state.sel);
    const cls = [focus ? 'wt-pin--selected' : '', quiet && !focus ? 'wt-pin--muted' : ''].join(' ');
    addPin(all[0], pinHTML(focus || g[0] || start, nums, cls), focus ? PIN_Z.sel : quiet ? PIN_Z.quiet : PIN_Z.pin, {
      nums, sel: !!focus, muted: quiet && !focus, stops: all,
      tap: () => { if (state.draft) return; if (g.length) selectStop(g[0]); else { setDay(dayOf(start)); selectStop(start); } },
    });
  }
  drawDraft();
  frameMap(trip);
  fitPins();
  drawSights();
}
// Frame the day on screen, or the drive on show, when either has changed since the map was last framed.
// A stop added to the day, taken off it or moved, by you or a co-editor, re-frames the map only while it shows the whole day:
// if you've brought it to a stop or a drive, or moved it yourself, it stays where you are. (Any change of the day's
// stops used to fly the map back out to the whole day, so a co-editor adding a stop took it from under your finger.)
function frameMap(trip) {
  const day = currentDay(trip);
  if (!day) return;
  const key = [trip.id, day, planOn(trip, day).map(e => `${e.place.lat},${e.place.lng}`).join(' ')].join('|');
  if (key === fitKey || state.draft) return;
  const sameDay = fitKey.slice(0, fitKey.lastIndexOf('|')) === key.slice(0, key.lastIndexOf('|'));
  fitKey = key;
  if (sameDay && (camFree || state.leg || !dayShown)) return;
  camFree = false;
  const leg = state.leg && legsOn(trip, day).find(l => l.key === state.leg);
  if (leg) return fitLeg(leg);
  const v = dayView(trip, day);
  if (v) moveCamera(v.center, v.zoom);
  dayShown = true;
}
// Where the camera goes for a day (or the overview): around all its places, clear of the list. Preloading uses it to
// fetch the tiles a day will land on, so it works the view out without moving the map.
export function dayView(trip, day) {
  if (!map) return null;
  const pts = planOn(trip, day).map(e => ({ lat: e.place.lat, lng: e.place.lng }));
  if (!pts.length) return null;
  if (new Set(pts.map(p => `${p.lat},${p.lng}`)).size === 1) return { center: pts[0], zoom: 12 };
  // the side panel sits beside the map, not on it; on a phone, the list covers the bottom
  // a pin is centered on its place, so leave half a selected pin clear around the edges
  return frameOn(pts, { x: 32, y: coveredTop() + 24 }, { x: 32, y: coveredBottom() + 24 }, 14);
}
// A map pin: a round dot in the stop's type color, centered on the place, with its number inside: its first row's,
// when several rows are at that place (the hotel in the morning and at night: 1, as the day starts there).
// Only a stop that isn't saved yet has no number: it has a dot until it has a row.
const pinHTML = (s, nums, cls = '') => {
  const n = nums.length ? Math.min(...nums) : null;
  return `<div class="wt-pin ${cls}" role="img" aria-label="${n ? `${n}. ` : ''}${esc(s.name)}, ${KINDS[kindOf(s)].label}" style="--wt-kind-color: ${kindColor(s)}">`
    + `${n ? `<b class="wt-pin__num">${n}</b>` : '<i class="wt-pin__dot"></i>'}</div>`;
};
// Numbers as one label, for a merged pin's aria-label: runs as ranges, "2–4, 7". Past three runs the rest is "…"; it
// never joins numbers that aren't in a row into one range, which would claim stops that aren't there.
function numLabel(nums) {
  const runs = [];
  for (const x of [...new Set(nums)].sort((a, b) => a - b)) {
    const r = runs.at(-1);
    if (r && x === r[1] + 1) r[1] = x; else runs.push([x, x]);
  }
  return runs.slice(0, 3).map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ') + (runs.length > 3 ? ', …' : '');
}
let draftNums = []; // the number of the stop being edited, so its pin keeps it
// Where pins crowd, they merge: a pin that would touch another joins it, and they show as one (.wt-pin--cluster): the
// first one's pin in front, round and with its number as ever, and the next ones' pins stacked behind it in their
// colors, so you can see there are several and what kinds. The others hide, so the numbers they hold are the ones
// missing from the map; the merged pin's label names them all. Zoom in and it comes apart; tap it and the map zooms in
// to its stops. Numbers stay as the list gives them. (Before: crowded pins shrank to dots without numbers; then a merged
// pin was a pill with all its numbers, "3–4", the one pin on the map that wasn't round; then the first pin alone, with
// a rim or a "+1", which didn't say clearly what was under it.)
// - The list's order decides: each pin joins the first pin before it that it would touch, and merged pins that touch
//   merge again, until none do.
// - A selected pin, and both ends of a route on show, never merge: they stand on their own, on top.
export let pins = []; // for each pin on the map: { ll, nums, sel, muted, stops, marker, el, own, r, members, hidden }
// In front where they overlap: the stop being edited, a selected pin, the rest, then quiet ones; the sights are behind all
// of them (see sights.js)
export const PIN_Z = { draft: 40, sel: 30, pin: 20, quiet: 10 };
const PIN_GAP = 4; // px of map between two pins
const PIN_FAN = 4; // each pin stacked behind a merged pin, further up and right
function addPin(place, html, z, { nums = [], sel = false, muted = false, stops = [], tap = null } = {}) {
  const p = { ll: latLng(place), nums, sel, muted, stops, r: 12, members: null, hidden: false };
  p.marker = addMarker(p.ll, { html, z, tap: tap && (() => onMapTap(() => (p.members ? openMerged(p.members) : tap()))) });
  p.el = p.marker.getElement().firstElementChild;
  p.own = p.el && { aria: p.el.getAttribute('aria-label'), color: p.el.style.getPropertyValue('--wt-kind-color') };
  pins.push(p);
}
// How far a pin reaches from its center: half its width, and a merged pin's stack, included
function pinReach(members) {
  const muted = members.every(m => m.muted);
  const w = members[0].sel ? 32 : muted ? 20 : 24;
  return w / 2 + Math.min(members.length - 1, 2) * PIN_FAN;
}
function fitPins() {
  if (!map || !pins.length) return;
  // During a flight, where it's going: the pins settle once instead of flickering through every zoom on the way
  const flying = camTarget && performance.now() < camTarget.until;
  const z = flying ? camTarget.zoom : map.getZoom();
  const first = p => (p.nums.length ? Math.min(...p.nums) : Infinity);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const merged = [];
  for (const p of pins.filter(q => !q.sel).sort((a, b) => first(a) - first(b))) {
    const pt = project(p.ll, z), r = pinReach([p]);
    const m = merged.find(c => dist(pt, c.pt) < r + c.r + PIN_GAP);
    if (m) { m.members.push(p); m.r = pinReach(m.members); } else merged.push({ pt, r, members: [p] });
  }
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < merged.length && !again; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        if (dist(a.pt, b.pt) >= a.r + b.r + PIN_GAP) continue;
        a.members.push(...b.members);
        a.r = pinReach(a.members);
        merged.splice(j, 1);
        again = true;
        break;
      }
    }
  }
  for (const p of pins.filter(q => q.sel)) { showMerged(p, null); hidePin(p, false); p.r = pinReach([p]); }
  for (const { members, r } of merged) {
    const [lead, ...rest] = members;
    showMerged(lead, rest.length ? members : null);
    lead.r = r;
    for (const p of rest) hidePin(p, true);
    hidePin(lead, false);
  }
}
// A pin alone, or as the pin for its merged stops: its own number, the next ones' pins stacked behind, in their
// colors (grey for one that's over), muted only when they all are
function showMerged(p, members) {
  p.members = members;
  const el = p.el;
  if (!el || !p.own) return;
  const muted = members ? members.every(m => m.muted) : p.muted;
  el.classList.toggle('wt-pin--cluster', !!members);
  el.classList.toggle('wt-pin--deep', !!members && members.length > 2);
  el.classList.toggle('wt-pin--muted', muted);
  if (!members) return el.setAttribute('aria-label', p.own.aria);
  const stops = [...new Set(members.flatMap(m => m.stops))], label = numLabel(members.flatMap(m => m.nums));
  members.slice(1, 3).forEach((m, i) => el.style.setProperty(`--wt-pin-behind-${i + 1}`, m.muted ? 'var(--wt-kind-past)' : m.own?.color || 'var(--wt-kind-place)'));
  el.setAttribute('aria-label', `${label}. ${stops.length} stops here: ${stops.map(s => s.name).join(', ')}`);
}
function hidePin(p, hidden) {
  if (p.hidden === hidden) return;
  p.hidden = hidden;
  p.marker.getElement().style.display = hidden ? 'none' : '';
  if (hidden) p.members = null;
}
// Tapping a merged pin zooms in to its stops, far enough that it comes apart
function openMerged(members) {
  if (!map) return;
  const v = frameOn(members.map(m => m.ll), { x: 48, y: coveredTop() + 40 }, { x: 48, y: coveredBottom() + 40 }, 17);
  moveCamera(v.center, Math.max(v.zoom, Math.min(map.getZoom() + 1, 17)));
}
// The stop being edited, where it would go: its new place and type.
function drawDraft() {
  const d = state.draft;
  if (!d || d.lat == null) return;
  addPin(d, pinHTML(d, draftNums, 'wt-pin--selected'), PIN_Z.draft, { nums: draftNums, sel: true, stops: [d] });
}
const legCoords = l => (l.r ? l.r.coords : [[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]]);
// Minutes a drive runs past the next stop's time, between two of the day's stops
// How late a drive gets you there: it sets off when the stop before it ends (its time, plus how long you're there)
export const lateMin = l => (l.r && l.fromEntry.role === 'stop' && l.toEntry.role === 'stop' ? Math.round(l.r.duration / 60 - (momentOf(l.to) - momentOf(l.from)) / 60000 + (stayOf(l.from) || 0)) : 0);
// Fit a route into the part of the map you can see, with room around its ends for their pins.
// From a tap on the map, only when an end is out of view, so the map doesn't jump under your finger.
function fitLeg(l, onlyIfHidden = false) {
  if (!map || (onlyIfHidden && inView(l.from) && inView(l.to))) return;
  camFree = false;
  const v = frameOn(legCoords(l), { x: 40, y: coveredTop() + 32 }, { x: 40, y: coveredBottom() + 32 }, 14);
  moveCamera(v.center, v.zoom);
}
// Show a drive's route: highlighted, with larger pins at its ends, and the map moved to fit it.
// Tapping the same drive again keeps it shown; tapping empty map, changing the day or Esc goes back to the whole day.
export function previewLeg(l, { fromMap = false } = {}) {
  // Again, at half: it's already the focus, so nothing animates. The map moves only if an end has gone out of view.
  if (state.leg === l.key && state.snap === 'half' && !isWide()) {
    fitLeg(l, true);
    centerFocus({ animate: false });
    return;
  }
  state.leg = l.key;
  state.sel = state.selRow = null;
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
// Tapping a pin or a row scrolls the row to the middle of the list. Tapping a row (`row`, its key) brings the map up close
// to the stop (see zoomToStop); a pin is already in front of you, so tapping one leaves the map where it is. Tapping the
// selected row (or its pin) again keeps it selected; tapping empty map, changing the day or Esc clears it.
export function selectStop(s, row = null) {
  // Again, at half: it's already the focus, so nothing animates. A row still brings its pin back up close if it's out of view.
  // (A hotel that starts and ends the day has two rows: its other row isn't the highlighted one.)
  if (state.sel === s.id && state.snap === 'half' && !isWide() && (!row || $app.querySelector('.wt-tl .is-selected')?.dataset.row === row)) {
    if (row) zoomToStop(s);
    centerFocus({ animate: false });
    return;
  }
  state.leg = null;
  state.sel = s.id;
  state.selRow = row;
  // Leaving a drive's preview or the whole-day list doesn't re-frame the map for the day: a row brings the map to
  // the stop instead, and a pin leaves it where it is (Whole day brings the day back).
  const key = fitKey;
  setSnap('half', false); // the whole-day list covers the map
  fitKey = key;
  render();
  if (row) zoomToStop(s);
  // in the middle of the list, so the stops before and after it show too
  centerFocus({ force: true });
}
// Street level: where a stop's streets show, and the sights around it. Offline saves each place's map at this zoom.
export const STOP_ZOOM = 14;
// Bring a stop up close: its pin in the middle of the map you can see, zoomed in to street level, or left closer if
// the map already is; it never zooms out. Already that close, with the pin in view, the map stays put. Zoomed out to
// a road trip's day, a selected pin was a dot on a map of the region, with no streets around it and no sights.
// `least` 0 keeps the zoom and only brings the pin back into view.
export function zoomToStop(s, least = STOP_ZOOM) {
  if (!map || s.lat == null) return;
  const flying = camTarget && performance.now() < camTarget.until;
  const z = Math.max(flying ? camTarget.zoom : map.getZoom(), least);
  if (!flying && map.getZoom() > least - 0.01 && inView([s.lat, s.lng])) return;
  camFree = true; // the map is placed for the stop: a new sheet height leaves it there rather than re-fitting the day
  moveCamera(toCenter(s, z), z);
}
// Move a place into the middle of the map you can see: above the stop sheet on a phone, the whole map on a wide screen.
export function focusStop(s) {
  if (!map || s.lat == null) return;
  const z = Math.max(map.getZoom(), 12);
  moveCamera(toCenter(s, z), z);
}
// The camera's center that puts a place in the middle of the map you can see, at zoom `z`
function toCenter(s, z) {
  const p = project(latLng(s), z);
  return unproject({ x: p.x, y: p.y + (coveredBottom() - coveredTop()) / 2 }, z);
}
export const sightsShown = new Map(); // id → its marker
