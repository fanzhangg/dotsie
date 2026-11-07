/* Place search and routes (by car, on foot, by bike), proxied so the Stadia key stays on the server, and routes are
   cached. Also the map's sights, from OpenStreetMap (see Sights below). Map tiles don't come
   through here: the browser loads them from Stadia directly, authorized by domain. */

// category is the source's place category (e.g. "accommodation", "tourism:museum"), for the app's first guess at a stop's type
export type Place = { name: string; address: string; lat: number; lng: number; category: string };
export type Route = { duration: number; distance: number; coords: [number, number][] };

const STADIA = 'https://api.stadiamaps.com';
const ROUTE_TTL = 60 * 60 * 24 * 30; // drive times barely change; refresh monthly
// The ways of getting somewhere that follow a route. Transit and flights don't: the app draws them straight, with no time.
export type RouteMode = 'drive' | 'walk' | 'bike';
export const ROUTE_MODES: readonly RouteMode[] = ['drive', 'walk', 'bike'];
const COSTING = { drive: 'auto', walk: 'pedestrian', bike: 'bicycle' } as const;
// Drives keep the key they've always had, so routes already looked up stay
const routeKey = (mode: RouteMode, a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  `${mode}:${a.lng.toFixed(5)},${a.lat.toFixed(5)};${b.lng.toFixed(5)},${b.lat.toFixed(5)}`;

// Autocomplete, biased toward the trip's area when the client sends one of its stops.
export async function searchPlaces(env: Env, q: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  if (!env.STADIA_API_KEY) return devSearch(q, near);
  const u = new URL(`${STADIA}/geocoding/v1/autocomplete`);
  u.searchParams.set('text', q);
  u.searchParams.set('size', '5');
  if (near) {
    u.searchParams.set('focus.point.lat', String(near.lat));
    u.searchParams.set('focus.point.lon', String(near.lng));
  }
  u.searchParams.set('api_key', env.STADIA_API_KEY);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Stadia search ${res.status}`);
  const { features } = await res.json<{ features: { properties: Record<string, string> & { category?: string[] }; geometry: { coordinates: [number, number] } }[] }>();
  return features.map(({ properties: p, geometry: { coordinates: [lng, lat] } }) => ({
    name: p.name,
    // In a plan the place name matters; keep the address short: street, town, state
    address: [[p.housenumber, p.street].filter(Boolean).join(' '), p.locality, p.region_a].filter(Boolean).join(', '),
    lat, lng,
    category: (p.category ?? []).join(' '),
  }));
}

export async function findRoute(env: Env, mode: RouteMode, a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<Route> {
  const key = routeKey(mode, a, b);
  const hit = await env.ROUTES.get<Route>(key, 'json');
  if (hit) return hit;
  const route = env.STADIA_API_KEY ? await stadiaRoute(env, mode, a, b) : await devRoute(mode, a, b);
  await env.ROUTES.put(key, JSON.stringify(route), { expirationTtl: ROUTE_TTL });
  return route;
}

// A route someone on the trip has already looked up, without looking it up now
export const cachedRoute = (env: Env, mode: RouteMode, a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  env.ROUTES.get<Route>(routeKey(mode, a, b), 'json');

async function stadiaRoute(env: Env, mode: RouteMode, a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<Route> {
  const res = await fetch(`${STADIA}/route/v1?api_key=${env.STADIA_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: [{ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }], costing: COSTING[mode], units: 'kilometers' }),
  });
  if (!res.ok) throw new Error(`Stadia route ${res.status}`);
  const { trip } = await res.json<{ trip: { summary: { time: number; length: number }; legs: { shape: string }[] } }>();
  return {
    duration: trip.summary.time,
    distance: Math.round(trip.summary.length * 1000),
    coords: trip.legs.flatMap(l => decodePolyline6(l.shape)),
  };
}

