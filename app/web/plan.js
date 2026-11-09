/* A trip as a plan: its stops in order, its days and stays, what each day holds, stop types and how you get there.
   No DOM: the tests import this. */
import { momentOf, toDate, toInput } from './time.js';

// In the order they happen (see Time zones)
export const stopsOf = trip => [...trip.stops].sort((a, b) => momentOf(a) - momentOf(b) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));

// ---------- Days: the trip screen shows one day at a time ----------
export const dayOf = s => s.time.slice(0, 10);
export function addDays(day, n) { const d = toDate(day); d.setDate(d.getDate() + n); return toInput(d).slice(0, 10); }
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
export const samePlace = (a, b) => a.lat === b.lat && a.lng === b.lng;

// Hotels are stays, not just stops: you check in, sleep there, and start the next morning from there.
// A hotel lasts its nights; left unset, it lasts until the next hotel, or the trip's last day.
// 0 nights is a same-day stay: in after midnight, out that morning, or a room for the afternoon.
export function staysOf(trip) {
  const stops = stopsOf(trip), hotels = stops.filter(s => kindOf(s) === 'hotel');
  const lastDay = stops.length ? dayOf(stops.at(-1)) : null;
  return hotels.map((s, i) => {
    const until = hotels[i + 1] ? dayOf(hotels[i + 1]) : lastDay;
    const nights = s.nights != null && s.nights >= 0 ? s.nights : Math.max(1, daysBetween(dayOf(s), until));
    return { s, nights, checkIn: dayOf(s), checkOut: addDays(dayOf(s), nights) };
  });
}
// The stay you sleep at on the night of `day`, if any.
export const stayOnNight = (trip, day) => staysOf(trip).find(st => st.checkIn <= day && day < st.checkOut);
// Trip days: every day with a stop, plus every day of a stay up to check-out.
export function daysOf(trip) {
  const days = new Set(stopsOf(trip).map(dayOf));
  for (const st of staysOf(trip)) for (let d = st.checkIn; d <= st.checkOut; d = addDays(d, 1)) days.add(d);
  return [...days].sort();
}
// The overview: every day of the trip on one page, before the first day. The day bar steps through the pages.
export const ALL = 'all';
export const pagesOf = trip => { const days = daysOf(trip); return days.length ? [ALL, ...days] : []; };
export const dayStops = (trip, day) => stopsOf(trip).filter(s => dayOf(s) === day);

// A day as you'll live it: wake up at last night's hotel, the day's stops, then back to tonight's hotel.
// Each entry is a place with a role. With no hotel the night before, the day starts from the day before's last stop.
export function dayPlan(trip, day) {
  const stops = dayStops(trip, day), plan = [];
  const morning = stayOnNight(trip, addDays(day, -1));
  if (morning) plan.push({ key: `wake:${morning.s.id}:${day}`, place: morning.s, role: morning.checkOut === day ? 'checkout' : 'wake' });
  else {
    const prev = stopsOf(trip).filter(s => dayOf(s) < day).at(-1);
    if (prev && stops.length) plan.push({ key: `from:${prev.id}:${day}`, place: prev, role: 'from' });
  }
  // A same-day stay checks out that day too: `Check out` goes among the day's stops at its time
  const sameDay = staysOf(trip).filter(st => st.nights === 0 && st.checkIn === day)
    .map(st => ({ key: `checkout:${st.s.id}:${day}`, place: st.s, role: 'checkout', at: `${day}T${checkoutOf(st.s)}` }));
  for (const s of stops) {
    while (sameDay.length && sameDay[0].at < s.time && plan.some(e => e.place === sameDay[0].place)) plan.push(sameDay.shift());
    plan.push({ key: s.id, place: s, role: 'stop' });
  }
  plan.push(...sameDay);
  const night = stayOnNight(trip, day);
  if (night && plan.at(-1)?.place !== night.s) plan.push({ key: `night:${night.s.id}:${day}`, place: night.s, role: 'night', day });
  return plan;
}
// A page's places, drives and rows: one day's, or on the overview every day's, in order. Leg and row keys are
// unique across the trip, so the overview's map works like a day's.
export const planOn = (trip, day) => (day === ALL ? daysOf(trip).flatMap(d => dayPlan(trip, d)) : dayPlan(trip, day));

