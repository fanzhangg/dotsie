import { Hono, type Context } from 'hono';
import { csrf } from 'hono/csrf';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createAuth, emailEnabled, isLocal, type Auth } from './auth';
import { driveRoute, searchPlaces } from './maps';
import { ERR } from './trip';

export { TripRoom } from './trip';

/* Waythread API. Static files are served by the assets binding; only /api/* reaches this Worker.
   Auth is a session cookie (Better Auth). Each trip's data lives in its TripRoom Durable Object,
   which checks membership itself; this layer authenticates, validates the URL, and routes. */

type User = { id: string; name: string; image: string | null };
type AppEnv = { Bindings: Env; Variables: { user: User; guest: boolean } };
const app = new Hono<AppEnv>().basePath('/api');

let auth: Auth | undefined; // env is the same for every request in an isolate
const getAuth = (env: Env) => (auth ??= createAuth(env));

const STATUS: Record<string, ContentfulStatusCode> = { [ERR.notFound]: 404, [ERR.notMember]: 403, [ERR.gone]: 410, [ERR.invalid]: 400 };
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
const rateLimited = (c: Context<AppEnv>) => c.json({ error: 'rate_limited' }, 429);
// Every sign-in endpoint (guest, email link, Google/Apple) creates accounts or sends email: limit per IP.
app.use('/auth/sign-in/*', async (c, next) => {
  if (c.req.method === 'POST' && await tooMany(c.env.SIGNIN_LIMIT, c.req.header('cf-connecting-ip') ?? 'local')) return rateLimited(c);
  await next();
});
app.on(['GET', 'POST'], '/auth/*', c => getAuth(c.env).handler(c.req.raw));

// ---------- Before sign-in ----------
// Which sign-in buttons to show
app.get('/config', c => c.json({ google: !!c.env.GOOGLE_CLIENT_ID, apple: !!c.env.APPLE_CLIENT_ID, email: emailEnabled(c.env) }));
// The trip name for a share link, so the sign-in screen can say what you're joining.
// Anyone holding the link may join anyway, so its name is no secret from them.
app.get('/invite/:token', async c => {
  const row = await c.env.DB.prepare('select name from trips where invite_hash = ? and deleted_at is null')
    .bind(await sha256(c.req.param('token'))).first<{ name: string }>();
  if (!row) throw new Error(ERR.notFound);
  return c.json(row);
});

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

// Home screen: one card per trip, newest edit first
app.get('/trips', async c => {
  const { results } = await c.env.DB.prepare(
    `select t.id, t.name, t.first_stop as start, t.last_stop as end from trips t
     join trip_members m on m.trip_id = t.id
     where m.user_id = ? and t.deleted_at is null order by t.updated_at desc`,
  ).bind(c.get('user').id).all();
  return c.json(results);
});

app.post('/trips', async c => {
  const { name } = await body(c.req.raw);
  const id = randomId(12);
  return c.json(await room(c.env, id).create(id, tripName(name), c.get('user'), await newInvite()), 201);
});

app.get('/trips/:id', async c => c.json(await room(c.env, c.req.param('id')).snapshot(c.get('user').id)));
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

// ---------- Sharing: the link is the invite ----------
// The token rides in the URL fragment, so it never reaches server logs or Referer headers.
// In local dev the link uses the address you're on (localhost or 127.0.0.1), like sign-in does.
const shareURL = (c: Context<AppEnv>, token: string) =>
  `${isLocal(c.env) ? new URL(c.req.url).origin : c.env.BETTER_AUTH_URL}/#/join/${token}`;
app.get('/trips/:id/invite', async c =>
  c.json({ url: shareURL(c, await room(c.env, c.req.param('id')).invite(c.get('user').id)) }));
app.post('/trips/:id/invite/rotate', async c => {
  const invite = await newInvite();
  await room(c.env, c.req.param('id')).rotateInvite(c.get('user').id, invite);
  return c.json({ url: shareURL(c, invite.token) });
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
for (const path of ['/places', '/route']) {
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
app.get('/route', async c => {
  if (mapsOff(c.env)) return c.json({ error: 'maps_not_configured' }, 503);
  const a = point(c.req.query('from')), b = point(c.req.query('to'));
  if (!a || !b) bad();
  return c.json(await driveRoute(c.env, a!, b!));
});

export default app;

// ---------- Helpers ----------
function randomId(len: number) {
  const abc = 'abcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), b => abc[b % abc.length]).join('');
}
async function newInvite() {
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { token, hash: await sha256(token) };
}
async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
