import { DurableObject } from 'cloudflare:workers';
import { QID } from './maps';

/* One TripRoom per trip (addressed by idFromName(tripId)). It owns the trip's stops and members in
   its own SQLite, applies writes one at a time, and pushes every change to the trip's open WebSockets.
   D1 gets a mirror of what spans trips: membership and the home-screen summary.
   Every method takes the acting user's id from the Worker's session, never from the client. */

// identity is 1–6, the design system's --wt-identity-N avatar colors
export type Member = { id: string; name: string; image: string | null; identity: number };
// kind is the stop's type ('' until someone picks one; the app guesses from the name). nights is for a
// hotel: how many nights from its check-in (0 checks out the same day), or null to last until the next hotel or the trip's last day.
// checkout is a hotel's check-out time ("HH:MM"; the day comes from nights), or null for the app's default.
// Other stops are null; some older clients saved a leave time there, which the app ignores.
// travel is how you get to this stop from the place before it (for a hotel, on its check-in day). Drive unless someone
// picks another. back is a hotel's way back to it each night, by the day ("YYYY-MM-DD"): each night's is its own leg.
// Nights not in it are drives, so it only holds the others; {} for every other stop.
// links are pages about the stop (a booking, a flight, a post about the place), in the order they show, each with an
// optional label ('' shows the link's site). [] for none.
// wikidata is the place's Wikidata item ("Q123") when it was added from a sight on the map, so its sheet can show what
// Wikipedia says about it; null otherwise.
// time is the clock time where the stop is. tz is the IANA time zone that clock is in, when someone set one other than the
// place's own; null means the place's own, which the app looks up from where it is.
// duration is how long you're at the stop, in minutes, or null for not said; the drive after it leaves when it ends.
// A hotel's stay is its nights and check-out, so it has none.
// done is no longer shown; it's kept so older clients' writes still validate.
export type Stop = {
  id: string; name: string; address: string; lat: number; lng: number;
  time: string; tz: string | null; duration: number | null; note: string; kind: Kind | ''; nights: number | null; checkout: string | null; travel: Travel; back: Back; links: Link[]; wikidata: string | null; done: boolean; by: string; updatedAt: number;
};
export type Link = { url: string; label: string };
export type StopFields = Omit<Stop, 'id' | 'by' | 'updatedAt'>;
export type TripEvent =
  | { type: 'stop.upserted'; stop: Stop }
  | { type: 'stop.removed'; id: string; name: string }
  | { type: 'member.joined'; member: Member }
  | { type: 'member.updated'; member: Member }
  | { type: 'member.left'; id: string; name: string }
  | { type: 'trip.updated'; name: string }
  | { type: 'trip.deleted' };

// Errors cross the RPC boundary as plain messages; the Worker maps these to HTTP statuses.
export const ERR = { notFound: 'not_found', notMember: 'not_member', notOwner: 'not_owner', gone: 'gone', invalid: 'invalid' } as const;

const IDENTITIES = 6;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
// Ids the client picks for its stops
export const ID = /^[A-Za-z0-9_-]{6,40}$/;
// Stop types; the app gives each an icon and color. Keep in sync with KINDS in web/app.js.
export const KINDS = ['place', 'airport', 'hotel', 'restaurant', 'cafe', 'attraction', 'museum', 'viewpoint', 'nature', 'shopping', 'gas'] as const;
type Kind = typeof KINDS[number];
// How you get to a stop. Drive, walk and bike follow a route; transit and flights are drawn straight, with no time.
// Keep in sync with TRAVEL in web/app.js.
export const TRAVEL = ['drive', 'walk', 'bike', 'transit', 'flight'] as const;
export type Travel = typeof TRAVEL[number];
export type Back = Record<string, Travel>;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NIGHTS = 30;
// A stay at one stop, in minutes: up to a day
const MAX_DURATION = 24 * 60;
// An IANA time zone this runtime knows ("America/Denver")
const isZone = (z: unknown): z is string => {
  if (typeof z !== 'string' || z.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(z)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; }
};
const MAX_LINKS = 10, MAX_URL = 2000, MAX_LABEL = 60;
// The home card's route sketch needs only where the stops are and how you get to each (and back to a hotel), and its
// photos each stop's Wikidata item; a trip longer than this is cut off there.
const PREVIEW_STOPS = 300;
export type Preview = { members: Member[]; stops: Pick<Stop, 'id' | 'name' | 'lat' | 'lng' | 'time' | 'kind' | 'nights' | 'travel' | 'back' | 'wikidata'>[] };

