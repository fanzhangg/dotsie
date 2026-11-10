import { Hono, type Context } from 'hono';
import { csrf } from 'hono/csrf';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createAuth, isLocal, type Auth } from './auth';
import { QID } from '../web/fields.js';
import { regionsMatching } from '../web/regions.js';
import { findAbout, findPlaceAbout, findRoute, findSights, ROUTE_MODES, searchPlaces, SIGHT_ZOOM, type RouteMode } from './maps';
import { AUTHORIZE_PATH, authorizeDecision, authorizePage, listConnections, mcpURL, oauthApi, oauthProvider, oauthSpec } from './oauth';
import { mcpSpec } from './mcp';
import { ERR } from './stop';
import type { Preview } from './trip';

export { TripRoom } from './trip';
export { SightsLookup } from './sights';

/* Dotsie API. Static files are served by the assets binding; only /api/* (and the page itself, see "Moved") reaches
   this Worker.
   Auth is a session cookie (Better Auth). Each trip's data lives in its TripRoom Durable Object,
   which checks membership itself; this layer authenticates, validates the URL, and routes. */

type User = { id: string; name: string; image: string | null };
type AppEnv = { Bindings: Env; Variables: { user: User; guest: boolean } };
const app = new Hono<AppEnv>().basePath('/api');

let auth: Auth | undefined; // env is the same for every request in an isolate
const getAuth = (env: Env) => (auth ??= createAuth(env));

const RATE_LIMITED = 'rate_limited';
const STATUS: Record<string, ContentfulStatusCode> = { [ERR.notFound]: 404, [ERR.notMember]: 403, [ERR.notOwner]: 403, [ERR.gone]: 410, [ERR.invalid]: 400, [RATE_LIMITED]: 429 };
app.onError((err, c) => {
  const status = STATUS[err.message];
  if (status) return c.json({ error: err.message }, status);
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});
const bad = () => { throw new Error(ERR.invalid); };

app.use(csrf()); // writes must come from our own origin

// ---------- Rate limits ----------
// Cloudflare's rate-limiting binding: counts are kept per Cloudflare location and are approximate,
// which is enough to stop scripted sign-ups and runaway map calls billed to the Stadia key.
const tooMany = async (limiter: RateLimit, key: string) => !(await limiter.limit({ key })).success;
const rateLimited = (c: Context<AppEnv>) => c.json({ error: RATE_LIMITED }, 429);
// Sign-in and sign-up (guest, password, Google/Apple) create accounts or check passwords: limit per IP.
const signInLimit = async (c: Context<AppEnv>, next: () => Promise<void>) => {
  if (c.req.method === 'POST' && await tooMany(c.env.SIGNIN_LIMIT, c.req.header('cf-connecting-ip') ?? 'local')) return rateLimited(c);
  await next();
};
app.use('/auth/sign-in/*', signInLimit);
app.use('/auth/sign-up/*', signInLimit);
app.on(['GET', 'POST'], '/auth/*', c => getAuth(c.env).handler(c.req.raw));

// ---------- Before sign-in ----------
// Which sign-in buttons to show
app.get('/config', c => c.json({ google: !!c.env.GOOGLE_CLIENT_ID, apple: !!c.env.APPLE_CLIENT_ID, password: true }));
// Where an email address leads, so sign-in can ask for the right thing next: its password, Google,
// or a new account. This does tell anyone whether an address has an account here; that's the price
// of not making people guess between "sign in" and "sign up", and the per-IP limit keeps it slow.
app.post('/sign-in-options', signInLimit, async c => {
  const { email } = await body(c.req.raw);
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) bad();
  const { results } = await c.env.DB.prepare(
    `select a.providerId as provider from "user" u join account a on a.userId = u.id
     where u.email = ? and coalesce(u.isAnonymous, 0) = 0`,
  ).bind((email as string).trim().toLowerCase()).all<{ provider: string }>();
  const providers = results.map(r => r.provider);
  const account = providers.includes('credential') ? 'password' : providers.includes('google') ? 'google'
    : providers.length ? 'other' : 'none';
  return c.json({ account });
});
// The trip name for a share link, so the sign-in screen can say what you're joining.
// Anyone holding the link may join anyway, so its name is no secret from them.
app.get('/invite/:token', async c => {
  const row = await c.env.DB.prepare('select name from trips where invite_hash = ? and deleted_at is null')
    .bind(await sha256(c.req.param('token'))).first<{ name: string }>();
  if (!row) throw new Error(ERR.notFound);
  return c.json(row);
});

