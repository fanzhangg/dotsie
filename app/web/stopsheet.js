/* The stop sheet: where a new stop goes, its pickers (type, how you get there, when), and saving it. */
import { $app, $sheets, ICON, WIDE, esc, state } from './core.js';
import { DAYS, fmtClock, fmtDay, fmtDur, fmtTime, instantOf, nowStamp, pad, placeZone, toDate, toInput, zoneCity, zoneName } from './time.js';
import { cur } from './trips.js';
import { api } from './backend.js';
import { ALL, HOTEL_CHECK_IN, HOTEL_CHECK_OUT, KINDS, KIND_HINTS, KIND_SECTIONS, TRAVEL, addDays, checkoutOf, dayOf, dayPlan, dayStops, daysBetween, daysOf, guessKind, kindOf, samePlace, stayOf, stayOnNight, stopsOf, wayTo } from './plan.js';
import { MAX_LINKS, centerFocus, currentDay, selectedStop, siteOf, webUrl } from './timeline.js';
import { foodURL, legRoute, legsOn } from './routes.js';
import { addStop, deleteStop, editStop } from './edits.js';
import { offlineNow } from './offline.js';
import { render } from './app.js';
import { drawMap, focusStop, map, markerHTML, moveCamera, reduceMotion } from './map.js';
import { aboutHTML, aboutSlot, loadAbout, showAbout, sightAt, sightsAlong } from './sights.js';
import { closeSheet, modalHead, openSheet } from './sheets.js';

// Where you are when you tap Add stop or its +: the stop selected; with a drive shown, the stop it leaves from (so the
// new one is on that drive). Null for none, or a drive from last night's hotel.
function anchorStop(trip) {
  const s = selectedStop(trip);
  if (s) return s;
  const leg = state.leg && legsOn(trip, currentDay(trip)).find(l => l.key === state.leg);
  return leg?.fromEntry.role === 'stop' ? leg.from : null;
}
// After `after` (see anchorStop): halfway to the next stop that day, on a 5-minute mark, so it goes in between; or two
// hours later when it's the day's last.
// Else two hours after the day's last stop; 9 AM on a day with none yet (a hotel day), or 9 AM tomorrow for an empty trip.
// From the overview, the trip's last day: a stop added there most often extends the trip.
function defaultTime(trip, after = null) {
  if (after) {
    const t = toDate(after.time), next = dayStops(trip, dayOf(after)).find(s => s.time > after.time);
    if (!next) { t.setHours(Math.min(t.getHours() + 2, 22), 0, 0, 0); return toInput(t > toDate(after.time) ? t : new Date(toDate(after.time).getTime() + 60000)); }
    const mid = new Date(Math.floor((t.getTime() + toDate(next.time).getTime()) / 2 / 300000) * 300000);
    return toInput(mid > t ? mid : new Date(t.getTime() + 60000));
  }
  const day = currentDay(trip) === ALL ? daysOf(trip).at(-1) : currentDay(trip), s = dayStops(trip, day);
  let d;
  if (s.length) { d = toDate(s.at(-1).time); d.setHours(Math.min(d.getHours() + 2, 22), 0, 0, 0); }
  else if (day) { d = toDate(day); d.setHours(9, 0, 0, 0); }
  else { d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  return toInput(d);
}
// Search leans toward a place: where the stop is, or where a new one goes (see wayAround). It used to lean toward the
// middle of all the trip's stops, which on a long road trip is somewhere none of them are.
const nearParam = p => (p ? `&near=${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}` : '');

// Where a stop at `time` goes in the plan: between the place you'd come from and the one you'd go on to (that day's
// stops, last night's hotel and tonight's; else the trip's stops before and after), leaving out `skip`, the stop being
// moved. With a hotel tonight, the day ends there: a stop in the evening goes from it and back, not on to tomorrow's
// first stop (that's after a night's sleep, not on the way). `line` is the way between them as [lat, lng] points, thinned: its route once it's been looked up (`routed`), a
// straight line until then. With only one of them, or no route between them (a flight), it's that one place, and `to`
// is null. Null for a trip with no stops.
function wayAround(trip, time, skip) {
  const day = time.slice(0, 10);
  const at = e => e.at || (e.role === 'stop' ? e.place.time : e.role === 'night' ? `${day}T23:59` : `${day}T00:00`);
  let from = null, to = null;
  for (const e of dayPlan(trip, day)) {
    if (e.place.id === skip) continue;
    if (at(e) <= time) from = e; else to ||= e;
  }
  const night = stayOnNight(trip, day);
  if (!to && night && night.s.id !== skip) to = { place: night.s, role: 'night', day };
  const others = stopsOf(trip).filter(s => s.id !== skip), entry = s => s && { place: s, role: 'stop' };
  from ||= entry(others.filter(s => s.time <= time).at(-1));
  to ||= entry(others.find(s => s.time > time));
  const a = from?.place, b = to?.place;
  if (!a || !b || samePlace(a, b) || !TRAVEL[wayTo(to)].route) {
    const p = a || b;
    return p ? { from: p, to: null, line: [[+p.lat, +p.lng]], routed: true } : null;
  }
  const r = legRoute(from, to);
  return { from: a, to: b, line: thinLine(r?.coords?.length > 1 ? r.coords : [[+a.lat, +a.lng], [+b.lat, +b.lng]]), routed: !!r };
}
// km east and north per degree, at a latitude (flat, which is close enough over a few km)
export const kmPerDeg = lat => [111.32 * Math.cos(lat * Math.PI / 180), 110.57];
// A route's points, at least 300 m apart: a long drive has thousands, and a sight's distance to it needs far fewer
function thinLine(line) {
  const out = [line[0]];
  for (const p of line.slice(1)) {
    const q = out.at(-1), [kx, ky] = kmPerDeg(q[0]);
    if (Math.hypot((p[1] - q[1]) * kx, (p[0] - q[0]) * ky) >= 0.3) out.push(p);
  }
  if (out.at(-1) !== line.at(-1)) out.push(line.at(-1));
  return out;
}
// How far a place is from a line of [lat, lng] points, in km
export function kmOff(p, line) {
  const [kx, ky] = kmPerDeg(p.lat), xy = q => [(q[1] - p.lng) * kx, (q[0] - p.lat) * ky];
  if (line.length === 1) return Math.hypot(...xy(line[0]));
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = xy(line[i - 1]), [bx, by] = xy(line[i]), dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
// A place this close to the way is on it: ten minutes or so there and back
export const ON_THE_WAY_KM = 5;
// A stop's Duration is one of these, in minutes (or one saved by an assistant), or none
const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];
// Every time zone, for a stop whose times are on a clock other than its place's
const ALL_ZONES = Intl.supportedValuesOf?.('timeZone') || [];

// ---------- Choices: every pick from a list is a picker row that opens its options ----------
// The row shows the current choice. On a phone, tapping it slides the sheet to the options, with Back in the head;
// picking one applies it and slides back, and Back slides back with nothing changed. On a computer (768px and up)
// the same options drop down under the row as a menu: one click to open, one to pick, Esc or a click outside to
// close. A stop's Type and Account's Maps app both work this way, however few the options. See "Picker" in the
// design system.
// `meta` is a short value on the right, before the check (a way's time in How you get there)
export const optionHTML = (value, label, { marker = '', detail = '', meta = null } = {}) =>
  `<li><button type="button" class="wt-option" role="radio" data-value="${esc(value)}">${marker}<span class="wt-option__text"><span class="wt-option__label">${esc(label)}</span>${detail ? `<span class="wt-option__detail">${esc(detail)}</span>` : ''}</span>${meta != null ? `<span class="wt-option__meta">${esc(meta)}</span>` : ''}${ICON.check}</button></li>`;
// `intro` is one line on what the choice affects, when the label alone doesn't say
export const choicePageHTML = (cls, title, options, intro = '') => `<div class="${cls}" hidden>
      <div class="wt-modal__head wt-modal__head--sub wt-modal__head--sticky"><button type="button" class="wt-icon-btn" data-choice-back aria-label="Back">${ICON.back}</button><h2 class="wt-modal__title">${esc(title)}</h2></div>
      ${intro ? `<p class="wt-modal__text">${esc(intro)}</p>` : ''}
      <ul class="wt-options" role="radiogroup" aria-label="${esc(title)}">${options}</ul>
    </div>`;
// Wires a picker to its options, inside `sheet`. On a phone the page takes `main`'s place while it's open, and the
// sheet's scroll comes back on return. On a computer the page moves under the picker and shows as a menu (.wt-menu),
// with the rest of the sheet still there. Focus goes to the checked option on the way in, and to the picker on the
// way out. Returns mark(value), which checks the current option.
const wideScreen = matchMedia(`(min-width: ${WIDE}px)`);
export function choicePage(sheet, { main, page, picker, onPick }) {
  const home = page.parentElement, field = picker.parentElement;
  let scrollBack = 0, menu = false;
  picker.setAttribute('aria-haspopup', 'true');
  picker.setAttribute('aria-expanded', 'false');
  const outside = e => { if (!page.contains(e.target) && !picker.contains(e.target)) open(false, false); };
  const open = (on, refocus = true) => {
    if (on) {
      menu = wideScreen.matches;
      // The page lives beside `main` for a phone, and inside the field, under the picker, for a menu
      if (menu) field.append(page); else home.append(page);
      page.classList.toggle('wt-menu', menu);
      if (menu) document.addEventListener('pointerdown', outside, true);
      else { scrollBack = sheet.scrollTop; main.hidden = true; }
    } else {
      if (page.hidden) return;
      if (menu) document.removeEventListener('pointerdown', outside, true);
      else main.hidden = false;
    }
    page.hidden = !on;
    picker.setAttribute('aria-expanded', on);
    if (!menu) sheet.scrollTop = on ? 0 : scrollBack;
    if (on) (page.querySelector('[aria-checked="true"]') || page.querySelector('[data-value]')).focus();
    else if (refocus) picker.focus();
  };
  picker.addEventListener('click', () => open(page.hidden));
  // A menu closes on Esc (without closing the sheet), or when focus leaves it
  page.addEventListener('keydown', e => {
    if (e.key === 'Escape' && menu && !page.hidden) { e.stopPropagation(); open(false); }
  });
  page.addEventListener('focusout', e => {
    if (menu && !page.hidden && e.relatedTarget && !page.contains(e.relatedTarget) && e.relatedTarget !== picker) open(false, false);
  });
  // ↑ ↓ move between options, as in any radio group
  page.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = [...page.querySelectorAll('[data-value]')], i = all.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
  });
  page.addEventListener('click', e => {
    if (e.target.closest('[data-choice-back]')) return open(false);
    const b = e.target.closest('[data-value]');
    if (!b) return;
    onPick(b.dataset.value);
    open(false);
  });
  return { mark: value => { for (const b of page.querySelectorAll('[data-value]')) b.setAttribute('aria-checked', b.dataset.value === value); } };
}

