/* A trip plan's map, in its article (tripplans.js), drawn the way the trip's map draws a trip (map.js):
   - MapLibre on Stadia's style, or OpenStreetMap's map when Stadia's tiles are refused, with the trip map's loader and
     styles (map.js, mapstyle.js);
   - the routes on the ground, looked up when the plan was made, drawn inside the basemap under its names with the
     trip map's route layers: solid where a route was found, dotted where it wasn't, one line per leg;
   - a numbered pin per place (.wt-pin), places at one spot sharing the first one's pin, and crowded pins merged as the
     trip map merges them (pins.js); tapping a merged pin zooms in to its stops;
   - one day at a time, as the trip map shows the open day, numbered from 1 that day;
   - tapping a pin selects its stop: the pin grows and the others step back, and its row in the plan's list is
     highlighted, without moving the map. Tapping empty map clears it. Whole day brings the day back.
   One thing differs, since the map sits in a page you scroll: one finger scrolls the page, two move the map.
   With no WebGL, or no MapLibre, the day is sketched as a trip card sketches a trip. */
import { ICON, esc, token } from './core.js';
import { CREDIT, glRefusals, glStyle, glStyleURL, loadGL } from './map.js';
import { ROUTE_SOURCE, blankStyle, firstLabelLayer, osmStyle, routeLayers } from './mapstyle.js';
import { mergePins, pinReach, showMerged } from './pins.js';
import { KINDS } from './plan.js';

const dark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const STOP_ZOOM = 14, FIT = { padding: 40, maxZoom: 14 };
export const kindOfPlace = p => (KINDS[p?.kind] ? p.kind : 'place');

// The day as the trip card draws a trip, when there's no WebGL: a sketch, scaled to the box
function sketch(el, stops) {
  el.querySelector('.plan-map__sketch')?.remove();
  if (!stops.length) return;
  const lat = stops.map(s => s.place.lat), lng = stops.map(s => s.place.lng);
  const [x0, x1, y0, y1] = [Math.min(...lng), Math.max(...lng), Math.min(...lat), Math.max(...lat)];
  const k = Math.cos((y0 + y1) / 2 * Math.PI / 180), w = 320, h = 200, pad = 24;
  const sc = Math.min((w - 2 * pad) / Math.max((x1 - x0) * k, 1e-6), (h - 2 * pad) / Math.max(y1 - y0, 1e-6));
  const xy = s => [pad + ((s.place.lng - x0) * k) * sc + ((w - 2 * pad) - (x1 - x0) * k * sc) / 2, h - pad - (s.place.lat - y0) * sc - ((h - 2 * pad) - (y1 - y0) * sc) / 2].map(v => v.toFixed(1)).join(' ');
  const d = stops.map((s, n) => `${n ? 'L' : 'M'}${xy(s)}`).join('');
  el.insertAdjacentHTML('beforeend', `<span class="wt-trip-card__map plan-map__sketch"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="The day’s places, sketched">
    <path class="wt-trip-card__casing" d="${d}"/><path class="wt-trip-card__route" d="${d}"/>
    <path class="wt-trip-card__ring" d="${stops.map(s => `M${xy(s)}h0`).join('')}"/>${stops.map(s => `<path class="wt-trip-card__stop" style="--wt-kind-color: var(--wt-kind-${kindOfPlace(s.place)})" d="M${xy(s)}h0"/>`).join('')}</svg></span>`);
}

/* Draws the plan into el, one day at a time. `days` maps each day to its stops ({ spot_id, n, place }, numbered from 1
   that day) and its legs ({ from, to, coords }, [lat, lng] each; coords null when no route was found, drawn dotted and
   straight). onSelect(spotId | null) hears the selection, onCredit(html) whose map it is. Resolves to { show(day), select(id, { fly }), remove() }: show
   puts another day on the map and frames it, select picks a stop as a row does. */