// ---------- Connecting an AI assistant (OAuth's authorize step; see src/oauth.ts) ----------
// A page, not an API call: without a session it sends you to sign in rather than answering 401.
const signedIn = async (c: Context<AppEnv>) => {
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return null;
  const u = session.user as typeof session.user & { isAnonymous?: boolean | null };
  return { id: u.id, name: u.name, email: u.isAnonymous ? null : u.email, guest: !!u.isAnonymous };
};
app.get(AUTHORIZE_PATH.slice(4), async c => authorizePage(c.req.raw, c.env, await signedIn(c)));
app.post(AUTHORIZE_PATH.slice(4), async c => authorizeDecision(c.req.raw, c.env, await signedIn(c)));

// ---------- For developers (the pages under /developer), open to anyone ----------
// The MCP server's tools, version and instructions, and how a client signs in: what /developer/mcp, /developer/tools
// and /developer/sign-in document, from the code that runs them
app.get('/developer/mcp', c => c.json({ url: mcpURL(c.env), ...mcpSpec(), oauth: oauthSpec(c.env) }, 200, { 'Cache-Control': 'public, max-age=300' }));

// ---------- Spots data: what outside sources say about places, open to anyone, read-only ----------
// Loaded per state by the Spots data workflow (pipeline/export_d1.py) and shown at /developer/spots. Every lookup reads
// D1, so they're limited per IP.
const dataLimit = async (c: Context<AppEnv>, next: () => Promise<void>) => {
  if (await tooMany(c.env.DATA_LIMIT, c.req.header('cf-connecting-ip') ?? 'local')) return rateLimited(c);
  await next();
};
app.use('/developer/spots/*', dataLimit);
const STATE = /^[A-Z]{2}$/;
const SOURCE = /^(wikidata|nps:[a-z]{2,20})$/;
const PLACE_ID = /^[A-Za-z0-9-]{1,64}$/;
type PlaceRow = { source: string; id: string; state: string; name: string; description: string | null; lat: number | null; lng: number | null; types: string | null; views: number | null };
const place = ({ types, ...p }: PlaceRow) => ({ ...p, types: JSON.parse(types ?? '[]') as string[] });
// The states loaded so far, and when
app.get('/developer/spots/states', async c => {
  const { results } = await c.env.DB.prepare('select state, loaded_at as loadedAt, built_at as builtAt, records from place_loads order by state').all();
  return c.json(results);
});
// Places with a word starting with each word of q ("mount rai" finds Mount Rainier; all, when q is empty), most read on
// Wikipedia first, 50 at a time, through the names' full-text index (migrations/0007_places_search.sql), so a search
// reads the places that match, not the whole table. source "nps" is every NPS endpoint.
const nameMatch = (q: string) => (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8)
  .map(w => `"${w}"${w.length > 1 ? '*' : ''}`).join(' ');