// ---------- Sights: what's worth seeing near the map's view ----------
// The map shows them once it's zoomed in, as a maps app shows its places. They come from OpenStreetMap through the
// public Overpass API, by tile at zoom 12 (about 10 km across, less away from the equator), and each tile is kept in
// KV for a month, so a tile costs one Overpass call however many people look at it. Only what a traveler goes to see:
// attractions, museums, viewpoints, historic sites and nature, with no shops or restaurants. OpenStreetMap says nothing
// about how popular a place is, so each sight gets a rank from what it is and whether it has a Wikipedia article or a
// Wikidata item, which well-known places mostly have and a roadside plaque mostly doesn't. The app shows the best ranked
// that fit on screen.
// wikidata is its Wikidata item ("Q123"), when OpenStreetMap has one: the app asks /api/about for its photo and a few lines.
export type Sight = { id: string; name: string; address: string; lat: number; lng: number; kind: SightKind; rank: number; wikidata?: string };
type SightKind = 'attraction' | 'museum' | 'viewpoint' | 'nature';
export const SIGHT_ZOOM = 12;
// How the sights and the lines about them are kept in KV: with when they were looked up, for a year after that. Past
// FRESH, whoever asks gets what's kept at once while it's looked up again after the answer (waitUntil), which keeps it
// another year. So a place people look at never has to wait for Overpass again, even when Overpass is down, and one
// nobody has looked at for a year drops out on its own: what an LRU cache would do, without a write for each read.
type Kept<T> = { at: number; value: T };
const KEEP = 60 * 60 * 24 * 365, FRESH = 1000 * 60 * 60 * 24 * 30;
const stale = (k: { at: number }, fresh = FRESH) => Date.now() - k.at > fresh;
const keep = <T>(env: Env, key: string, value: T, at = Date.now()) => env.ROUTES.put(key, JSON.stringify({ at, value } satisfies Kept<T>), { expirationTtl: KEEP });
const SIGHTS_PER_TILE = 80; // the best ranked: more than ever fit on a screen showing this tile
// The main public server, then another public one when it's busy or too slow
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
// After both fail on a tile, it isn't asked again for this long; an hour when there's an older copy to show meanwhile
const SIGHT_RETRY = 60 * 2, SIGHT_RETRY_STALE = 60 * 60;
// A tile Overpass hasn't answered yet: the request waits this long for it, then answers "still loading" and the lookup
// carries on after the response (waitUntil), up to the time Cloudflare gives it: about 30 s for all of it.
const SIGHT_WAIT = 8000, SIGHT_DEADLINE = 28000;
// A tile is asked as quarters (2×2), two at a time, each given 12 s by Overpass: a whole city-centre tile (Santa Fe's
// plaza, central Paris) took Overpass past its time limit, and a failed 25 s try left no time to ask again. Overpass's
// public servers let one address run only a couple of queries at once. A quarter one server fails is asked of the other.
const SIGHT_SPLIT = 2, SIGHT_PARALLEL = 2, SIGHT_PART_TIMEOUT = 12;
// A tile with a quarter missing is kept, but looked up again after an hour rather than a month
const SIGHT_PARTIAL_FRESH = 1000 * 60 * 60;
const OSM_UA = { 'User-Agent': 'Waythread (road trip planner)' }; // Overpass and Nominatim ask for one

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
// What a sight is, from its tags: its kind, for the stop it would become, and how much it's worth a visit (0–3)
function sightKind(t: Record<string, string>): { kind: SightKind; worth: number } | null {
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

// A tile's x and y at SIGHT_ZOOM, and its bounds as Overpass takes them: south, west, north, east
export function tileBounds(x: number, y: number) {
  const n = 2 ** SIGHT_ZOOM, lng = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lat(y + 1), lng(x), lat(y), lng(x + 1)];
}

