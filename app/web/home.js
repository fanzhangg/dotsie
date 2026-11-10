/* Home: a card for each trip, with its dates, people, a sketch of its route and a photo. */
import { $app, ICON, appBarHTML, avatarHTML, esc } from './core.js';
import { DAYS, fmtRange, fmtTime, instantOf, nowIn, nowStamp, toDate, zoneOf } from './time.js';
import { canSignIn, me } from './signin.js';
import { trips } from './trips.js';
import { addDays, dayOf, dayPlan, daysBetween, daysOf, kindColor, samePlace, stopsOf, wayTo } from './plan.js';
import { legKey, routes } from './routes.js';
import { offlineNow } from './offline.js';
import { markerHTML } from './map.js';
import { abouts, loadAbout, photoCredit } from './sights.js';

// A photo that won't load (expired, offline, blocked) drops away to reveal the initial. Error events
// don't bubble, so this listens while they travel down.
document.addEventListener('error', e => {
  if (e.target.classList?.contains('wt-avatar__img')) e.target.remove();
  else if (e.target.classList?.contains('wt-trip-card__photo')) cardPhotoFailed(e.target);
}, true);

// ---------- Home ----------
// New trip floats at the bottom of the screen, as a spot's Save to a trip and the trip screen's add bar do, so it's in
// reach however far down the trips you are. One card per trip: photos of where it goes, or a sketch of its route, then its name and dates, and who's on it. The
// trips go under Current (under way today), Upcoming, Wishlist (places saved to it, and no stops yet) and Past, in that
// order. Wishlist and Past have small cards, two to a row on a phone: they're for looking back and dreaming, not for
// what's next.
export function homeHTML() {
  const today = nowStamp().slice(0, 10), list = trips || [];
  const over = t => !!t.end && t.end.slice(0, 10) < today;
  const on = t => !!t.start && t.start.slice(0, 10) <= today && !over(t);
  const wish = t => !t.stops?.length && !!t.ideas?.length; // no stops means no dates, so never under way or over
  // Under way and coming up: soonest first, and trips with no dates yet last. What's over: the latest first. The
  // wishlist: the newest first, as the server lists trips.
  const soonest = (a, b) => (a.start ? 0 : 1) - (b.start ? 0 : 1) || (a.start || '').localeCompare(b.start || '');
  const current = list.filter(on).sort(soonest);
  const ahead = list.filter(t => !on(t) && !over(t) && !wish(t)).sort(soonest);
  const wishlist = list.filter(wish);
  const past = list.filter(over).sort((a, b) => b.end.localeCompare(a.end));
  const group = (title, ts, { done = false, small = false } = {}) => `<section class="home-group"><h2 class="home-group__title">${title}</h2>
    <div class="home-grid${small ? ' home-grid--small' : ''}">${ts.map(t => tripCardHTML(t, done, today, small)).join('')}</div></section>`;
  return `
    ${appBarHTML('plan', `<button class="wt-icon-btn" data-action="account" aria-label="Account">${avatarHTML({ name: me.name, image: me.image, identity: 1 })}</button>`)}
    <main class="home">
    ${trips && !list.length ? '<p class="wt-empty">No trips yet. Start one with New trip, or open the link a friend sent you.</p>' : ''}
      ${current.length ? group('Current', current) : ''}
      ${ahead.length ? group('Upcoming', ahead) : ''}
      ${wishlist.length ? group('Wishlist', wishlist, { small: true }) : ''}
      ${past.length ? group('Past', past, { done: true, small: true }) : ''}
      ${me.isGuest && trips?.length && canSignIn() ? '<button class="wt-btn wt-btn--secondary wt-btn--block home-guest" data-action="account">Sign in to keep your trips</button>' : ''}
    </main>
    <div class="wt-float-bar wt-float-bar--hug home-new"><button class="wt-btn wt-btn--primary wt-btn--block" data-action="new-trip">${ICON.plus}New trip</button></div>`;
}
const HOME_AVATARS = 4; // past this, the rest are a "+N"
// When a trip is, next to its dates: how soon, or which day of it today is (in primary ink, like the row happening now)
function tripWhen(t, today) {
  if (!t.start) return null;
  const start = t.start.slice(0, 10), end = (t.end || t.start).slice(0, 10);
  if (end < today) return null;
  if (start <= today) return { now: true, text: `Day ${daysBetween(start, today) + 1} of ${daysBetween(start, end) + 1}` };
  const d = daysBetween(today, start);
  return { text: d === 1 ? 'Tomorrow' : d < 14 ? `In ${d} days` : d < 60 ? `In ${Math.round(d / 7)} weeks` : `In ${Math.round(d / 30.4)} months` };
}
// A trip's dates, always with the year: "Nov 5 – 8, 2026"; one over New Year says both
export function tripDates(t) {
  if (!t.start) return 'No dates yet';
  const end = t.end || t.start, y1 = t.start.slice(0, 4), y2 = end.slice(0, 4);
  return y1 !== y2 ? `${fmtRange(t.start, t.start)}, ${y1} – ${fmtRange(end, end)}, ${y2}` : `${fmtRange(t.start, end)}, ${y1}`;
}
// While a trip is under way, what it's at now and what's next, as the trip screen has today: the row happening now
// (where you woke up, a stop, or tonight's hotel) and the one after it, or once the day is done, the next day's first
// stop. Next says when it is ("2:00 PM", "Tomorrow, 9:30 AM"), or "Tonight" for tonight's hotel, which has no time.
function tripNow(t, today) {
  const trip = { stops: (t.stops || []).filter(s => s.time) };
  const rows = dayPlan(trip, today).map(e => ({
    s: e.place, start: e.role === 'stop' ? e.place.time : e.role === 'night' ? `${today}T23:59` : e.at || `${today}T00:00`,
    time: e.role === 'stop' ? e.place.time : e.at,
  }));
  const i = rows.findLastIndex(r => instantOf(r.start, zoneOf(r.s)) <= nowIn(zoneOf(r.s)));
  const later = stopsOf(trip).find(s => dayOf(s) > today);
  const now = rows[i], next = rows[i + 1] || (later && { s: later, time: later.time });
  if (!now && !next) return null;
  const at = time => { const d = time.slice(0, 10); return `${d === today ? '' : d === addDays(today, 1) ? 'Tomorrow, ' : `${DAYS[toDate(d).getDay()]}, `}${fmtTime(time)}`; };
  return { now: now?.s, next: next?.s, nextAt: next && (next.time ? at(next.time) : 'Tonight') };
}
function tripNowHTML(t, today) {
  const p = tripNow(t, today);
  if (!p) return '';
  // Like a row of the timeline: marker · place · when, with "Now" where the time goes
  const step = (s, when, now) => `<span class="wt-trip-card__step${now ? ' is-now' : ''}">${markerHTML(s, 'wt-marker--sm')}
      <span class="wt-trip-card__step-name">${esc(s.name)}</span><span class="wt-trip-card__step-time">${when}</span></span>`;
  return `<span class="wt-trip-card__now">${p.now ? step(p.now, 'Now', true) : ''}${p.next ? step(p.next, p.nextAt) : ''}</span>`;
}
// Keep Now and Next current while Home is open: each card under way gets them again, in place, so nothing else moves
setInterval(() => {
  if ($app.dataset.page !== 'home') return;
  const today = nowStamp().slice(0, 10);
  for (const el of $app.querySelectorAll('.wt-trip-card__now')) {
    const t = trips?.find(t => t.id === el.closest('[data-trip]').dataset.trip), html = t && tripNowHTML(t, today);
    if (html) el.outerHTML = html; else el.remove();
  }
}, 60000);
// A small card (Wishlist and Past) has one photo, a squarer picture and no avatars (the names are still said). A trip on
// the wishlist has no dates, so it says how many places are saved to it instead.
function tripCardHTML(t, past, today, small = false) {
  const people = t.members || [], shown = people.slice(0, people.length > HOME_AVATARS ? HOME_AVATARS - 1 : HOME_AVATARS);
  const more = people.length - shown.length, when = tripWhen(t, today), saved = t.ideas?.length || 0;
  const dates = !t.stops?.length && saved ? `${saved} saved place${saved === 1 ? '' : 's'}` : tripDates(t);
  return `<a class="wt-trip-card${small ? ' wt-trip-card--small' : ''}${past ? ' is-past' : ''}${when?.now ? ' is-now' : ''}" href="#/trip/${esc(t.id)}" data-trip="${esc(t.id)}">
    ${tripPictureHTML(t, past, small)}
    <span class="wt-trip-card__body">
      <span class="wt-trip-card__text"><span class="wt-trip-card__name">${esc(t.name)}</span>
        <span class="wt-trip-card__dates">${dates}${when ? ` · <span class="wt-trip-card__when">${when.text}</span>` : ''}</span></span>
      ${people.length ? `<span class="wt-avatar-stack wt-trip-card__people" aria-hidden="true">${shown.map(avatarHTML).join('')}${more ? `<span class="wt-avatar wt-avatar--more">+${more}</span>` : ''}</span>
      <span class="wt-visually-hidden">, with ${esc(people.map(m => m.name).join(', '))}</span>` : ''}
    </span>
    ${when?.now ? tripNowHTML(t, today) : ''}</a>`;
}
// The top of a trip's card: photos of its places when they have them, so you can tell at a glance where it goes, else
// the sketch of its route. The photos are those of its first places, in the plan's order, then its Want to go places, in
// the order they were saved, whose English Wikipedia article has a free photo: what /api/about says, as a stop's sheet
// shows. So a trip of saved places only, with no stops yet, shows where it'd go too. A place added from a sight on the map (or
// at one) is asked for by its Wikidata item; any other by its name and where it is. Airports, hotels and places to eat
// are left out: their photos don't say where a trip goes. The sketch shows until they're in, and offline, as
// Wikimedia's photos aren't saved for offline.
const CARD_PHOTOS = 3, CARD_PHOTO_TRIES = 6; // photos on a card, at most; places asked for one, at most, per trip
const NO_CARD_PHOTO = new Set(['airport', 'hotel', 'restaurant', 'cafe', 'gas']);
const badPhotos = new Set(); // photos that wouldn't load: the next place's stands in
const photoItems = t => [...new Set([...(t.stops || []), ...(t.ideas || [])].filter(s => !NO_CARD_PHOTO.has(s.kind) && s.name)
  .map(s => s.wikidata || `${s.name}@${(+s.lat).toFixed(4)},${(+s.lng).toFixed(4)}`))].slice(0, CARD_PHOTO_TRIES);
