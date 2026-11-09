// @ts-check
/* Places, sights and drives from the open map services: what's asked of OpenStreetMap's Overpass, of Wikidata,
   Wikipedia and Wikimedia Commons, and of the OSM demo routers, and how their answers are read. The Worker asks them
   (src/maps.ts, with its keys, caching and limits) and so does the prototype, straight from the browser
   (prototype/backend.js): each fetches in its own way, and passes its fetch in where one is needed. No DOM: the tests
   import this. */
import { QID } from './fields.js';

/** @typedef {{ name: string, address: string, lat: number, lng: number, category: string }} Place */
/** @typedef {{ duration: number, distance: number, coords: [number, number][] }} Route */
/** @typedef {'attraction' | 'museum' | 'viewpoint' | 'nature'} SightKind */
/** @typedef {{ id: string, name: string, address: string, lat: number, lng: number, kind: SightKind, rank: number, wikidata?: string }} Sight */
/** @typedef {{ type: 'node' | 'way' | 'relation', id: number, lat?: number, lon?: number, center?: { lat: number, lon: number }, tags?: Record<string, string> }} OsmElement */
/** @typedef {{ title: string, text: string, url: string, image: { src: string, width: number, height: number, credit: string, license: string, page: string } | null } | null} About */
/** @typedef {{ lat: number, lng: number }} LatLng */

// ---------- Sights: what's worth seeing in a map tile, from OpenStreetMap ----------
export const SIGHT_ZOOM = 12;
const SIGHTS_PER_TILE = 80; // the best ranked: more than ever fit on a screen showing this tile
// Two public servers, asked at once: whichever answers first is used (see overpassSights in src/maps.ts for why)
export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
// Each line is a kind of sight. Minor kinds need a Wikidata item or a Wikipedia article to count: OpenStreetMap maps
// every named peak, park and plaque, and only the known ones are worth a trip. Only parks and protected areas are asked
// for as relations too: matching a relation means loading its outline, and a tile crossed by a huge one (a missile range
// by White Sands, a state's border) took Overpass past its time limit.
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
/** Overpass's query for the sights in a box, given `timeout` seconds @param {number[]} bounds south, west, north, east @param {number} timeout */
export const sightsQuery = ([s, w, n, e], timeout) => `[out:json][timeout:${timeout}][bbox:${s},${w},${n},${e}];(${SIGHT_QUERY.join(';')};);out center tags qt;`;
/** A tile's x and y at SIGHT_ZOOM, and its bounds as Overpass takes them: south, west, north, east @param {number} x @param {number} y */
export function tileBounds(x, y) {
  const n = 2 ** SIGHT_ZOOM, lng = (/** @type {number} */ i) => (i / n) * 360 - 180;
  const lat = (/** @type {number} */ j) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lat(y + 1), lng(x), lat(y), lng(x + 1)];
}
/** What a sight is, from its tags: its kind, for the stop it would become, and how much it's worth a visit (0–3)
 * @param {Record<string, string>} t @returns {{ kind: SightKind, worth: number } | null} */
