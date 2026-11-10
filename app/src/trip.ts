import { DurableObject } from 'cloudflare:workers';
import { MAX_LINKS } from '../web/fields.js';
import { copyStatements } from './copy';
import { migrate } from './schema';
import { cleanIdea, cleanStop, ERR, type Back, type Idea, type Link, type Stop, type StopFields, type Travel } from './stop';

/* One TripRoom per trip (addressed by idFromName(tripId)). It owns the trip's stops and members in
   its own SQLite, applies writes one at a time, and pushes every change to the trip's open WebSockets.
   D1 gets a copy of what spans trips: membership, the home-screen summary and the share link's hash, written only by
   project() (see "The D1 copy").
   Every method takes the acting user's id from the Worker's session, never from the client. */

// identity is 1–6, the design system's --wt-identity-N avatar colors
export type Member = { id: string; name: string; image: string | null; identity: number };
export type TripEvent =
  | { type: 'stop.upserted'; stop: Stop }
  | { type: 'stop.removed'; id: string; name: string }
  | { type: 'idea.upserted'; idea: Idea }
  | { type: 'idea.removed'; id: string; name: string }
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
type StopRow = Omit<Stop, 'updatedAt' | 'back' | 'links'> & { updated_at: number; back: string; links: string };
const parseBack = (back: string): Back => { try { return JSON.parse(back) || {}; } catch { return {}; } };
const parseLinks = (links: string): Link[] => { try { return JSON.parse(links) || []; } catch { return []; } };
const toStop = ({ updated_at, back, links, ...r }: StopRow): Stop => ({ ...r, back: parseBack(back), links: parseLinks(links), updatedAt: updated_at });
type IdeaRow = Omit<Idea, 'updatedAt' | 'links'> & { updated_at: number; links: string };
const toIdea = ({ updated_at, links, ...r }: IdeaRow): Idea => ({ ...r, links: parseLinks(links), updatedAt: updated_at });

export class TripRoom extends DurableObject<Env> {
  private sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    migrate(this.sql, fn => this.ctx.storage.transactionSync(fn));
    // Answer keep-alive pings without waking the object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---------- Trip ----------
  // The share-link token is kept here, behind the membership check, so members can show the link
  // again; D1 only has its hash, for looking up which trip a link opens.
  async create(id: string, name: string, user: Omit<Member, 'identity'>, invite: string) {
    if (this.trip()) throw new Error(ERR.invalid);
    this.sql.exec('insert into trip (id, name, created_by, invite, edited_at) values (?, ?, ?, ?, ?)', id, name, user.id, invite, Date.now());
    this.addMember(user);
    await this.publish();
    return this.snapshot(user.id);
  }

  // Opening the trip. Home lists it from D1's copy, but this object decides: when it says you're not on the trip, or
  // it's deleted, and Home still lists it for you, that copy is out of date (its D1 write failed), so it's written again
  // and the card goes.
  async open(userId: string) {
    try { return this.snapshot(userId); } catch (e) {
      const m = (e as Error).message;
      if ((m === ERR.notMember || m === ERR.gone) && await this.listedFor(userId)) await this.publish();
      throw e;
    }
  }

  snapshot(userId: string) {
    const trip = this.check(userId);
    return {
      trip: { id: trip.id, name: trip.name, owner: trip.created_by },
      members: this.sql.exec<Member>('select id, name, image, identity from members order by joined_at').toArray(),
      stops: this.stops(),
      ideas: this.ideas(),
    };
  }

  async rename(userId: string, name: string) {
    this.check(userId);
    this.sql.exec('update trip set name = ?, edited_at = ?', name, Date.now());
    await this.publish();
    this.broadcast({ type: 'trip.updated', name }, userId);
  }

  // Soft delete: the trip leaves everyone's home screen but can be restored. Only its owner (who made it) can.
  async remove(userId: string) {
    this.checkOwner(userId);
    this.sql.exec('update trip set deleted_at = ?', Date.now());
    await this.publish();
    this.broadcast({ type: 'trip.deleted' }, userId);
    for (const ws of this.ctx.getWebSockets()) ws.close(4410, 'Trip deleted');
  }