app.get('/developer/spots/search', async c => {
  const q = (c.req.query('q') ?? '').trim(), state = c.req.query('state') ?? '', source = c.req.query('source') ?? '';
  const offset = Number(c.req.query('offset') ?? 0);
  if (q.length > 100 || (state && !STATE.test(state)) || (source && source !== 'nps' && !SOURCE.test(source))
    || !Number.isInteger(offset) || offset < 0 || offset > 5000) bad();
  const match = nameMatch(q);
  if (q && !match) return c.json({ results: [], more: false }); // only punctuation: no word to look for
  const where: string[] = [], args: (string | number)[] = [];
  if (match) { where.push('places_fts match ?'); args.push(match); }
  if (state) { where.push('p.state = ?'); args.push(state); }
  if (source === 'nps') where.push(`p.source >= 'nps:' and p.source < 'nps;'`); // a range, so places_by_source serves it
  else if (source) { where.push('p.source = ?'); args.push(source); }
  const { results } = await c.env.DB.prepare(
    `select p.source, p.id, p.state, p.name, p.description, p.lat, p.lng, p.types, p.views
     from ${match ? 'places_fts join places p on p.n = places_fts.rowid' : 'places p'}
     ${where.length ? 'where ' + where.join(' and ') : ''} order by p.views desc nulls last, p.name limit 51 offset ?`,
  ).bind(...args, offset).all<PlaceRow>();
  return c.json({ results: results.slice(0, 50).map(place), more: results.length > 50 });
});
// One place: everything loaded about it, what each identifier is called, and the records it shares an identifier with
app.get('/developer/spots/place/:source/:id', async c => {
  const source = c.req.param('source'), id = c.req.param('id');
  if (!SOURCE.test(source) || !PLACE_ID.test(id)) bad();
  const row = await c.env.DB.prepare('select source, id, state, name, description, lat, lng, types, url, wikipedia, website, views, ids from places where source = ? and id = ?').bind(source, id)
    .first<PlaceRow & { url: string | null; wikipedia: string | null; website: string | null; ids: string | null }>();
  if (!row) throw new Error(ERR.notFound);
  const ids = JSON.parse(row.ids ?? '{}') as Record<string, string[]>;
  const schemes = Object.keys(ids).slice(0, 90);
  const [names, links] = await Promise.all([
    schemes.length ? c.env.DB.prepare(`select scheme, label from place_schemes where scheme in (${schemes.map(() => '?').join(',')})`)
      .bind(...schemes).all<{ scheme: string; label: string }>() : { results: [] },
    c.env.DB.prepare(
      `select l.via, p.source, p.id, p.name from place_links l join places p
         on (p.source = l.source_b and p.id = l.id_b and l.source_a = ?1 and l.id_a = ?2)
         or (p.source = l.source_a and p.id = l.id_a and l.source_b = ?1 and l.id_b = ?2)`,
    ).bind(source, id).all<{ via: string; source: string; id: string; name: string }>(),
  ]);
  return c.json({ ...place(row), url: row.url, wikipedia: row.wikipedia, website: row.website, ids,
    schemes: Object.fromEntries(names.results.map(n => [n.scheme, n.label])), links: links.results });
});

// ---------- Spots guides: each destination's picks and their guidebook entries, for review ----------
// Written by a model from the sources each entry lists (pipeline/guides.py), loaded by the Spots guides workflow and
// shown at /developer/guide. CC BY-SA 4.0.
const DESTINATION = /^[a-z0-9-]{1,40}$/;
const json = <T>(v: string | null, empty: T) => (v ? JSON.parse(v) as T : empty);
type GuideRow = { source: string; id: string; state: string; name: string; one_liner: string; paragraphs: string; practical: string | null;
  sources: string | null; images: string | null; overlap: number | null; model: string | null; prompt: string | null; created_at: string };
type Images = { hero: Record<string, unknown> | null; inline: Record<string, unknown>[] };
// How much a pick is read about: its English Wikipedia views over the last 12 months. An NPS record has no article of
// its own, so it takes the views of the Wikidata item it shares an identifier with (place_links), the most read if
// there are several. Needs `g` (spot_guides) and `pl` (its row in places) in the query. CROSS JOIN starts from the pick's
// few links and looks each item up by its key: left to itself, SQLite went through every Wikidata row in places for each pick.
const VIEWS = `coalesce(pl.views, (select max(w.views) from place_links l cross join places w on w.source = 'wikidata' and (
    (l.source_a = g.source and l.id_a = g.id and w.source = l.source_b and w.id = l.id_b)
    or (l.source_b = g.source and l.id_b = g.id and w.source = l.source_a and w.id = l.id_a))))`;