// The lookup of a tile that's running, in this isolate; another isolate sees the KV mark instead
const sightsLoading = new Map<string, Promise<Sight[]>>();
// A tile's sights, or 'pending' while Overpass looks them up. Throws once a tile has just failed on both servers.
// A copy older than FRESH is answered at once and looked up again behind it.
export async function findSights(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, x: number, y: number): Promise<Sight[] | 'pending'> {
  const key = `sights:v3:${x}/${y}`, failed = `sights:failed:${x}/${y}`, loading = `sights:loading:${x}/${y}`;
  const hit = await env.ROUTES.get<Kept<Sight[]>>(key, 'json');
  if (hit && !stale(hit)) return hit.value;
  // A tile Overpass couldn't answer just now: everyone looking at it would ask again every few seconds
  if (await env.ROUTES.get(failed)) {
    if (hit) return hit.value;
    throw new Error('Overpass failed on this tile a moment ago');
  }
  let p = sightsLoading.get(key);
  if (!p) {
    // Being looked up elsewhere: one Overpass call per tile, since a second one only makes both slower
    if (await env.ROUTES.get(loading)) return hit ? hit.value : 'pending';
    await env.ROUTES.put(loading, '1', { expirationTtl: 60 });
    p = overpassSights(tileBounds(x, y)).then(async ({ sights, whole }) => {
      await keep(env, key, sights, whole ? Date.now() : Date.now() - FRESH + SIGHT_PARTIAL_FRESH);
      return sights;
    }, async e => {
      await env.ROUTES.put(failed, '1', { expirationTtl: hit ? SIGHT_RETRY_STALE : SIGHT_RETRY });
      throw e;
    }).finally(() => { sightsLoading.delete(key); ctx.waitUntil(env.ROUTES.delete(loading)); });
    sightsLoading.set(key, p);
    ctx.waitUntil(p.catch(() => {})); // finishes and is kept even after this request has answered
  }
  if (hit) return hit.value;
  const wait = new Promise<'pending'>(done => setTimeout(() => done('pending'), SIGHT_WAIT));
  return Promise.race([p, wait]);
}

