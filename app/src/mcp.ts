import type { McpProps } from './oauth';
import { ERR, KINDS, TRAVEL, cleanStop, type Stop } from './stop';
import type { TripRoom } from './trip';

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
// Bump the version whenever a tool or its arguments change: a client may keep its copy of the tools until it does.
const SERVER = { name: 'dotsie', title: 'Dotsie', version: '2.0.0' };
const INSTRUCTIONS = `Dotsie plans road trips. A trip is a list of stops, each with a time ("YYYY-MM-DDTHH:MM"): the clock time where the stop is, in the place's own time zone, as on a ticket or a booking. A flight that leaves Los Angeles at 10:00 and lands in New York at 18:30 is two stops at those times.
Call list_trips to find a trip and list_stops to see its plan; add_stop, edit_stop and delete_stop change it. Changes show at once for everyone on the trip.
A stop's links are buttons under it in the app, one tap from the plan. Whenever you find or are given a web page for a stop, add it with add_link instead of writing the URL in the note: a booking or reservation, a flight (the airline's booking or its flight status), tickets, the place's own site, a guide to it. Label each in a few words ("UA 123", "Hotel booking", "Tickets"). A flight's links go on the airport you fly from, where you'll need them; with no stop there, on the one you land at.`;

const ID = /^[A-Za-z0-9_-]{6,40}$/;
const room = (env: Env, tripId: unknown) => {
  if (typeof tripId !== 'string' || !ID.test(tripId)) throw new ToolError('trip_id isn’t a trip id. Call list_trips for one.');
  return env.TRIP.get(env.TRIP.idFromName(tripId)) as DurableObjectStub<TripRoom>;
};
const stopId = (v: unknown) => {
  if (typeof v !== 'string' || !ID.test(v)) throw new ToolError('stop_id isn’t a stop id. Call list_stops for one.');
  return v;
};
// Like the app's ids for the stops it adds (uid in web/core.js)
const newId = () => [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');
// The fields a tool was given that a stop has, each checked on its own, so an error names the one that's wrong
function fieldsOf(args: Record<string, unknown>) {
  const fields = Object.fromEntries(Object.entries(args).filter(([k]) => k in EDITABLE));
  if (fields.links !== undefined) fields.links = linksOf(fields.links);
  for (const [k, v] of Object.entries(fields)) {
    try { cleanStop({ [k]: v }, true); } catch {
      const about = (EDITABLE as Record<string, { description?: string }>)[k].description;
      throw new ToolError(`${k} isn’t valid${about ? `: ${about}` : '. Check its format in the tool’s input schema'}.`);
    }
  }
  return fields;
}

// Links as an assistant may send them, as [{ url, label }]. A client whose copy of the tools predates links, or a
// model guessing, sends them as a JSON string, bare addresses, one link on its own, a title in place of a label, or
// an address without https://. Each of those is taken; anything else gets an error that says what to send.
const LINKS_FORMAT = 'Send links as an array of { "url": "https://…", "label": "a few words" }, or add one at a time with add_link.';
function linksOf(v: unknown) {
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^[[{]/.test(t)) {
      try { v = JSON.parse(t); } catch { throw new ToolError(`links isn’t valid JSON. ${LINKS_FORMAT}`); }
    } else v = t ? [t] : [];
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) v = [v];
  if (!Array.isArray(v)) throw new ToolError(`links isn’t a list. ${LINKS_FORMAT}`);
  if (v.length > MAX_LINKS) throw new ToolError(`A stop has at most ${MAX_LINKS} links; this sends ${v.length}.`);
  return v.map((x, i) => linkOf(x, `links[${i}]`));
}
function linkOf(x: unknown, where: string) {
  const o = typeof x === 'string' ? { url: x } : x && typeof x === 'object' ? x as Record<string, unknown> : null;
  if (!o) throw new ToolError(`${where} isn’t a link. ${LINKS_FORMAT}`);
  const url = webAddress(o.url ?? o.href ?? o.link), label = o.label ?? o.title ?? o.name ?? o.text ?? '';
  if (!url) throw new ToolError(`${where}: ${JSON.stringify(o.url ?? o.href ?? o.link ?? null)} isn’t a web address. Links are http(s) pages.`);
  if (typeof label !== 'string') throw new ToolError(`${where}: its label must be text.`);
  // A long label is cut, not refused: the button shows a few words at most
  const short = label.trim().length > MAX_LABEL ? `${label.trim().slice(0, MAX_LABEL - 1).trimEnd()}…` : label.trim();
  return { url, label: short };
}
// "booking.com/…" becomes https://booking.com/…; '' for anything that isn't an http(s) address
function webAddress(v: unknown) {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (!t || /\s/.test(t)) return '';
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(t) && !/^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(t) ? t : `https://${t}`);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? u.href : '';
  } catch { return ''; }
}
const MAX_LINKS = 10, MAX_LABEL = 60;
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
  id: s.id, name: s.name, address: s.address, lat: s.lat, lng: s.lng, time: s.time, tz: s.tz ?? null, duration: s.duration ?? null, checkout: s.checkout,
  kind: s.kind, nights: s.nights, travel: s.travel ?? 'drive', back: s.back ?? {}, note: s.note, links: s.links ?? [], updatedBy: names.get(s.by) ?? null, updatedAt: new Date(s.updatedAt).toISOString(),
});
const memberNames = (members: { id: string; name: string }[]) => new Map(members.map(m => [m.id, m.name]));