// Checks a full stop (create) or a partial one (patch); unknown keys are dropped.
export function cleanStop(input: unknown, partial: boolean): Partial<StopFields> {
  if (!input || typeof input !== 'object') throw new Error(ERR.invalid);
  const i = input as Record<string, unknown>;
  let out: Partial<StopFields> = {};
  const str = (k: 'name' | 'address' | 'note', max: number, required: boolean) => {
    if (i[k] === undefined && (partial || !required)) return;
    if (typeof i[k] !== 'string' || i[k].length > max || (required && !i[k].trim())) throw new Error(ERR.invalid);
    out[k] = i[k].trim();
  };
  const num = (k: 'lat' | 'lng', lim: number) => {
    if (i[k] === undefined && partial) return;
    if (typeof i[k] !== 'number' || !Number.isFinite(i[k]) || Math.abs(i[k]) > lim) throw new Error(ERR.invalid);
    out[k] = i[k];
  };
  str('name', 200, true);
  str('address', 300, false);
  str('note', 2000, false);
  num('lat', 90);
  num('lng', 180);
  if (i.time !== undefined || !partial) {
    if (typeof i.time !== 'string' || !TIME.test(i.time)) throw new Error(ERR.invalid);
    out.time = i.time;
  }
  if (i.tz !== undefined) {
    if (i.tz !== null && !isZone(i.tz)) throw new Error(ERR.invalid);
    out.tz = i.tz as string | null;
  }
  if (i.duration !== undefined) {
    if (i.duration !== null && !(Number.isInteger(i.duration) && (i.duration as number) > 0 && (i.duration as number) <= MAX_DURATION)) throw new Error(ERR.invalid);
    out.duration = i.duration as number | null;
  }
  if (i.kind !== undefined) {
    if (i.kind !== '' && !KINDS.includes(i.kind as Kind)) throw new Error(ERR.invalid);
    out.kind = i.kind as Kind | '';
  }
  if (i.nights !== undefined) {
    if (i.nights !== null && !(Number.isInteger(i.nights) && (i.nights as number) >= 0 && (i.nights as number) <= MAX_NIGHTS)) throw new Error(ERR.invalid);
    out.nights = i.nights as number | null;
  }
  if (i.checkout !== undefined) {
    if (i.checkout !== null && !(typeof i.checkout === 'string' && CLOCK.test(i.checkout))) throw new Error(ERR.invalid);
    out.checkout = i.checkout as string | null;
  }
  if (i.travel !== undefined) {
    if (!TRAVEL.includes(i.travel as Travel)) throw new Error(ERR.invalid);
    out.travel = i.travel as Travel;
  }
  if (i.back !== undefined) {
    // A stay is at most 30 nights, and the check-in day can have its own way back
    const b = i.back;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length > MAX_NIGHTS + 1) throw new Error(ERR.invalid);
    const entries = Object.entries(b as Record<string, unknown>);
    if (entries.some(([d, t]) => !DAY.test(d) || !TRAVEL.includes(t as Travel))) throw new Error(ERR.invalid);
    out.back = Object.fromEntries(entries.filter(([, t]) => t !== 'drive')) as Back;
  }
  if (i.links !== undefined) {
    // Only web pages: a link opens in a new tab, and anything else (javascript:, data:) has no business there
    const l = i.links;
    if (!Array.isArray(l) || l.length > MAX_LINKS) throw new Error(ERR.invalid);
    out.links = l.map(x => {
      if (!x || typeof x !== 'object') throw new Error(ERR.invalid);
      const { url, label = '' } = x as Record<string, unknown>;
      if (typeof url !== 'string' || url.length > MAX_URL || typeof label !== 'string' || label.length > MAX_LABEL) throw new Error(ERR.invalid);
      let u: URL;
      try { u = new URL(url.trim()); } catch { throw new Error(ERR.invalid); }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(ERR.invalid);
      return { url: u.href, label: label.trim() };
    });
  }
  if (i.wikidata !== undefined) {
    if (i.wikidata !== null && !(typeof i.wikidata === 'string' && QID.test(i.wikidata))) throw new Error(ERR.invalid);
    out.wikidata = i.wikidata as string | null;
  }
  if (i.done !== undefined) {
    if (typeof i.done !== 'boolean') throw new Error(ERR.invalid);
    out.done = i.done;
  }
  if (!partial) out = { address: '', note: '', tz: null, duration: null, kind: '', nights: null, checkout: null, travel: 'drive', back: {}, links: [], wikidata: null, done: false, ...out };
  return out;
}

