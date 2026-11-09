/* The trip screen's map: setting it up and tearing it down, the routes on it, the basemap, preloading other days,
   gestures, and the camera and pins. */
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

// ---------- Trip screen: map + one day of the plan ----------
// Stadia answers a domain it doesn't know with a "401" picture instead of an error, which Leaflet
// can't tell from a real tile; ask once per visit whether it will serve this site. With no connection there's no
// answer: use Stadia, whose tiles a trip saved for offline has (the tile asked for is saved with them), and ask again next time.
export const STADIA_CHECK = 'https://tiles.stadiamaps.com/tiles/alidade_smooth/0/0/0.png';
let stadiaCheck = null;
const stadiaServes = () => (stadiaCheck ??= fetch(STADIA_CHECK).then(r => r.ok, () => { stadiaCheck = null; return true; }));
export let map = null, layer = null, routeLayer = null, fitKey = '';
// Frame the map again on the next draw, as if it had just opened on this view
export const refit = () => { fitKey = ''; };
let camPlaced = false; // the new map has been framed once: its first framing is placed, not flown to
let camTarget = null; // where the camera is flying, and until when
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
  // The cells of a `cell`-pixel grid over the map's container that a route on the map runs through, as "x,y": so the
  // sights can keep off the routes (see drawSights). Each segment in view is walked in steps of half a cell.
  cells(cell) {
    const m = this._map, out = new Set();
    if (!m) return out;
    const v = viewOf(m), tl = m.containerPointToLayerPoint([0, 0]), size = m.getSize();
    const ox = v.ox + tl.x, oy = v.oy + tl.y, inView = (x, y) => x > -cell && y > -cell && x < size.x + cell && y < size.y + cell;
    for (const route of this._routes.values()) {
      const w = route.world, [x0, y0, x1, y1] = route.box;
      if (x1 * v.s - ox < 0 || x0 * v.s - ox > size.x || y1 * v.s - oy < 0 || y0 * v.s - oy > size.y) continue;
      for (let i = 0; i < w.length / 2 - 1; i++) {
        const ax = w[i * 2] * v.s - ox, ay = w[i * 2 + 1] * v.s - oy, bx = w[i * 2 + 2] * v.s - ox, by = w[i * 2 + 3] * v.s - oy;
        if (!inView(ax, ay) && !inView(bx, by) && !L.LineUtil.clipSegment(L.point(ax, ay), L.point(bx, by), L.bounds([0, 0], size))) continue;
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2)));
        for (let k = 0; k <= steps; k++) {
          const x = ax + ((bx - ax) * k) / steps, y = ay + ((by - ay) * k) / steps;
          if (inView(x, y)) out.add(`${Math.floor(x / cell)},${Math.floor(y / cell)}`);
        }
      }
    }
    return out;
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
export let mapCredit = CREDIT.stadia;
// Leaflet fetches only the tiles in view, so a zoom waits on a whole fresh set and a pan shows blank edges.
// This layer also loads a ring of tiles around the view, and once the view's tiles are in, it fetches the
// next zoom level in (where a zoom-in lands) and the one out (a quarter as many) so the browser has them cached.
// Stadia tiles only. Skipped when the browser asks to save data. `_getTiledPixelBounds` is Leaflet-internal: check it on upgrade.
// The trip's other days are preloaded too (see preloadTrip), behind these and a few tiles at a time.
const EDGE_TILES = 1;
const PREFETCH_ZOOMS = [1, -1];
export const TILE_PRELOAD_PARALLEL = 4;
const fetchedTiles = new Set(); // asked for once per visit; after that the browser's cache has them
let tileQueue = [], tilesInFlight = 0;
function pumpTiles() {
  while (tilesInFlight < TILE_PRELOAD_PARALLEL && tileQueue.length) {
    const src = tileQueue.shift(), done = () => { tilesInFlight--; pumpTiles(); };
    tilesInFlight++;
    // a picture as Leaflet loads it; MapLibre's tiles as sharedFetch does
    if (src.endsWith('.pbf')) fetch(src, { priority: 'low' }).then(r => r.arrayBuffer()).catch(() => {}).finally(done);
    else { const img = new Image(); img.onload = img.onerror = done; img.src = src; }
  }
}
// Tiles to load behind everything else, each once a visit
function queueTiles(urls) {
  for (const src of urls) if (!fetchedTiles.has(src)) { fetchedTiles.add(src); tileQueue.push(src); }
  pumpTiles();
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
    if (later) return queueTiles(t.tileURLs(b, z));
    for (const src of t.tileURLs(b, z)) if (!fetchedTiles.has(src)) { fetchedTiles.add(src); new Image().src = src; }
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
export let tiles = null; // the Stadia pictures, shown or not: what's saved for offline. Not the OpenStreetMap fallback, which isn't preloaded

// ---------- The basemap, drawn in the browser ----------
// Stadia's pictures have the place and road names painted in, so a route drawn over them hides the names of the roads
// it follows. The map is Stadia's same style drawn by MapLibre from its vector tiles instead, in two layers: land,
// water and roads under the routes, and the names, road numbers and places over them (the labels pane, between the
// routes and the pins). The pictures stay when MapLibre can't run, and for a trip saved for offline with them.
// MapLibre is loaded the first time a trip opens.
// Served with the app (see vendor/README.md), next to this file wherever the page is: the prototype's is in another folder
const MAPLIBRE = ['vendor/maplibre/maplibre-gl.js', 'vendor/maplibre/leaflet-maplibre-gl.js'].map(f => new URL(f, import.meta.url).href);
let glLoaded = null;
const loadScript = src => new Promise((done, fail) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = done;
  s.onerror = () => { s.remove(); fail(); };
  document.head.append(s);
});
const loadGL = () => (glLoaded ??= MAPLIBRE.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
  .then(() => { maplibregl.addProtocol('wt-shared', sharedFetch); return true; }, () => { glLoaded = null; return false; }));