// The card's photos, from what's known already; undefined while one it would show hasn't been asked for or answered
function cardPhotos(t) {
  const shots = [];
  for (const q of photoItems(t)) {
    const a = abouts.get(q);
    if (a === undefined || a instanceof Promise) return undefined;
    // Two places can have one article (a park and its visitor center): its photo shows once
    if (a?.image && !badPhotos.has(a.image.src) && !shots.some(i => i.src === a.image.src) && shots.push(a.image) === CARD_PHOTOS) break;
  }
  return shots;
}
function tripPictureHTML(t, past, small) {
  let shots = offlineNow() ? null : cardPhotos(t);
  if (!shots?.length) return tripMapHTML(t, past, small);
  if (small) shots = shots.slice(0, 1);
  // Commons makes thumbnails in set widths; a narrow photo needs a smaller one than a card-wide one. If that one fails, the 960px.
  const w = shots.length > 1 || small ? 500 : 960;
  return `<span class="wt-trip-card__photos" aria-hidden="true">${shots.map(img => `<img class="wt-trip-card__photo" src="${esc(img.src.replace(/\/960px-([^/]+)$/, `/${w}px-$1`))}" data-full="${esc(img.src)}" alt="" title="${esc(photoCredit(img))}" decoding="async">`).join('')}</span>`;
}
// Asks for each card's photos, a card's worth at a time, until there are enough or no more places to ask about, and
// puts them on the card when they're in. Each place's answer is kept a day (by the browser and the server), so a
// visit to Home asks again only about new ones.
const photosAsking = new Set(); // trips whose photos are being asked for
export function loadCardPhotos() {
  if (offlineNow()) return;
  for (const t of trips || []) {
    if (photosAsking.has(t.id) || cardPhotos(t) !== undefined) continue;
    photosAsking.add(t.id);
    (async () => {
      const items = photoItems(t);
      for (let i = 0; i < items.length && cardPhotos(t) === undefined; i += CARD_PHOTOS) await Promise.all(items.slice(i, i + CARD_PHOTOS).map(loadAbout));
      photosAsking.delete(t.id);
      if (cardPhotos(t)?.length) showCardPicture(t.id);
    })();
  }
}
function showCardPicture(id) {
  const t = trips?.find(x => x.id === id), card = [...$app.querySelectorAll('.wt-trip-card')].find(c => c.dataset.trip === id);
  if (t && card) card.firstElementChild.outerHTML = tripPictureHTML(t, card.classList.contains('is-past'), card.classList.contains('wt-trip-card--small'));
}
// A photo that won't load: its 960px thumbnail, then, if that fails too, the next place's photo, or the sketch
function cardPhotoFailed(img) {
  const full = img.dataset.full;
  if (img.getAttribute('src') !== full) { img.setAttribute('src', full); return; }
  badPhotos.add(full);
  const card = img.closest('.wt-trip-card');
  if (card) showCardPicture(card.dataset.trip);
}