  async restore(userId: string) {
    this.checkOwner(userId, true);
    this.sql.exec('update trip set deleted_at = null, edited_at = ?', Date.now());
    await this.publish();
  }

  // ---------- Stops ----------
  // Create, or put a deleted stop back (Undo). The client picks the id, so retries are harmless.
  async putStop(userId: string, stopId: string, input: unknown) {
    this.check(userId);
    const f = cleanStop(input, false) as StopFields;
    this.sql.exec(
      `insert or replace into stops (id, name, address, lat, lng, time, tz, duration, note, kind, nights, checkout, travel, back, links, wikidata, by, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      stopId, f.name, f.address, f.lat, f.lng, f.time, f.tz, f.duration, f.note, f.kind, f.nights, f.checkout, f.travel, JSON.stringify(f.back), JSON.stringify(f.links), f.wikidata, userId, Date.now());
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
    const vals = cols.map(k => (k === 'back' || k === 'links' ? JSON.stringify(f[k]) : f[k]));
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
    this.sql.exec('update trip set edited_at = ?', Date.now());
    await this.publish();
    this.broadcast({ type: 'stop.removed', id: stopId, name: row.name }, userId);
    return toStop(row);
  }

  // ---------- Want to go ----------
  // Places saved for the trip before they have a day. Saved whole, like a new stop (the client picks the id, so a retry
  // or an Undo is the same write); adding one to a day is a new stop, then this deleted. Neither changes the trip's
  // dates or its home card, which are the stops'.
  async putIdea(userId: string, ideaId: string, input: unknown) {
    this.check(userId);
    const f = cleanIdea(input);
    this.sql.exec(
      'insert or replace into ideas (id, name, address, lat, lng, note, kind, links, wikidata, by, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ideaId, f.name, f.address, f.lat, f.lng, f.note, f.kind, JSON.stringify(f.links), f.wikidata, userId, Date.now());
    const idea = toIdea(this.sql.exec<IdeaRow>('select * from ideas where id = ?', ideaId).one());
    await this.touch();
    this.broadcast({ type: 'idea.upserted', idea }, userId);
    return idea;
  }

  // Returns the idea as it was (null if it was already gone)
  async deleteIdea(userId: string, ideaId: string) {
    this.check(userId);
    const row = this.sql.exec<IdeaRow>('select * from ideas where id = ?', ideaId).toArray()[0];
    if (!row) return null;
    this.sql.exec('delete from ideas where id = ?', ideaId);
    await this.touch();
    this.broadcast({ type: 'idea.removed', id: ideaId, name: row.name }, userId);
    return toIdea(row);
  }

  // ---------- People ----------
  invite(userId: string) {
    return this.check(userId).invite;
  }

  // A new link, for when the old one went somewhere it shouldn't have
  async rotateInvite(userId: string, invite: string) {
    this.check(userId);
    this.sql.exec('update trip set invite = ?', invite);
    await this.publish();
  }

  // The Worker has already checked the share-link token against D1.
  async join(user: Omit<Member, 'identity'>) {
    const trip = this.trip();
    if (!trip) throw new Error(ERR.notFound);
    if (trip.deleted_at) throw new Error(ERR.gone);
    // Published whether or not you were on it already, so joining again puts right a D1 copy that missed you
    const member = this.isMember(user.id) ? null : this.addMember(user);
    await this.publish();
    if (member) this.broadcast({ type: 'member.joined', member }, user.id);
    return this.snapshot(user.id);
  }

  // Anyone but the owner can leave; the owner deletes the trip instead. Stops they added stay.
  // Leaving again is fine, and puts right a D1 copy that still has you.
  async leave(userId: string) {
    if (this.trip() && !this.isMember(userId)) {
      if (await this.listedFor(userId)) await this.publish();
      return;
    }
    const trip = this.check(userId);
    if (trip.created_by === userId) throw new Error(ERR.invalid);
    const { name } = this.sql.exec<{ name: string }>('select name from members where id = ?', userId).one();
    this.sql.exec('delete from members where id = ?', userId);
    await this.publish();
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
    this.sql.exec('update ideas set by = ? where by = ?', to.id, fromId);
    if (trip.created_by === fromId) this.sql.exec('update trip set created_by = ?', to.id);
    await this.publish();
  }

  // Keep names and photos current when someone updates their profile, live for anyone looking.
  async updateMember(user: Omit<Member, 'identity'>) {
    if (!this.isMember(user.id)) return;
    this.sql.exec('update members set name = ?, image = ? where id = ?', user.name, user.image, user.id);
    const member = this.sql.exec<Member>('select id, name, image, identity from members where id = ?', user.id).one();
    await this.publish();
    this.broadcast({ type: 'member.updated', member }, user.id);
  }

  // The home card's people and stops, for a trip whose D1 row doesn't have them yet (written before they were kept).
  async summary(): Promise<Preview | null> {
    if (!this.trip()) return null;
    await this.publish();
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
  // Finish the close with the code the client sent. A dropped connection (1006) or one closed with no code (1005) has
  // none it may be sent back with, and close() throws for those, so they're answered with 1000.
  webSocketClose(ws: WebSocket, code: number) { ws.close(code === 1000 || (code >= 3000 && code < 5000) ? code : 1000); }

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
  private ideas() {
    return this.sql.exec<IdeaRow>('select * from ideas order by updated_at, id').toArray().map(toIdea);
  }
  // An edit to the Want to go list: the trip was edited (Home lists the latest first), but its dates and card are the same
  private async touch() {
    this.sql.exec('update trip set edited_at = ?', Date.now());
    await this.publish();
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
    this.sql.exec('update trip set edited_at = ?', Date.now());
    await this.publish();
    this.broadcast({ type: 'stop.upserted', stop }, stop.by);
    return stop;
  }
  // ---------- The D1 copy ----------
  // D1 has what spans trips: who's on which trip (Home's list, an assistant's), each trip's home card, and the share
  // link's hash. It's a copy of this object, written only here, whole, in one batch: every change ends by publishing it,
  // so a write that failed is put right by the next one. rev numbers the copies, so one that lands late is ignored.
  // The trip ends at its last stop, or later if a hotel's nights run past it.
  private async project() {
    const trip = this.trip();
    if (!trip) return;
    // Everything is read in the same step as the revision, before anything is awaited, so a copy is one moment's
    this.sql.exec('update trip set rev = rev + 1');
    const { rev, edited_at } = this.sql.exec<{ rev: number; edited_at: number | null }>('select rev, edited_at from trip').one();
    const r = this.sql.exec<{ first: string | null; last: string | null }>(
      `select min(time) as first, max(max(time), coalesce((select max(date(time, '+' || nights || ' days')) from stops where nights is not null), '')) as last from stops`).one();
    const members = this.sql.exec<{ id: string; joined: number }>('select id, joined_at as joined from members').toArray();
    const copy = { id: trip.id, name: trip.name, first: r.first, last: r.last, preview: JSON.stringify(this.preview()), deletedAt: trip.deleted_at, editedAt: edited_at, rev, members };
    const D = this.env.DB, statements = copyStatements({ ...copy, inviteHash: await sha256(trip.invite) });
    await D.batch(statements.map(([sql, values]) => D.prepare(sql).bind(...values)));
  }
  // Whether Home lists this trip for someone: only then is a copy that disagrees with this object worth writing again
  // (asking costs a read, not a write, however often someone opens a trip they're not on)
  private async listedFor(userId: string) {
    return !!(await this.env.DB.prepare('select 1 from trip_members m join trips t on t.id = m.trip_id where m.trip_id = ? and m.user_id = ? and t.deleted_at is null')
      .bind(this.trip()!.id, userId).first());
  }
  // A change is saved here once it's made, so D1 being out of reach doesn't fail it: the copy is tried again shortly
  // (the alarm), and by the next change, and by open.
  private async publish() {
    try { await this.project(); } catch (e) {
      console.error(`D1 copy of trip ${this.trip()?.id}:`, e);
      await this.ctx.storage.setAlarm(Date.now() + 10_000);
    }
  }
  // Cloudflare retries an alarm that throws, waiting longer each time
  async alarm() { await this.project(); }
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

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
