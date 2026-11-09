import { DurableObject } from 'cloudflare:workers';
import { MAX_LINKS } from '../web/fields.js';
import { cleanStop, ERR, type Back, type Link, type Stop, type StopFields, type Travel } from './stop';

/* One TripRoom per trip (addressed by idFromName(tripId)). It owns the trip's stops and members in
   its own SQLite, applies writes one at a time, and pushes every change to the trip's open WebSockets.
   D1 gets a mirror of what spans trips: membership and the home-screen summary.
   Every method takes the acting user's id from the Worker's session, never from the client. */

// identity is 1–6, the design system's --wt-identity-N avatar colors
export type Member = { id: string; name: string; image: string | null; identity: number };
export type TripEvent =
  | { type: 'stop.upserted'; stop: Stop }
  | { type: 'stop.removed'; id: string; name: string }
  | { type: 'member.joined'; member: Member }
  | { type: 'member.updated'; member: Member }
  | { type: 'member.left'; id: string; name: string }
  | { type: 'trip.updated'; name: string }
  | { type: 'trip.deleted' };

const IDENTITIES = 6;
// The home card's route sketch needs only where the stops are and how you get to each (and back to a hotel), and its
// photos each stop's Wikidata item; a trip longer than this is cut off there.
const PREVIEW_STOPS = 300;
export type Preview = { members: Member[]; stops: Pick<Stop, 'id' | 'name' | 'lat' | 'lng' | 'time' | 'kind' | 'nights' | 'travel' | 'back' | 'wikidata'>[] };

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

  // Opening the trip. D1 says who's on which trip for the home screen, but this object decides: when it says you're not
  // on it, D1's row is out of date (a leave whose D1 write failed, say), so it goes, and the card leaves your home screen.
  // Checked here, one request at a time, so a join that has just added you isn't undone.
  async open(userId: string) {
    try { return this.snapshot(userId); } catch (e) {
      if ((e as Error).message === ERR.notMember) {
        await this.env.DB.prepare('delete from trip_members where trip_id = ? and user_id = ?').bind(this.trip()!.id, userId).run();
      }
      throw e;
    }
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
    // Here first, then D1: D1 never lists someone this object doesn't (see open). If the D1 write fails, joining
    // again writes it, since it's written whether or not you were already on the trip.
    const member = this.isMember(user.id) ? null : this.addMember(user);
    await this.env.DB.prepare('insert or ignore into trip_members (trip_id, user_id, joined_at) values (?, ?, ?)')
      .bind(trip.id, user.id, Date.now()).run();
    if (member) {
      await this.syncPreview();
      this.broadcast({ type: 'member.joined', member }, user.id);
    }
    return this.snapshot(user.id);
  }

  // Anyone but the owner can leave; the owner deletes the trip instead. Stops they added stay.
  async leave(userId: string) {
    const trip = this.check(userId);
    if (trip.created_by === userId) throw new Error(ERR.invalid);
    const { name } = this.sql.exec<{ name: string }>('select name from members where id = ?', userId).one();
    // D1 first, then here: if the D1 write fails you're still on the trip, so leaving again works
    await this.env.DB.prepare('delete from trip_members where trip_id = ? and user_id = ?').bind(trip.id, userId).run();
    this.sql.exec('delete from members where id = ?', userId);
    await this.syncPreview(); // the home card's people
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