// folder is a column from when stops could be grouped in folders: older trips still have it, and it's left out
type StopRow = Omit<Stop, 'done' | 'updatedAt' | 'back' | 'links'> & { done: number; updated_at: number; back: string; links: string; folder?: string | null };
const parseBack = (back: string): Back => { try { return JSON.parse(back) || {}; } catch { return {}; } };
const parseLinks = (links: string): Link[] => { try { return JSON.parse(links) || []; } catch { return []; } };
const toStop = ({ done, updated_at, back, links, folder: _folder, ...r }: StopRow): Stop => ({ ...r, back: parseBack(back), links: parseLinks(links), done: !!done, updatedAt: updated_at });

export class TripRoom extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      create table if not exists trip (id text primary key, name text not null, created_by text not null, invite text not null, deleted_at integer);
      create table if not exists members (id text primary key, name text not null, image text, identity integer not null, joined_at integer not null);
      create table if not exists stops (
        id text primary key, name text not null, address text not null, lat real not null, lng real not null,
        time text not null, note text not null, done integer not null, by text not null, updated_at integer not null
      );`);
    // Added after launch: stop types, hotel nights, check-out time and how you get there
    const cols = new Set(this.sql.exec<{ name: string }>('pragma table_info(stops)').toArray().map(c => c.name));
    if (!cols.has('kind')) this.sql.exec("alter table stops add column kind text not null default ''");
    if (!cols.has('nights')) this.sql.exec('alter table stops add column nights integer');
    if (!cols.has('checkout')) this.sql.exec('alter table stops add column checkout text');
    if (!cols.has('travel')) this.sql.exec("alter table stops add column travel text not null default 'drive'");
    if (!cols.has('back')) this.sql.exec("alter table stops add column back text not null default '{}'");
    // (Older trips also have a folder column and a folders table, from when stops could be grouped in folders. Neither
    // is read or written any more.)
    // ...and links
    if (!cols.has('links')) this.sql.exec("alter table stops add column links text not null default '[]'");
    // ...and the Wikidata item of a stop added from a sight
    if (!cols.has('wikidata')) this.sql.exec('alter table stops add column wikidata text');
    // ...and a time zone other than the place's own, and how long you're there
    if (!cols.has('tz')) this.sql.exec('alter table stops add column tz text');
    if (!cols.has('duration')) this.sql.exec('alter table stops add column duration integer');
    // Answer keep-alive pings without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---------- Trip ----------
  // The share-link token is kept here, behind the membership check, so members can show the link
  // again; D1 only has its hash, for looking up which trip a link opens.
  async create(id: string, name: string, user: Omit<Member, 'identity'>, invite: { token: string; hash: string }) {
    if (this.trip()) throw new Error(ERR.invalid);
    const now = Date.now();
    this.sql.exec('insert into trip (id, name, created_by, invite) values (?, ?, ?, ?)', id, name, user.id, invite.token);
    await this.env.DB.batch([
      this.env.DB.prepare('insert into trips (id, name, invite_hash, updated_at) values (?, ?, ?, ?)').bind(id, name, invite.hash, now),
      this.env.DB.prepare('insert into trip_members (trip_id, user_id, joined_at) values (?, ?, ?)').bind(id, user.id, now),
    ]);
    this.addMember(user);
    await this.syncPreview();
    return this.snapshot(user.id);
  }

  snapshot(userId: string) {
    const trip = this.check(userId);
    return {
      trip: { id: trip.id, name: trip.name, owner: trip.created_by },
      members: this.sql.exec<Member>('select id, name, image, identity from members order by joined_at').toArray(),
      stops: this.stops(),
    };
  }

  async rename(userId: string, name: string) {
    this.check(userId);
    this.sql.exec('update trip set name = ?', name);
    await this.syncSummary();
    this.broadcast({ type: 'trip.updated', name }, userId);
  }

  // Soft delete: the trip leaves everyone's home screen but can be restored. Only its owner (who made it) can.
  async remove(userId: string) {
    const trip = this.checkOwner(userId);
    const now = Date.now();
    this.sql.exec('update trip set deleted_at = ?', now);
    await this.env.DB.prepare('update trips set deleted_at = ? where id = ?').bind(now, trip.id).run();
    this.broadcast({ type: 'trip.deleted' }, userId);
    for (const ws of this.ctx.getWebSockets()) ws.close(4410, 'Trip deleted');
  }

  async restore(userId: string) {
    const trip = this.checkOwner(userId, true);
    this.sql.exec('update trip set deleted_at = null');
    await this.env.DB.prepare('update trips set deleted_at = null, updated_at = ? where id = ?').bind(Date.now(), trip.id).run();
  }

  // ---------- Stops ----------
  // Create, or put a deleted stop back (Undo). The client picks the id, so retries are harmless.
  async putStop(userId: string, stopId: string, input: unknown) {
    this.check(userId);
    const f = cleanStop(input, false) as StopFields;
    this.sql.exec(
      `insert or replace into stops (id, name, address, lat, lng, time, tz, duration, note, kind, nights, checkout, travel, back, links, wikidata, done, by, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      stopId, f.name, f.address, f.lat, f.lng, f.time, f.tz, f.duration, f.note, f.kind, f.nights, f.checkout, f.travel, JSON.stringify(f.back), JSON.stringify(f.links), f.wikidata, +f.done, userId, Date.now());
    return this.afterStopWrite(stopId);
  }

  // Only the changed fields are sent, so two people editing different fields of one stop both win.
  async patchStop(userId: string, stopId: string, input: unknown) {
    this.check(userId);
    const f = cleanStop(input, true);
    const was = this.sql.exec<{ lat: number; lng: number }>('select lat, lng from stops where id = ?', stopId).toArray()[0];
    if (!was) throw new Error(ERR.notFound);
    // A stop moved to another place isn't that sight any more
    if (f.wikidata === undefined && ((f.lat ?? was.lat) !== was.lat || (f.lng ?? was.lng) !== was.lng)) f.wikidata = null;
    const cols = Object.keys(f) as (keyof StopFields)[];
    const vals = cols.map(k => (k === 'done' ? +f.done! : k === 'back' || k === 'links' ? JSON.stringify(f[k]) : f[k]));
    this.sql.exec(
      `update stops set ${[...cols, 'by', 'updated_at'].map(c => `${c} = ?`).join(', ')} where id = ?`,
      ...vals, userId, Date.now(), stopId);
    return this.afterStopWrite(stopId);
  }

  // Adds a link to a stop's links, or relabels it if the stop has that page already (an empty label keeps the old one).
  // Done here, in one step, so an assistant adding a link can't drop one someone added a moment before.
  async addLink(userId: string, stopId: string, link: unknown) {
    this.check(userId);
    const row = this.sql.exec<{ links: string }>('select links from stops where id = ?', stopId).toArray()[0];
    if (!row) throw new Error(ERR.notFound);
    const [add] = cleanStop({ links: [link] }, true).links!;
    const links = parseLinks(row.links), old = links.find(l => l.url === add.url);
    if (old) old.label = add.label || old.label;
    else if (links.length >= MAX_LINKS) throw new Error(ERR.invalid);
    else links.push(add);
    return this.patchStop(userId, stopId, { links });
  }

  // Returns the stop as it was (null if it was already gone), so the MCP server can say what it removed.
  async deleteStop(userId: string, stopId: string) {
    this.check(userId);
    const row = this.sql.exec<StopRow>('select * from stops where id = ?', stopId).toArray()[0];
    if (!row) return null;
    this.sql.exec('delete from stops where id = ?', stopId);
    await this.syncSummary();
    this.broadcast({ type: 'stop.removed', id: stopId, name: row.name }, userId);
    return toStop(row);
  }

  // ---------- People ----------
  invite(userId: string) {
    return this.check(userId).invite;
  }

  // A new link, for when the old one went somewhere it shouldn't have
  async rotateInvite(userId: string, invite: { token: string; hash: string }) {
    const trip = this.check(userId);
    await this.env.DB.prepare('update trips set invite_hash = ? where id = ?').bind(invite.hash, trip.id).run();
    this.sql.exec('update trip set invite = ?', invite.token);
  }

  // The Worker has already checked the share-link token against D1.
  async join(user: Omit<Member, 'identity'>) {
    const trip = this.trip();
    if (!trip) throw new Error(ERR.notFound);
    if (trip.deleted_at) throw new Error(ERR.gone);
    if (this.isMember(user.id)) return this.snapshot(user.id);
    await this.env.DB.prepare('insert or ignore into trip_members (trip_id, user_id, joined_at) values (?, ?, ?)')
      .bind(trip.id, user.id, Date.now()).run();
    const member = this.addMember(user);
    await this.syncPreview();
    this.broadcast({ type: 'member.joined', member }, user.id);
    return this.snapshot(user.id);
  }

  // Anyone but the owner can leave; the owner deletes the trip instead. Stops they added stay.
  async leave(userId: string) {
    const trip = this.check(userId);
    if (trip.created_by === userId) throw new Error(ERR.invalid);
    const { name } = this.sql.exec<{ name: string }>('select name from members where id = ?', userId).one();
    this.sql.exec('delete from members where id = ?', userId);
    await this.env.DB.prepare('delete from trip_members where trip_id = ? and user_id = ?').bind(trip.id, userId).run();
    this.broadcast({ type: 'member.left', id: userId, name }, userId);
    for (const ws of this.ctx.getWebSockets(userId)) ws.close(4403, 'Left the trip');
  }

  // A guest signed in for real: their trips and stops move to the new account.
  async replaceMember(fromId: string, to: Omit<Member, 'identity'>) {
    const trip = this.trip();
    if (!trip || !this.isMember(fromId)) return;
    if (this.isMember(to.id)) this.sql.exec('delete from members where id = ?', fromId);
    else this.sql.exec('update members set id = ?, name = ?, image = ? where id = ?', to.id, to.name, to.image, fromId);
    this.sql.exec('update stops set by = ? where by = ?', to.id, fromId);
    if (trip.created_by === fromId) this.sql.exec('update trip set created_by = ?', to.id);
    await this.env.DB.batch([
      this.env.DB.prepare('insert or ignore into trip_members (trip_id, user_id, joined_at) values (?, ?, ?)').bind(trip.id, to.id, Date.now()),
      this.env.DB.prepare('delete from trip_members where trip_id = ? and user_id = ?').bind(trip.id, fromId),
    ]);
    await this.syncPreview();
  }

  // Keep names and photos current when someone updates their profile, live for anyone looking.
  async updateMember(user: Omit<Member, 'identity'>) {
    if (!this.isMember(user.id)) return;
    this.sql.exec('update members set name = ?, image = ? where id = ?', user.name, user.image, user.id);
    const member = this.sql.exec<Member>('select id, name, image, identity from members where id = ?', user.id).one();
    await this.syncPreview();
    this.broadcast({ type: 'member.updated', member }, user.id);
  }

  // The home card's people and stops, for a trip whose D1 row doesn't have them yet (written before they were kept).
  async summary(): Promise<Preview | null> {
    if (!this.trip()) return null;
    await this.syncPreview();
    return this.preview();
  }

  // ---------- Live edits ----------
  async fetch(req: Request) {
    const userId = req.headers.get('X-User-Id');
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    try { this.check(userId ?? ''); } catch { return new Response(null, { status: 403 }); }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [userId!]);
    return new Response(null, { status: 101, webSocket: client });
  }
  // Clients only listen; writes go over HTTP so they can be retried and checked.
  webSocketMessage() {}
  webSocketClose(ws: WebSocket, code: number) { ws.close(code === 1005 ? 1000 : code); }

  // ---------- Internals ----------
  private trip() {
    return this.sql.exec<{ id: string; name: string; created_by: string; invite: string; deleted_at: number | null }>('select * from trip').toArray()[0];
  }
  private isMember(userId: string) {
    return this.sql.exec('select 1 from members where id = ?', userId).toArray().length > 0;
  }
  private check(userId: string, allowDeleted = false) {
    const trip = this.trip();
    if (!trip) throw new Error(ERR.notFound);
    if (!this.isMember(userId)) throw new Error(ERR.notMember);
    if (trip.deleted_at && !allowDeleted) throw new Error(ERR.gone);
    return trip;
  }
  private checkOwner(userId: string, allowDeleted = false) {
    const trip = this.check(userId, allowDeleted);
    if (trip.created_by !== userId) throw new Error(ERR.notOwner);
    return trip;
  }
  private stops() {
    return this.sql.exec<StopRow>('select * from stops order by time, id').toArray().map(toStop);
  }
  private addMember(user: Omit<Member, 'identity'>): Member {
    // The first identity nobody on the trip has yet; past six, they repeat
    const used = new Set(this.sql.exec<{ identity: number }>('select identity from members').toArray().map(r => r.identity));
    const n = this.sql.exec<{ n: number }>('select count(*) as n from members').one().n;
    const identity = [...Array(IDENTITIES).keys()].map(i => i + 1).find(i => !used.has(i)) ?? (n % IDENTITIES) + 1;
    this.sql.exec('insert into members (id, name, image, identity, joined_at) values (?, ?, ?, ?, ?)', user.id, user.name, user.image, identity, Date.now());
    return { ...user, identity };
  }
  private async afterStopWrite(stopId: string) {
    const stop = toStop(this.sql.exec<StopRow>('select * from stops where id = ?', stopId).one());
    await this.syncSummary();
    this.broadcast({ type: 'stop.upserted', stop }, stop.by);
    return stop;
  }
  // Mirror the home-card fields to D1 (name, date range, people and stops, last edit for sorting). The trip ends at
  // its last stop, or later if a hotel's nights run past it.
  private async syncSummary() {
    const trip = this.trip()!;
    const r = this.sql.exec<{ first: string | null; last: string | null }>(
      `select min(time) as first, max(max(time), coalesce((select max(date(time, '+' || nights || ' days')) from stops where nights is not null), '')) as last from stops`).one();
    await this.env.DB.prepare('update trips set name = ?, first_stop = ?, last_stop = ?, preview = ?, updated_at = ? where id = ?')
      .bind(trip.name, r.first, r.last, JSON.stringify(this.preview()), Date.now(), trip.id).run();
  }
  // Someone joined or renamed themselves: the card's people change, but the trip doesn't move up everyone's list.
  private async syncPreview() {
    await this.env.DB.prepare('update trips set preview = ? where id = ?').bind(JSON.stringify(this.preview()), this.trip()!.id).run();
  }
  private preview(): Preview {
    return {
      members: this.sql.exec<Member>('select id, name, image, identity from members order by joined_at').toArray(),
      stops: this.sql.exec<Omit<Preview['stops'][number], 'back'> & { back: string }>('select id, name, lat, lng, time, kind, nights, travel, back, wikidata from stops order by time, id limit ?', PREVIEW_STOPS)
        .toArray().map(s => ({ ...s, back: parseBack(s.back) })),
    };
  }
  private broadcast(event: TripEvent, by?: string) {
    const msg = JSON.stringify({ ...event, by });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg); } catch {}
    }
  }
}
