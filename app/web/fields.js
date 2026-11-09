// @ts-check
/* What a trip and its stops are made of, as both sides check it: the server's validation (src/stop.ts) and the app's
   forms and pickers import this one file, so they can't disagree. No DOM: the server and the tests import it too. */

// Stop types. The app gives each an icon and a color (KINDS in plan.js); this is the list, in the order the app shows them.
export const STOP_KINDS = /** @type {const} */ (['place', 'airport', 'hotel', 'restaurant', 'cafe', 'attraction', 'museum', 'viewpoint', 'nature', 'shopping', 'gas']);
// How you get to a stop. Drive, walk and bike follow a route; transit and flights are drawn straight, with no time.
export const TRAVEL_MODES = /** @type {const} */ (['drive', 'walk', 'bike', 'transit', 'flight']);

// Longest names and texts, in characters
export const MAX = { tripName: 120, name: 200, address: 300, note: 2000, url: 2000, label: 60 };
// Up to this many links on a stop
export const MAX_LINKS = 10;
// A hotel's stay, in nights
export const MAX_NIGHTS = 30;
// A stay at one stop, in minutes: up to a day
export const MAX_DURATION = 24 * 60;
// A Wikidata item ("Q123"): a stop added from a sight keeps its item
export const QID = /^Q[1-9]\d{0,11}$/;
