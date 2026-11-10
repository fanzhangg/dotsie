// @ts-check
/* A trip as a plan: its stops in order, its days and stays, what each day holds, stop types and how you get there.
   No DOM: the tests import this. */
import { STOP_KINDS, TRAVEL_MODES } from './fields.js';
import { momentOf, toDate, toInput } from './time.js';

/** @typedef {import('../src/stop').Stop} Stop A stop as the server sends it */
/** @typedef {import('../src/stop').Idea} Idea A place on the trip's Want to go list, as the server sends it */
/** @typedef {{ stops: Stop[], ideas?: Idea[] }} Trip A trip as the app holds it (fromSnapshot in trips.js); only its stops and ideas matter here */
/** @typedef {{ key: string, place: Stop, role: 'wake' | 'checkout' | 'from' | 'stop' | 'night', day?: string, at?: string }} Entry
    A place in a day's plan, and why it's there */

// In the order they happen (see Time zones)
/** @param {Trip} trip @returns {Stop[]} */
export const stopsOf = trip => [...trip.stops].sort((a, b) => momentOf(a) - momentOf(b) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));

// ---------- Days: the trip screen shows one day at a time ----------
/** @param {Pick<Stop, 'time'>} s */
export const dayOf = s => s.time.slice(0, 10);
/** @param {string} day @param {number} n */
export function addDays(day, n) { const d = toDate(day); d.setDate(d.getDate() + n); return toInput(d).slice(0, 10); }
/** @param {string} a @param {string} b */
export const daysBetween = (a, b) => Math.round((+toDate(b) - +toDate(a)) / 864e5);
/** @param {Pick<Stop, 'lat' | 'lng'>} a @param {Pick<Stop, 'lat' | 'lng'>} b */
export const samePlace = (a, b) => a.lat === b.lat && a.lng === b.lng;

// Hotels are stays, not just stops: you check in, sleep there, and start the next morning from there.
// A hotel lasts its nights; left unset, it lasts until the next hotel, or the trip's last day.
// 0 nights is a same-day stay: in after midnight, out that morning, or a room for the afternoon.
/** @param {Trip} trip @returns {{ s: Stop, nights: number, checkIn: string, checkOut: string }[]} */
export function staysOf(trip) {
  const stops = stopsOf(trip), hotels = stops.filter(s => kindOf(s) === 'hotel');
  const last = stops.at(-1), lastDay = last ? dayOf(last) : '';
  return hotels.map((s, i) => {
    const next = hotels[i + 1], until = next ? dayOf(next) : lastDay;
    const nights = s.nights != null && s.nights >= 0 ? s.nights : Math.max(1, daysBetween(dayOf(s), until));
    return { s, nights, checkIn: dayOf(s), checkOut: addDays(dayOf(s), nights) };
  });
}
// The stay you sleep at on the night of `day`, if any.
/** @param {Trip} trip @param {string} day */
export const stayOnNight = (trip, day) => staysOf(trip).find(st => st.checkIn <= day && day < st.checkOut);
// Trip days: every day with a stop, plus every day of a stay up to check-out.
/** @param {Trip} trip @returns {string[]} */
export function daysOf(trip) {
  const days = new Set(stopsOf(trip).map(dayOf));
  for (const st of staysOf(trip)) for (let d = st.checkIn; d <= st.checkOut; d = addDays(d, 1)) days.add(d);
  return [...days].sort();
}
// The overview: every day of the trip on one page, before the first day. The day bar steps through the pages.
export const ALL = 'all';
// Want to go: the places saved for the trip that have no day yet, on a page of their own before the overview, since
// that's where planning starts: first where you'd like to go, then when.
export const IDEAS = 'ideas';
/** @param {Trip} trip @returns {string[]} Want to go, the overview, then every day (none yet: the overview is empty) */
export const pagesOf = trip => [IDEAS, ALL, ...daysOf(trip)];
/** @param {Trip} trip @returns {Idea[]} in the order they were saved */
export const ideasOf = trip => trip.ideas || [];
// km between two places: flat, which is close enough for "near"
/** @param {{ lat: number, lng: number }} a @param {{ lat: number, lng: number }} b */
export const kmBetween = (a, b) => Math.hypot((b.lng - a.lng) * 111.32 * Math.cos(a.lat * Math.PI / 180), (b.lat - a.lat) * 110.57);
// A place is near a day when one of the day's places (its stops, and the hotel at either end) is this close
export const NEAR_KM = 50;
// The day each place on Want to go is nearest, by the day's places, or null when none is within NEAR_KM: the list
// groups them by it, and each day's map shows its own. The earlier day, where two are as near (a hotel's days).
/** @param {Trip} trip @returns {Map<string, string | null>} idea id → day */
export function ideaDays(trip) {
  const days = daysOf(trip).map(d => ({ d, places: dayPlan(trip, d).filter(e => e.role !== 'from').map(e => e.place) }));
  return new Map(ideasOf(trip).map(i => {
    /** @type {string | null} */
    let best = null, min = Infinity;
    for (const { d, places } of days) for (const p of places) { const k = kmBetween(i, p); if (k < min) { min = k; best = d; } }
    return /** @type {[string, string | null]} */ ([i.id, min <= NEAR_KM ? best : null]);
  }));
}
// The Want to go places a page shows on its map: a day's own, the overview's every day's, and on Want to go all of them
/** @param {Trip} trip @param {string} day */
export function ideasOn(trip, day) {
  if (day === IDEAS) return ideasOf(trip);
  const by = ideaDays(trip);
  return ideasOf(trip).filter(i => (day === ALL ? by.get(i.id) != null : by.get(i.id) === day));
}
// The place on Want to go that's this one, if it's there already: the same spot, or the same name close by (search and
// a sight can put one place a little apart)
/** @param {{ ideas?: { name: string, lat: number, lng: number }[] }} trip @param {{ name: string, lat: number, lng: number }} p */
export function findIdea(trip, p) {
  const name = p.name.trim().toLowerCase();
  return (trip.ideas || []).find(i => kmBetween(i, p) < 0.05 || (i.name.trim().toLowerCase() === name && kmBetween(i, p) < 2)) || null;
}
/** @param {Trip} trip @param {string} day */
export const dayStops = (trip, day) => stopsOf(trip).filter(s => dayOf(s) === day);