// MapLibre asks for Stadia's tiles, sprite and fonts through this. Both layers draw from the same tiles and ask for each
// at the same moment, too soon for the browser's cache to answer the second: they share one fetch per file instead, so
// a tile counts once against the Stadia plan. Each gets its own copy of the bytes, since MapLibre hands them over to its
// worker. The sprite and fonts asked for are noted, so saving the trip for offline saves them.
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
// Its tile source's description is read once here rather than by each layer, and everything Stadia serves for it goes
// through sharedFetch.
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
// The vector tiles MapLibre draws Leaflet's pixel bounds `b` at zoom `z` from. MapLibre's zoom is Leaflet's less one (its
// tiles are twice the size), and it draws from the whole level below a fractional zoom, no closer than the tiles' highest
// level. A tile at a level covers what one of Leaflet's 256-pixel tiles at that level does.
export function glTileURLs(gs, b, z) {
  const k = Math.max(gs.minzoom, Math.min(gs.maxzoom, Math.floor(z - 1))), s = 2 ** (k - z), n = 2 ** k, out = [];
  const lo = b.min.multiplyBy(s).divideBy(256).floor(), hi = b.max.multiplyBy(s).divideBy(256).floor();
  for (let y = Math.max(lo.y, 0); y <= Math.min(hi.y, n - 1); y++) {
    for (let x = lo.x; x <= hi.x; x++) out.push(gs.tiles.replace('{z}', k).replace('{x}', ((x % n) + n) % n).replace('{y}', y));
  }
  return out;
}
// Everything else a style needs to be drawn with no connection: its own files, the sprite, and the fonts for Latin
// names (the alphabet and its accents) and for any other names drawn so far
export function glFiles(gs) {
  const sprite = gs.style.sprite?.replace(/^wt-shared:/, 'https:'), retina = devicePixelRatio > 1 ? '@2x' : '';
  const glyphs = gs.style.glyphs?.replace(/^wt-shared:/, 'https:');
  const fonts = glyphs ? gs.fonts.flatMap(f => ['0-255', '256-511'].map(r => glyphs.replace('{fontstack}', f).replace('{range}', r))) : [];
  return [...gs.files, ...(sprite ? [`${sprite}${retina}.json`, `${sprite}${retina}.png`] : []), ...fonts, ...glUsed];
}
// Two changes to the plugin, so the map stays under the routes and pins, which move with every frame:
// - while Leaflet zooms or flies, the plugin follows only the frames that change the zoom, and doesn't move its layer:
//   a frame that only pans, or a pan at the same time (the keyboard's), left MapLibre's map behind. It follows each one here.
// - it moves MapLibre's map and leaves the drawing for MapLibre's next frame, a frame late: it's drawn at once instead.
const glLayer = opts => new (L.MaplibreGL.extend({
  getEvents() {
    const { zoom, ...events } = L.MaplibreGL.prototype.getEvents.call(this);
    return { ...events, move: this._follow }; // a zoom always comes with a move
  },
  _follow(e) {
    const m = this._map;
    if (!this._zooming) return this._throttledUpdate(e);
    if (m._animatingZoom) return; // in the zoom transition, CSS moves the layer
    this._offset = m.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this._container, this._roundPoint(this._offset.subtract(m.getSize().multiplyBy(this.options.padding))));
    this._transformGL(this._glMap);
  },
  _transformGL(gl) { L.MaplibreGL.prototype._transformGL.call(this, gl); gl.redraw(); },
}))({ validateStyle: false, ...opts });
// The map MapLibre is drawing: { layers: [under the routes, over them], gs: its style (see glStyle) }
export let basemap = null;
// Stadia gives anyone its style and fonts but refuses its tiles to a site not registered with it, which would leave the
// names over an empty map: a refused tile puts the pictures back instead (and those fall back to OpenStreetMap)
let glRefused = null;
// Show the map drawn by MapLibre in the style at `url`; false if it can't be (MapLibre or the style didn't load, no WebGL)
async function showGLMap(m, url) {
  const [ok, gs] = await Promise.all([loadGL(), glStyle(url)]);
  if (!ok || !gs || map !== m || !window.L?.MaplibreGL) return false;
  const part = names => {
    const s = structuredClone(gs.style);
    s.layers = s.layers.filter(l => (l.type === 'symbol') === names);
    if (!names) delete s.sprite; // only the names and road numbers use its pictures
    return s;
  };
  const layers = [glLayer({ style: part(false) }), glLayer({ style: part(true), pane: 'labels' })];
  try {
    for (const l of layers) l.addTo(m);
  } catch {
    for (const l of layers) { try { m.removeLayer(l); } catch {} l.getContainer?.()?.remove(); }
    return false;
  }
  basemap = { layers, gs };
  return true;
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
  if (!tiles || navigator.connection?.saveData || state.draft) return;
  // the day on screen comes first
  const gl = basemap?.layers[0].getMaplibreMap();
  if (gl ? !gl.loaded() : tiles.isLoading()) { if (gl) gl.once('idle', schedulePreload); else tiles.once('load', schedulePreload); return; }
  topUpOffline(trip);
  const size = map.getSize(), shown = L.point(size.x, size.y - coveredBottom());
  if (shown.x <= 0 || shown.y <= 0) return;
  for (const d of days) {
    const v = dayView(trip, d);
    if (!v) continue;
    // Leaflet's pictures are at the nearest whole zoom; MapLibre's tiles depend on the zoom itself (see glTileURLs)
    const z = gl ? v.zoom : Math.round(v.zoom), c = map.project(v.center, z), tl = c.subtract(size.divideBy(2)), b = L.bounds(tl, tl.add(shown));
    if (gl) queueTiles(glTileURLs(basemap.gs, b, z)); else tiles.prefetchArea(b, z, true);
  }
}

