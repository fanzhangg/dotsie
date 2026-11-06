import type { McpProps } from './oauth';
import { ERR, KINDS, TRAVEL, type Stop, type TripRoom } from './trip';

/* An MCP server, so an AI assistant can read a trip's stops and add, change or remove them for you. It speaks MCP's
   Streamable HTTP transport without sessions: every POST to /api/mcp is one JSON-RPC message, answered with
   plain JSON (no event stream, since no tool here runs long or sends progress).
   Clients sign in with OAuth (src/oauth.ts). It acts as the person who allowed it and goes through their TripRoom calls like the app does, so membership,
   validation and live updates to anyone with the trip open are the same as an edit made in the app. */

export type McpUser = { id: string; name: string };
type Tool = {
  name: string; title: string; description: string;
  inputSchema: object; annotations?: object;
  run: (env: Env, user: McpUser, args: Record<string, unknown>) => Promise<unknown>;
};

// Versions this server can speak. The tools use nothing that differs between them.
const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER = { name: 'waythread', title: 'Waythread', version: '1.0.0' };
const INSTRUCTIONS = `Waythread plans road trips. A trip is a list of stops, each with a trip-local time ("YYYY-MM-DDTHH:MM", no time zone).
Call list_trips to find a trip and list_stops to see its plan; add_stop, edit_stop and delete_stop change it. Changes show at once for everyone on the trip.`;

const ID = /^[A-Za-z0-9_-]{6,40}$/;
const room = (env: Env, tripId: unknown) => {
  if (typeof tripId !== 'string' || !ID.test(tripId)) throw new ToolError('trip_id isn’t a trip id. Call list_trips for one.');
  return env.TRIP.get(env.TRIP.idFromName(tripId)) as DurableObjectStub<TripRoom>;
};
const stopId = (v: unknown) => {
  if (typeof v !== 'string' || !ID.test(v)) throw new ToolError('stop_id isn’t a stop id. Call list_stops for one.');
  return v;
};
// Like the app's ids for the stops it adds (uid in web/app.js)
const newStopId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
const fieldsOf = (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).filter(([k]) => k in EDITABLE));
// What a tool error says to the assistant, which can then fix its call
class ToolError extends Error {}
const ERROR_TEXT: Record<string, string> = {
  [ERR.notFound]: 'No such trip or stop. Call list_trips or list_stops for ids.',
  [ERR.notMember]: 'You’re not on this trip.',
  [ERR.gone]: 'This trip was deleted.',
  [ERR.invalid]: 'A field isn’t valid. Check the formats in the tool’s input schema.',
};

// A stop as the assistant sees it: the fields it can edit, plus who changed it last
const stopOut = (s: Stop, names: Map<string, string>) => ({
  id: s.id, name: s.name, address: s.address, lat: s.lat, lng: s.lng, time: s.time, checkout: s.checkout,
  kind: s.kind, nights: s.nights, travel: s.travel ?? 'drive', note: s.note, updatedBy: names.get(s.by) ?? null, updatedAt: new Date(s.updatedAt).toISOString(),
});
const memberNames = (members: { id: string; name: string }[]) => new Map(members.map(m => [m.id, m.name]));

const EDITABLE = {
  name: { type: 'string', maxLength: 200, description: 'The place’s name' },
  address: { type: 'string', maxLength: 300 },
  lat: { type: 'number', minimum: -90, maximum: 90 },
  lng: { type: 'number', minimum: -180, maximum: 180 },
  time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$', description: 'When you arrive, trip-local: "YYYY-MM-DDTHH:MM". Stops are ordered by time' },
  checkout: { type: ['string', 'null'], pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'When you leave, "HH:MM". A hotel: its check-out time on the day its nights end (null shows 11:00). Any other stop: a time later the same day, or null for none' },
  kind: { type: 'string', enum: ['', ...KINDS], description: 'The stop’s type, which sets its icon. "" lets the app guess from the name' },
  nights: { type: ['integer', 'null'], minimum: 1, maximum: 30, description: 'A hotel’s nights from check-in, or null to last until the next hotel or the trip’s last day' },
  travel: { type: 'string', enum: [...TRAVEL], description: 'How you get to this stop from the one before it (for a hotel, also the way back to it each night). New stops are "drive"' },
  note: { type: 'string', maxLength: 2000 },
};

