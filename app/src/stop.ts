/* A stop: its fields, and the one check every write goes through (the app's, an assistant's over MCP). No storage and
   no Workers APIs, so the tests import it as it is. */
import { MAX, MAX_DURATION, MAX_LINKS, MAX_NIGHTS, QID, STOP_KINDS, TRAVEL_MODES } from '../web/fields.js';

// Errors cross the RPC boundary as plain messages; the Worker maps these to HTTP statuses.
export const ERR = { notFound: 'not_found', notMember: 'not_member', notOwner: 'not_owner', gone: 'gone', invalid: 'invalid' } as const;

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Ids the client picks for its stops
export const ID = /^[A-Za-z0-9_-]{6,40}$/;
// Stop types and how you get to a stop: the lists are in web/fields.js, which the app uses too
export const KINDS = STOP_KINDS;
export type Kind = typeof KINDS[number];
export const TRAVEL = TRAVEL_MODES;
export type Travel = typeof TRAVEL[number];
export type Back = Record<string, Travel>;
// An IANA time zone this runtime knows ("America/Denver")
const isZone = (z: unknown): z is string => {
  if (typeof z !== 'string' || z.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(z)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; }
};

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
export type Stop = {
  id: string; name: string; address: string; lat: number; lng: number;
  time: string; tz: string | null; duration: number | null; note: string; kind: Kind | ''; nights: number | null; checkout: string | null; travel: Travel; back: Back; links: Link[]; wikidata: string | null; by: string; updatedAt: number;
};
export type Link = { url: string; label: string };
export type StopFields = Omit<Stop, 'id' | 'by' | 'updatedAt'>;

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
  str('name', MAX.name, true);
  str('address', MAX.address, false);
  str('note', MAX.note, false);
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
      if (typeof url !== 'string' || url.length > MAX.url || typeof label !== 'string' || label.length > MAX.label) throw new Error(ERR.invalid);
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
  // done is gone (see the schema's second change), but an older client may still send it: checked, and dropped
  if (i.done !== undefined && typeof i.done !== 'boolean') throw new Error(ERR.invalid);
  if (!partial) out = { address: '', note: '', tz: null, duration: null, kind: '', nights: null, checkout: null, travel: 'drive', back: {}, links: [], wikidata: null, ...out };
  return out;
}

// An idea: a place on the trip's Want to go list, not given a day yet. It's a stop's place, and nothing else: no note or
// links (those are for a stop), no time, stay or way there. They come when it's added to a day, as a stop. `by` is who
// saved it.
export type Idea = Pick<Stop, 'id' | 'name' | 'address' | 'lat' | 'lng' | 'kind' | 'wikidata' | 'by' | 'updatedAt'>;
export type IdeaFields = Omit<Idea, 'id' | 'by' | 'updatedAt'>;
const IDEA_KEYS = ['name', 'address', 'lat', 'lng', 'kind', 'wikidata'] as const;

// Checks a whole idea (it's only ever written whole): its fields are checked as a stop's are; any other key (a time, a
// note, links) is dropped.
export function cleanIdea(input: unknown): IdeaFields {
  if (!input || typeof input !== 'object') throw new Error(ERR.invalid);
  const i = input as Record<string, unknown>;
  const picked = Object.fromEntries(IDEA_KEYS.filter(k => i[k] !== undefined).map(k => [k, i[k]]));
  const f = cleanStop(picked, true);
  if (f.name === undefined || f.lat === undefined || f.lng === undefined) throw new Error(ERR.invalid);
  return { address: '', kind: '', wikidata: null, ...f } as IdeaFields;
}