export function sightKind(t) {
  const tourism = t.tourism, historic = t.historic;
  if (tourism === 'museum') return { kind: 'museum', worth: 3 };
  if (tourism === 'gallery') return { kind: 'museum', worth: 2 };
  if (tourism === 'viewpoint') return { kind: 'viewpoint', worth: 2 };
  if (tourism && /^(attraction|zoo|theme_park|aquarium)$/.test(tourism)) return { kind: 'attraction', worth: 3 };
  // A national park is often mapped as a protected area of class 2
  if (t.boundary === 'national_park' || t.protected_area === 'national_park' || (t.boundary === 'protected_area' && t.protect_class === '2')) return { kind: 'nature', worth: 3 };
  if (historic && /^(castle|palace|fort)$/.test(historic)) return { kind: 'attraction', worth: 3 };
  if (historic && /^(monument|archaeological_site|ship|city_gate)$/.test(historic)) return { kind: 'attraction', worth: 2 };
  if (t.waterway === 'waterfall' || t.natural) return { kind: 'nature', worth: 2 };
  if (t.leisure || t.boundary) return { kind: 'nature', worth: 1 };
  if (historic || t.man_made === 'lighthouse' || t.amenity === 'place_of_worship') return { kind: 'attraction', worth: 1 };
  // Where a park's visit starts: its visitor center, and its trails
  if (tourism === 'information') return { kind: 'attraction', worth: 1 };
  if (t.highway === 'trailhead') return { kind: 'nature', worth: 1 };
  return null;
}
/** A tile's sights from what Overpass found, the best known first @param {OsmElement[]} elements @returns {Sight[]} */
export function sightsFrom(elements) {
  /** @type {Sight[]} */
  const out = [];
  for (const el of elements) {
    const t = el.tags ?? {}, at = el.center ?? (el.lat != null && el.lon != null ? { lat: el.lat, lon: el.lon } : null), what = sightKind(t);
    if (!t.name || !at || !what) continue;
    // Known places first: a Wikipedia article counts most, then a Wikidata item. A mapped area (a park, a castle's
    // walls) beats a point (a statue, a sign) of the same kind.
    const rank = what.worth + (t.wikipedia ? 4 : t.wikidata ? 2 : 0) + (el.type === 'node' ? 0 : 1);
    out.push({
      id: `${el.type[0]}${el.id}`, wikidata: QID.test(t.wikidata ?? '') ? t.wikidata : undefined, name: t.name, lat: +at.lat.toFixed(5), lng: +at.lon.toFixed(5), kind: what.kind, rank,
      address: [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', '),
    });
  }
  // One place mapped more than once is one sight, the better ranked: a museum's point and its building, a park's area
  // and a point in it with the same Wikidata item, or a name used twice in the tile (three viewpoints all called
  // "Interdune" along one boardwalk)
  out.sort((a, b) => b.rank - a.rank);
  /** @type {Sight[]} */
  const kept = [];
  const names = new Set(), items = new Set();
  for (const sg of out) {
    if (names.has(sg.name) || (sg.wikidata && items.has(sg.wikidata))) continue;
    names.add(sg.name);
    if (sg.wikidata) items.add(sg.wikidata);
    else delete sg.wikidata;
    kept.push(sg);
    if (kept.length === SIGHTS_PER_TILE) break;
  }
  return kept;
}

// ---------- About a place: a few lines from English Wikipedia and its photo from Wikimedia Commons ----------
// `get(host, params)` asks a MediaWiki API (format=json, formatversion=2) for its JSON answer: the Worker's sends a
// User-Agent; the browser's adds origin=*, which those APIs ask of a page on another site.
/** @typedef {(host: string, params: Record<string, string>) => Promise<any>} WikiGet */
const ABOUT_TEXT = 1200, ABOUT_CREDIT = 100;
const ABOUT_PHOTO = 960; // px wide: a card's photo on a phone at 2x, from Wikimedia's standard thumbnail sizes
const PLACE_NEAR = 50; // km: a park's or a town's article is placed at its middle
/** A name as titles are compared: no "(Santa Fe, New Mexico)" or ", New Mexico", no leading "The", "St." for "Saint",
 * then letters and digits only @param {string} n */
export const placeKey = n => n.replace(/\s*\([^)]*\)/g, '').replace(/,.*$/, '').replace(/^\s*the\s+/i, '').replace(/\bsaint\b/gi, 'st')
  .normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
/** @param {LatLng} a @param {LatLng} b */
export const kmBetween = (a, b) => {
  const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371;
};
/**
 * A place with no Wikidata item, by its name and where it is: the item of the article Wikipedia's search puts first
 * whose title is the place's name (or starts it: "White Sands National Park" for its visitor center) and whose place is
 * within PLACE_NEAR of it. Null for none.
 * @param {WikiGet} get @param {string} name @param {LatLng} at @returns {Promise<string | null>}
 */
export async function wikiPlace(get, name, at) {
  const n = placeKey(name);
  if (n.length < 4) return null;
  /** @type {any[]} */
  const pages = (await get('en.wikipedia.org', {
    action: 'query', generator: 'search', gsrsearch: name, gsrnamespace: '0', gsrlimit: '5', prop: 'coordinates|pageprops', ppprop: 'wikibase_item|disambiguation',
  })).query?.pages ?? [];
  const page = pages.sort((a, b) => a.index - b.index).find(p => {
    const t = placeKey(p.title), c = p.coordinates?.[0];
    return (t === n || (t.length >= 8 && n.startsWith(t))) && c && kmBetween(at, { lat: c.lat, lng: c.lon }) <= PLACE_NEAR
      && p.pageprops?.disambiguation === undefined && QID.test(p.pageprops?.wikibase_item ?? '');
  });
  return page?.pageprops.wikibase_item ?? null;
}
/**
 * From a Wikidata item: its English Wikipedia article, that article's first sentences and its lead picture (only a
 * free one, so it's on Commons), then the picture's author and license, which the app shows under it. Null when
 * there's no article.
 * @param {WikiGet} get @param {string} qid @returns {Promise<About>}
 */
