/* What kind of place a spot is, and the orders the spots can come in: the Spots page's Type and Sort filters, and the
   server's search, which filters and counts by type in SQL. The Worker imports this file too, as the prototype's
   pretend /api does, so the three agree.

   A spot's type is read from its text: its Wikidata types ("instance of": ["urban park","tourist attraction"], or an
   NPS record's ["NPS park"]) and its name, as one lowercased string with each in quotes (spotText). A type is any of
   its words in that string, unless one of its `not` words is too: "park" at the end of a type or name is nature, but a
   ballpark's stadium isn't. A spot can be of several types (a history museum is both), or of none (shown under All). The
   words are plain substrings, so the server can match them with LIKE and the prototype with includes. */

/** @typedef {{ id: string, label: string, words: string[], not?: string[] }} SpotKind */
/** @type {SpotKind[]} */
export const SPOT_KINDS = [
  { id: 'nature', label: 'Nature & parks',
    words: ['park"', 'national park', 'state park', 'garden', 'forest', 'lake', 'mountain', 'peak', 'volcano', 'beach', 'island',
      'waterfall', 'falls"', 'canyon', 'dune', 'trail', 'nature', 'wilderness', 'river"', 'glacier', 'cave', 'hot spring', 'arboretum',
      'seashore', 'gorge', 'valley', 'meadow', 'reserve', 'wildlife', 'bay"', 'cliff', 'geyser', 'scenic'],
    not: ['amusement park', 'theme park', 'water park', 'ballpark', 'stadium', 'sports venue', 'baseball', 'parking', 'office park',
      'industrial park', 'trailer'] },
  { id: 'museums', label: 'Museums & art',
    words: ['museum', 'gallery', 'artwork', 'public art', 'sculpture', 'mural', 'library', 'exhibition', 'science center', 'planetarium'] },
  { id: 'landmarks', label: 'Landmarks & views',
    words: ['tower', 'needle', 'bridge', 'skyscraper', 'lighthouse', 'monument', 'memorial', 'statue', 'landmark', 'viewpoint',
      'observation', 'overlook', 'lookout', 'fountain', 'capitol', 'church', 'cathedral', 'basilica', 'temple', 'mosque', 'synagogue',
      'chapel', 'castle', 'palace', 'arch"', 'square"', 'plaza'] },
  { id: 'history', label: 'History',
    words: ['historic', 'history', 'heritage', '"fort ', 'fort"', 'battlefield', 'ruins', 'archaeological', 'pueblo', 'mission"',
      'ghost town', 'cemetery', 'old town', 'pioneer', 'shipwreck', 'battleship', 'museum ship', 'presidio', 'homestead', 'mansion'] },
  { id: 'food', label: 'Markets & food',
    words: ['market', 'restaurant', 'food', 'brewery', 'winery', 'vineyard', 'distillery', 'bakery', 'cafe', 'coffee', 'bar"', 'pub"',
      'shopping', 'mall"', 'shop"', 'farm"', 'bazaar'] },
  { id: 'fun', label: 'Fun & shows',
    words: ['zoo', 'aquarium', 'amusement', 'theme park', 'water park', 'roller coaster', 'stadium', 'arena', 'ballpark', 'theater',
      'theatre', 'concert', 'music venue', 'casino', 'sports venue', 'opera', 'circus', 'ferris wheel', 'carousel', 'boardwalk', 'pier"',
      'ski area', 'ski resort', 'golf', 'racetrack', 'speedway'] },
];
// Only letters, spaces and quotes: the server puts them in its SQL as they are (D1 binds at most 100 values a query)
for (const k of SPOT_KINDS) for (const w of [...k.words, ...(k.not ?? [])]) if (!/^[a-z "]+$/.test(w)) throw new Error(`Spot type word ${w}`);

/** @param {string} id */
export const spotKind = id => SPOT_KINDS.find(k => k.id === id);
/**
 * A spot's text to look for its types in: its types (as the JSON array they're stored as) and its name, in quotes
 * @param {string | null | undefined} types @param {string} name
 */
export const spotText = (types, name) => `${types ?? ''} "${name}"`.toLowerCase();
/** @param {SpotKind} kind @param {string} text spotText's */
export const isKind = (kind, text) => kind.words.some(w => text.includes(w)) && !(kind.not ?? []).some(w => text.includes(w));
/**
 * The same as isKind, in SQL, for `text`, an SQL expression that is spotText's string
 * @param {SpotKind} kind @param {string} text
 */
export const kindSQL = (kind, text) => `((${kind.words.map(w => `${text} like '%${w}%'`).join(' or ')})${
  (kind.not ?? []).map(w => ` and ${text} not like '%${w}%'`).join('')})`;

// The orders, as the address and the API name them. With none given: the guide's own order in a city, else most viewed.
// Nearest needs where you are (near=lat,lng); without it, the search keeps to the usual order.
export const SPOT_SORTS = { views: 'Most viewed', near: 'Nearest', name: 'A to Z' };
/** @param {string} lat @param {string} lng */
const inRange = (lat, lng) => Math.abs(+lat) <= 90 && Math.abs(+lng) <= 180;
/** "47.61,-122.33" as numbers, or null when it isn't a place @param {string | null | undefined} near */
export function nearOf(near) {
  const m = /^(-?\d{1,2}(?:\.\d{1,6})?),(-?\d{1,3}(?:\.\d{1,6})?)$/.exec(near ?? '');
  return m && inRange(m[1], m[2]) ? { lat: +m[1], lng: +m[2] } : null;
}
/**
 * How far from a to b, in km, along the ground
 * @param {{ lat: number, lng: number }} a @param {{ lat: number, lng: number }} b
 */
export function kmBetween(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}
