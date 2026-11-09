/* Place search and routes (by car, on foot, by bike), proxied so the Stadia key stays on the server, and routes are
   cached. Also the map's sights, from OpenStreetMap (see Sights below). Map tiles don't come
   through here: the browser loads them from Stadia directly, authorized by domain. */
import { OVERPASS, nominatimPlaces, nominatimURL, osrmRoute, osrmURL, placeKey, sightsFrom, sightsQuery, wikiAbout, wikiPlace, type About, type OsmElement, type Place, type Route, type Sight } from '../web/places.js';
export { SIGHT_ZOOM, tileBounds } from '../web/places.js';
export type { About, Place, Route, Sight };

// category is the source's place category (e.g. "accommodation", "tourism:museum"), for the app's first guess at a stop's type

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
// How the sights and the lines about them are kept in KV: with when they were looked up, for a year after that. Past
// FRESH, whoever asks gets what's kept at once while it's looked up again behind the answer (a tile in its
// SightsLookup, the lines after the response), which keeps it another year. So a place people look at never has to wait for Overpass again, even when Overpass is down, and one
// nobody has looked at for a year drops out on its own: what an LRU cache would do, without a write for each read.
type Kept<T> = { at: number; value: T };
const KEEP = 60 * 60 * 24 * 365, FRESH = 1000 * 60 * 60 * 24 * 30;
const stale = (k: { at: number }, fresh = FRESH) => Date.now() - k.at > fresh;
export const keep = <T>(env: Env, key: string, value: T, at = Date.now()) => env.ROUTES.put(key, JSON.stringify({ at, value } satisfies Kept<T>), { expirationTtl: KEEP });
// Two public servers, asked at once: whichever answers first is used. Each is given SIGHT_TIMEOUT s (Overpass's own
// limit for the query) and a little more to send it back. They're slow because they're busy, not because a tile is
// big: a query for three museums took mail.ru 15–22 s, a whole tile 20–28 s. Asking them in quarters only made four
// waits of that, and asking one and then the other left the second no time, so both are asked from the start. The
// lookup runs in the tile's SightsLookup Durable Object (sights.ts), which can wait that long; a request can't.
const SIGHT_TIMEOUT = 60, SIGHT_ABORT = 75_000;
export const sightsKey = (x: number, y: number) => `sights:v3:${x}/${y}`;
const OSM_UA = { 'User-Agent': 'Dotsie (road trip planner)' }; // Overpass and Nominatim ask for one

// A tile's sights, or 'pending' while its SightsLookup asks Overpass for them. Throws once both servers have just failed
// on it. A copy older than FRESH is answered at once and looked up again behind it.
export async function findSights(env: Env, x: number, y: number): Promise<Sight[] | 'pending'> {
  const hit = await env.ROUTES.get<Kept<Sight[]>>(sightsKey(x, y), 'json');
  if (hit && !stale(hit)) return hit.value;
  const look = await env.SIGHTS.get(env.SIGHTS.idFromName(`${x}/${y}`)).look(x, y, !!hit);
  if (typeof look === 'object') return look.sights;
  if (hit) return hit.value;
  if (look === 'failed') throw new Error('Overpass failed on this tile a moment ago');
  return 'pending';
}