const TOOLS: Tool[] = [
  {
    name: 'list_trips',
    title: 'List trips',
    description: 'Your trips, most recently edited first, each with its id and its first and last stop times.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(env, user) {
      const { results } = await env.DB.prepare(
        `select t.id, t.name, t.first_stop as start, t.last_stop as end from trips t
         join trip_members m on m.trip_id = t.id
         where m.user_id = ? and t.deleted_at is null order by t.updated_at desc`,
      ).bind(user.id).all();
      return { trips: results };
    },
  },
  {
    name: 'list_stops',
    title: 'List stops',
    description: 'A trip’s plan: its stops in time order. Give day to see just that day’s stops.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'string', description: 'From list_trips' },
        day: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Optional: only stops on this trip-local day, "YYYY-MM-DD"' },
      },
      required: ['trip_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(env, user, { trip_id, day }) {
      if (day !== undefined && (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))) throw new ToolError('day must be "YYYY-MM-DD".');
      const snap = await room(env, trip_id).snapshot(user.id);
      const names = memberNames(snap.members);
      const stops = snap.stops.filter(s => !day || s.time.startsWith(day as string)).map(s => stopOut(s, names));
      return { trip: snap.trip, stops };
    },
  },
  {
    name: 'add_stop',
    title: 'Add a stop',
    description: 'Add a stop to a trip. It needs a name, where it is (lat, lng) and when (time); the rest is optional. Everyone on the trip sees it at once. Returns the stop as saved, with its new id.',
    inputSchema: {
      type: 'object',
      properties: { trip_id: { type: 'string', description: 'From list_trips' }, ...EDITABLE },
      required: ['trip_id', 'name', 'lat', 'lng', 'time'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async run(env, user, { trip_id, ...fields }) {
      const missing = ['name', 'lat', 'lng', 'time'].filter(k => fields[k] === undefined);
      if (missing.length) throw new ToolError(`A new stop needs ${missing.join(', ')}.`);
      const stop = await room(env, trip_id).putStop(user.id, newStopId(), fieldsOf(fields));
      return { stop: stopOut(stop, new Map([[user.id, user.name]])) };
    },
  },
  {
    name: 'edit_stop',
    title: 'Edit a stop',
    description: 'Change some of a stop’s fields; the rest stay as they are. Everyone on the trip sees the change at once. Returns the stop as saved.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'string', description: 'From list_trips' },
        stop_id: { type: 'string', description: 'From list_stops' },
        ...EDITABLE,
      },
      required: ['trip_id', 'stop_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(env, user, { trip_id, stop_id, ...fields }) {
      const id = stopId(stop_id), changes = fieldsOf(fields);
      if (!Object.keys(changes).length) throw new ToolError(`Give at least one field to change: ${Object.keys(EDITABLE).join(', ')}.`);
      const stop = await room(env, trip_id).patchStop(user.id, id, changes);
      return { stop: stopOut(stop, new Map([[user.id, user.name]])) };
    },
  },
  {
    name: 'delete_stop',
    title: 'Delete a stop',
    description: 'Remove a stop from a trip, for everyone on it. Returns the stop as it was, so add_stop can put it back.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'string', description: 'From list_trips' },
        stop_id: { type: 'string', description: 'From list_stops' },
      },
      required: ['trip_id', 'stop_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async run(env, user, { trip_id, stop_id }) {
      const r = room(env, trip_id), id = stopId(stop_id);
      const names = memberNames((await r.snapshot(user.id)).members); // who last changed it, as list_stops says
      const stop = await r.deleteStop(user.id, id);
      if (!stop) throw new Error(ERR.notFound);
      return { deleted: stopOut(stop, names) };
    },
  },
];

// ---------- JSON-RPC ----------
type Message = { jsonrpc?: unknown; id?: string | number | null; method?: unknown; params?: Record<string, unknown> };
const result = (id: Message['id'], r: unknown) => ({ jsonrpc: '2.0', id, result: r });
const failure = (id: Message['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

// One JSON-RPC message in, its reply out (null for a notification, which gets none)
async function handleMcp(env: Env, user: McpUser, msg: unknown) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || (msg as Message).jsonrpc !== '2.0' || typeof (msg as Message).method !== 'string')
    return failure(null, -32600, 'Invalid request');
  const { id, method, params = {} } = msg as Message;
  if (id === undefined) return null; // notifications/initialized, notifications/cancelled: nothing to do
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return result(id, {
        protocolVersion: typeof asked === 'string' && VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return result(id, {});
    case 'tools/list':
      return result(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === params.name);
      if (!tool) return failure(id, -32602, `Unknown tool: ${String(params.name)}`);
      const args = params.arguments && typeof params.arguments === 'object' ? params.arguments as Record<string, unknown> : {};
      try {
        const out = await tool.run(env, user, args);
        return result(id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out });
      } catch (err) {
        const text = err instanceof ToolError ? err.message : ERROR_TEXT[(err as Error).message];
        if (!text) { console.error(err); return failure(id, -32603, 'Internal error'); }
        return result(id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return failure(id, -32601, `Method not found: ${method}`);
  }
}

// ---------- HTTP ----------
// The OAuth provider (src/oauth.ts) has checked the access token before this runs; ctx.props is who it acts for.
export const mcpApi = {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } }); // no event stream to open, no session to end
    // Their current name, for updatedBy; a deleted account's grant stops working
    const user = await env.DB.prepare('select id, name from "user" where id = ?').bind((ctx.props as McpProps).userId).first<McpUser>();
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (!(await env.MCP_LIMIT.limit({ key: user.id })).success) return Response.json({ error: 'rate_limited' }, { status: 429 });
    const msg = await req.json().catch(() => undefined);
    if (msg === undefined) return Response.json(failure(null, -32700, 'Parse error'), { status: 400 });
    const reply = await handleMcp(env, user, msg);
    return reply ? Response.json(reply) : new Response(null, { status: 202 });
  },
};