// A trip's route for its card: a sketch of its drives and places, drawn here, so a card costs nothing from the Stadia
// plan (a map picture from Stadia cost 2,000 credits each time a trip changed). Like the overview's map, it shows each
// day's drives, along the roads where they've been looked up already (Home never looks routes up, so as not to use up
// the limit), straight otherwise, as transit and flights always are, and a dot for each place in its type's color,
// with north up. A trip with no stops yet, only Want to go places, has those dots and no drives.
// The sketch's own units, the shape of its box: 5:2, or 3:2 on a small card; degrees
const SKETCH = { w: 320, h: 128 }, SKETCH_SMALL = { w: 240, h: 160 }, SKETCH_PAD = 16, SKETCH_MIN_SPAN = 0.01;
const mercY = lat => -Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI; // down the page
function tripMapHTML(t, past, small) {
  const stops = t.stops || [], ideas = (t.ideas || []).filter(i => i.lat != null), box = small ? SKETCH_SMALL : SKETCH;
  if (!stops.length && ideas.length) return `<span class="wt-trip-card__map" aria-hidden="true">${routeSketchSVG([], ideas, past, box)}</span>`;
  if (!stops.length) return '<span class="wt-trip-card__map wt-trip-card__map--empty">No stops yet</span>';
  const trip = { stops }, legs = [];
  for (const d of daysOf(trip)) {
    const plan = dayPlan(trip, d);
    for (let i = 1; i < plan.length; i++) if (!samePlace(plan[i - 1].place, plan[i].place)) legs.push([plan[i - 1].place, plan[i].place, wayTo(plan[i])]);
  }
  const places = stops.filter((s, i) => stops.findIndex(o => samePlace(o, s)) === i);
  return `<span class="wt-trip-card__map" aria-hidden="true">${routeSketchSVG(legs, places, past, box)}</span>`;
}
function routeSketchSVG(legs, places, past, { w: SKETCH_W, h: SKETCH_H }) {
  const lines = legs.map(([a, b, way]) => { const r = routes[legKey(a, b, way)]; return r?.ok && r.coords.length > 1 ? { road: true, coords: r.coords } : { road: false, coords: [[a.lat, a.lng], [b.lat, b.lng]] }; });
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [lat, lng] of [...places.map(s => [s.lat, s.lng]), ...lines.flatMap(l => l.coords)]) {
    const y = mercY(lat);
    x0 = Math.min(x0, lng); x1 = Math.max(x1, lng); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const k = Math.min((SKETCH_W - 2 * SKETCH_PAD) / Math.max(x1 - x0, SKETCH_MIN_SPAN), (SKETCH_H - 2 * SKETCH_PAD) / Math.max(y1 - y0, SKETCH_MIN_SPAN));
  const at = (lat, lng) => [SKETCH_W / 2 + (lng - (x0 + x1) / 2) * k, SKETCH_H / 2 + (mercY(lat) - (y0 + y1) / 2) * k];
  const xy = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  // A road's points closer together than a unit or so don't show at this size
  const pathOf = ls => ls.map(({ coords: l }) => {
    const pts = [at(...l[0])];
    for (let i = 1; i < l.length; i++) {
      const p = at(...l[i]), q = pts.at(-1);
      if (i === l.length - 1 || Math.hypot(p[0] - q[0], p[1] - q[1]) >= 1.5) pts.push(p);
    }
    return `M${pts.map(xy).join('L')}`;
  }).join('');
  const roads = pathOf(lines.filter(l => l.road)), guesses = pathOf(lines.filter(l => !l.road));
  const dots = places.map(s => `M${xy(at(s.lat, s.lng))}h0`); // a dot is a path of no length, drawn by its round cap
  const line = (d, cls) => (d ? `<path class="wt-trip-card__casing${cls}" d="${d}"/><path class="wt-trip-card__route${cls}" d="${d}"/>` : '');
  return `<svg viewBox="0 0 ${SKETCH_W} ${SKETCH_H}" preserveAspectRatio="xMidYMid meet">
    ${line(roads, '')}${line(guesses, ' is-estimate')}
    <path class="wt-trip-card__ring" d="${dots.join('')}"/>
    ${places.map((s, i) => `<path class="wt-trip-card__stop" style="--wt-kind-color: ${past ? 'var(--wt-kind-past)' : kindColor(s)}" d="${dots[i]}"/>`).join('')}
  </svg>`;
}
