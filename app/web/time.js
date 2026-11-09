// @ts-check
/* Clock times ("YYYY-MM-DDTHH:MM", the time where the stop is), time zones, and how they read. No DOM: the tests import this. */
// ?today=YYYY-MM-DD (and &now=HH:MM) pretend it's a trip day, so today's highlight can be previewed before the trip.
// (There's no location when the tests import this.)
const pretend = new URLSearchParams(globalThis.location?.search);
const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(pretend.get('today') || '') ? pretend.get('today') : null;
const NOW_HM = /^\d{2}:\d{2}$/.test(pretend.get('now') || '') ? pretend.get('now') : null;
export const pad = n => String(n).padStart(2, '0');

// ---------- Time & distance formatting (times are trip-local, stored as "YYYY-MM-DDTHH:MM") ----------
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function toDate(t) {
  const [d, hm = '00:00'] = t.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  return new Date(y, m - 1, dd, h, mi);
}
export const toInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function fmtClock(d) { const h = d.getHours(); return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`; }
export const fmtTime = t => fmtClock(toDate(t));
export const fmtDay = t => { const d = toDate(t); return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
// "Now" as a "YYYY-MM-DDTHH:MM" stamp, trip-local like stop times
export function nowStamp() {
  const real = toInput(new Date());
  return `${TODAY || real.slice(0, 10)}T${NOW_HM || real.slice(11)}`;
}
// ---------- Time zones: a stop's time is the clock time where it is ----------
// Its zone is its place's own, looked up from where it is (tzlookup, tz-lookup.js), unless someone set another (`tz`).
// Times show as they're written, the way a ticket or a booking says them; what's in order, a drive that won't make it,
// and what's happening now go by the moment each one is, so a flight from Los Angeles at 10:00 that lands in New York
// at 18:30 takes 5½ hours, not 8½. With no lookup (the file didn't load), every place is in this device's zone.
export const DEVICE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const zoneOk = new Map(), placeZones = new Map(), zoneFmts = new Map(), instants = new Map();
function knownZone(z) {
  if (!zoneOk.has(z)) { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); zoneOk.set(z, true); } catch { zoneOk.set(z, false); } }
  return zoneOk.get(z);
}
export function placeZone(lat, lng) {
  if (lat == null || lng == null || typeof tzlookup !== 'function') return DEVICE_ZONE;
  const k = `${(+lat).toFixed(3)},${(+lng).toFixed(3)}`;
  if (!placeZones.has(k)) { let z = DEVICE_ZONE; try { z = tzlookup(+lat, +lng); } catch {} placeZones.set(k, knownZone(z) ? z : DEVICE_ZONE); }
  return placeZones.get(k);
}
export const zoneOf = s => (s.tz && knownZone(s.tz) ? s.tz : placeZone(s.lat, s.lng));
// How far `zone` is ahead of UTC at the moment `ms`, in ms
function zoneAhead(zone, ms) {
  let f = zoneFmts.get(zone);
  if (!f) zoneFmts.set(zone, f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }));
  const p = Object.fromEntries(f.formatToParts(ms).map(x => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - Math.floor(ms / 60000) * 60000;
}
// The moment a clock time in `zone` is, in ms. (A time skipped when the clocks go forward counts as the hour after.)
export function instantOf(t, zone) {
  const k = `${t}|${zone}`;
  if (!instants.has(k)) {
    const [d, hm = '00:00'] = t.split('T'), [y, m, dd] = d.split('-').map(Number), [h, mi] = hm.split(':').map(Number);
    const wall = Date.UTC(y, m - 1, dd, h, mi);
    // The clock time read with the zone's offset a day before and a day after. One of them is that clock time, or both:
    // when the clocks go back it happens twice, and the first is taken. In the hour skipped when they go forward neither
    // is, and the later one is the hour after.
    const [a, b] = [-864e5, 864e5].map(d => wall - zoneAhead(zone, wall + d));
    const real = [a, b].filter(t => zoneAhead(zone, t) === wall - t);
    const ms = real.length ? Math.min(...real) : Math.max(a, b);
    if (instants.size > 5000) instants.clear();
    instants.set(k, ms);
  }
  return instants.get(k);
}
export const momentOf = s => instantOf(s.time, zoneOf(s));
// "Now", as a moment. Pretending (?today=, &now=) puts each clock at that time, as nowStamp does.
export const nowIn = zone => (TODAY || NOW_HM ? instantOf(nowStamp(), zone) : Date.now());
// A zone's short name at a moment ("MST", "GMT+9"), and its long one ("Mountain Standard Time")
/** @param {string} zone @param {number} ms @param {'short' | 'long'} [style] */
export function zoneName(zone, ms, style = 'short') {
  const k = `${zone}|${style}`;
  if (!zoneFmts.has(k)) zoneFmts.set(k, new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style }));
  return zoneFmts.get(k).formatToParts(ms).find(x => x.type === 'timeZoneName')?.value || zone;
}
// The city in a zone's name ("America/Argentina/Buenos_Aires" → "Buenos Aires")
export const zoneCity = z => z.split('/').at(-1).replace(/_/g, ' ');

export function fmtRange(start, end) {
  if (!start) return '';
  const a = toDate(start), b = toDate(end);
  const left = `${MONTHS[a.getMonth()]} ${a.getDate()}`;
  if (a.toDateString() === b.toDateString()) return left;
  return a.getMonth() === b.getMonth() ? `${left} – ${b.getDate()}` : `${left} – ${MONTHS[b.getMonth()]} ${b.getDate()}`;
}
export function fmtDur(sec) {
  const m = Math.max(1, Math.round(Math.abs(sec) / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}