// A day as you'll live it: wake up at last night's hotel, the day's stops, then back to tonight's hotel.
// Each entry is a place with a role. With no hotel the night before, the day starts from the day before's last stop.
/** @param {Trip} trip @param {string} day @returns {Entry[]} */
export function dayPlan(trip, day) {
  /** @type {Entry[]} */
  const plan = [];
  const stops = dayStops(trip, day);
  const morning = stayOnNight(trip, addDays(day, -1));
  if (morning) plan.push({ key: `wake:${morning.s.id}:${day}`, place: morning.s, role: morning.checkOut === day ? 'checkout' : 'wake' });
  else {
    const prev = stopsOf(trip).filter(s => dayOf(s) < day).at(-1);
    if (prev && stops.length) plan.push({ key: `from:${prev.id}:${day}`, place: prev, role: 'from' });
  }
  // A same-day stay checks out that day too: `Check out` goes among the day's stops at its time
  /** @type {Entry[]} */
  const sameDay = staysOf(trip).filter(st => st.nights === 0 && st.checkIn === day)
    .map(st => ({ key: `checkout:${st.s.id}:${day}`, place: st.s, role: 'checkout', at: `${day}T${checkoutOf(st.s)}` }));
  for (const s of stops) {
    while (sameDay.length && /** @type {string} */ (sameDay[0].at) < s.time && plan.some(e => e.place === sameDay[0].place)) plan.push(/** @type {Entry} */ (sameDay.shift()));
    plan.push({ key: s.id, place: s, role: 'stop' });
  }
  plan.push(...sameDay);
  const night = stayOnNight(trip, day);
  if (night && plan.at(-1)?.place !== night.s) plan.push({ key: `night:${night.s.id}:${day}`, place: night.s, role: 'night', day });
  return plan;
}
// A page's places, drives and rows: one day's, or on the overview every day's, in order. Leg and row keys are
// unique across the trip, so the overview's map works like a day's.
/** @param {Trip} trip @param {string} day */
// Want to go has no plan: its places have no day.
/** @param {Trip} trip @param {string} day */
export const planOn = (trip, day) => (day === IDEAS ? [] : day === ALL ? daysOf(trip).flatMap(d => dayPlan(trip, d)) : dayPlan(trip, day));