export function teardownTrip() {
  if (map) { map.remove(); map = null; layer = routeLayer = sightLayer = null; fitKey = ''; }
  sightsShown.clear();
  tiles = basemap = glRefused = null;
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
  if (!window.L) return;
  // double-tap zoom is our own (see mapGestures), so it works over routes and pins too.
  // Quarter zoom levels, so a day (or a drive) fills the map it's framed in: with whole levels only, the next level
  // in often didn't fit, and the day showed at up to half the size it could have.
  map = L.map($app.querySelector('#map'), { zoomControl: false, attributionControl: false, doubleClickZoom: false, zoomSnap: 0.25 }).setView([32.6, -106.1], 8);
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
  map.on('zoom zoomend moveend', fitPins); // crowded pins merge as you zoom out, and come apart as you zoom in
  // A quiet basemap so routes lead. Stadia needs no key on localhost; in production, register the
  // domain with Stadia. Fall back to OpenStreetMap if it's refused.
  const m = map, dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const osm = () => {
    // No prefetch here: OpenStreetMap's tile policy discourages loading tiles nobody looks at
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    mapCredit = CREDIT.osm;
    $app.querySelector('.trip')?.classList.add('osm-tiles');
  };
  stadiaServes().then(async ok => {
    if (map !== m) return; // left the trip meanwhile
    if (!ok) return osm();
    mapCredit = CREDIT.stadia;
    // A trip opened from its saved copy shows the map that was saved with it, light or dark, whichever the phone is now:
    // drawn by MapLibre, or Stadia's pictures for a trip saved with those
    const saved = trip.offline && savedTrip(trip.id)?.style, pictured = saved && !isGLStyle(saved);
    const quiet = bufferedTileLayer(pictured ? saved : `https://tiles.stadiamaps.com/tiles/alidade_smooth${dark ? '_dark' : ''}/{z}/{x}/{y}{r}.png`, { maxZoom: 20 });
    const drawn = !pictured && await showGLMap(m, saved || glStyleURL(dark));
    if (map !== m) return;
    tiles = quiet;
    const pictures = () => {
      quiet.addTo(m);
      // A tile that fails with no connection is one that wasn't saved, not Stadia refusing the site: keep the rest
      const fallBack = () => {
        if (offlineNow()) return;
        quiet.off('tileerror', fallBack);
        m.removeLayer(quiet); tiles = null; tileQueue = []; osm();
      };
      quiet.on('tileerror', fallBack);
    };
    if (drawn) {
      glRefused = () => {
        if (map !== m || !basemap) return;
        for (const l of basemap.layers) m.removeLayer(l);
        basemap = glRefused = null;
        pictures();
      };
    } else pictures();
    schedulePreload();
  });
  // The map's names over the routes (the overlay pane, 400); sights over both, so no name hides them, and under the pins
  map.createPane('sights').style.zIndex = 500;
  Object.assign(map.createPane('labels').style, { zIndex: 450, pointerEvents: 'none' });
  sightLayer = L.layerGroup().addTo(map);
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
  // Tapping empty map clears the selection, a route's included, and leaves the camera where it is: you tapped the map
  // you're looking at, so it doesn't fly off to the whole day (Whole day does that). (It used to.)
  // While a stop is open, the map is there to look at, so taps leave everything as it is.
  map.on('click', () => onMapTap(() => {
    if (sightOpen) return closeSheet();
    if (state.draft || (!state.sel && !state.leg)) return;
    state.sel = state.selRow = state.leg = null;
    render();
  }));
  map.on('moveend', () => { dayShown = dayFramed(); updateFitBtn(); drawSights(); });
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
export function onMapTap(fn) {
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
export const setDayShown = v => { dayShown = v; };
export function dayFramed() {
  const trip = cur?.stops ? cur : null, day = trip && currentDay(trip), v = map && day && dayView(trip, day);
  if (!v) return true;
  // A few pixels off still counts: turning the phone frames the day while the header is still sliding into place
  return Math.abs(map.getZoom() - v.zoom) < 0.01 && map.latLngToContainerPoint(v.center).distanceTo(map.getSize().divideBy(2)) < 8;
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
// Every camera move the app makes goes through here, so they all look the same: one flyTo that pans and zooms
// together, timed by how far it goes. Leaflet's setView, fitBounds and panTo each pick an animation by distance:
// a 250ms slide within a screen, a CSS scale for a zoom of up to 4 levels around an on-screen point, and otherwise
// a jump with no animation. And a zoom asked for while one of those scales is still running is dropped.
export function moveCamera(center, zoom) {
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

export function drawMap(trip) {
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
  // Past routes first, so they sit under the rest. The route on show widens and darkens in place, and a copy of it
  // fades in on top, over any route it crosses; moving the route itself to the top would cut its transition short.
  const style = (l, isOn) => {
    const stale = moved && (editing(l.from) || editing(l.to));
    return {
      coords: legCoords(l), casing: C.casing, casingWidth: isOn ? 11 : 8, width: isOn ? 7 : 4.5,
      color: isOn ? C.on : active || stale ? C.muted : pastLeg.has(l.key) ? C.done : C.route,
      // a route not looked up yet is dotted; transit and flights, which have none, are dashed
      dash: !TRAVEL[l.mode].route ? '10 8' : l.r?.ok && !stale ? null : '1 9',
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
    addPin(L.marker([all[0].lat, all[0].lng], {
      icon: L.divIcon({ className: '', iconSize: [0, 0], html: pinHTML(focus || g[0] || start, nums, cls) }),
      zIndexOffset: focus ? 1000 : quiet ? -1000 : 0, title: all[0].name,
    }), {
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
  const pts = planOn(trip, day).map(e => [e.place.lat, e.place.lng]);
  if (!pts.length) return null;
  if (new Set(pts.map(String)).size === 1) return { center: L.latLng(pts[0]), zoom: 13 };
  // the side panel sits beside the map, not on it; on a phone, the list covers the bottom
  // a pin is centered on its place, so leave half a selected pin clear around the edges
  return frameBounds(L.latLngBounds(pts), L.point(32, coveredTop() + 24), L.point(32, coveredBottom() + 24), 15);
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
const PIN_GAP = 4; // px of map between two pins
const PIN_FAN = 4; // each pin stacked behind a merged pin, further up and right
function addPin(marker, { nums = [], sel = false, muted = false, stops = [], tap = null } = {}) {
  marker.addTo(layer);
  const el = marker.getElement()?.firstElementChild;
  const p = {
    ll: marker.getLatLng(), nums, sel, muted, stops, marker, el, r: 12, members: null, hidden: false,
    own: el && { aria: el.getAttribute('aria-label'), color: el.style.getPropertyValue('--wt-kind-color') },
  };
  if (tap) marker.on('click', () => onMapTap(() => (p.members ? openMerged(p.members) : tap())));
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
  const merged = [];
  for (const p of pins.filter(q => !q.sel).sort((a, b) => first(a) - first(b))) {
    const pt = map.project(p.ll, z), r = pinReach([p]);
    const m = merged.find(c => pt.distanceTo(c.pt) < r + c.r + PIN_GAP);
    if (m) { m.members.push(p); m.r = pinReach(m.members); } else merged.push({ pt, r, members: [p] });
  }
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < merged.length && !again; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const a = merged[i], b = merged[j];
        if (a.pt.distanceTo(b.pt) >= a.r + b.r + PIN_GAP) continue;
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
  const icon = p.marker.getElement();
  if (icon) icon.style.display = hidden ? 'none' : '';
  if (hidden) p.members = null;
}
// Tapping a merged pin zooms in to its stops, far enough that it comes apart
function openMerged(members) {
  if (!map) return;
  const v = frameBounds(L.latLngBounds(members.map(m => m.ll)), L.point(48, coveredTop() + 40), L.point(48, coveredBottom() + 40), 18);
  moveCamera(v.center, Math.max(v.zoom, Math.min(map.getZoom() + 1, 18)));
}
// The stop being edited, where it would go: its new place and type.
function drawDraft() {
  const d = state.draft;
  if (!d || d.lat == null) return;
  addPin(L.marker([d.lat, d.lng], {
    interactive: false, keyboard: false, zIndexOffset: 1500,
    icon: L.divIcon({ className: '', iconSize: [0, 0], html: pinHTML(d, draftNums, 'wt-pin--selected') }),
  }), { nums: draftNums, sel: true, stops: [d] });
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
  const v = frameBounds(L.latLngBounds(legCoords(l)), L.point(40, coveredTop() + 32), L.point(40, coveredBottom() + 32), 15);
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
const STOP_ZOOM = 15;
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
  const p = map.project([s.lat, s.lng], z).add([0, (coveredBottom() - coveredTop()) / 2]);
  moveCamera(map.unproject(p, z), z);
}
// Move a place into the middle of the map you can see: above the stop sheet on a phone, the whole map on a wide screen.
export function focusStop(s) {
  if (!map || s.lat == null) return;
  const z = Math.max(map.getZoom(), 13);
  const p = map.project([s.lat, s.lng], z).add([0, (coveredBottom() - coveredTop()) / 2]);
  moveCamera(map.unproject(p, z), z);
}
export let sightLayer = null, sightsShown = new Map(); // id → its marker