// The destinations with picks so far
app.get('/developer/spots/guides', async c => {
  const { results } = await c.env.DB.prepare(
    `select d.id, d.name, d.state, d.kind, d.built_at as builtAt, count(p.id) as picks from spot_destinations d
       left join spot_picks p on p.destination = d.id group by d.id order by d.name`).all();
  return c.json(results);
});
// A destination's picks, in order, each with its one-liner and lead photo, and what was left out
app.get('/developer/spots/guides/:destination', async c => {
  const dest = c.req.param('destination');
  if (!DESTINATION.test(dest)) bad();
  const d = await c.env.DB.prepare('select * from spot_destinations where id = ?').bind(dest)
    .first<{ id: string; name: string; state: string; kind: string | null; wikidata: string | null; built_at: string; counts: string | null; left_out: string | null }>();
  if (!d) throw new Error(ERR.notFound);
  const { results } = await c.env.DB.prepare(
    `select p.source, p.id, p.rank, p.reason, g.name, g.one_liner, g.images, pl.lat, pl.lng from spot_picks p
       join spot_guides g on g.source = p.source and g.id = p.id
       left join places pl on pl.source = p.source and pl.id = p.id
     where p.destination = ? order by p.rank`).bind(dest)
    .all<{ source: string; id: string; rank: number; reason: string | null; name: string; one_liner: string; images: string | null; lat: number | null; lng: number | null }>();
  return c.json({ id: d.id, name: d.name, state: d.state, kind: d.kind, wikidata: d.wikidata, builtAt: d.built_at,
    counts: json(d.counts, {}), leftOut: json(d.left_out, []),
    picks: results.map(({ one_liner, images, ...p }) => ({ ...p, oneLiner: one_liner, hero: json<Images>(images, { hero: null, inline: [] }).hero })) });
});
// One pick's entry in full: paragraphs with their sources, practical facts, photos with their credits, and its views
// (as the spots page sorts by them; see `views` under Spots)
async function guideEntry(env: Env, dest: string, source: string, id: string) {
  if (!DESTINATION.test(dest) || !SOURCE.test(source) || !PLACE_ID.test(id)) bad();
  const g = await env.DB.prepare(
    `select g.*, p.rank, p.reason, d.name as destination_name, d.state as destination_state, d.country, pl.lat, pl.lng, pl.url,
       pl.wikipedia, pl.website, ${VIEWS} as views from spot_guides g
       join spot_picks p on p.source = g.source and p.id = g.id and p.destination = ?1
       join spot_destinations d on d.id = p.destination
       left join places pl on pl.source = g.source and pl.id = g.id
     where g.source = ?2 and g.id = ?3`).bind(dest, source, id)
    .first<GuideRow & { rank: number; reason: string | null; destination_name: string; destination_state: string; country: string;
      lat: number | null; lng: number | null; url: string | null; wikipedia: string | null; website: string | null; views: number | null }>();
  if (!g) throw new Error(ERR.notFound);
  return { destination: { id: dest, name: g.destination_name, state: g.destination_state, country: g.country }, source: g.source, id: g.id,
    state: g.state, name: g.name, rank: g.rank, reason: g.reason, oneLiner: g.one_liner, paragraphs: json(g.paragraphs, []),
    practical: json(g.practical, []), sources: json(g.sources, []), images: json<Images>(g.images, { hero: null, inline: [] }),
    overlap: g.overlap, lat: g.lat, lng: g.lng, url: g.url, wikipedia: g.wikipedia, website: g.website, views: g.views,
    model: g.model, prompt: g.prompt, createdAt: g.created_at, license: 'CC BY-SA 4.0' };
}
app.get('/developer/spots/guides/:destination/:source/:id', async c =>
  c.json(await guideEntry(c.env, c.req.param('destination'), c.req.param('source'), c.req.param('id'))));