// ---------- Stop types: an icon and a color each (--wt-kind-<key>), shared by the list marker and the map pin ----------
// The colors skip blue (routes) and red (a drive that doesn't fit). Keep the keys in sync with KINDS in src/trip.ts.
export const KINDS = {
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
// The type list, in sections a traveler thinks in: anywhere; staying and getting there; eating; seeing and doing
export const KIND_SECTIONS = [['place'], ['hotel', 'airport', 'gas'], ['restaurant', 'cafe'], ['attraction', 'viewpoint', 'nature', 'museum', 'shopping']];
// Said only where a type changes the form
export const KIND_HINTS = { hotel: 'Check-in and check-out' };
// A first guess from the place's name, and from its category when it came from search
// (OpenStreetMap's "tourism:museum" in local dev, Stadia's "accommodation" or "food" in production).
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
export const stayOf = s => (kindOf(s) !== 'hotel' && s.duration > 0 ? s.duration : null);
export const kindOf = s => (KINDS[s.kind] ? s.kind : guessKind(s.name) !== 'place' ? guessKind(s.name) : /\b(breakfast|brunch|lunch|dinner)\b/i.test(s.note || '') ? 'restaurant' : 'place');
export const kindColor = s => `var(--wt-kind-${kindOf(s)})`;
export const kindIcon = (s, size = 16) => DotsieIcons.svg(KINDS[kindOf(s)].icon, size);

// ---------- How you get there: each stop says how you get to it from the place before (a hotel, also the way back each night) ----------
// Drive, walk and bike follow a route, with a time that can run late. Transit and flights are drawn straight, with no
// time: Dotsie can't look up timetables, and the stops' own times already say when you leave and land.
// `noun` finishes the row's sentence ("12 min walk"); `google` and `apple` are the maps apps' directions modes
// (Apple Maps has none for bikes); `speed` (m/s) is the straight-line estimate when a route can't be looked up.
// Keep the keys in sync with TRAVEL in src/trip.ts.
export const TRAVEL = {
  drive: { label: 'Drive', icon: 'car', noun: 'drive', route: true, google: 'driving', apple: 'd', speed: 22 },
  walk: { label: 'Walk', icon: 'walk', noun: 'walk', route: true, google: 'walking', apple: 'w', speed: 1.3 },
  bike: { label: 'Bike', icon: 'bike', noun: 'bike ride', route: true, google: 'bicycling', apple: '', speed: 4.5 },
  transit: { label: 'Transit', icon: 'train', noun: 'Transit', detail: 'Times are in your maps app', google: 'transit', apple: 'r' },
  flight: { label: 'Flight', icon: 'plane', noun: 'Flight', detail: 'No time or directions' },
};
export const travelOf = s => (TRAVEL[s.travel] ? s.travel : 'drive');
// A hotel's way back on the night of `day`: each night's trip back is its own leg, a drive unless someone changed it
export const backOf = (s, day) => (TRAVEL[s.back?.[day]] ? s.back[day] : 'drive');
// How you get to a place in a day's plan: the way back to a hotel at night is that night's; anywhere else, the stop's own
export const wayTo = e => (e.role === 'night' ? backOf(e.place, e.day) : travelOf(e.place));
export const travelIcon = (mode, size = 14) => DotsieIcons.svg(TRAVEL[mode].icon, size);

// A hotel you add starts at a 3 PM check-in, and checks out at 11 AM unless you set another time.
export const HOTEL_CHECK_IN = '15:00', HOTEL_CHECK_OUT = '11:00';
export const checkoutOf = s => s.checkout || HOTEL_CHECK_OUT;