// A tile's sights from Overpass: both servers at once, the first good answer. Throws, with each server's reason in the
// log, when neither gives one.
export async function overpassSights([s, w, n, e]: number[]): Promise<Sight[]> {
  const q = sightsQuery([s, w, n, e], SIGHT_TIMEOUT);
  const done = new AbortController();
  const ask = async (url: string) => {
    const host = new URL(url).host, t = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { ...OSM_UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`,
        signal: AbortSignal.any([done.signal, AbortSignal.timeout(SIGHT_ABORT)]),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = await res.json<{ elements: OsmElement[]; remark?: string }>();
      // A query that ran out of time or memory still answers 200, with what it found so far and a remark: not worth keeping
      if (j.remark && /error/i.test(j.remark)) throw new Error(j.remark);
      return sightsFrom(j.elements);
    } catch (err) {
      if (!done.signal.aborted) console.error(`Overpass ${host} after ${Math.round((Date.now() - t) / 1000)} s: ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  };
  try {
    return await Promise.any(OVERPASS.map(ask));
  } catch (err) {
    throw err instanceof AggregateError ? err.errors[0] : err;
  } finally {
    done.abort(); // the other server's answer, if it's still coming, isn't needed
  }
}
// ---------- About a sight: a few lines from English Wikipedia and its photo from Wikimedia Commons ----------
// From the sight's Wikidata item: its English Wikipedia article, that article's first sentences and its lead picture
// (only a free one, so it's on Commons), then the picture's author and license, which the app shows under it. null
// when there's no article. Kept in KV as `about:v1:Q123` like the sights (see KEEP), looked up again after a month, or a
// week when there was nothing. Nothing needs a key.
const ABOUT_NONE_FRESH = 1000 * 60 * 60 * 24 * 7;

// The lookups running in this isolate, so a card many people open at once is looked up again only once
const aboutsLoading = new Map<string, Promise<About>>();
export async function findAbout(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, qid: string): Promise<About> {
  const key = `about:v1:${qid}`;
  const hit = await env.ROUTES.get<Kept<About>>(key, 'json');
  if (hit && !stale(hit, hit.value ? FRESH : ABOUT_NONE_FRESH)) return hit.value;
  let p = aboutsLoading.get(key);
  if (!p) {
    p = wikiAbout(wikiGet, qid).then(async about => { await keep(env, key, about); return about; }).finally(() => aboutsLoading.delete(key));
    aboutsLoading.set(key, p);
    ctx.waitUntil(p.catch(e => console.error(e)));
  }
  // An older copy answers now; if Wikipedia fails, it's still there to answer the next time
  return hit ? hit.value : p;
}

// A place that isn't a sight on the map (found by place search, or added by an assistant) has no Wikidata item, but
// it may have an English Wikipedia article all the same: the Home card's photos ask for it by its name and where it is.
// It's the article Wikipedia's search puts first whose title is the place's name (or starts its name: "White Sands
// National Park" for its visitor center) and whose place is within PLACE_NEAR of it. Then it's that article's item,
// as above. Which item a place is, or that it has none, is kept in KV as `place:v1:<name>@<where>`, like an about.
export async function findPlaceAbout(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, name: string, at: { lat: number; lng: number }): Promise<About> {
  const key = `place:v1:${placeKey(name)}@${at.lat.toFixed(3)},${at.lng.toFixed(3)}`;
  const hit = await env.ROUTES.get<Kept<string | null>>(key, 'json');
  let qid = hit?.value ?? null;
  if (!hit || stale(hit, hit.value ? FRESH : ABOUT_NONE_FRESH)) {
    try {
      qid = await wikiPlace(wikiGet, name, at);
      ctx.waitUntil(keep(env, key, qid).catch(e => console.error(e)));
    } catch (e) {
      if (!hit) throw e; // an older answer stands in while Wikipedia fails
    }
  }
  return qid ? findAbout(env, ctx, qid) : null;
}
const wikiGet = async (host: string, params: Record<string, string>) => {
  const res = await fetch(`https://${host}/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`, { headers: OSM_UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`${host} ${res.status}`);
  return res.json<any>();
};
// ---------- Local dev without a Stadia key: the public OSM demo servers (not for production traffic) ----------
const DEV_UA = { 'User-Agent': 'Dotsie-dev (local development)' }; // Nominatim requires one

async function devSearch(q: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  const res = await fetch(nominatimURL(q, near), { headers: DEV_UA });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  return nominatimPlaces(await res.json());
}

async function devRoute(mode: RouteMode, a: { lat: number; lng: number }, b: { lat: number; lng: number }): Promise<Route> {
  const res = await fetch(osrmURL(mode, a, b), { headers: DEV_UA });
  return osrmRoute(await res.json());
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