// ---------- Spots: the guide's places, for anyone, signed in or not (the app's Spots page, #/spots) ----------
// The same picks and entries as the guide preview above, across every destination. Read-only. Most viewed first:
// `views` is the place's English Wikipedia views over the last 12 months (see VIEWS), the one measure of how much people
// care about a place that every pick has, or nearly; within a city, the guide's own order.
// Every answer is kept in Cloudflare's cache at the location that asked for it, for as long as the browser keeps it, and
// answered from there without counting against anyone's limit: a public page's visitors can share an address (a phone
// network's, a campus's). What isn't cached yet is limited per IP, more loosely than the spots data, as typing a search
// asks every pause.
app.use('/spots/*', async (c, next) => {
  const cache = caches.default, key = new Request(c.req.url);
  const hit = await cache.match(key);
  if (hit) return hit;
  if (await tooMany(c.env.SPOTS_LIMIT, c.req.header('cf-connecting-ip') ?? 'local')) return rateLimited(c);
  await next();
  if (c.res.status === 200) c.executionCtx.waitUntil(cache.put(key, c.res.clone()));
});
const COUNTRY = /^[A-Z]{2}$/;
const PAGE = 50;
const SPOTS_CACHE = { 'Cache-Control': 'public, max-age=300' }; // loaded by hand, now and then: five minutes old is fine
// The cities with spots, for the page's filters: country, then state, then city
app.get('/spots/cities', async c => {
  const { results } = await c.env.DB.prepare(
    `select d.id, d.name, d.state, d.country, count(*) as spots from spot_destinations d
       join spot_picks p on p.destination = d.id join spot_guides g on g.source = p.source and g.id = p.id
     group by d.id order by d.country, d.state, d.name`).all();
  return c.json(results, 200, SPOTS_CACHE);
});
// Spots that match q, in a country, state or city, most viewed first (in a city, the guide's order), `limit` (at most
// 50) at a time, with how many there are in all, for a pager. A place two cities picked shows once, in the city that ranked it
// higher (SQLite takes a row's other columns from its min()).
app.get('/spots/search', async c => {
  const q = (c.req.query('q') ?? '').trim(), country = c.req.query('country') ?? '', state = c.req.query('state') ?? '';
  const city = c.req.query('city') ?? '', offset = Number(c.req.query('offset') ?? 0), limit = Number(c.req.query('limit') ?? PAGE);
  if (!Number.isInteger(limit) || limit < 1 || limit > PAGE || q.length > 100 || (country && !COUNTRY.test(country)) || (state && !STATE.test(state)) || (city && !DESTINATION.test(city))
    || !Number.isInteger(offset) || offset < 0 || offset > 5000) bad();
  const where: string[] = [], args: (string | number)[] = [];
  // q: in its name or one line, or its city's name, or its state's name or code ("washington", "WA")
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`, regions = regionsMatching(q);
    where.push(`(g.name like ? escape '\\' or g.one_liner like ? escape '\\' or d.name like ? escape '\\'${regions.length
      ? ` or d.country || '-' || d.state in (${regions.map(() => '?').join(',')})` : ''})`);
    args.push(like, like, like, ...regions);
  }
  if (country) { where.push('d.country = ?'); args.push(country); }
  if (state) { where.push('d.state = ?'); args.push(state); }
  if (city) { where.push('d.id = ?'); args.push(city); }
  const { results } = await c.env.DB.prepare(
    `select g.source, g.id, g.name, g.one_liner, g.images, min(p.rank) as rank, d.id as city, d.name as city_name, d.state, d.country, pl.lat, pl.lng,
       ${VIEWS} as views, count(*) over () as total from spot_guides g
       join spot_picks p on p.source = g.source and p.id = g.id
       join spot_destinations d on d.id = p.destination
       left join places pl on pl.source = g.source and pl.id = g.id
     ${where.length ? 'where ' + where.join(' and ') : ''}
     group by g.source, g.id order by ${city ? 'rank, ' : ''}views desc nulls last, rank, g.name limit ? offset ?`,
  ).bind(...args, limit, offset).all<{ source: string; id: string; name: string; one_liner: string; images: string | null; rank: number;
    city: string; city_name: string; state: string; country: string; lat: number | null; lng: number | null; views: number | null; total: number }>();
  // Past the last page there's no row to say how many there are: ask
  const total = results[0]?.total ?? (offset ? (await c.env.DB.prepare(
    `select count(distinct g.source || ' ' || g.id) as n from spot_guides g join spot_picks p on p.source = g.source and p.id = g.id
       join spot_destinations d on d.id = p.destination ${where.length ? 'where ' + where.join(' and ') : ''}`).bind(...args).first<number>('n')) ?? 0 : 0);
  return c.json({
    results: results.map(r => ({ source: r.source, id: r.id, name: r.name, oneLiner: r.one_liner,
      hero: json<Images>(r.images, { hero: null, inline: [] }).hero, rank: r.rank, city: { id: r.city, name: r.city_name },
      state: r.state, country: r.country, lat: r.lat, lng: r.lng, views: r.views })),
    total, more: offset + results.length < total,
  }, 200, SPOTS_CACHE);
});
// One spot's entry, as the guide preview has it
app.get('/spots/:city/:source/:id', async c =>
  c.json(await guideEntry(c.env, c.req.param('city'), c.req.param('source'), c.req.param('id')), 200, SPOTS_CACHE));

// Everything below needs a signed-in user (a guest session counts).
app.use(async (c, next) => {
  const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  const { id, name, image } = session.user;
  c.set('user', { id, name, image: image ?? null });
  c.set('guest', !!(session.user as { isAnonymous?: boolean | null }).isAnonymous);
  await next();
});

const ID = /^[A-Za-z0-9_-]{6,40}$/;
const room = (env: Env, tripId: string) => {
  if (!ID.test(tripId)) bad();
  return env.TRIP.get(env.TRIP.idFromName(tripId));
};
const body = async (req: Request) => (await req.json().catch(() => bad())) as Record<string, unknown>;
const tripName = (v: unknown) => (typeof v === 'string' && v.trim() && v.length <= 120 ? v.trim() : bad()) as string;

// ---------- Me & trips ----------
// Guests have no email; the client asks them for a name (POST /api/auth/update-user) and offers sign-in later.
app.get('/me', c => c.json({ ...c.get('user'), isGuest: c.get('guest') }));

// Home screen: one card per trip, newest edit first, with its people and stops for the card's avatars, route sketch and
// photos, and its Want to go places, for the card's photos after the stops' and so a spot says which trips have it
app.get('/trips', async c => {
  const { results } = await c.env.DB.prepare(
    `select t.id, t.name, t.first_stop as start, t.last_stop as end, t.preview from trips t
     join trip_members m on m.trip_id = t.id
     where m.user_id = ? and t.deleted_at is null order by t.updated_at desc`,
  ).bind(c.get('user').id).all<{ id: string; name: string; start: string | null; end: string | null; preview: string | null }>();
  // A trip last written before previews were kept, or before they had the stops' and Want to go places' types and
  // Wikidata items (for the card's photos), gets one from its TripRoom, once
  const cards = await Promise.all(results.map(async ({ preview, ...t }) => {
    const kept: Preview | null = preview ? JSON.parse(preview) : null;
    const p = kept?.stops.every(s => 'wikidata' in s) && kept.ideas?.every(i => 'wikidata' in i) ? kept : (await room(c.env, t.id).summary().catch(() => null)) ?? kept;
    return { ...t, members: p?.members ?? [], stops: p?.stops ?? [], ideas: p?.ideas ?? [] };
  }));
  return c.json(cards);
});

app.post('/trips', async c => {
  const { name } = await body(c.req.raw);
  const id = randomId(12);
  return c.json(await room(c.env, id).create(id, tripName(name), c.get('user'), newInvite()), 201);
});

app.get('/trips/:id', async c => c.json(await room(c.env, c.req.param('id')).open(c.get('user').id)));
app.patch('/trips/:id', async c => {
  const { name } = await body(c.req.raw);
  await room(c.env, c.req.param('id')).rename(c.get('user').id, tripName(name));
  return c.body(null, 204);
});
app.delete('/trips/:id', async c => {
  await room(c.env, c.req.param('id')).remove(c.get('user').id);
  return c.body(null, 204);
});
app.post('/trips/:id/restore', async c => {
  await room(c.env, c.req.param('id')).restore(c.get('user').id);
  return c.body(null, 204);
});
app.post('/trips/:id/leave', async c => {
  await room(c.env, c.req.param('id')).leave(c.get('user').id);
  return c.body(null, 204);
});

// ---------- Sharing: the link is the invite ----------
// The token rides in the URL fragment, so it never reaches server logs or Referer headers.
// In local dev the link uses the address you're on (localhost or 127.0.0.1), like sign-in does.
const shareURL = (c: Context<AppEnv>, token: string) =>
  `${isLocal(c.env) ? new URL(c.req.url).origin : c.env.BETTER_AUTH_URL}/#/join/${token}`;
app.get('/trips/:id/invite', async c =>
  c.json({ url: shareURL(c, await room(c.env, c.req.param('id')).invite(c.get('user').id)) }));
app.post('/trips/:id/invite/rotate', async c => {
  const invite = newInvite();
  await room(c.env, c.req.param('id')).rotateInvite(c.get('user').id, invite);
  return c.json({ url: shareURL(c, invite) });
});
app.post('/join/:token', async c => {
  const row = await c.env.DB.prepare('select id from trips where invite_hash = ?')
    .bind(await sha256(c.req.param('token'))).first<{ id: string }>();
  if (!row) throw new Error(ERR.notFound);
  return c.json(await room(c.env, row.id).join(c.get('user')));
});

// ---------- Stops ----------
app.put('/trips/:id/stops/:stopId', async c => {
  const stopId = ID.test(c.req.param('stopId')) ? c.req.param('stopId') : bad();
  return c.json(await room(c.env, c.req.param('id')).putStop(c.get('user').id, stopId, await body(c.req.raw)));
});
app.patch('/trips/:id/stops/:stopId', async c =>
  c.json(await room(c.env, c.req.param('id')).patchStop(c.get('user').id, c.req.param('stopId'), await body(c.req.raw))));
app.delete('/trips/:id/stops/:stopId', async c => {
  await room(c.env, c.req.param('id')).deleteStop(c.get('user').id, c.req.param('stopId'));
  return c.body(null, 204);
});

// ---------- Want to go: places saved for the trip, with no day yet ----------
app.put('/trips/:id/ideas/:ideaId', async c => {
  const ideaId = ID.test(c.req.param('ideaId')) ? c.req.param('ideaId') : bad();
  return c.json(await room(c.env, c.req.param('id')).putIdea(c.get('user').id, ideaId, await body(c.req.raw)));
});
app.delete('/trips/:id/ideas/:ideaId', async c => {
  await room(c.env, c.req.param('id')).deleteIdea(c.get('user').id, c.req.param('ideaId'));
  return c.body(null, 204);
});

// ---------- Connected assistants, in Account ----------
// Not under /api/mcp: everything there needs an assistant's token, and these take your session.
app.get('/assistants', async c => c.json({ url: mcpURL(c.env), connections: await listConnections(c.env, c.get('user').id) }));
// Ends that assistant's access at once: its tokens stop working
app.delete('/assistants/:id', async c => {
  await oauthApi(c.env).revokeGrant(c.req.param('id'), c.get('user').id);
  return c.body(null, 204);
});

// ---------- Live edits ----------
app.get('/trips/:id/live', async c => {
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-User-Id', c.get('user').id); // set here, after auth; anything the client sent is replaced
  return room(c.env, c.req.param('id')).fetch(new Request(c.req.raw, { headers }));
});

// ---------- Maps ----------
const point = (v: string | undefined) => {
  const [lat, lng] = (v ?? '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : undefined;
};
// Without a Stadia key, local dev falls back to the public OSM demo services; production returns 503.
const mapsOff = (env: Env) => !env.STADIA_API_KEY && !isLocal(env);
// Search runs as people type and a trip's routes load together, so the per-person limit is generous.
for (const path of ['/places', '/route', '/sights', '/about']) {
  app.use(path, async (c, next) => {
    if (await tooMany(c.env.MAPS_LIMIT, c.get('user').id)) return rateLimited(c);
    await next();
  });
}
app.get('/places', async c => {
  if (mapsOff(c.env)) return c.json({ error: 'maps_not_configured' }, 503);
  const q = c.req.query('q')?.trim() ?? '';
  if (q.length < 3 || q.length > 200) bad();
  return c.json(await searchPlaces(c.env, q, point(c.req.query('near'))));
});
// The client falls back to a straight-line estimate when this fails, as the prototype does.
// mode is drive (the default), walk or bike.
app.get('/route', async c => {
  if (mapsOff(c.env)) return c.json({ error: 'maps_not_configured' }, 503);
  const a = point(c.req.query('from')), b = point(c.req.query('to')), mode = c.req.query('mode') ?? 'drive';
  if (!a || !b || !ROUTE_MODES.includes(mode as RouteMode)) bad();
  return c.json(await findRoute(c.env, mode as RouteMode, a!, b!));
});

// What's worth seeing in one tile of the map (zoom 12): x and y as in a tile's address. They come from OpenStreetMap,
// not Stadia, so they need no key. The browser keeps them a day; the server, as long as people look at them (see KEEP in maps.ts).
app.get('/sights', async c => {
  const [z, x, y] = (/^(\d+)\/(\d+)\/(\d+)$/.exec(c.req.query('tile') ?? '') ?? []).slice(1).map(Number), n = 2 ** SIGHT_ZOOM;
  if (z !== SIGHT_ZOOM || !(x < n) || !(y < n)) bad();
  try {
    const list = await findSights(c.env, x, y);
    // Not looked up yet: ask again in a few seconds
    if (list === 'pending') return c.json({ pending: true }, 202, { 'Cache-Control': 'no-store', 'Retry-After': '4' });
    return c.json(list, 200, { 'Cache-Control': 'private, max-age=86400' });
  } catch (e) {
    console.error(e);
    return c.json({ error: 'unavailable' }, 503); // Overpass is busy or down: the map goes without for now
  }
});

// A sight's photo and a few lines about it, by its Wikidata item (?id=Q123), from Wikipedia and Wikimedia Commons:
// null when there's nothing. A place with no item is asked for by its name and where it is (?name=…&at=lat,lng): its
// article, if Wikipedia has one there. The browser keeps it a day; the server, as long as people look at it (see KEEP in maps.ts).
app.get('/about', async c => {
  const id = c.req.query('id'), name = c.req.query('name')?.trim() ?? '', at = point(c.req.query('at'));
  if (id !== undefined ? !QID.test(id) : !at || !name || name.length > 200) bad();
  try {
    const about = id !== undefined ? await findAbout(c.env, c.executionCtx, id) : await findPlaceAbout(c.env, c.executionCtx, name, at!);
    return c.json(about, 200, { 'Cache-Control': 'private, max-age=86400' });
  } catch (e) {
    console.error(e);
    return c.json({ error: 'unavailable' }, 503); // Wikipedia is busy or down: the card goes without for now
  }
});

// ---------- Moved ----------
// The page opened at any address but the app's own (BETTER_AUTH_URL: the workers.dev one, once APP_URL sets a custom
// domain) goes there, so old links and bookmarks still work: the path and query come along, and the browser keeps
// the # part, where a share link's token is. Sign-in only trusts the app's own address, so the old one couldn't be
// used anyway. Only the page moves; the API answers where it's asked.
function moved(req: Request, env: Env) {
  if (isLocal(env) || (req.method !== 'GET' && req.method !== 'HEAD')) return null;
  const url = new URL(req.url), home = new URL(env.BETTER_AUTH_URL);
  if (url.host === home.host) return null;
  return Response.redirect(`${home.origin}${url.pathname}${url.search}`, 301);
}
const isPage = (req: Request) => ['/', '/index.html'].includes(new URL(req.url).pathname);

// The OAuth provider sees every API request first: it answers discovery (/.well-known/*) and its own endpoints
// (/api/oauth/token, /api/oauth/register), checks the token on /api/mcp, and hands the rest to the app.
export default {
  fetch: (req, env, ctx) => {
    if (isPage(req)) return moved(req, env) ?? env.ASSETS.fetch(req);
    return oauthProvider(env, app).fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;

// ---------- Helpers ----------
function randomId(len: number) {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), b => abc[b % abc.length]).join('');
}
// A share link's token. D1 keeps only its hash (see project in trip.ts), to look up which trip a link opens.
function newInvite() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
