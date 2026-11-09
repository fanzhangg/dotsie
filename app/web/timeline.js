/* The day's list (rail · stop · time), the day bar, and which row has the focus. */
import { $app, ICON, WIDE, esc, state, token } from './core.js';
import { DAYS, fmtDay, fmtDur, instantOf, nowIn, nowStamp, toDate, zoneOf } from './time.js';
import { cur } from './trips.js';
import { ALL, TRAVEL, addDays, checkoutOf, dayOf, dayPlan, daysOf, kindColor, kindOf, pagesOf, samePlace, stayOf, staysOf, travelIcon } from './plan.js';
import { dayLegs, directionsURL, legsOn, placeURL } from './routes.js';
import { offlineNow } from './offline.js';
import { render, scheduleRender } from './app.js';
import { camFree, dayFramed, drawMap, lateMin, map, markerHTML, refit, setDayShown, timeHTML, updateFitBtn, zoneShown } from './map.js';
import { drag, headBottom, holdScroll, listContentHeight, listTop, motion, moveSheet, setBottom, setListTop, setSheetHeight, stopMotion } from './sheet.js';
import { modalHead, openSheet } from './sheets.js';

// Today, when it's one of the trip's days, with what's happening now highlighted; else the overview.
// If the day's stops are gone (deleted, moved), the next day that has some.
export function currentDay(trip) {
  const days = daysOf(trip);
  if (!days.length) return null;
  const today = nowStamp().slice(0, 10);
  if (!state.day) state.day = days.includes(today) ? today : ALL;
  if (state.day !== ALL && !days.includes(state.day)) state.day = days.find(d => d > state.day) || days.at(-1);
  return state.day;
}
export const itemsOn = (trip, day) => (day === ALL ? daysOf(trip).flatMap(d => dayItems(trip, d)) : dayItems(trip, day));