type OsmElement = { type: 'node' | 'way' | 'relation'; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };
// The tile's sights, from its quarters (see SIGHT_SPLIT); whole is false when a quarter couldn't be had. Throws when
// none could. Each quarter is asked of the first server, then of the other if that fails, all within SIGHT_DEADLINE.
async function overpassSights([s, w, n, e]: number[]): Promise<{ sights: Sight[]; whole: boolean }> {
  const until = Date.now() + SIGHT_DEADLINE, parts: number[][] = [];
  for (let i = 0; i < SIGHT_SPLIT; i++) for (let j = 0; j < SIGHT_SPLIT; j++) {
    const lat = (k: number) => s + ((n - s) * k) / SIGHT_SPLIT, lng = (k: number) => w + ((e - w) * k) / SIGHT_SPLIT;
    parts.push([lat(i), lng(j), lat(i + 1), lng(j + 1)]);
  }
  const got: (OsmElement[] | null)[] = [];
  let next = 0, last: unknown;
  const worker = async () => {
    while (next < parts.length) {
      const i = next++;
      got[i] = await overpassPart(parts[i], until).catch(err => { console.error(err); last = err; return null; });
    }
  };
  await Promise.all(Array.from({ length: SIGHT_PARALLEL }, worker));
  const answered = got.filter((g): g is OsmElement[] => !!g);
  if (!answered.length) throw last ?? new Error('Overpass answered no part of this tile');
  // A place across two quarters (a park, a long trail) comes back in both: once is enough
  const seen = new Set<string>(), elements: OsmElement[] = [];
  for (const el of answered.flat()) if (!seen.has(el.type + el.id)) { seen.add(el.type + el.id); elements.push(el); }
  return { sights: sightsFrom(elements), whole: answered.length === parts.length };
}
async function overpassPart([s, w, n, e]: number[], until: number): Promise<OsmElement[]> {
  const q = `[out:json][timeout:${SIGHT_PART_TIMEOUT}][bbox:${s},${w},${n},${e}];(${SIGHT_QUERY.join(';')};);out center tags qt;`;
  let last: unknown = new Error('Overpass: no time left for this part');
  for (const url of OVERPASS) {
    const left = until - Date.now();
    if (left < 2000) break;
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { ...OSM_UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.timeout(Math.min(left, (SIGHT_PART_TIMEOUT + 3) * 1000)),
      });
      if (!res.ok) throw new Error(`Overpass ${new URL(url).host} ${res.status}`);
      const j = await res.json<{ elements: OsmElement[]; remark?: string }>();
      // A query that ran out of time or memory still answers 200, with what it found so far and a remark: not worth keeping
      if (j.remark && /error/i.test(j.remark)) throw new Error(`Overpass ${new URL(url).host}: ${j.remark}`);
      return j.elements;
    } catch (err) { last = err; }
  }
  throw last;
}
export function sightsFrom(elements: OsmElement[]): Sight[] {
  const out: Sight[] = [];
  for (const el of elements) {
    const t = el.tags ?? {}, at = el.center ?? (el.lat != null ? { lat: el.lat, lon: el.lon! } : null), what = sightKind(t);
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
  const kept: Sight[] = [], names = new Set<string>(), items = new Set<string>();
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

// ---------- About a sight: a few lines from English Wikipedia and its photo from Wikimedia Commons ----------
// From the sight's Wikidata item: its English Wikipedia article, that article's first sentences and its lead picture
// (only a free one, so it's on Commons), then the picture's author and license, which the app shows under it. null
// when there's no article. Kept in KV as `about:v1:Q123` like the sights (see KEEP), looked up again after a month, or a
// week when there was nothing. Nothing needs a key.
export type About = {
  title: string; text: string; url: string;
  image: { src: string; width: number; height: number; credit: string; license: string; page: string } | null;
} | null;
export const QID = /^Q[1-9]\d{0,11}$/;
const ABOUT_NONE_FRESH = 1000 * 60 * 60 * 24 * 7;
const ABOUT_TEXT = 1200, ABOUT_CREDIT = 100;
const ABOUT_PHOTO = 960; // px wide: a card's photo on a phone at 2x, from Wikimedia's standard thumbnail sizes

// The lookups running in this isolate, so a card many people open at once is looked up again only once
const aboutsLoading = new Map<string, Promise<About>>();
export async function findAbout(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, qid: string): Promise<About> {
  const key = `about:v1:${qid}`;
  const hit = await env.ROUTES.get<Kept<About>>(key, 'json');
  if (hit && !stale(hit, hit.value ? FRESH : ABOUT_NONE_FRESH)) return hit.value;
  let p = aboutsLoading.get(key);
  if (!p) {
    p = wikiAbout(qid).then(async about => { await keep(env, key, about); return about; }).finally(() => aboutsLoading.delete(key));
    aboutsLoading.set(key, p);
    ctx.waitUntil(p.catch(e => console.error(e)));
  }
  // An older copy answers now; if Wikipedia fails, it's still there to answer the next time
  return hit ? hit.value : p;
}
// The prototype has a copy of this, asked straight from the browser: keep them the same
async function wikiAbout(qid: string): Promise<About> {
  const get = async (host: string, params: Record<string, string>) => {
    const res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, { headers: OSM_UA, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${host} ${res.status}`);
    return res.json<any>();
  };
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
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };
const plainText = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e) => ENTITIES[e]).replace(/\s+/g, ' ').trim();

// ---------- Local dev without a Stadia key: the public OSM demo servers (not for production traffic) ----------
const DEV_UA = { 'User-Agent': 'Waythread-dev (local development)' }; // Nominatim requires one

async function devSearch(q: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  u.search = new URLSearchParams({ format: 'jsonv2', limit: '5', addressdetails: '1', q }).toString();
  if (near) u.searchParams.set('viewbox', `${near.lng - 1.5},${near.lat + 1.5},${near.lng + 1.5},${near.lat - 1.5}`);
  const res = await fetch(u, { headers: DEV_UA });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const list = await res.json<{ name: string; display_name: string; lat: string; lon: string; category: string; type: string; address?: Record<string, string> }[]>();
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

// The OSRM demo server only drives; OpenStreetMap Germany's runs the same API on foot and by bike (as openstreetmap.org's
// directions call it: the profile in the path is always driving, the server decides)
const DEV_ROUTER = {
  drive: 'https://router.project-osrm.org/route/v1/driving',
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
  bike: 'https://routing.openstreetmap.de/routed-bike/route/v1/driving',
};
async function devRoute(mode: RouteMode, a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<Route> {
  const res = await fetch(`${DEV_ROUTER[mode]}/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { headers: DEV_UA });
  const j = await res.json<{ code: string; routes: { duration: number; distance: number; geometry: { coordinates: [number, number][] } }[] }>();
  if (j.code !== 'Ok') throw new Error(`OSRM ${j.code}`);
  const rt = j.routes[0];
  return { duration: rt.duration, distance: rt.distance, coords: rt.geometry.coordinates.map(([x, y]) => [+y.toFixed(5), +x.toFixed(5)]) };
}

// Valhalla encodes shapes as Google polylines with 6 digits of precision; output is [lat, lng] at 5.
function decodePolyline6(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let shift = 0, result = 0, b;
    do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lng += next();
    out.push([+(lat / 1e6).toFixed(5), +(lng / 1e6).toFixed(5)]);
  }
  return out;
}