export async function wikiAbout(get, qid) {
  const item = await get('www.wikidata.org', { action: 'wbgetentities', ids: qid, props: 'sitelinks', sitefilter: 'enwiki' });
  const title = item.entities?.[qid]?.sitelinks?.enwiki?.title;
  if (!title) return null;
  const page = (await get('en.wikipedia.org', {
    action: 'query', titles: title, redirects: '1', prop: 'extracts|pageimages|info|pageprops',
    exintro: '1', explaintext: '1', exsentences: '3', piprop: 'name', pilicense: 'free', inprop: 'url', ppprop: 'disambiguation',
  })).query?.pages?.[0];
  const text = (page?.extract ?? '').replace(/\s+/g, ' ').trim();
  if (!page || page.missing || page.pageprops?.disambiguation !== undefined || !text) return null;
  /** @type {NonNullable<About>['image']} */
  let image = null;
  // A drawing (a logo, a map, a flag) isn't a picture of the place
  if (page.pageimage && !/\.svg$/i.test(page.pageimage)) {
    const info = (await get('commons.wikimedia.org', {
      action: 'query', titles: `File:${page.pageimage}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(ABOUT_PHOTO),
      iiextmetadatafilter: 'Artist|LicenseShortName',
    })).query?.pages?.[0]?.imageinfo?.[0];
    const meta = info?.extmetadata ?? {}, license = plainText(meta.LicenseShortName?.value ?? '');
    if (info?.thumburl && license) image = {
      src: info.thumburl, width: info.thumbwidth, height: info.thumbheight, license, page: info.descriptionurl,
      credit: plainText(meta.Artist?.value ?? '').slice(0, ABOUT_CREDIT),
    };
  }
  return { title: page.title, text: text.slice(0, ABOUT_TEXT), url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`, image };
}
// Commons gives an author as HTML (a link to their user page, often): just the words
/** @type {Record<string, string>} */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
/** @param {string} html */
const plainText = html => html.replace(/<[^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENTITIES[e]).replace(/\s+/g, ' ').trim();

// ---------- Without a Stadia key (local dev, the prototype): the public OSM demo servers, not for production traffic ----------
/** Nominatim's address for a place search, near a point when there's one @param {string} q @param {LatLng} [near] */
export function nominatimURL(q, near) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ format: 'jsonv2', limit: '5', addressdetails: '1', q }).toString();
  if (near) u.searchParams.set('viewbox', `${near.lng - 1.5},${near.lat + 1.5},${near.lng + 1.5},${near.lat - 1.5}`);
  return u.href;
}
/** Nominatim's answer as places: in a plan the place name matters, so the address is short (street, town, state)
 * @param {{ name: string, display_name: string, lat: string, lon: string, category: string, type: string, address?: Record<string, string> }[]} list
 * @returns {Place[]} */
export const nominatimPlaces = list => list.map(p => {
  const a = p.address ?? {};
  return {
    name: p.name || p.display_name.split(', ')[0],
    address: [[a.house_number, a.road].filter(Boolean).join(' '), a.city || a.town || a.village, a.state].filter(Boolean).join(', '),
    lat: +p.lat, lng: +p.lon,
    category: `${p.category}:${p.type}`,
  };
});
// The OSRM demo server only drives; OpenStreetMap Germany's runs the same API on foot and by bike (as openstreetmap.org's
// directions call it: the profile in the path is always driving, the server decides)
const OSRM = {
  drive: 'https://router.project-osrm.org/route/v1/driving',
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
};
/** OSRM's address for a route @param {'drive' | 'walk' | 'bike'} mode @param {LatLng} a @param {LatLng} b */
export const osrmURL = (mode, a, b) => `${OSRM[mode]}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
/** OSRM's answer as a route, its points [lat, lng] to 5 places; throws when it found none
 * @param {{ code: string, routes: { duration: number, distance: number, geometry: { coordinates: [number, number][] } }[] }} j @returns {Route} */
export function osrmRoute(j) {
  if (j.code !== 'Ok') throw new Error(`OSRM ${j.code}`);
  const rt = j.routes[0];
  return { duration: rt.duration, distance: rt.distance, coords: rt.geometry.coordinates.map(([x, y]) => /** @type {[number, number]} */ ([+y.toFixed(5), +x.toFixed(5)])) };
}
