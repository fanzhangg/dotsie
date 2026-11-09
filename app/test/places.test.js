// What the Worker and the prototype both read from Overpass, Wikipedia and the OSM demo routers (web/places.js)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nominatimPlaces, nominatimURL, osrmRoute, osrmURL, placeKey, sightKind, sightsFrom, sightsQuery, tileBounds, wikiAbout, wikiPlace } from '../web/places.js';

const node = (id, tags, lat = 32.78, lon = -106.17) => ({ type: 'node', id, lat, lon, tags });

test('a sight’s kind and worth come from its tags', () => {
  assert.deepEqual(sightKind({ tourism: 'museum' }), { kind: 'museum', worth: 3 });
  assert.deepEqual(sightKind({ boundary: 'protected_area', protect_class: '2' }), { kind: 'nature', worth: 3 });
  assert.deepEqual(sightKind({ highway: 'trailhead' }), { kind: 'nature', worth: 1 });
  assert.equal(sightKind({ shop: 'bakery' }), null);
});

test('a tile’s sights: the known ones first, each place once, nameless and unknown things left out', () => {
  const sights = sightsFrom([
    node(1, { name: 'Small Plaque', historic: 'memorial' }),
    node(2, { name: 'Dune Overlook', tourism: 'viewpoint', wikipedia: 'en:Dune Overlook', wikidata: 'Q42' }),
    { type: 'way', id: 3, center: { lat: 32.79, lon: -106.2 }, tags: { name: 'Visitor Center', tourism: 'information', information: 'visitor_centre', wikidata: 'Q42' } },
    node(4, { name: 'Dune Overlook', tourism: 'viewpoint' }), // the same name again in the tile
    node(5, { tourism: 'museum' }), // no name
    node(6, { name: 'Gift Shop', shop: 'gift' }),
  ]);
  assert.deepEqual(sights.map(s => [s.id, s.name, s.kind, s.rank]), [['n2', 'Dune Overlook', 'viewpoint', 6], ['n1', 'Small Plaque', 'attraction', 1]]);
  assert.equal(sights[0].wikidata, 'Q42');
  assert.equal('wikidata' in sights[1], false);
});

test('a tile’s bounds, and the query for its sights', () => {
  const [s, w, n, e] = tileBounds(840, 1652);
  assert.ok(s < 32.7797 && 32.7797 < n && w < -106.1717 && -106.1717 < e, 'the Visitor Center is in its tile');
  assert.match(sightsQuery([s, w, n, e], 60), /^\[out:json\]\[timeout:60\]\[bbox:[-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+\];\(.*\);out center tags qt;$/);
});

test('a place’s Wikipedia article: the first search result named as it is, near it', async () => {
  assert.equal(placeKey('The Saint Francis Cathedral (Santa Fe, New Mexico)'), 'stfranciscathedral');
  const pages = [
    { index: 2, title: 'White Sands National Park', coordinates: [{ lat: 32.78, lon: -106.17 }], pageprops: { wikibase_item: 'Q1' } },
    { index: 1, title: 'White Sands Missile Range', coordinates: [{ lat: 32.38, lon: -106.48 }], pageprops: { wikibase_item: 'Q2' } },
  ];
  const get = async () => ({ query: { pages } });
  // "White Sands National Park" starts the name; the missile range doesn't
  assert.equal(await wikiPlace(get, 'White Sands National Park Visitor Center', { lat: 32.7797, lng: -106.1717 }), 'Q1');
  // too far away
  assert.equal(await wikiPlace(get, 'White Sands National Park', { lat: 40, lng: -100 }), null);
  assert.equal(await wikiPlace(get, 'WS', { lat: 32.78, lng: -106.17 }), null, 'too short a name to go by');
});

test('about a place: its article’s first lines, and a free photo with its author and license', async () => {
  const answers = {
    'www.wikidata.org': { entities: { Q1: { sitelinks: { enwiki: { title: 'White Sands National Park' } } } } },
    'en.wikipedia.org': { query: { pages: [{ title: 'White Sands National Park', extract: 'White Sands  is a park.\nIn New Mexico.', fullurl: 'https://en.wikipedia.org/wiki/White_Sands_National_Park', pageimage: 'Dunes.jpg' }] } },
    'commons.wikimedia.org': { query: { pages: [{ imageinfo: [{ thumburl: 'https://upload/x.jpg', thumbwidth: 960, thumbheight: 640, descriptionurl: 'https://commons/x', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="/u">Jo &amp; Sam</a>' } } }] }] } },
  };
  const asked = [];
  const about = await wikiAbout(async (host, params) => { asked.push(host); return answers[host]; }, 'Q1');
  assert.deepEqual(asked, ['www.wikidata.org', 'en.wikipedia.org', 'commons.wikimedia.org']);
  assert.equal(about.text, 'White Sands is a park. In New Mexico.');
  assert.deepEqual(about.image, { src: 'https://upload/x.jpg', width: 960, height: 640, license: 'CC BY-SA 4.0', page: 'https://commons/x', credit: 'Jo & Sam' });
  // no English article: nothing
  assert.equal(await wikiAbout(async () => ({ entities: { Q2: {} } }), 'Q2'), null);
});

test('the OSM demo servers: a search near a place, a route as [lat, lng]', () => {
  const u = new URL(nominatimURL('Cloudcroft', { lat: 32.9, lng: -105.7 }));
  assert.equal(u.searchParams.get('q'), 'Cloudcroft');
  assert.equal(u.searchParams.get('viewbox'), '-107.2,34.4,-104.2,31.4');
  assert.deepEqual(nominatimPlaces([{ name: '', display_name: 'Cloudcroft, Otero County', lat: '32.95', lon: '-105.74', category: 'place', type: 'village', address: { village: 'Cloudcroft', state: 'New Mexico' } }]),
    [{ name: 'Cloudcroft', address: 'Cloudcroft, New Mexico', lat: 32.95, lng: -105.74, category: 'place:village' }]);
  assert.equal(osrmURL('walk', { lat: 1, lng: 2 }, { lat: 3, lng: 4 }), 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/2,1;4,3?overview=full&geometries=geojson');
  assert.deepEqual(osrmRoute({ code: 'Ok', routes: [{ duration: 60, distance: 900, geometry: { coordinates: [[-106.123456, 32.123456]] } }] }), { duration: 60, distance: 900, coords: [[32.12346, -106.12346]] });
  assert.throws(() => osrmRoute({ code: 'NoRoute', routes: [] }), /NoRoute/);
});
