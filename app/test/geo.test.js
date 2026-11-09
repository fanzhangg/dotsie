import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundsOf, frame, latLng, project, tileOf, tilesUnder, unproject } from '../web/geo.js';
import { ROUTE_HIT, firstLabelLayer, osmStyle, pictureStyle, routeLayers } from '../web/mapstyle.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`);
const VISITOR_CENTER = { lat: 32.7797, lng: -106.1717 }, AIRPORT = { lat: 31.8072, lng: -106.3779 };

test('a place and its point on the map go both ways', () => {
  assert.deepEqual(project({ lat: 0, lng: 0 }, 0), { x: 256, y: 256 });
  for (const z of [0, 7.5, 14]) {
    const back = unproject(project(VISITOR_CENTER, z), z);
    close(back.lat, VISITOR_CENTER.lat, 1e-9, `lat at ${z}`);
    close(back.lng, VISITOR_CENTER.lng, 1e-9, `lng at ${z}`);
  }
  // one zoom level in, twice as far
  const a = project(VISITOR_CENTER, 10), b = project(VISITOR_CENTER, 11);
  close(b.x, a.x * 2, 1e-6, 'x');
  assert.deepEqual(latLng([1, 2]), { lat: 1, lng: 2 });
});

test('the tile a place is on, numbered as map tiles are (z/x/y), as the server’s sights tiles are', () => {
  // the usual slippy-map sums, worked out here on their own
  const z = 12, n = 2 ** z, r = (VISITOR_CENTER.lat * Math.PI) / 180;
  const want = { x: Math.floor(((VISITOR_CENTER.lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
  assert.deepEqual(want, { x: 840, y: 1652 });
  assert.deepEqual(tileOf(VISITOR_CENTER, z), want);
  assert.deepEqual(tileOf({ lat: 0, lng: 180 }, 1), { x: 0, y: 1 }, 'the date line wraps');
});

test('the tiles under a box of the map', () => {
  // a 512-pixel box at zoom 3 is one tile of zoom 3, or four of zoom 4
  const p = project(VISITOR_CENTER, 3), t = tileOf(VISITOR_CENTER, 3);
  const min = { x: t.x * 512 + 1, y: t.y * 512 + 1 }, max = { x: t.x * 512 + 511, y: t.y * 512 + 511 };
  assert.deepEqual(tilesUnder(min, max, 3, 3), [[t.x, t.y]]);
  assert.equal(tilesUnder(min, max, 3, 4).length, 4);
  assert.ok(p.x >= min.x && p.x <= max.x);
});

test('framing places: they fit in the part of the map left clear, as close as a quarter level allows', () => {
  const size = { x: 390, y: 844 }, tl = { x: 32, y: 80 }, br = { x: 32, y: 400 }, pts = [VISITOR_CENTER, AIRPORT];
  const { center, zoom } = frame(boundsOf(pts), size, tl, br, 14);
  assert.equal(zoom * 4, Math.round(zoom * 4), 'quarter levels');
  const c = project(center, zoom), on = ll => { const p = project(ll, zoom); return { x: p.x - c.x + size.x / 2, y: p.y - c.y + size.y / 2 }; };
  for (const p of pts.map(on)) {
    assert.ok(p.x >= tl.x - 0.5 && p.x <= size.x - br.x + 0.5, `x ${p.x}`);
    assert.ok(p.y >= tl.y - 0.5 && p.y <= size.y - br.y + 0.5, `y ${p.y}`);
  }
  // a quarter level closer wouldn't fit
  const span = z => { const a = project(VISITOR_CENTER, z), b = project(AIRPORT, z); return Math.abs(a.y - b.y); };
  assert.ok(span(zoom + 0.25) > size.y - tl.y - br.y);
  // one place, or places on one spot: as close as it goes
  assert.equal(frame(boundsOf([VISITOR_CENTER]), size, tl, br, 14).zoom, 14);
});

test('the routes go under the map’s names, and taps find them', () => {
  const style = { layers: [{ id: 'water', type: 'fill' }, { id: 'roads', type: 'line' }, { id: 'road-names', type: 'symbol' }, { id: 'places', type: 'symbol' }] };
  assert.equal(firstLabelLayer(style.layers), 'road-names');
  assert.equal(firstLabelLayer(osmStyle(false).layers), undefined, 'a map without names: on top');
  const ids = routeLayers().map(l => l.id);
  assert.equal(ids.at(-1), ROUTE_HIT);
  assert.ok(ids.indexOf('routes-casing') < ids.indexOf('routes-solid'), 'a casing under its line');
  assert.ok(ids.indexOf('routes-solid') < ids.indexOf('routes-casing-top'), 'the route on show over the rest');
  assert.equal(new Set(ids).size, ids.length);
});

test('a trip saved with Stadia’s pictures shows the same pictures', () => {
  const tpl = 'https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png';
  assert.deepEqual(pictureStyle(tpl, true).sources.pictures.tiles, ['https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}@2x.png']);
  assert.deepEqual(pictureStyle(tpl, false).sources.pictures.tiles, ['https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}.png']);
  assert.equal(pictureStyle(tpl, false).sources.pictures.tileSize, 256, 'pictures are 256 pixels, as they were saved');
});
