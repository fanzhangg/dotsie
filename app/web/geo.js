// @ts-check
/* Where places are on the map, in the map's own units, and the camera's sums. Web Mercator, in pixels of the 512-pixel
   tiles MapLibre's zoom levels count (one of them is four of the 256-pixel map pictures at the next level in). No DOM:
   the tests import this. */

/** @typedef {{ lat: number, lng: number }} LatLng */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ south: number, west: number, north: number, east: number }} Bounds */

export const TILE = 512;
const MAX_LAT = 85.0511287798; // as far north and south as Web Mercator goes

/** A place, from a stop ({ lat, lng }) or a pair ([lat, lng]) @param {LatLng | [number, number]} v @returns {LatLng} */
export const latLng = v => (Array.isArray(v) ? { lat: v[0], lng: v[1] } : { lat: v.lat, lng: v.lng });

/** Where a place is on the whole world's map at zoom `z`, in pixels from its top left @param {LatLng} ll @param {number} z @returns {Point} */
export function project(ll, z) {
  const s = TILE * 2 ** z, lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, ll.lat)), sin = Math.sin((lat * Math.PI) / 180);
  return { x: ((ll.lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}
/** The place at a point on the world's map at zoom `z` @param {Point} p @param {number} z @returns {LatLng} */
export function unproject(p, z) {
  const s = TILE * 2 ** z, n = Math.PI - (2 * Math.PI * p.y) / s;
  return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (p.x / s) * 360 - 180 };
}
/** The map tile a place is on at tile zoom `z` (the x/y of a z/x/y tile address) @param {LatLng} ll @param {number} z */
export function tileOf(ll, z) {
  const p = project(ll, z), n = 2 ** z;
  return { x: ((Math.floor(p.x / TILE) % n) + n) % n, y: Math.max(0, Math.min(n - 1, Math.floor(p.y / TILE))) };
}
/** The tiles at tile zoom `k` under a box of the map at zoom `z` (in pixels, as `project` gives them), as [x, y] pairs
 * @param {Point} min @param {Point} max @param {number} z @param {number} k @returns {[number, number][]} */
export function tilesUnder(min, max, z, k) {
  const s = 2 ** (k - z) / TILE, n = 2 ** k, out = [];
  const x0 = Math.floor(min.x * s), x1 = Math.floor(max.x * s), y0 = Math.max(0, Math.floor(min.y * s)), y1 = Math.min(n - 1, Math.floor(max.y * s));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([((x % n) + n) % n, y]);
  return /** @type {[number, number][]} */ (out);
}
/** The smallest box around some places @param {LatLng[]} lls @returns {Bounds} */
export function boundsOf(lls) {
  const lats = lls.map(p => p.lat), lngs = lls.map(p => p.lng);
  return { south: Math.min(...lats), west: Math.min(...lngs), north: Math.max(...lats), east: Math.max(...lngs) };
}
/**
 * The camera that fits `bounds` into a map of `size` with `tl` and `br` pixels kept clear at its top left and bottom
 * right (the header, the list): the closest zoom, in quarter levels, at which it fits, no closer than `maxZoom`; and
 * the center that puts the bounds in the middle of what's left.
 * @param {Bounds} bounds @param {Point} size @param {Point} tl @param {Point} br @param {number} maxZoom
 * @returns {{ center: LatLng, zoom: number }}
 */
export function frame(bounds, size, tl, br, maxZoom) {
  const a = project({ lat: bounds.north, lng: bounds.west }, 0), b = project({ lat: bounds.south, lng: bounds.east }, 0);
  const fit = Math.log2(Math.min((size.x - tl.x - br.x) / (b.x - a.x), (size.y - tl.y - br.y) / (b.y - a.y)));
  // quarter levels, rounded down so it fits (a hair under a level counts as that level)
  const zoom = Number.isFinite(fit) ? Math.max(0, Math.min(maxZoom, Math.floor(Math.round(fit * 400) / 100) / 4)) : maxZoom;
  const k = 2 ** zoom, mid = { x: ((a.x + b.x) / 2) * k + (br.x - tl.x) / 2, y: ((a.y + b.y) / 2) * k + (br.y - tl.y) / 2 };
  return { center: unproject(mid, zoom), zoom };
}