// ---------- When: a day, then a time, as in a calendar app ----------
// A stop's Arrive (and a hotel's Check-out) is one row of two pickers, the day and the time ("Fri, Nov 20" · "1:00 PM"),
// over a hidden input holding "YYYY-MM-DDTHH:MM". Tapping the day opens the month, and picking a day goes straight on to
// the time; tapping the time goes there alone. The time is three wheels, hour, minute and AM/PM, and Done sets the day and
// time together. Back steps back (from the time to the month it came from, from the month to the form), and nothing
// changes until Done. On a phone each step is a page of the sheet, like a picker's options; on a computer it drops down
// under the row as a menu, and the row shows the draft as it changes. See "When" in the design system.
// `marks()` is the days that have stops, dotted in the month; `limits()` the earliest and latest it can be ({ min, max }).
const fmtDate = t => `${fmtDay(t)}${t.slice(0, 4) === nowStamp().slice(0, 4) ? '' : `, ${t.slice(0, 4)}`}`;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const addMonths = (month, n) => { const d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
function whenPicker(sheet, { main, field, input, marks = () => new Set(), limits = () => ({}) }) {
  const dateBtn = field.querySelector('[data-when-date]'), timeBtn = field.querySelector('[data-when-time]');
  const label = field.querySelector('[data-when-label]'), home = main.parentElement;
  const page = Object.assign(document.createElement('div'), { className: 'wt-when-page', hidden: true });
  let draft = '', step = null, month = '', fromDate = false, menu = false, scrollBack = 0;
  for (const b of [dateBtn, timeBtn]) { b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); }

  const paint = () => {
    const v = step ? draft : input.value;
    dateBtn.textContent = v ? fmtDate(v) : '';
    timeBtn.textContent = v ? fmtTime(v) : '';
  };
  const outside = e => { if (!page.contains(e.target) && !field.querySelector('.wt-when').contains(e.target)) close(false, false); };
  function open(which) {
    draft = input.value;
    month = draft.slice(0, 7);
    fromDate = false;
    menu = wideScreen.matches;
    if (menu) { field.append(page); document.addEventListener('pointerdown', outside, true); }
    else { home.append(page); scrollBack = sheet.scrollTop; main.hidden = true; }
    page.classList.toggle('wt-menu', menu);
    page.hidden = false;
    show(which);
  }
  function show(which) {
    step = which;
    if (which === 'date') month = draft.slice(0, 7);
    dateBtn.setAttribute('aria-expanded', which === 'date');
    timeBtn.setAttribute('aria-expanded', which === 'time');
    page.innerHTML = which === 'date' ? monthHTML() : timeHTML();
    if (!menu) sheet.scrollTop = 0;
    if (which === 'time') wheels();
    (page.querySelector('.wt-cal__day[tabindex="0"]') || page.querySelector('.wt-wheel'))?.focus({ preventScroll: true });
    if (menu) page.scrollIntoView({ block: 'nearest' });
    paint();
  }
  function close(apply, refocus = true) {
    if (!step) return;
    const was = step;
    step = null;
    if (menu) document.removeEventListener('pointerdown', outside, true);
    else main.hidden = false;
    page.hidden = true;
    page.innerHTML = '';
    if (!menu) sheet.scrollTop = scrollBack;
    dateBtn.setAttribute('aria-expanded', 'false');
    timeBtn.setAttribute('aria-expanded', 'false');
    if (apply && draft !== input.value) { input.value = draft; input.dispatchEvent(new Event('input')); }
    paint();
    if (refocus) (was === 'date' ? dateBtn : timeBtn).focus();
  }
  const back = () => (step === 'time' && fromDate ? show('date') : close(false));
  const head = title => `<div class="wt-modal__head wt-modal__head--sub wt-modal__head--sticky"><button type="button" class="wt-icon-btn" data-when-back aria-label="Back">${ICON.back}</button><h2 class="wt-modal__title">${esc(title)}</h2></div>`;

  // ----- The month: a grid of its days, Sunday first. The day set is black, today has a ring, a day with stops a dot. -----
  function monthHTML() {
    const [y, m] = month.split('-').map(Number), lead = new Date(y, m - 1, 1).getDay(), n = new Date(y, m, 0).getDate();
    const { min, max } = limits(), lo = min?.slice(0, 10), hi = max?.slice(0, 10);
    const sel = draft.slice(0, 10), today = nowStamp().slice(0, 10), has = marks();
    const focusDay = sel.startsWith(month) ? sel : today.startsWith(month) && !(lo && today < lo) && !(hi && today > hi) ? today
      : lo?.startsWith(month) ? lo : `${month}-01`;
    let cells = '<span></span>'.repeat(lead);
    for (let d = 1; d <= n; d++) {
      const day = `${month}-${pad(d)}`, off = (lo && day < lo) || (hi && day > hi);
      cells += `<button type="button" class="wt-cal__day${has.has(day) ? ' has-stops' : ''}" data-cal-day="${day}" aria-pressed="${day === sel}"${day === today ? ' aria-current="date"' : ''} tabindex="${day === focusDay ? 0 : -1}" aria-label="${fmtDay(day)}${has.has(day) ? ', has stops' : ''}"${off ? ' disabled' : ''}><span class="wt-cal__n">${d}</span></button>`;
    }
    return `${head(label.textContent)}
      <div class="wt-cal">
        <div class="wt-cal__head"><span class="wt-cal__month" aria-live="polite">${MONTH_NAMES[m - 1]} ${y}</span>
          <button type="button" class="wt-icon-btn" data-month="-1" aria-label="Previous month"${lo && lo >= `${month}-01` ? ' disabled' : ''}>${ICON.back}</button>
          <button type="button" class="wt-icon-btn" data-month="1" aria-label="Next month"${hi && hi.slice(0, 7) <= month ? ' disabled' : ''}>${ICON.forward}</button></div>
        <div class="wt-cal__grid" role="group" aria-label="${MONTH_NAMES[m - 1]} ${y}">
          ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => `<span class="wt-cal__wd" aria-hidden="true">${w}</span>`).join('')}${cells}</div>
      </div>`;
  }
  // ← → ↑ ↓ move a day or a week, Page Up and Page Down a month, moving the month with it
  function moveTo(day) {
    const { min, max } = limits();
    if (min && day < min.slice(0, 10)) day = min.slice(0, 10);
    if (max && day > max.slice(0, 10)) day = max.slice(0, 10);
    if (!day.startsWith(month)) { month = day.slice(0, 7); page.innerHTML = monthHTML(); }
    page.querySelectorAll('.wt-cal__day[tabindex="0"]').forEach(b => { b.tabIndex = -1; });
    const b = page.querySelector(`[data-cal-day="${day}"]`);
    if (b) { b.tabIndex = 0; b.focus(); }
  }

  // ----- The time: hour, minute (every 5, and the stop's own if it's between) and AM/PM, each a wheel that snaps -----
  let cols = [];
  function timeHTML() {
    const h = +draft.slice(11, 13), mi = +draft.slice(14, 16);
    const mins = [...new Set([...Array(12).keys()].map(i => i * 5).concat(mi))].sort((a, b) => a - b);
    cols = [
      { name: 'Hour', values: [...Array(12).keys()], text: v => String(v || 12), at: h % 12 },
      { name: 'Minute', values: mins, text: pad, at: mi },
      { name: 'AM or PM', values: [0, 12], text: v => (v ? 'PM' : 'AM'), at: h < 12 ? 0 : 12 },
    ];
    const wheel = c => `<div class="wt-wheel" tabindex="0" role="spinbutton" aria-label="${c.name}">${c.values.map((v, i) => `<div class="wt-wheel__item" data-i="${i}">${c.text(v)}</div>`).join('')}</div>`;
    return `${head(fmtDate(draft))}
      <div class="wt-wheels" role="group" aria-label="Time">${cols.map(wheel).join('')}</div>
      <button type="button" class="wt-btn wt-btn--primary wt-btn--block wt-when-page__done" data-when-done>Done</button>`;
  }
  function wheels() {
    page.querySelectorAll('.wt-wheel').forEach((el, k) => {
      const c = cols[k], items = [...el.children], size = () => items[0].offsetHeight || 44;
      c.el = el;
      c.i = Math.max(0, c.values.indexOf(c.at));
      const mark = () => {
        items.forEach((it, i) => it.classList.toggle('is-on', i === c.i));
        el.setAttribute('aria-valuetext', c.text(c.values[c.i]));
      };
      const go = (i, smooth = true) => el.scrollTo({ top: Math.max(0, Math.min(items.length - 1, i)) * size(), behavior: smooth && !reduceMotion.matches ? 'smooth' : 'instant' });
      c.go = go;
      el.scrollTop = c.i * size();
      mark();
      let frame = 0;
      el.addEventListener('scroll', () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const i = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / size())));
          if (i === c.i) return;
          c.i = i;
          mark();
          const [hr, mn, ap] = cols.map(x => x.values[x.i]);
          draft = `${draft.slice(0, 11)}${pad(hr + ap)}:${pad(mn)}`;
          paint();
        });
      });
      el.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) go(+it.dataset.i); });
      el.addEventListener('keydown', e => {
        const step = { ArrowUp: -1, ArrowDown: 1, PageUp: -3, PageDown: 3, Home: -99, End: 99 }[e.key];
        if (step == null) return;
        e.preventDefault();
        go(c.i + step);
      });
    });
  }

  dateBtn.addEventListener('click', () => (step === 'date' ? close(false) : step ? show('date') : open('date')));
  timeBtn.addEventListener('click', () => (step === 'time' ? close(false) : step ? show('time') : open('time')));
  page.addEventListener('click', e => {
    if (e.target.closest('[data-when-back]')) return back();
    const m = e.target.closest('[data-month]');
    if (m) { month = addMonths(month, +m.dataset.month); page.innerHTML = monthHTML(); return page.querySelector(`[data-month="${m.dataset.month}"]`).focus(); }
    const d = e.target.closest('[data-cal-day]');
    if (d) { draft = d.dataset.calDay + draft.slice(10); fromDate = true; return show('time'); }
    if (e.target.closest('[data-when-done]')) {
      // A time before the earliest it can be (a check-out before check-in, on the same day) comes up to it
      const { min, max } = limits();
      if (min && draft < min) draft = min;
      if (max && draft > max) draft = max;
      close(true);
    }
  });
  page.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); return close(false); }
    const day = e.target.closest?.('[data-cal-day]')?.dataset.calDay;
    if (!day) return;
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (by) { e.preventDefault(); moveTo(addDays(day, by)); }
    else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const to = addMonths(day.slice(0, 7), e.key === 'PageUp' ? -1 : 1), last = new Date(+to.slice(0, 4), +to.slice(5, 7), 0).getDate();
      moveTo(`${to}-${pad(Math.min(+day.slice(8), last))}`);
    }
  });
  page.addEventListener('focusout', e => {
    if (menu && step && e.relatedTarget && !page.contains(e.relatedTarget) && !field.querySelector('.wt-when').contains(e.relatedTarget)) close(false, false);
  });
  return { paint, close: () => close(false, false) };
}