// ---------- Stop types: an icon and a color each (--wt-kind-<key>), shared by the list marker and the map pin ----------
// The colors skip blue (routes) and red (a drive that doesn't fit). The types, in this order, are fields.js's, which the
// server checks stops against; the tests check each has a look here.
const KIND_LOOKS = {
  place: { label: 'Place', icon: 'pin' },
  airport: { label: 'Airport', icon: 'plane' },
  hotel: { label: 'Hotel', icon: 'bed' },
  restaurant: { label: 'Restaurant', icon: 'utensils' },
  cafe: { label: 'Café', icon: 'cup' },
  attraction: { label: 'Attraction', icon: 'star' },
  museum: { label: 'Museum', icon: 'museum' },
  viewpoint: { label: 'Viewpoint', icon: 'camera' },
  nature: { label: 'Nature', icon: 'tree' },
  shopping: { label: 'Shopping', icon: 'bag' },
  gas: { label: 'Gas', icon: 'fuel' },
};
export const KINDS = Object.fromEntries(STOP_KINDS.map(k => [k, KIND_LOOKS[k]]));
// The type list, in sections a traveler thinks in: anywhere; staying and getting there; eating; seeing and doing
export const KIND_SECTIONS = [['place'], ['hotel', 'airport', 'gas'], ['restaurant', 'cafe'], ['attraction', 'viewpoint', 'nature', 'museum', 'shopping']];
// Said only where a type changes the form
export const KIND_HINTS = { hotel: 'Check-in and check-out' };
// A first guess from the place's name, and from its category when it came from search
// (OpenStreetMap's "tourism:museum" in local dev, Stadia's "accommodation" or "food" in production).
/** @param {string} [name] @param {string} [cat] @returns {import('../src/stop').Kind} */
export function guessKind(name = '', cat = '') {
  const is = (tags, words) => tags.test(cat) || words.test(name);
  if (is(/aerodrome|airport|transport:air/, /airport|\bintl\b/i)) return 'airport';
  if (is(/hotel|motel|hostel|guest_house|camp_site|chalet|accommodation/, /hotel|\binn\b|motel|lodge|resort|hostel/i)) return 'hotel';
  if (is(/cafe|coffee/, /caf[eé]|coffee|bakery/i)) return 'cafe';
  if (is(/restaurant|fast_food|food_court|:bar|:pub|\bfood\b|nightlife/, /restaurant|grill|diner|bistro|pizz|taco|bbq|kitchen/i)) return 'restaurant';
  if (is(/museum|gallery/, /museum|gallery/i)) return 'museum';
  if (is(/viewpoint/, /viewpoint|overlook|lookout|vista/i)) return 'viewpoint';
  if (is(/fuel|gas_station/, /\bgas\b|fuel/i)) return 'gas';
  if (is(/natural|:park|nature_reserve|beach|peak|recreation/, /park|trail|boardwalk|forest|lake|canyon|dunes|beach|falls/i)) return 'nature';
  if (is(/shop|mall|marketplace|retail/, /mall|market|outlet|shop/i)) return 'shopping';
  if (is(/attraction|theme_park|zoo|historic|monument|entertainment/, /visitor center|monument|memorial|zoo|castle/i)) return 'attraction';
  return 'place';
}
// Untyped stops are guessed from the name; a bare town with "Lunch" in its note is a meal.
// How long you're at a stop, in minutes, when someone said; a hotel's stay is its nights instead
/** @param {Stop} s */
export const stayOf = s => (kindOf(s) !== 'hotel' && (s.duration ?? 0) > 0 ? s.duration : null);
/** @param {{ kind?: string, name: string, note?: string }} s A stop, or a sight */
export const kindOf = s => (s.kind && KINDS[s.kind] ? s.kind : guessKind(s.name) !== 'place' ? guessKind(s.name) : /\b(breakfast|brunch|lunch|dinner)\b/i.test(s.note || '') ? 'restaurant' : 'place');
export const kindColor = s => `var(--wt-kind-${kindOf(s)})`;
export const kindIcon = (s, size = 16) => DotsieIcons.svg(KINDS[kindOf(s)].icon, size);

// ---------- How you get there: each stop says how you get to it from the place before (a hotel, also the way back each night) ----------
// Drive, walk and bike follow a route, with a time that can run late. Transit and flights are drawn straight, with no
// time: Dotsie can't look up timetables, and the stops' own times already say when you leave and land.
// `noun` finishes the row's sentence ("12 min walk"); `google` and `apple` are the maps apps' directions modes
// (Apple Maps has none for bikes); `speed` (m/s) is the straight-line estimate when a route can't be looked up.
// The modes, in this order, are fields.js's, as for stop types.
const TRAVEL_LOOKS = {
  drive: { label: 'Drive', icon: 'car', noun: 'drive', route: true, google: 'driving', apple: 'd', speed: 22 },
  walk: { label: 'Walk', icon: 'walk', noun: 'walk', route: true, google: 'walking', apple: 'w', speed: 1.3 },
  bike: { label: 'Bike', icon: 'bike', noun: 'bike ride', route: true, google: 'bicycling', apple: '', speed: 4.5 },
  transit: { label: 'Transit', icon: 'train', noun: 'Transit', detail: 'Times are in your maps app', google: 'transit', apple: 'r' },
  flight: { label: 'Flight', icon: 'plane', noun: 'Flight', detail: 'No time or directions' },
};
export const TRAVEL = Object.fromEntries(TRAVEL_MODES.map(k => [k, TRAVEL_LOOKS[k]]));
/** @param {Pick<Stop, 'travel'>} s */
export const travelOf = s => (TRAVEL[s.travel] ? s.travel : 'drive');
// A hotel's way back on the night of `day`: each night's trip back is its own leg, a drive unless someone changed it
/** @param {Pick<Stop, 'back'>} s @param {string} day */
export const backOf = (s, day) => (TRAVEL[s.back?.[day]] ? s.back[day] : 'drive');
// How you get to a place in a day's plan: the way back to a hotel at night is that night's; anywhere else, the stop's own
/** @param {Entry} e */
export const wayTo = e => (e.role === 'night' ? backOf(e.place, e.day ?? '') : travelOf(e.place));
export const travelIcon = (mode, size = 14) => DotsieIcons.svg(TRAVEL[mode].icon, size);

// A hotel you add starts at a 3 PM check-in, and checks out at 11 AM unless you set another time.
export const HOTEL_CHECK_IN = '15:00', HOTEL_CHECK_OUT = '11:00';
/** @param {Pick<Stop, 'checkout'>} s */
export const checkoutOf = s => s.checkout || HOTEL_CHECK_OUT;