// ---------- Timeline: rail · stop · time. Each stop's marker is its pin on the map: same icon, same color. ----------
// A drive reads as a sentence ("1 hr 49 min drive"), with a small car on the rail, and says when it won't make it.
// Another way of getting there says so instead: "12 min walk", with someone walking on the rail; transit and flights
// have no time, so they're just "Transit" and "Flight".
// Tapping the row shows the route on the map, and the bar below the list offers Directions in the maps app.
// Rows take `row`: { key, past (over: dimmed), now (happening now: highlighted), sel (the selected row) }.
const rowState = (past, now) => `${past ? ' is-past' : ''}${now ? ' is-now' : ''}`;
function driveItem(day, leg) {
  const { r, to, fromEntry, toEntry, mode } = leg, T = TRAVEL[mode], late = lateMin(leg);
  const time = T.route ? (r ? fmtDur(r.duration) : '…') : '';
  const cls = ['wt-tl-drive', state.leg === leg.key ? 'is-active' : '', late > 0 ? 'is-late' : ''];
  return {
    // when you set off (until the route is in, no earlier than you arrive); the drive back to the hotel has no time, so it comes last
    start: leg.leave || leg.arrive || (toEntry.role === 'night' ? `${day}T23:58` : fromEntry.place.time),
    tz: zoneOf(leg.leave || leg.arrive ? to : fromEntry.place),
    html: ({ past, now }) => `<div class="${cls.join(' ')}${rowState(past, now)}" data-leg="${esc(leg.key)}" data-action="leg" tabindex="0" role="button" aria-pressed="${state.leg === leg.key}" aria-label="${time ? `${time} ${T.noun}` : T.noun} to ${esc(to.name)}. Show the route on the map">
      <span class="wt-tl-rail"><i class="wt-tl-car">${travelIcon(mode)}</i></span>
      <span class="wt-tl-drive__body">
        <span class="wt-tl-drive__what">${time ? `<b>${time}</b> ${T.noun}` : `<b>${T.noun}</b>`}</span>
        ${late > 0 ? `<span class="wt-tl-drive__late">Arrives ${fmtDur(late * 60)} late</span>` : ''}
      </span>
    </div>`,
  };
}
// Links in a note can be tapped. Each shows only its site (booking.com), so a long link doesn't fill the row;
// punctuation right after one ("see https://…).") stays text.
const LINK_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
export const siteOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
function noteHTML(text) {
  let html = '', at = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const url = m[0].replace(/[.,;:!?)\]}，。；：！？）】」』]+$/, '');
    const site = siteOf(url);
    if (!site) continue;
    html += `${esc(text.slice(at, m.index))}<a href="${esc(url)}" target="_blank" rel="noopener">${esc(site)}</a>`;
    at = m.index + url.length;
  }
  return html + esc(text.slice(at));
}
// A stop's links (a booking, a flight, tickets, a page about the place): a button each, named by its label or else its
// site, that opens the page without selecting the stop. On a phone only the selected stop shows them, so the half list
// still fits three stops; the others show a link icon at the start of their notes' line.
const linkLabel = l => l.label || siteOf(l.url);
// What someone typed or pasted as a link, as a web address: "booking.com/…" gets https://. '' if it isn't one.
export function webUrl(text) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`);
    return u.hostname.includes('.') ? u.href : '';
  } catch { return ''; }
}
const LINKS_HINT = `<span class="wt-tl-links-hint" aria-hidden="true">${ICON.link}</span>`;
const linksHTML = links => `<span class="wt-tl-links">${links.map(l => `<a class="wt-tl-link" href="${esc(l.url)}" target="_blank" rel="noopener" title="${esc(l.url)}"><span class="wt-tl-link__label">${esc(linkLabel(l))}</span>${ICON.external}</a>`).join('')}</span>`;
// A stop row: marker · name · time, with its notes below across the name and time, and its links under them. A hotel on its check-in day says how many nights.
// A row from another day than the one on screen can say which day in place of the time.
// Tapping it selects it: the row and its pin are highlighted, and Add stop becomes Open in Maps and Edit stop. Tapping it again keeps it selected.
// It's a div acting as a button, like a drive, since a link in its note can't sit inside a <button>.
function stopRow(s, { key, past, now, sel }, note, time, timeDay, links = [], zone = '') {
  const notes = note.filter(Boolean), marker = markerHTML(s, 'wt-tl-marker'), linked = links.length > 0;
  return `<div class="wt-tl-stop${sel ? ' is-selected' : ''}${rowState(past, now)}" data-action="select" data-id="${esc(s.id)}" data-row="${esc(key)}"${key === s.id ? ' data-stop' : ''} tabindex="0" role="button" aria-pressed="${!!sel}" style="--wt-kind-color: ${kindColor(s)}">
      <span class="wt-tl-rail">${marker}</span>
      <span class="wt-tl-name">${esc(s.name)}</span>${notes.length || linked ? `<span class="wt-tl-notes">${linked ? LINKS_HINT : ''}${notes.map(n => `<span class="wt-tl-note">${noteHTML(n)}</span>`).join('')}</span>` : ''}${linked ? linksHTML(links) : ''}
      <span class="wt-tl-time">${time ? timeHTML(time) : ''}${zone ? `<span class="wt-tl-zone">${esc(zone)}</span>` : ''}${timeDay ? `<span class="wt-tl-time__day">${esc(timeDay)}</span>` : ''}</span>
    </div>`;
}
// `note` false leaves out the stop's own note and links (the overview), keeping a hotel's nights.
function stopItem(trip, s, { note = true } = {}) {
  const stay = kindOf(s) === 'hotel' && staysOf(trip).find(st => st.s === s);
  const nights = stay && stay.nights > 0 && `${stay.nights} ${stay.nights === 1 ? 'night' : 'nights'}`;
  const long = stayOf(s) && fmtDur(stayOf(s) * 60);
  return { start: s.time, tz: zoneOf(s), html: row => stopRow(s, row, [nights || long, note && s.note], s.time, null, note ? s.links : [], zoneShown(trip, s)) };
}
// The hotel at either end of a day: where you wake up, and where you go back to at night. It has no time,
// except on check-out morning, the one with something to do: `Check out`, at the check-out time. Tapping it selects the hotel.
function hotelItem(day, entry) {
  return {
    start: entry.role === 'night' ? `${day}T23:59` : entry.at || `${day}T00:00`,
    tz: zoneOf(entry.place),
    html: row => stopRow(entry.place, row, [entry.role === 'checkout' && 'Check out'], entry.role === 'checkout' ? `${day}T${checkoutOf(entry.place)}` : null),
  };
}
// With no hotel last night, the day opens where the day before ended: that stop, with `Yesterday` where the time goes
// (or the weekday, when there's a day with no stops in between).
function fromItem(day, entry) {
  const d = dayOf(entry.place), when = d === addDays(day, -1) ? 'Yesterday' : DAYS[toDate(d).getDay()];
  return { start: `${day}T00:00`, tz: zoneOf(entry.place), html: row => stopRow(entry.place, row, [], null, when) };
}
// The selected stop, if it's still in the trip (a co-editor may have deleted it).
export const selectedStop = trip => (state.sel && trip.stops.find(s => s.id === state.sel)) || null;
// Below the list, always in reach: Add stop; with a stop selected, Open in Maps (the place in the maps app, to see what it is)
// and a round Edit stop; with a drive's route shown, Directions to the drive's end in the maps app, the way you're going,
// and a round button with that way's icon to change it (a flight has no directions: Open in Maps shows where it lands).
// Either way a small + at the end keeps adding one tap away. Each button has a `data-key`, the same in every set, so a change of set can morph (morphRow).
// Offline, adding and editing are greyed out (aria-disabled), and a tap says why (see needsConnection).
function addBarHTML(trip) {
  const s = selectedStop(trip), off = offlineNow() ? ' aria-disabled="true"' : '';
  const leg = !s && state.leg && legsOn(trip, currentDay(trip)).find(l => l.key === state.leg);
  const plus = `<button class="wt-btn wt-btn--secondary wt-btn--icon" data-key="add" data-action="add"${off} aria-label="Add stop" title="Add stop">${ICON.plus}</button>`;
  if (leg) {
    const travel = `<button class="wt-btn wt-btn--secondary wt-btn--icon" data-key="edit" data-action="travel" data-leg="${esc(leg.key)}"${off} aria-label="${TRAVEL[leg.mode].label}. Change how you get there" title="Change how you get there">${travelIcon(leg.mode, 20)}</button>`;
    return `${leg.mode === 'flight'
      ? `<a class="wt-btn wt-btn--primary wt-btn--block" data-key="main" href="${esc(placeURL(leg.to))}" target="_blank" rel="noopener" aria-label="Open ${esc(leg.to.name)} in your maps app">${ICON.map}Open in Maps</a>`
      : `<a class="wt-btn wt-btn--primary wt-btn--block" data-key="main" href="${directionsURL(leg.from, leg.to, leg.mode)}" target="_blank" rel="noopener" aria-label="Directions to ${esc(leg.to.name)} in your maps app">${ICON.directions}Directions</a>`}${travel}${plus}`;
  }
  return s
    ? `<a class="wt-btn wt-btn--primary wt-btn--block" data-key="main" href="${esc(placeURL(s))}" target="_blank" rel="noopener" aria-label="Open ${esc(s.name)} in your maps app">${ICON.map}Open in Maps</a><button class="wt-btn wt-btn--secondary wt-btn--icon" data-key="edit" data-action="edit" data-id="${esc(s.id)}"${off} aria-label="Edit stop" title="Edit stop">${ICON.edit}</button>${plus}`
    : `<button class="wt-btn wt-btn--primary wt-btn--block" data-key="add" data-action="add"${off}>${ICON.plus}Add stop</button>`;
}
export function renderAddBar(trip) {
  const bar = $app.querySelector('.wt-add-bar'), html = addBarHTML(trip);
  // only when it changes, so a focused button keeps its focus through the minute's re-render
  if (bar.wtHTML === html) return;
  const before = bar.wtHTML !== undefined && [...bar.querySelectorAll(':scope > [data-key]')].map(el => ({ key: el.dataset.key, el, r: el.getBoundingClientRect() }));
  bar.innerHTML = html; bar.wtHTML = html;
  if (before) morphRow(bar, before);
}
// A row of buttons changing to another set morphs into it, on --wt-duration-base (see "Motion" in the design system's README).
// `before` is the old buttons and where they were. A button in both sets (the same data-key) moves and stretches from where it
// was to where it goes, its old look fading out over it in the first 60%: full-width Add stop shrinks into the + at the row's end, and back.
// A new button fades in, a wide one growing from its left edge, a round one from smaller; one that's gone fades out where it
// was, under the rest. While it runs the row is .is-morphing: its buttons are placed absolutely, here, and it keeps its height.
function morphRow(row, before) {
  const ms = parseFloat(token('--wt-duration-base')) || 0, id = row.wtMorph = {};
  row.classList.remove('is-morphing'); row.style.height = '';
  row.querySelectorAll(':scope > *').forEach(el => el.removeAttribute('style'));
  const box = row.getBoundingClientRect();
  const after = [...row.querySelectorAll(':scope > [data-key]')].map(el => ({ key: el.dataset.key, el, r: el.getBoundingClientRect() }));
  const was = new Map(before.map(b => [b.key, b])), keys = new Set(after.map(a => a.key));
  const still = after.length === before.length && after.every(a => was.get(a.key)?.r.left === a.r.left && was.get(a.key).r.width === a.r.width);
  if (!ms || still || !box.width || before.some(b => !b.r.width)) return;
  const x = r => `${r.left - box.left}px`, place = (el, r) => Object.assign(el.style, { left: x(r), top: `${r.top - box.top}px`, width: `${r.width}px` });
  const ghost = b => {
    const g = b.el.cloneNode(true);
    g.removeAttribute('style'); g.removeAttribute('data-key'); g.removeAttribute('data-action');
    g.classList.add('is-ghost'); g.inert = true; g.setAttribute('aria-hidden', 'true'); g.tabIndex = -1;
    place(g, b.r);
    return g;
  };
  const opts = { duration: ms, easing: token('--wt-ease-out') || 'ease-out' }, runs = [];
  const gone = { ...opts, fill: 'forwards' }; // a ghost stays faded out until it's removed
  row.style.height = `${box.height}px`; row.classList.add('is-morphing');
  for (const a of after) place(a.el, a.r);
  for (const b of before) if (!keys.has(b.key)) { const g = ghost(b); row.prepend(g); runs.push(g.animate({ opacity: [1, 0] }, gone)); }
  for (const a of after) {
    const b = was.get(a.key), to = { left: x(a.r), width: `${a.r.width}px` };
    if (b) {
      const from = { left: x(b.r), width: `${b.r.width}px` };
      runs.push(a.el.animate([from, to], opts));
      if (b.el.className !== a.el.className || b.el.innerHTML !== a.el.innerHTML) {
        const g = ghost(b); a.el.after(g);
        runs.push(g.animate([{ ...from, opacity: 1 }, { opacity: 0, offset: 0.6 }, { ...to, opacity: 0 }], gone));
      }
    } else if (a.el.matches('.wt-btn--icon')) runs.push(a.el.animate({ opacity: [0, 1], transform: ['scale(.6)', 'none'] }, opts));
    else runs.push(a.el.animate({ opacity: [0, 1], width: [`${Math.min(a.r.height, a.r.width)}px`, to.width] }, opts));
  }
  Promise.all(runs.map(r => r.finished)).then(() => {
    if (row.wtMorph !== id) return;
    row.querySelectorAll(':scope > .is-ghost').forEach(g => g.remove());
    row.querySelectorAll(':scope > *').forEach(el => el.removeAttribute('style'));
    row.classList.remove('is-morphing'); row.style.height = '';
  }, () => {});
}
// One day's rows, from the day's plan, each marked `past` or `now`. On today, the row you're in now
// (the latest thing that has started) is now, and everything before it is past; earlier days are past throughout.
// The map dims the same drives and stops.
// `note` false leaves out the stops' own notes, as on the overview.
function dayItems(trip, day, { note = true } = {}) {
  const today = nowStamp().slice(0, 10);
  const legs = new Map(dayLegs(trip, day).map(l => [l.key, l]));
  const items = [];
  const plan = dayPlan(trip, day);
  plan.forEach((e, i) => {
    const leg = legs.get(e.key);
    if (leg && !(leg.r && leg.r.distance === 0)) items.push({ leg: leg.key, ...driveItem(day, leg) });
    if (e.role === 'stop') items.push({ entry: e, ...stopItem(trip, e.place, { note }) });
    // where you start, unless the day's first stop is the same place
    else if (e.role === 'from') { if (!samePlace(e.place, plan[i + 1].place)) items.push({ entry: e, ...fromItem(day, e) }); }
    else items.push({ entry: e, ...hotelItem(day, e) });
  });
  const cur = day === today ? items.findLastIndex(it => instantOf(it.start, it.tz) <= nowIn(it.tz)) : -1;
  items.forEach((it, i) => { it.past = day < today || i < cur; it.now = i === cur; });
  return items;
}
// The overview: every day under its name, with its stops and their times, and the drives between them, as on a day,
// so the whole trip reads at a glance. Notes are left to the day's own page, and so are the hotel you wake up at and
// go back to, with the drives to and from it (the map still shows every drive). A day with no stops of its own,
// in the middle of a stay, shows the hotel you wake up at. Tapping a day's name opens the day; tapping a stop
// selects it, and tapping a drive shows its route, as on a day. Past and now are worked out as on a day, among the rows shown.
export function overviewItems(trip) {
  const today = nowStamp().slice(0, 10), items = [];
  for (const d of daysOf(trip)) {
    const all = dayItems(trip, d, { note: false }), legs = new Map(dayLegs(trip, d).map(l => [l.key, l]));
    let rows = all.filter(it => it.entry && (it.entry.role === 'stop' || it.entry.role === 'checkout'));
    if (!rows.length) rows = all.filter(it => it.entry?.role === 'wake');
    const shown = new Set(rows.map(it => it.entry.key));
    const its = all.filter(it => (it.leg ? shown.has(legs.get(it.leg).fromEntry.key) && shown.has(it.leg) : shown.has(it.entry.key)));
    const at = d === today ? its.findLastIndex(it => instantOf(it.start, it.tz) <= nowIn(it.tz)) : -1;
    its.forEach((it, i) => { it.past = d < today || i < at; it.now = i === at; });
    items.push({ html: () => dayHeadHTML(d, d < today) }, ...its);
  }
  return items;
}
// Its action is said in words, "View day", not with a ›: the day bar's ‹ › just above it step through the days.
const dayHeadHTML = (d, past) => `<button class="wt-tl-day${past ? ' is-past' : ''}" data-action="pick-day" data-day="${d}" aria-label="${dayName(d)}. Open this day">
    <span class="wt-tl-day__name">${dayName(d)}</span><span class="wt-tl-day__open" aria-hidden="true">View day</span></button>`;
function listHTML(trip, day) {
  if (!day) return '<p class="wt-empty">Add a flight, a hotel, or a place to see.</p>';
  const items = day === ALL ? overviewItems(trip) : dayItems(trip, day);
  if (!items.length) return '<p class="wt-empty">Nothing planned this day yet.</p>';
  // Only one row is selected: the one tapped, or, from a pin, the stop's first row (a hotel can start and end the day)
  const rows = items.filter(it => it.entry?.place.id === state.sel);
  const sel = (rows.find(it => it.entry.key === state.selRow) || rows[0])?.entry.key;
  const row = it => ({ key: it.entry?.key, past: it.past, now: it.now, sel: !!it.entry && it.entry.key === sel });
  return items.map(it => it.html(row(it))).join('');
}
// The list fades out at an edge with more of the day past it, so it's clear there are stops to scroll to.
export function updateFades() {
  const body = $app.querySelector('.wt-sheet__body');
  if (!body) return;
  body.classList.toggle('is-more-above', body.scrollTop > 1);
  body.classList.toggle('is-more-below', body.scrollTop + body.clientHeight < listContentHeight(body) - 1);
}
export function renderList(trip) {
  const body = $app.querySelector('.wt-sheet__body'), day = currentDay(trip);
  // the row with the keyboard's focus keeps it (a stop's row or a drive's), wherever it is now
  const had = body.contains(document.activeElement) && document.activeElement;
  const key = had && ['row', 'leg'].map(k => had.dataset[k] && `[data-${k}="${CSS.escape(had.dataset[k])}"]`).find(Boolean);
  body.innerHTML = listHTML(trip, day);
  if (key) (body.querySelector(key) || (had.dataset.id && body.querySelector(`[data-id="${CSS.escape(had.dataset.id)}"]`)))?.focus({ preventScroll: true });
  const same = body.dataset.day === day;
  // The same day stays where the app had it (as far as its new rows go): on an iPhone, new rows could leave the list
  // at its end, and the movement a tap starts set off from there, so the list flew to the end and back.
  // A new day starts at the top, or, on today, with what's happening now in the middle (render centers it).
  body.dataset.day = day;
  setListTop(same ? Math.max(0, Math.min(listTop, body.scrollHeight - body.clientHeight)) : 0);
  if (!same) holdScroll(0);
  updateFades();
  return !same;
}
// Keep the highlight and the dimming current while the trip is open.
setInterval(() => { if ($app.dataset.trip) scheduleRender(); }, 60000);

// ---------- Day bar: ‹ day › to step, or tap the day to pick from all of them. All days comes before the first. ----------
export function dayBarHTML(trip) {
  const days = pagesOf(trip), d = currentDay(trip), i = days.indexOf(d);
  if (!d) return '';
  return `<button class="wt-icon-btn wt-day-bar__step" data-action="prev-day" aria-label="Previous day"${i > 0 ? '' : ' disabled'}>${ICON.back}</button>
    <button class="wt-day-bar__title" data-action="days" aria-label="${dayName(d)}. Pick a day">
      <span class="wt-day-bar__label">${dayName(d)}${ICON.chevronUpDown}</span>
    </button>
    <button class="wt-icon-btn wt-day-bar__step" data-action="next-day" aria-label="Next day"${i < days.length - 1 ? '' : ' disabled'}>${ICON.forward}</button>`;
}
// "Today, Nov 21" on today, so it's easy to find your way back to it; otherwise "Sat, Nov 21". The overview is "All days".
const dayName = d => (d === ALL ? 'All days' : d === nowStamp().slice(0, 10) ? `Today, ${fmtDay(d).split(', ')[1]}` : fmtDay(d));
// All days, then every day of the trip, with the icons of its stops and the hotel you sleep at, so you can see what each day holds.
export function openDays(trip) {
  const cur = currentDay(trip);
  openSheet(`${modalHead('Days')}
    <ul class="wt-day-list">${pagesOf(trip).map(d => {
      const places = d === ALL ? [] : [...new Set(dayPlan(trip, d).filter(e => e.role === 'stop' || e.role === 'night').map(e => e.place))];
      return `<li><button class="wt-day-list__item" data-action="pick-day" data-day="${d}"${d === cur ? ` aria-current="${d === ALL ? 'page' : 'date'}"` : ''}>
        <span class="wt-day-list__name">${dayName(d)}</span>
        <span class="wt-day-list__kinds">${places.slice(0, 6).map(x => markerHTML(x, 'wt-marker--sm')).join('')}</span>
      </button></li>`;
    }).join('')}</ul>`);
}
export function setDay(d) {
  const trip = cur?.stops ? cur : null;
  if (!trip || !pagesOf(trip).includes(d) || d === state.day) return;
  state.day = d;
  state.sel = state.selRow = state.leg = state.hoverLeg = null;
  render();
}
export function stepDay(n) {
  const trip = cur?.stops ? cur : null;
  if (!trip) return;
  const pages = pagesOf(trip);
  setDay(pages[pages.indexOf(currentDay(trip)) + n]);
}
export const isWide = () => ($app.querySelector('.trip')?.clientWidth || 0) >= WIDE;
// The list has two heights on a phone: half (the default) and full (the whole day, docked under the header).
// It never hides. (A lower height, the day bar with one row, was tried: half, with the focus's neighbors and the
// add bar, was preferred.)
// You move it by dragging: the grab handle, the day bar, or the list itself. Dragging the list up grows the sheet
// before the list scrolls; at full, pulling the list down from its top shrinks the sheet again.
// At half the list doesn't scroll by hand at all: the app keeps its focused row in the middle (see centerFocus).
export const SNAPS = ['half', 'full'];
// Half is one fixed height, the same on every day: the list fits exactly three stops and the two drives between
// them, so a selected stop, centered, has its neighbors in view. A stop is counted with one line of notes, as a phone
// shows them unselected (.wt-tl-stop: 12px padding, the name, a 19px note line; .wt-tl-drive: 32px). It used to be
// measured from each day's rows and was at least 48% of the screen, so it changed from day to day.
// On a short screen it's never more than HALF_MAX of it, so the map keeps some room.
const HALF_STOP = 68, HALF_DRIVE = 32, HALF_LIST = 3 * HALF_STOP + 2 * HALF_DRIVE, HALF_MAX = 0.62;
export function snaps() {
  const H = $app.querySelector('.trip').clientHeight;
  const chrome = $app.querySelector('.wt-sheet__top').offsetHeight + $app.querySelector('.wt-add-bar').offsetHeight;
  const half = Math.min(chrome + HALF_LIST, H * HALF_MAX, H - headBottom());
  return { half: Math.round(half), full: H - headBottom(), chrome };
}
const GRAB_LABEL = { half: 'Show the whole day', full: 'Show more of the map' };
const GRAB_LABEL_ALL = { half: 'Show the whole trip', full: 'Show more of the map' };
export const grabLabel = () => (state.day === ALL ? GRAB_LABEL_ALL : GRAB_LABEL)[state.snap];
// `animate`: slide to the new height (a new snap); otherwise it's placed there at once (a first render, a resize).
export function applySnap(animate = false) {
  const trip = $app.querySelector('.trip'), sheet = trip?.querySelector('.wt-sheet');
  if (!sheet) return;
  const wide = isWide(), h = wide ? 0 : snaps()[state.snap];
  if (wide) { stopMotion(); sheet.style.height = ''; setBottom(0); }
  else if (animate) moveSheet({ h });
  else { stopMotion(); setSheetHeight(h); }
  sheet.classList.toggle('is-full', !wide && state.snap === 'full');
  // The header floats over the map as a card; with the whole day showing, it docks and joins the list.
  trip.querySelector('.wt-trip-head').classList.toggle('is-docked', !wide && state.snap === 'full');
  trip.querySelector('.wt-sheet__grab').setAttribute('aria-label', grabLabel());
  // the day's view depends on the room the list leaves; a re-frame (setSnap) puts the camera there again
  if (map) { setDayShown(dayFramed()); updateFitBtn(); }
}
// A new height re-frames the map for what's left of it, unless you've moved the map yourself since.
// `draw` false: the caller renders next, and that render frames the map, so it isn't drawn twice.
// Arriving at half puts the focused row in the middle of the list, in the same movement as the sheet's.
export function setSnap(snap, draw = true) {
  const changed = state.snap !== snap;
  state.snap = snap;
  applySnap(true);
  if (changed && snap !== 'full') {
    if (draw) reframe();
    else if (!camFree && !state.draft) refit();
  }
  if (snap !== 'full') centerFocus();
}
function reframe() {
  const trip = cur?.stops ? cur : null;
  if (camFree || state.draft || !trip) return;
  refit();
  drawMap(trip);
}

// ---------- The focused row ----------
// The half list is about one row, its focus: the selected stop, or else the drive on show, or else, on today,
// the row happening now. Whenever the sheet is at half, the focus sits in the middle
// of the list, with the rows before and after it in view: on opening a day, selecting a stop or a drive, clearing it,
// saving a stop, coming to half from full, and when the plan changes under it. The list can't scroll past
// its ends, so a first or last row stays near its edge; a row taller than the list shows from its top.
// At full the list is yours to scroll; `force` centers it there too (a new day, a stop just saved), and on a wide screen.
const FADE = 24; // the list's edge fades (.is-more-above, .is-more-below)
export function centerFocus({ force = false, animate = true } = {}) {
  const sheet = $app.querySelector('.wt-sheet'), body = sheet?.querySelector('.wt-sheet__body');
  if (!body || drag.moved) return;
  const wide = isWide(), snap = state.snap;
  if (!wide && !force && snap === 'full') return;
  if (wide && !force) return;
  const row = body.querySelector('.is-selected, .is-active') || body.querySelector('.is-now');
  if (!row) return;
  // the list's height once the sheet has settled
  const s = wide ? null : snaps();
  const listH = wide ? body.clientHeight : s[snap] - s.chrome;
  const top = row.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  const h = row.getBoundingClientRect().height;
  const want = h > listH - 2 * FADE ? top - FADE : top + h / 2 - listH / 2;
  const to = Math.round(Math.max(0, Math.min(want, listContentHeight(body) - listH)));
  if (!animate) {
    holdScroll(to); // a sheet movement under way carries on, leaving the list here
    setListTop(to);
    return;
  }
  if (Math.abs(to - listTop) < 1 && (!motion.raf || motion.s1 == null)) return;
  moveSheet({ s: to });
}