export async function drawPlanMap(el, { days, day, onSelect, onCredit }) {
  const api = { show: d => { day = d; sketch(el, days.get(d)?.stops ?? []); }, select: () => {}, remove: () => {} };
  const stopsOn = d => days.get(d)?.stops ?? [];
  if (!(await loadGL()) || !el.isConnected || (maplibregl.supported && !maplibregl.supported())) { sketch(el, stopsOn(day)); return api; }
  const gl = maplibregl, toGL = ([lat, lng]) => [lng, lat];
  const boundsOf = lls => lls.reduce((b, c) => b.extend(toGL(c)), new gl.LngLatBounds(toGL(lls[0]), toGL(lls[0])));
  const placesOf = d => stopsOn(d).map(s => [s.place.lat, s.place.lng]);
  let map;
  try {
    map = new gl.Map({ container: el, style: blankStyle(token('--wt-surface-map')), bounds: boundsOf(placesOf(day)), fitBoundsOptions: FIT,
      attributionControl: false, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, maxZoom: 19 });
  } catch { sketch(el, stopsOn(day)); return api; }
  map.touchZoomRotate.disableRotation();
  // Errors from tiles and such: the map carries on without them, as the trip's map does
  map.on('error', () => {});

  // ---------- The basemap, and the routes inside it under its names ----------
  const features = () => ({
    type: 'FeatureCollection',
    features: days.get(day).legs.map((l, n) => ({
      type: 'Feature',
      properties: { key: String(n), color: token('--wt-route'), width: 4.5, casing: token('--wt-route-casing'), casingWidth: 8, dash: l.coords ? 'solid' : 'dot', top: false },
      geometry: { type: 'LineString', coordinates: (l.coords || [l.from, l.to]).map(toGL) },
    })),
  });
  const addRoutes = () => {
    if (map.getSource(ROUTE_SOURCE)) return map.getSource(ROUTE_SOURCE).setData(features());
    map.addSource(ROUTE_SOURCE, { type: 'geojson', data: features() });
    const before = firstLabelLayer(map.getStyle().layers);
    for (const layer of routeLayers()) map.addLayer(layer, before);
  };
  let osm = false;
  const showStyle = style => map.setStyle(style, { diff: false });
  map.on('style.load', addRoutes); // each style, the blank one first
  const toOSM = () => {
    if (osm || !map) return;
    osm = true;
    showStyle(osmStyle(dark()));
    onCredit?.(CREDIT.osm);
  };
  glRefusals.add(toOSM);
  onCredit?.(CREDIT.stadia);
  glStyle(glStyleURL(dark())).then(gs => { if (map && !osm) { if (gs) showStyle(structuredClone(gs.style)); else toOSM(); } });

  // ---------- Pins: one per place, numbered as the day's list is; places at one spot share the first one's ----------
  el.classList.add('wt-pins');
  let selected = null, pins = [];
  function placePins() {
    for (const p of pins) p.marker.remove();
    const groups = new Map();
    for (const s of stopsOn(day)) {
      const k = `${s.place.lat.toFixed(4)},${s.place.lng.toFixed(4)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    pins = [...groups.values()].map(g => {
      const s = g[0], kind = kindOfPlace(s.place);
      const p = { ll: { lat: s.place.lat, lng: s.place.lng }, nums: g.map(x => x.n), sel: false, muted: false, stops: g.map(x => x.place), ids: g.map(x => x.spot_id), members: null, hidden: false, r: 12 };
      const box = document.createElement('div');
      box.className = 'wt-map-marker';
      box.tabIndex = 0;
      box.setAttribute('role', 'button');
      box.innerHTML = `<div class="wt-pin" role="img" aria-label="${s.n}. ${esc(s.place.name)}, ${esc(KINDS[kind].label)}" style="--wt-kind-color: var(--wt-kind-${kind})"><b class="wt-pin__num">${s.n}</b></div>`;
      const tap = e => { e.stopPropagation(); if (p.members) openMerged(p.members); else select(p.ids[0]); };
      box.addEventListener('click', tap);
      box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(e); } });
      p.marker = new gl.Marker({ element: box, anchor: 'center' }).setLngLat(toGL([p.ll.lat, p.ll.lng])).addTo(map);
      p.el = box.firstElementChild;
      p.own = { aria: p.el.getAttribute('aria-label'), color: p.el.style.getPropertyValue('--wt-kind-color') };
      return p;
    });
  }
  const hide = (p, hidden) => { p.hidden = hidden; p.marker.getElement().style.display = hidden ? 'none' : ''; if (hidden) p.members = null; };
  function fitPins() {
    for (const p of pins) {
      p.el.classList.toggle('wt-pin--selected', p.sel);
      p.marker.getElement().style.zIndex = p.sel ? 30 : 20;
    }
    for (const p of pins.filter(q => q.sel)) { showMerged(p, null); hide(p, false); p.r = pinReach([p]); }
    for (const { members, r } of mergePins(pins, map.getZoom())) {
      const [lead, ...rest] = members;
      showMerged(lead, rest.length ? members : null);
      lead.r = r;
      for (const p of rest) hide(p, true);
      hide(lead, false);
    }
  }
  const fly = cam => (reduceMotion() ? map.jumpTo(cam) : map.flyTo({ ...cam, duration: 600, essential: true }));
  const home = () => map.cameraForBounds(boundsOf(placesOf(day)), FIT);
  // Tapping a merged pin zooms in to its stops, far enough that it comes apart
  function openMerged(members) {
    const cam = map.cameraForBounds(boundsOf(members.map(m => [m.ll.lat, m.ll.lng])), { padding: 48, maxZoom: 17 });
    fly({ center: cam.center, zoom: Math.max(cam.zoom, Math.min(map.getZoom() + 1, 17)) });
  }
  // Select a stop (or none). From a pin the map stays where it is; from the list (`fly`) it comes up close to the
  // stop, at street level or closer: it never zooms out, and stays put when the stop is already in view that close
  function select(id, { fly: go = false } = {}) {
    selected = id;
    for (const p of pins) p.sel = !!id && p.ids.includes(id);
    fitPins();
    const p = pins.find(q => q.sel);
    if (go && p) {
      const at = toGL([p.ll.lat, p.ll.lng]);
      if (!(map.getBounds().contains(at) && map.getZoom() >= STOP_ZOOM - 0.01)) fly({ center: at, zoom: Math.max(map.getZoom(), STOP_ZOOM) });
    }
    onSelect?.(id);
    updateFit();
  }
  // Another day: its pins and routes, and the map framed on it
  function show(d) {
    if (!days.has(d) || d === day) return;
    day = d;
    selected = null;
    onSelect?.(null);
    placePins();
    if (map.getSource(ROUTE_SOURCE)) map.getSource(ROUTE_SOURCE).setData(features());
    fly(home());
    fitPins();
  }
  map.on('click', () => { if (selected) select(null); });
  map.on('moveend', () => { fitPins(); updateFit(); });
  map.on('zoom', () => fitPins());

  // ---------- Whole day: the map back on the open day, greyed out while it's already there ----------
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'wt-icon-btn wt-map-btn plan-map__fit';
  btn.title = 'Whole day';
  btn.setAttribute('aria-label', 'Show the whole day on the map');
  btn.innerHTML = ICON.fit;
  btn.addEventListener('click', e => { e.stopPropagation(); select(null); fly(home()); });
  el.append(btn);
  function updateFit() {
    const h = home(), c = map.project(h.center);
    btn.disabled = !selected && Math.abs(map.getZoom() - h.zoom) < 0.05 && Math.hypot(c.x - el.clientWidth / 2, c.y - el.clientHeight / 2) < 8;
  }
  placePins();
  map.once('load', () => { fitPins(); updateFit(); });
  fitPins();
  updateFit();
  Object.assign(api, {
    show, select,
    remove: () => { glRefusals.delete(toOSM); map?.remove(); map = null; },
  });
  return api;
}