// A when field: its label, then the day and the time side by side (see whenPicker). `aside` follows the label, on its right.
const whenHTML = (name, label, cls = '', aside = '', after = '') => `<div class="wt-field${cls}"${cls ? ' hidden' : ''}>
        <span class="wt-field__label wt-field__label--split"><span id="when-${name}" data-when-label>${label}</span>${aside}</span>
        <div class="wt-when"><button type="button" class="wt-picker wt-picker--text wt-when__date" data-when-date aria-describedby="when-${name}"></button><button type="button" class="wt-picker wt-picker--text wt-when__time" data-when-time aria-describedby="when-${name}"></button></div>
        ${after}<input type="hidden" name="${name}"></div>`;

// The stop sheet is a panel: the map stays in view (above it on a phone, beside it on a wide screen) and shows
// the stop as you edit it, at the place you picked, with the type you chose.
// The first line is the place, a row like a calendar's Location: tapping it opens a search page, as in a maps app.
// Type is one row that opens the types on a page of their own; it starts as a guess from the place you pick,
// until you choose one yourself.
// A new stop can start from a place picked on the map (`place`: name, address, lat, lng and kind), rather than from search.
export function openStopSheet(trip, stop, place = null) {
  if ($sheets.innerHTML) closeSheet();
  const draft = stop ? { ...stop, kind: kindOf(stop) } : { lat: null, lng: null, address: '', name: '', kind: 'place', ...place };
  let chosen = !!stop, saved = false;
  const camera = map && { center: map.getCenter(), zoom: map.getZoom() };
  const after = stop ? null : anchorStop(trip); // before the selection's cleared
  state.leg = null;
  if (state.sel !== stop?.id) state.selRow = null;
  state.sel = stop?.id || null;
  state.draft = draft;
  $app.querySelector('.trip')?.classList.add('is-editing');
  render();
  const option = k => optionHTML(k, KINDS[k].label, { marker: markerHTML({ kind: k }, ''), detail: KIND_HINTS[k] });
  const durOption = m => optionHTML(m ? String(m) : '', m ? fmtDur(m * 60) : 'None');
  const zoneOption = (z, detail) => optionHTML(z, z ? zoneCity(z) : 'Local time', { detail });
  openSheet(`<div class="stop-main">${modalHead(stop ? 'Edit stop' : 'Add stop', true)}
    <form>
      ${stop ? aboutSlot(draft.wikidata, true) : ''}
      <div class="wt-field"><span class="wt-field__label" id="place-label">Place</span>
        <button type="button" class="wt-picker wt-picker--text" data-place-open aria-describedby="place-label"></button></div>
      <div class="wt-field"><span class="wt-field__label" id="kind-label">Type</span>
        <button type="button" class="wt-picker" data-kind-open aria-describedby="kind-label"></button></div>
      ${whenHTML('time', 'Arrive', '', '', `<button type="button" class="wt-when__zone" data-zone-open aria-describedby="zone-label"><span class="wt-visually-hidden" id="zone-label">Time zone</span><span class="wt-when__zone-name"></span>${ICON.forward}</button>`)}
      ${whenHTML('checkout', 'Check-out', ' wt-stay', '<span class="wt-field__aside" data-nights></span>')}
      <div class="wt-field wt-dur"><span class="wt-field__label" id="dur-label">Duration</span>
        <button type="button" class="wt-picker wt-picker--text" data-dur-open aria-describedby="dur-label"></button></div>
      <label class="wt-field"><span class="wt-field__label">Note</span><textarea class="wt-input" name="note" rows="2" maxlength="2000" placeholder="Confirmation #, tickets, tips…"></textarea></label>
      <div class="wt-field"><span class="wt-field__label" id="links-label">Links</span>
        <div class="wt-link-list" role="group" aria-labelledby="links-label"></div>
        <button type="button" class="wt-link-add" data-link-add>${ICON.plus}Add link</button></div>
      <div class="wt-modal__actions wt-modal__actions--sticky">${stop ? '<button type="button" class="wt-btn wt-btn--danger" data-del>Delete</button>' : ''}<button class="wt-btn wt-btn--primary">${stop ? 'Save' : 'Add'}</button></div>
    </form></div>
    ${choicePageHTML('stop-kinds', 'Type', KIND_SECTIONS.map(g => g.map(option).join('')).join('<li class="wt-options__sep" role="presentation"></li>'))}
    ${choicePageHTML('stop-durs', 'Duration', '', 'How long you’ll be here. The drive after it leaves when it ends.')}
    ${choicePageHTML('stop-zones', 'Time zone', '', 'The clock the times are on. Usually the one where the place is, as on a ticket or a booking.')}
    <div class="stop-place" hidden>
      <div class="wt-search-bar">
        <label class="wt-input wt-input-group wt-search">${ICON.search}<input id="stop-place" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="place-results" aria-label="Search a place" placeholder="Search a place" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="200"><span class="wt-spinner" hidden></span><button type="button" class="wt-search__clear" aria-label="Clear" hidden>${ICON.close}</button></label>
        <button type="button" class="wt-search-bar__cancel" data-place-cancel>Cancel</button>
      </div>
      <div class="wt-results" id="place-results" role="listbox" aria-label="Places"></div>
      <a class="wt-results__more" data-place-food target="_blank" rel="noopener" hidden>Places to eat nearby${ICON.external}</a>
      <span class="wt-visually-hidden" role="status" data-place-status></span>
    </div>`, el => {
    const f = el.querySelector('form'), F = f.elements;
    const about = f.querySelector('.wt-about--loading');
    if (about) showAbout(about, draft.wikidata, true);
    // A place with no Wikidata item may be a sight on the map that has one (see sightAt): the draft takes it, so Save
    // keeps it with the stop, and an open stop shows what Wikipedia says. Opening the sheet alone changes nothing.
    let looking = 0;
    const stillAt = (at, n) => n === looking && el.isConnected && draft.lat === at.lat && draft.lng === at.lng;
    function findItem() {
      if (draft.wikidata || draft.lat == null) return;
      const at = { name: draft.name, lat: draft.lat, lng: draft.lng }, n = ++looking;
      sightAt(at).then(s => {
        if (!s || !stillAt(at, n) || draft.wikidata) return;
        draft.wikidata = s.wikidata;
        if (stop) loadAbout(s.wikidata).then(a => {
          if (a && stillAt(at, n) && draft.wikidata === s.wikidata && !f.querySelector('.wt-about')) f.insertAdjacentHTML('afterbegin', aboutHTML(a, true));
        });
      });
    }
    findItem();
    const main = el.querySelector('.stop-main'), kindsPage = el.querySelector('.stop-kinds'), picker = el.querySelector('[data-kind-open]');
    // The time is yours once you've touched it; until then a new hotel's starts at check-in time
    let timeTouched = !!stop;
    if (stop) { F.time.value = stop.time; F.note.value = stop.note || ''; }
    else F.time.value = defaultTime(trip, after);
    // The note grows with what's in it, rather than scrolling in a small box inside the scrolling sheet
    const growNote = () => {
      if (main.hidden) return;
      F.note.style.height = '';
      F.note.style.height = `${F.note.scrollHeight + F.note.offsetHeight - F.note.clientHeight}px`;
    };
    F.note.addEventListener('input', growNote);
    requestAnimationFrame(growNote);

    // ----- Links: a row each, its label over its address, and Add link under them. A label left empty shows the
    // page's site, which its placeholder says once there's an address. Rows left empty are dropped on save. -----
    const linkList = el.querySelector('.wt-link-list'), linkAdd = el.querySelector('[data-link-add]');
    const showLinkAdd = () => { linkAdd.hidden = linkList.children.length >= MAX_LINKS; };
    function addLinkRow(link = { url: '', label: '' }) {
      linkList.insertAdjacentHTML('beforeend', `<div class="wt-link-edit">
        <span class="wt-link-edit__fields">
          <input class="wt-link-edit__label" type="text" maxlength="60" aria-label="Label" placeholder="Label" autocomplete="off" enterkeyhint="next" value="${esc(link.label)}">
          <input class="wt-link-edit__url" type="text" inputmode="url" maxlength="2000" aria-label="Link" placeholder="Paste a link" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done" value="${esc(link.url)}">
        </span>
        <button type="button" class="wt-icon-btn wt-link-edit__remove" aria-label="Remove link">${ICON.close}</button></div>`);
      const row = linkList.lastElementChild, url = row.querySelector('.wt-link-edit__url'), label = row.querySelector('.wt-link-edit__label');
      const hint = () => { label.placeholder = siteOf(webUrl(url.value)) || 'Label'; };
      url.addEventListener('input', () => { url.setCustomValidity(''); hint(); });
      row.querySelector('.wt-link-edit__remove').onclick = () => {
        const next = row.nextElementSibling?.querySelector('input') || linkAdd;
        row.remove();
        showLinkAdd();
        (linkAdd.hidden ? linkList.querySelector('input') : next)?.focus();
      };
      hint();
      showLinkAdd();
      return row;
    }
    for (const l of stop?.links || []) addLinkRow(l);
    linkAdd.onclick = () => addLinkRow().querySelector('.wt-link-edit__url').focus();
    // The links as saved, or null (with the field that's wrong showing why) when one isn't a web page
    function readLinks() {
      const links = [];
      for (const row of linkList.children) {
        const url = row.querySelector('.wt-link-edit__url'), label = row.querySelector('.wt-link-edit__label').value.trim();
        if (!url.value.trim() && !label) continue;
        const href = webUrl(url.value);
        if (!href) {
          url.setCustomValidity(url.value.trim() ? 'This isn’t a web address.' : 'Paste a link, or remove this one.');
          url.reportValidity();
          return null;
        }
        links.push({ url: href, label });
      }
      return links;
    }

    // ----- Type: the picker row, and its page -----
    const showKind = () => {
      picker.innerHTML = `${markerHTML(draft, '')}<span class="wt-picker__value">${KINDS[draft.kind].label}</span>${ICON.forward}`;
      kinds.mark(draft.kind);
    };
    const kinds = choicePage(el, { main, page: kindsPage, picker, onPick: k => { chosen = true; setKind(k); } });
    function setKind(kind) {
      draft.kind = kind;
      // A new hotel starts at check-in time; anything else goes back to the usual default.
      if (!timeTouched) F.time.value = kind === 'hotel' ? `${F.time.value.slice(0, 10)}T${HOTEL_CHECK_IN}` : defaultTime(trip, after);
      showKind();
      showNights();
      if (cur?.stops) drawMap(cur);
    }

    // ----- A stop has one time, when you get there: Arrive. A hotel is a stay: Arrive becomes Check-in, then
    // Check-out, a day and time. The nights are the days between them, shown beside Check-out's label. Left alone,
    // check-out follows the trip (the next hotel, or the last day). Each is a day and a time, picked in that order
    // (see whenPicker); the month dots the days that have other stops. -----
    let nights = stop?.nights != null && stop.nights >= 0 ? stop.nights : null, outTime = stop && kindOf(stop) === 'hotel' ? checkoutOf(stop) : HOTEL_CHECK_OUT;
    const stay = el.querySelector('.wt-stay'), inDay = () => F.time.value.slice(0, 10);
    const marks = () => new Set(stopsOf(cur?.id === trip.id && cur.stops ? cur : trip).filter(s => s.id !== stop?.id).map(dayOf));
    const whenIn = whenPicker(el, { main, field: F.time.closest('.wt-field'), input: F.time, marks });
    // Check-out is after check-in, the same day at the earliest, and at most 30 nights later.
    const whenOut = whenPicker(el, { main, field: stay, input: F.checkout, marks, limits: () => ({ min: F.time.value, max: `${addDays(inDay(), 30)}T23:59` }) });
    let shownIn = inDay();
    function autoNights() {
      const day = inDay(), later = stopsOf(trip).filter(s => s.id !== stop?.id && dayOf(s) > day);
      const nextHotel = later.find(s => kindOf(s) === 'hotel');
      return Math.max(1, daysBetween(day, nextHotel ? dayOf(nextHotel) : later.length ? dayOf(later.at(-1)) : addDays(day, 1)));
    }
    function showNights() {
      const hotel = draft.kind === 'hotel', day = inDay();
      stay.hidden = !hotel;
      F.checkout.disabled = !hotel; // so a hidden field isn't saved
      el.querySelector('#when-time').textContent = hotel ? 'Check-in' : 'Arrive';
      if (day) {
        F.checkout.value = `${addDays(day, nights ?? autoNights())}T${outTime}`;
        const n = daysBetween(day, F.checkout.value.slice(0, 10));
        el.querySelector('[data-nights]').textContent = n ? `${n} ${n === 1 ? 'night' : 'nights'}` : 'Same day';
      }
      whenIn.paint();
      whenOut.paint();
      showDur();
      showZone();
    }
    F.checkout.addEventListener('input', () => {
      const v = F.checkout.value, day = inDay();
      if (!v || !day) return;
      outTime = v.slice(11, 16);
      const n = daysBetween(day, v.slice(0, 10));
      // Changing only the time keeps nights following the trip.
      if (nights != null || n !== autoNights()) nights = Math.min(30, Math.max(0, n));
      showNights();
    });
    F.time.addEventListener('input', () => {
      timeTouched = true;
      // Moving check-in keeps the check-out day, unless that would put it before check-in (or too many nights after): then the nights move with it.
      const day = inDay();
      if (nights != null && day && shownIn) {
        const n = daysBetween(day, addDays(shownIn, nights));
        if (n >= 0 && n <= 30) nights = n;
      }
      if (day) shownIn = day;
      showNights();
    });

    // ----- Duration: how long you're here, picked from a list, or None. The drive after the stop leaves when it ends.
    // A hotel has its nights and check-out instead. -----
    const durPicker = el.querySelector('[data-dur-open]'), durField = durPicker.parentElement, durPage = el.querySelector('.stop-durs');
    let dur = stop ? stayOf(stop) : null;
    durPage.querySelector('.wt-options').innerHTML = durOption(null) + '<li class="wt-options__sep" role="presentation"></li>'
      + [...new Set([...DURATIONS, ...(dur ? [dur] : [])])].sort((a, b) => a - b).map(durOption).join('');
    const durs = choicePage(el, { main, page: durPage, picker: durPicker, onPick: v => { dur = v ? +v : null; showDur(); } });
    function showDur() {
      durField.hidden = draft.kind === 'hotel';
      const end = dur && F.time.value ? toDate(F.time.value) : null;
      if (end) end.setMinutes(end.getMinutes() + dur);
      const until = end && `Until ${fmtClock(end)}${toInput(end).slice(0, 10) !== inDay() ? `, ${DAYS[end.getDay()]}` : ''}`;
      durPicker.innerHTML = `<span class="wt-picker__value"><span class="wt-picker__name">${dur ? fmtDur(dur * 60) : 'None'}</span>${until ? `<span class="wt-picker__detail">${until}</span>` : ''}</span>${ICON.forward}`;
      durs.mark(dur ? String(dur) : '');
    }

    // ----- Time zone: the clock the times are on, under them. It's the place's own (Local time) unless someone picks
    // another, from every zone, searched by city or name. Picking the place's own zone is Local time again. -----
    const zonePicker = el.querySelector('[data-zone-open]'), zonePage = el.querySelector('.stop-zones'), zoneList = zonePage.querySelector('.wt-options');
    zoneList.insertAdjacentHTML('beforebegin', `<label class="wt-input wt-input-group wt-search wt-zone-search">${ICON.search}<input type="text" aria-label="Search time zones" placeholder="Search a city or time zone" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="60"></label>`);
    const zoneSearch = zonePage.querySelector('.wt-zone-search input');
    const zoneHere = () => placeZone(draft.lat, draft.lng), zoneAt = () => instantOf(F.time.value || nowStamp(), draft.tz || zoneHere());
    function listZones() {
      const q = zoneSearch.value.trim().toLowerCase().replace(/\s+/g, ' '), ms = zoneAt(), here = zoneHere();
      const long = z => zoneName(z, ms, 'long');
      const hit = z => z.toLowerCase().replace(/_/g, ' ').includes(q) || long(z).toLowerCase().includes(q);
      const found = ALL_ZONES.filter(z => !q || hit(z));
      zoneList.innerHTML = (q ? '' : `${zoneOption('', `${long(here)} · ${zoneCity(here)}`)}<li class="wt-options__sep" role="presentation"></li>`)
        + found.map(z => zoneOption(z, `${long(z)} · ${zoneName(z, ms, 'shortOffset')}`)).join('')
        + (found.length ? '' : `<li class="wt-results__msg"><b>No time zones match “${esc(zoneSearch.value.trim())}”</b>Try a big city nearby.</li>`);
      zones.mark(draft.tz || '');
    }
    zonePicker.addEventListener('click', () => { zoneSearch.value = ''; listZones(); }); // before choicePage's, which opens it
    const zones = choicePage(el, { main, page: zonePage, picker: zonePicker, onPick: z => { draft.tz = z && z !== zoneHere() ? z : null; showZone(); } });
    zoneSearch.addEventListener('input', listZones);
    function showZone() {
      const z = draft.tz || zoneHere(), name = zoneName(z, zoneAt(), 'long');
      zonePicker.querySelector('.wt-when__zone-name').textContent = draft.tz ? `${name} · ${zoneCity(z)}` : `Local time · ${name}`;
    }
    showKind();
    showNights();

    // ----- Place: the row shows the place's name and address. Tapping it opens the search page, as in Google or
    // Apple Maps: the field starts with the place's name, suggestions fill the page (each with the marker of the
    // type it would get), and tapping one fills it in and comes back. Cancel (or Esc) comes back unchanged; for a
    // new stop with no place yet, it closes the sheet. A new stop opens on this page. Picking moves the pin there.
    const placeRow = el.querySelector('[data-place-open]'), placePage = el.querySelector('.stop-place');
    const input = placePage.querySelector('#stop-place'), box = input.closest('.wt-search');
    const spinner = box.querySelector('.wt-spinner'), clear = box.querySelector('.wt-search__clear');
    const list = placePage.querySelector('.wt-results'), status = placePage.querySelector('[data-place-status]');
    const food = placePage.querySelector('[data-place-food]');

    const placeKey = p => `${(+p.lat).toFixed(4)},${(+p.lng).toFixed(4)}`;
    const cache = new Map(); // query → places, so backspacing doesn't search again
    let timer, ctrl, found = { q: '', list: [] }, phase = 'idle', failText = '';
    let opts = [], active = -1;

    const showPlace = () => {
      placeRow.innerHTML = `<span class="wt-picker__value"><span class="wt-picker__name">${esc(draft.name)}</span>${draft.address ? `<span class="wt-picker__detail">${esc(draft.address)}</span>` : ''}</span>${ICON.forward}`;
    };
    // Where this stop goes, for search to lean toward and to suggest what's on the way (see wayAround). Looked at
    // again while the page waits for the route and the sights' tiles.
    let way = null, along = { list: [], waiting: false }, alongTimer, alongUntil = 0;
    function loadAlong() {
      clearTimeout(alongTimer);
      if (placePage.hidden) return;
      way = wayAround(trip, F.time.value || defaultTime(trip, after), stop?.id);
      along = way ? sightsAlong(trip, way) : { list: [], waiting: false };
      if (input.value.trim().length < 3) paint();
      if (along.waiting && Date.now() < alongUntil) alongTimer = setTimeout(loadAlong, 1500);
    }
    // The search page takes the sheet's place, and on a phone the whole screen, like a maps app's search
    let placeScroll = 0;
    function showPlacePage(open) {
      if (open) placeScroll = el.scrollTop;
      main.hidden = open;
      placePage.hidden = !open;
      el.classList.toggle('is-full', open);
      el.scrollTop = open ? 0 : placeScroll;
      if (!open) { clearTimeout(timer); clearTimeout(alongTimer); ctrl?.abort(); spinner.hidden = true; placeRow.focus(); return; }
      // A sheet that opens on this page (a new stop) appears where it'll stay rather than sliding up: on an iPhone,
      // focusing the field while it was still below the screen panned the page down to it, and the field was left out
      // of view above, over a blank screen. It has to be focused now, in the tap, for the keyboard to come up.
      if (!$sheets.classList.contains('is-open')) el.classList.add('wt-modal--in-place');
      input.value = draft.name || '';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      alongUntil = Date.now() + 45000;
      loadAlong();
      onType();
    }
    function cancelPlace() {
      if (draft.lat == null) closeSheet(); // a new stop, with nowhere to go yet
      else showPlacePage(false);
    }
    placeRow.addEventListener('click', () => showPlacePage(true));
    placePage.querySelector('[data-place-cancel]').addEventListener('click', cancelPlace);

    function highlight(text, q) {
      const words = q.trim().split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (!words.length) return esc(text);
      let out = '', last = 0;
      for (const m of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join('|')})`, 'giu'))) {
        out += `${esc(text.slice(last, m.index))}<mark class="wt-option__match">${esc(m[0])}</mark>`;
        last = m.index + m[0].length;
      }
      return out + esc(text.slice(last));
    }
    // A result on the way says so first, in its detail line
    const optionHTML = (p, i, q) => {
      const detail = [p.on && `<span class="wt-option__tag">${way.to ? 'On the way' : 'Nearby'}</span>`, (p.detail || p.address) && esc(p.detail || p.address)].filter(Boolean).join(' · ');
      return `<div class="wt-option" role="option" id="place-opt-${i}" data-i="${i}" aria-selected="false">${markerHTML(p, '')}<span class="wt-option__text"><span class="wt-option__label">${highlight(p.name, q)}</span>${detail ? `<span class="wt-option__detail">${detail}</span>` : ''}</span></div>`;
    };

    // Draw the suggestions for what's typed now: the latest search results (kept on screen while the next search
    // runs, so the list doesn't flash), or a message that says what happened and what to try. Those on the way come
    // first, in the order search gave them, then the rest. Before anything's typed, the best known sights on the way,
    // under a heading that says which way; none of them is picked by Return until you move to it.
    function paint() {
      const q = input.value.trim(), typed = q.length >= 3;
      const results = typed
        ? found.list.map(p => ({ ...p, kind: guessKind(p.name, p.category), on: !!way && kmOff(p, way.line) <= ON_THE_WAY_KM })).sort((a, b) => b.on - a.on)
        : along.list.map(s => ({ ...s, detail: s.address || KINDS[s.kind].label }));
      let msg = '';
      if (typed && phase === 'error') msg = failText;
      else if (typed && phase === 'done' && !results.length) msg = `<b>No places match “${esc(q)}”</b>Try adding the town, or check the spelling.`;
      const head = !typed && results.length ? (way.to ? `On the way to ${way.to.name}` : `Near ${way.from.name}`) : '';
      const prev = opts[active];
      opts = results;
      list.innerHTML = (head ? `<div class="wt-results__head" role="presentation">${esc(head)}</div>` : '')
        + opts.map((p, i) => optionHTML(p, i, typed ? q : '')).join('') + (msg ? `<div class="wt-results__msg" role="presentation">${msg}</div>` : '');
      input.setAttribute('aria-expanded', String(!!opts.length));
      // Under them, before anything's typed: where to eat around there, in the maps app
      food.hidden = typed || !way || offlineNow();
      if (!food.hidden) food.href = foodURL(way.from);
      // Return picks the top match, or the one moved to with the arrows, which stays put as results arrive
      const kept = prev ? opts.findIndex(p => placeKey(p) === placeKey(prev) && p.name === prev.name) : -1;
      setActive(kept >= 0 ? kept : typed && opts.length ? 0 : -1, false);
      status.textContent = msg ? list.querySelector('.wt-results__msg').textContent
        : head ? `${head}: ${opts.length} ${opts.length === 1 ? 'place' : 'places'}` : opts.length ? `${opts.length} ${opts.length === 1 ? 'place' : 'places'}` : '';
    }
    function setActive(i, scroll = true) {
      active = i;
      list.querySelectorAll('[aria-selected="true"]').forEach(o => o.setAttribute('aria-selected', 'false'));
      const o = i >= 0 && list.querySelector(`#place-opt-${i}`);
      if (o) { o.setAttribute('aria-selected', 'true'); if (scroll) o.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', o.id); }
      else input.removeAttribute('aria-activedescendant');
    }

    function onType() {
      clear.hidden = !input.value;
      const q = input.value.trim();
      clearTimeout(timer);
      if (q.length < 3) { ctrl?.abort(); spinner.hidden = true; phase = 'idle'; found = { q: '', list: [] }; return paint(); }
      if (cache.has(q.toLowerCase())) { found = { q, list: cache.get(q.toLowerCase()) }; phase = 'done'; spinner.hidden = true; return paint(); }
      phase = 'loading';
      spinner.hidden = false;
      paint();
      timer = setTimeout(() => search(q), 250);
    }
    async function search(q) {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const list = await api(`/places?q=${encodeURIComponent(q)}${nearParam(stop || way?.from)}`, { signal: ctrl.signal });
        cache.set(q.toLowerCase(), list);
        found = { q, list };
        phase = 'done';
      } catch (e) {
        if (e.name === 'AbortError') return;
        phase = 'error';
        failText = e.code === 'rate_limited' ? '<b>Too many searches at once</b>Wait a moment, then keep typing.'
          : e.code === 'offline' ? '<b>Can’t search right now</b>Check your connection, then keep typing.' : '<b>Search isn’t working right now</b>Try again in a moment.';
      }
      spinner.hidden = true;
      if (input.value.trim() === q && !placePage.hidden) paint();
    }
    function pick(p) {
      Object.assign(draft, { lat: p.lat, lng: p.lng, address: p.address, name: p.name });
      // Another place isn't the sight it was
      if (draft.wikidata && (p.lat !== stop?.lat || p.lng !== stop?.lng)) { draft.wikidata = null; el.querySelector('.wt-about')?.remove(); }
      findItem();
      showPlace();
      status.textContent = `${p.name} picked`;
      if (draft.tz === zoneHere()) draft.tz = null; // its own zone is Local time
      showZone();
      if (!chosen) setKind(p.kind);
      showPlacePage(false); // first, so the map centers the place above the sheet's real height
      if (cur?.stops) drawMap(cur);
      focusStop(draft);
    }

    input.addEventListener('input', onType);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (opts.length) setActive(e.key === 'ArrowDown' ? (active + 1) % opts.length : active <= 0 ? opts.length - 1 : active - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0) pick(opts[active]);
      } else if (e.key === 'Escape') {
        e.stopPropagation(); // Esc is Cancel here; on the form it closes the sheet
        cancelPlace();
      }
    });
    list.addEventListener('mousedown', e => e.preventDefault()); // keep the keyboard up until a place is picked
    list.addEventListener('click', e => {
      const o = e.target.closest('[data-i]');
      if (o) pick(opts[+o.dataset.i]);
    });
    clear.addEventListener('mousedown', e => e.preventDefault());
    clear.addEventListener('click', () => {
      input.value = '';
      input.focus();
      onType();
    });
    if (draft.lat != null) showPlace();
    else showPlacePage(true); // a new stop starts by finding its place

    f.onsubmit = e => {
      e.preventDefault();
      if (draft.lat == null) return showPlacePage(true);
      const links = readLinks();
      if (!links) return;
      const hotel = draft.kind === 'hotel';
      const data = {
        name: draft.name, address: draft.address, lat: draft.lat, lng: draft.lng, time: F.time.value, tz: draft.tz || null, duration: hotel ? null : dur, note: F.note.value.trim(), links,
        kind: draft.kind, nights: hotel ? nights : null, checkout: hotel ? outTime : null,
        ...(draft.wikidata !== undefined && { wikidata: draft.wikidata }),
      };
      if (state.day !== ALL) state.day = dayOf(data); // follow the stop to its day; the overview has every day
      saved = true;
      state.draft = null; // so the list and map show the saved stop, not the draft
      if (stop) editStop(trip, stop, data); else addStop(trip, data);
      closeSheet();
      centerFocus({ force: true, animate: false }); // the saved stop, wherever its time put it, in the middle of the list
    };
    f.querySelector('[data-del]')?.addEventListener('click', () => {
      saved = true;
      closeSheet();
      deleteStop(trip, stop);
    });
  }, {
    panel: true,
    // Closed without saving: the map goes back to where it was.
    onClose: () => {
      state.draft = null;
      $app.querySelector('.trip')?.classList.remove('is-editing');
      if (!saved && map && camera) moveCamera(camera.center, camera.zoom);
      if ($app.dataset.trip && cur?.stops) render();
    },
  });
  if (stop || place) focusStop(draft);
}