// A web page about a stop; the app shows it as a button with its label, or its site when it has none
const LINK = {
  type: 'object', required: ['url'], additionalProperties: false,
  properties: {
    url: { type: 'string', maxLength: 2000, pattern: '^https?://', description: 'An http(s) web page' },
    label: { type: 'string', maxLength: 60, description: 'A few words for its button: "UA 123", "Hotel booking", "Tickets". Leave out to show the site (booking.com)' },
  },
} as const;

const EDITABLE = {
  name: { type: 'string', maxLength: 200, description: 'The place’s name' },
  address: { type: 'string', maxLength: 300 },
  lat: { type: 'number', minimum: -90, maximum: 90 },
  lng: { type: 'number', minimum: -180, maximum: 180 },
  time: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$', description: 'When you arrive, "YYYY-MM-DDTHH:MM", in the clock time where the stop is (its place’s time zone, or tz). Stops are ordered by when that is' },
  tz: { type: ['string', 'null'], maxLength: 64, description: 'Only if time isn’t the clock time where the stop is: the IANA time zone it’s in ("America/Denver"). null (the default) is the place’s own' },
  duration: { type: ['integer', 'null'], minimum: 1, maximum: 1440, description: 'How long you’re at the stop, in minutes, or null for not said. The drive after it leaves when it ends. Not for a hotel: its stay is nights and checkout' },
  checkout: { type: ['string', 'null'], pattern: '^([01]\\d|2[0-3]):[0-5]\\d$', description: 'When you leave, "HH:MM". A hotel only: its check-out time on the day its nights end (null shows 11:00). For how long you’re at another stop, use duration' },
  kind: { type: 'string', enum: ['', ...KINDS], description: 'The stop’s type, which sets its icon. "" lets the app guess from the name' },
  nights: { type: ['integer', 'null'], minimum: 0, maximum: 30, description: 'A hotel’s nights from check-in (0 checks out the same day, e.g. arriving after midnight), or null to last until the next hotel or the trip’s last day' },
  travel: { type: 'string', enum: [...TRAVEL], description: 'How you get to this stop from the one before it (for a hotel, on its check-in day). New stops are "drive"' },
  back: {
    type: 'object', propertyNames: { pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, additionalProperties: { type: 'string', enum: [...TRAVEL] }, maxProperties: 31,
    description: 'A hotel only: how you get back to it each night, by the day you go back ("YYYY-MM-DD": way). Each night is its own leg; nights not listed are drives. Replaces the whole set, so send every night to keep',
  },
  note: { type: 'string', maxLength: 2000, description: 'Anything to remember: confirmation numbers, tickets, tips. Put web pages in links (add_link), not here' },
  links: {
    type: 'array', maxItems: 10, items: LINK,
    description: 'Pages about the stop, each a button under it in the app. Replaces the whole list, so send every link to keep, or [] for none. To add one, use add_link',
  },
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
      const stop = await room(env, trip_id).putStop(user.id, newId(), fieldsOf(fields));
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
    name: 'add_link',
    title: 'Add a link to a stop',
    description: 'Add a web page to a stop’s links, which show as buttons under it in the app: a booking, flight, tickets, the place’s own page or a guide to it. The stop’s other links stay. If it has this page already, only its label changes. Returns the stop as saved.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'string', description: 'From list_trips' },
        stop_id: { type: 'string', description: 'From list_stops' },
        url: LINK.properties.url,
        label: LINK.properties.label,
      },
      required: ['trip_id', 'stop_id', 'url'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async run(env, user, { trip_id, stop_id, url, label }) {
      const stop = await room(env, trip_id).addLink(user.id, stopId(stop_id), linkOf({ url, label }, 'url'));
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
