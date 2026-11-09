/* The plan's sheet on a phone: how tall it is, its motion, and dragging it. */
import { $app, $sheets, state, token } from './core.js';
import { cur } from './trips.js';
import { SNAPS, applySnap, centerFocus, currentDay, followDayTabs, isWide, listHTML, placeTabBar, setDay, setSnap, snaps, updateFades } from './timeline.js';
import { pagesOf } from './plan.js';
import { scheduleRender } from './app.js';
import { camFree, map, mapSize, refit, resizeMap, toScreen, zoomToStop } from './map.js';
import { sightOpen } from './sights.js';

// ---------- Sheet motion ----------
// The sheet's height and the list's scroll move together, frame by frame, on one timeline (--wt-duration-base,
// --wt-ease-out). A row being centered while the sheet changes height goes straight to the middle and never leaves
// the list: both are the same blend of where they start and where they end. (The sheet used to slide by a CSS
// transition and the list scrolled after it, so a row tapped on the whole day slid off the list and came back.)
// A new target part way (a second tap) starts the movement again from where everything is, with a whole quarter
// second to get there. (It used to keep the old timeline, so a tap late in a movement had only what was left of it,
// and the list jumped.) Targets asked for before the first frame, as one tap asks for the height and then the scroll,
// are one movement, and asking again for where it's already going changes nothing.
// The clock starts with the first frame, not when the movement is asked for: a tap redraws the list and the map
// before any frame, and on a slow phone that took up the start of the quarter second, so the first frame jumped.
// The list's scroll always has a target, even when only the height is changing: a taller list has less room to
// scroll, so near the end of the day the browser would cut the scroll back part way through the movement, and the
// list would seem to scroll by itself, its rows riding with the sheet and then stopping short. Instead the scroll goes,
// on the same timeline, to the nearest place it can be at the new height; on the way, it's always within its room.
function cubicBezier(x1, y1, x2, y2) {
  const at = (a, b, u) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  return t => {
    if (t <= 0 || t >= 1) return Math.max(0, Math.min(1, t));
    let lo = 0, hi = 1, u = t;
    for (let i = 0; i < 24; i++) { u = (lo + hi) / 2; if (at(x1, x2, u) < t) lo = u; else hi = u; }
    return at(y1, y2, u);
  };
}
const sheetEase = cubicBezier(0.2, 0.8, 0.2, 1); // --wt-ease-out
export const motion = { raf: 0, t0: null, dur: 0, h0: 0, h1: null, s0: 0, s1: null };
const FRAME = 1000 / 60;
// What floats over the map (Whole day) rides with the sheet.
export const setBottom = h => $app.querySelector('.trip-fit')?.style.setProperty('--bottom-h', `${h}px`);
export function setSheetHeight(h) {
  const sheet = $app.querySelector('.wt-sheet');
  if (!sheet) return;
  sheet.style.height = `${h}px`;
  setBottom(h);
}
// Where the sheet is going: the end of a movement under way, or else where it is.
export const sheetTarget = () => (motion.raf && motion.h1 != null ? motion.h1 : $app.querySelector('.wt-sheet')?.offsetHeight || 0);
export function stopMotion() {
  cancelAnimationFrame(motion.raf);
  motion.raf = 0;
  setRoom(false);
}
// How tall the list's rows are, with its padding. Not scrollHeight: that's never less than the list itself (with the
// whole day showing, a short day looked as tall as the list, and there seemed to be room to scroll that wasn't there),
// and it counts the room the list is given while the sheet moves.
export function listContentHeight(body) {
  const last = body.lastElementChild;
  if (!last) return 0;
  const end = last.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop;
  return end + (parseFloat(getComputedStyle(body).paddingBottom) || 0);
}
// While the sheet moves, the list has room to scroll past its last row (--sheet-room, styles.css): enough for any
// height between half and full. Where a short day doesn't fill the list, its scroll would otherwise have to wait for
// the list to come down to its rows, and they'd ride with the sheet and then stop. Every movement ends where the list
// can scroll without the room (see moveSheet), so taking it away moves nothing.
function setRoom(on) {
  const body = $app.querySelector('.wt-sheet__body'), s = on && snaps();
  body?.style.setProperty('--sheet-room', s ? `${s.full - s.half}px` : '0px');
}
// The furthest the list can scroll with the sheet at height `h` (`chrome`: the sheet's top and add bar, see snaps)
const maxScrollAt = (body, h, chrome) => Math.max(0, listContentHeight(body) - (h - chrome));
// Where the list is scrolled to, as the app has it. Movements set off from here, not from the list's scrollTop:
// on an iPhone, replacing the list's rows could leave its scrollTop at the end of the list for a moment, and a
// movement that read it there went from the end of the list back to its row. The list follows listTop; only you,
// scrolling the whole day or the side panel by hand, move listTop by scrolling the list.
export let listTop = 0;
export function setListTop(s) {
  listTop = s;
  const body = $app.querySelector('.wt-sheet__body');
  if (body && Math.abs(body.scrollTop - s) >= 0.5) body.scrollTop = s;
}
export function onListScroll() {
  const body = $app.querySelector('.wt-sheet__body');
  if (!body) return;
  // you scrolled it: the whole day or the side panel, while the app isn't moving it
  if ((state.snap === 'full' || isWide()) && !motion.raf && !drag.moved) listTop = body.scrollTop;
  // anything else (at half nothing scrolls it by hand) is put back
  else if (Math.abs(body.scrollTop - listTop) >= 1) body.scrollTop = listTop;
  updateFades();
}
// A movement under way keeps the list's scroll at `s` from now on (a new day, or a scroll placed at once)
export function holdScroll(s) {
  if (motion.raf) motion.s0 = motion.s1 = s;
}
// Move the sheet to height `h` and/or the list to scroll position `s`; leave either out to keep where it's going.
export function moveSheet({ h, s }) {
  const sheet = $app.querySelector('.wt-sheet'), body = sheet?.querySelector('.wt-sheet__body');
  if (!sheet) return;
  const running = !!motion.raf;
  let h1 = h !== undefined ? h : running ? motion.h1 : null;
  let s1 = s !== undefined ? s : running ? motion.s1 : null;
  // where the list's scroll can be at the new height: where it's going, or else where it is, cut back to its room
  if (h1 != null) s1 = Math.min(s1 ?? listTop, maxScrollAt(body, h1, snaps().chrome));
  const same = (a, b) => (a == null ? b == null : b != null && Math.abs(a - b) < 0.5);
  if (running && same(h1, motion.h1) && same(s1, motion.s1)) return; // already on its way there
  const dur = parseFloat(token('--wt-duration-base')) || 0;
  if (!dur) { // reduced motion: straight there
    stopMotion();
    if (h1 != null) setSheetHeight(h1);
    if (s1 != null) setListTop(s1);
    return;
  }
  // from where everything is now, with the clock to start on the next frame
  Object.assign(motion, { t0: null, dur, h0: parseFloat(sheet.style.height) || sheet.offsetHeight, s0: listTop, h1, s1 });
  setRoom(h1 != null);
  if (!running) motion.raf = requestAnimationFrame(motionFrame);
}
// Timed by performance.now(), as moveSheet is, not by the frame's timestamp: that's when the frame began, which can be
// before the movement was asked for.
function motionFrame() {
  const sheet = $app.querySelector('.wt-sheet'), body = sheet?.querySelector('.wt-sheet__body');
  if (!sheet) { motion.raf = 0; return; }
  const now = performance.now();
  if (motion.t0 == null) motion.t0 = now - FRAME; // the first frame is a frame in
  const p = Math.max(0, Math.min(1, (now - motion.t0) / motion.dur)), q = sheetEase(p);
  // height first, then the scroll, so the frame is laid out once
  if (motion.h1 != null) setSheetHeight(motion.h0 + (motion.h1 - motion.h0) * q);
  if (motion.s1 != null) setListTop(motion.s0 + (motion.s1 - motion.s0) * q);
  motion.raf = p < 1 ? requestAnimationFrame(motionFrame) : 0;
  if (!motion.raf && !drag.moved) setRoom(false);
}

// ---------- Dragging the sheet ----------
// The sheet follows the finger once a frame. The height range is measured once, when the drag starts.
// Dragged up, the list has less room to scroll the taller it gets. Near the end of the day, the browser cut its
// scroll back as soon as it ran out, so the rows rode up with the finger and then stopped, and the list seemed to scroll
// by itself. Instead the scroll comes down evenly with the height, from where it was to where it can be at full.
export const drag = { active: false, moved: false, list: null, mode: null, y0: 0, h0: 0, y: 0, s: null, sc0: 0, scFull: 0, pts: [], frame: 0, suppressClick: false };
function dragStart(y, list) {
  cancelAnimationFrame(drag.frame);
  Object.assign(drag, { active: true, moved: false, list, mode: list ? null : 'sheet', y0: y, y, h0: 0, s: null, pts: [], frame: 0 });
}
const dragHeight = () => Math.max(drag.s.half, Math.min(drag.s.full, drag.h0 + drag.y0 - drag.y));
function dragTo(h) {
  setSheetHeight(h);
  const body = $app.querySelector('.wt-sheet__body');
  const sc = h > drag.h0 ? drag.sc0 + (drag.scFull - drag.sc0) * (h - drag.h0) / Math.max(1, drag.s.full - drag.h0) : drag.sc0;
  if (body) setListTop(sc);
}
function dragMove(y) {
  const now = performance.now();
  drag.pts.push([now, y]);
  while (drag.pts.length > 2 && now - drag.pts[0][0] > 100) drag.pts.shift();
  drag.y = y;
  if (!drag.moved) {
    if (Math.abs(drag.y0 - y) < 6) return;
    // From here the sheet follows the finger: stop any movement under way and pick it up where it is.
    const sheet = $app.querySelector('.wt-sheet');
    stopMotion();
    Object.assign(drag, { moved: true, h0: sheet.offsetHeight, y0: y, s: snaps() });
    sheet.classList.add('is-dragging');
    const body = sheet.querySelector('.wt-sheet__body');
    drag.sc0 = listTop;
    drag.scFull = Math.min(drag.sc0, maxScrollAt(body, drag.s.full, drag.s.chrome));
    setRoom(true);
  }
  if (!drag.frame) drag.frame = requestAnimationFrame(() => { drag.frame = 0; if (drag.active) dragTo(dragHeight()); });
}
function dragEnd() {
  drag.active = false;
  cancelAnimationFrame(drag.frame);
  drag.frame = 0;
  const sheet = $app.querySelector('.wt-sheet');
  if (!sheet || !drag.moved) return;
  const s = drag.s, h = dragHeight();
  dragTo(h);
  drag.moved = false;
  sheet.classList.remove('is-dragging');
  // The finger's speed over its last 100ms (none if it rested before letting go), up is positive.
  // A flick goes on to the next height its way; a slower drag settles at the nearest one.
  const now = performance.now(), pts = drag.pts.filter(p => now - p[0] <= 100);
  const v = pts.length > 1 ? (pts[0][1] - pts.at(-1)[1]) / Math.max(1, pts.at(-1)[0] - pts[0][0]) : 0;
  const snap = v > 0.4 ? SNAPS.find(k => s[k] > h + 1) || 'full'
    : v < -0.4 ? [...SNAPS].reverse().find(k => s[k] < h - 1) || 'half'
      : SNAPS.reduce((a, k) => (Math.abs(s[k] - h) < Math.abs(s[a] - h) ? k : a));
  setSnap(snap);
  drag.suppressClick = true;
  setTimeout(() => { drag.suppressClick = false; }, 50);
}
// The sheet's top (grab handle and day bar), with a finger or a mouse
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.wt-sheet__top') || isWide()) return;
  dragStart(e.clientY, null);
});
document.addEventListener('pointermove', e => { if (drag.active && !drag.list) dragMove(e.clientY); });
for (const t of ['pointerup', 'pointercancel']) document.addEventListener(t, () => { if (drag.active && !drag.list) dragEnd(); });
// The list, with a finger: below full it moves the sheet (it can't scroll there); at full, only a pull down from
// its top does, and otherwise it scrolls as usual. A sideways swipe turns the page (see below), on a wide screen too.
// The rest of the touch is followed on the element it started on: a render can replace the row under the finger, and
// the touchmove and touchend of a row that's been taken out of the page no longer reach the document, so the sheet
// (or the page) was left where the finger had it.
let touchEl = null;
function unfollowTouch() {
  if (!touchEl) return;
  touchEl.removeEventListener('touchmove', onTouchMove);
  for (const t of ['touchend', 'touchcancel']) touchEl.removeEventListener(t, onTouchEnd);
  touchEl = null;
}
document.addEventListener('touchstart', e => {
  const list = e.target.closest?.('.wt-sheet__body');
  if (!list || e.touches.length > 1 || swipe.busy) return;
  dragStart(e.touches[0].clientY, list);
  drag.x0 = e.touches[0].clientX;
  unfollowTouch();
  touchEl = e.target;
  touchEl.addEventListener('touchmove', onTouchMove, { passive: false });
  for (const t of ['touchend', 'touchcancel']) touchEl.addEventListener(t, onTouchEnd);
}, { passive: true });
function onTouchMove(e) {
  if (!drag.active || !drag.list) return;
  const y = e.touches[0].clientY, dy = drag.y0 - y, dx = e.touches[0].clientX - drag.x0;
  if (!drag.mode) {
    // Nothing is claimed until the finger has clearly gone one way. On an iPhone, holding back a touch's first move
    // stops the list scrolling for the whole touch, and a finger setting off up the list often first moves a pixel
    // down: a pull down from the top used to be claimed at once, so the first swipe up the whole day from its top
    // did nothing, and it took a second. A pull down the browser has started scrolling doesn't bounce the list
    // instead of moving the sheet: at its top, the whole day has no overscroll (styles.css).
    // Sideways has to be clearly sideways (half as much again as it's gone up or down), so a drag up that wobbles
    // doesn't turn the page.
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax >= 8 && ax > ay * 1.5) drag.mode = canSwipe() ? 'page' : 'none';
    else if (ay >= 6 && ay >= ax) drag.mode = isWide() ? 'scroll' : state.snap !== 'full' || (dy < 0 && drag.list.scrollTop <= 1) ? 'sheet' : 'scroll';
    else return;
  }
  if (drag.mode === 'page') { if (e.cancelable) e.preventDefault(); swipeMove(dx); return; }
  if (drag.mode !== 'sheet') return;
  if (e.cancelable) e.preventDefault();
  dragMove(y);
}
function onTouchEnd() {
  unfollowTouch();
  if (!drag.active || !drag.list) return;
  if (drag.mode === 'page') swipeEnd(); else dragEnd();
}

// ---------- Swiping between pages ----------
// A sideways swipe on the list turns the page: Overview, then each day, in the tabs' order. The list follows the
// finger with the next page coming in beside it, and the bar under the tabs slides along with them. Let go more than a
// quarter of the way across, or flick, and it carries on to that page; otherwise it slides back. Past the first or
// last page it gives a little and comes back. The map changes once the page has.
const swipe = { peek: null, to: null, dir: 0, w: 0, x: 0, pts: [], busy: false, held: false };
// A render while the page is being swiped waits for the swipe to end (see render), so the rows and the tabs' bar stay
// where the finger has them.
export function holdRender() {
  if (!swipe.w && !swipe.busy) return false;
  swipe.held = true;
  return true;
}
function canSwipe() {
  const trip = cur?.stops ? cur : null;
  return !!trip && !state.draft && !swipe.busy && pagesOf(trip).length > 1;
}
// The page coming in: the next (dir 1) or previous (-1) page's rows, drawn beside the list, for the length of the swipe
function showPeek(trip, body) {
  swipe.peek?.remove();
  swipe.peek = null;
  if (!swipe.to) return;
  const p = document.createElement('div');
  p.className = 'wt-sheet__peek wt-tl';
  p.inert = true;
  p.setAttribute('aria-hidden', 'true');
  Object.assign(p.style, { top: `${body.offsetTop}px`, height: `${body.offsetHeight}px` });
  const sel = [state.sel, state.selRow];
  state.sel = state.selRow = null; // a new page opens with nothing selected
  p.innerHTML = listHTML(trip, swipe.to);
  [state.sel, state.selRow] = sel;
  body.after(p);
  swipe.peek = p;
}
function swipeMove(dx) {
  const trip = cur, body = $app.querySelector('.wt-sheet__body');
  if (!body) return;
  if (!swipe.w) { swipe.w = body.offsetWidth; stopMotion(); }
  const pages = pagesOf(trip), i = pages.indexOf(currentDay(trip)), dir = dx < 0 ? 1 : dx > 0 ? -1 : swipe.dir;
  if (dir && dir !== swipe.dir) { swipe.dir = dir; swipe.to = pages[i + dir] || null; showPeek(trip, body); }
  const now = performance.now();
  swipe.pts.push([now, dx]);
  while (swipe.pts.length > 2 && now - swipe.pts[0][0] > 100) swipe.pts.shift();
  swipe.x = swipe.to ? dx : dx / 3;
  body.style.transform = `translateX(${swipe.x}px)`;
  if (swipe.peek) swipe.peek.style.transform = `translateX(${swipe.x + swipe.dir * swipe.w}px)`;
  followDayTabs(swipe.to, Math.min(1, Math.abs(swipe.x) / swipe.w));
}
function swipeEnd() {
  drag.active = false;
  const body = $app.querySelector('.wt-sheet__body'), { to, dir, w, x } = swipe;
  if (!body || !w) { endSwipe(); return; }
  // the finger's speed over its last 100ms, in px/ms, rightward positive
  const now = performance.now(), pts = swipe.pts.filter(p => now - p[0] <= 100);
  const v = pts.length > 1 ? (pts.at(-1)[1] - pts[0][1]) / Math.max(1, pts.at(-1)[0] - pts[0][0]) : 0;
  const go = !!to && x * dir < 0 && (Math.abs(x) > w / 4 || v * dir < -0.3);
  const end = go ? -dir * w : 0, opts = { duration: parseFloat(token('--wt-duration-base')) || 0, easing: token('--wt-ease-out') || 'ease-out', fill: 'forwards' };
  swipe.busy = true;
  drag.suppressClick = true;
  setTimeout(() => { drag.suppressClick = false; }, 50);
  const slide = (el, off) => el.animate([{ transform: `translateX(${x + off}px)` }, { transform: `translateX(${end + off}px)` }], opts);
  const runs = [slide(body, 0)];
  if (swipe.peek) runs.push(slide(swipe.peek, dir * w));
  if (!go) placeTabBar(true);
  const done = () => {
    const peek = swipe.peek, held = swipe.held;
    swipe.peek = null;
    endSwipe();
    body.style.transform = '';
    // the new page's rows, its tab, and its map, drawn before the slide's last frame is let go
    if (go) setDay(to); else if (held) scheduleRender();
    for (const r of runs) r.cancel();
    peek?.remove();
  };
  Promise.all(runs.map(r => r.finished)).then(done, done);
}
function endSwipe() {
  swipe.peek?.remove();
  Object.assign(swipe, { peek: null, to: null, dir: 0, w: 0, x: 0, pts: [], busy: false, held: false });
}
document.addEventListener('click', e => {
  if (drag.suppressClick) { drag.suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
}, true);
// iPhone: the keyboard scrolls the window to show the field being typed in, and with the page's own scrolling off while a
// trip is open, Safari and Chrome can leave it scrolled once the keyboard's gone. The trip screen, pinned to the window,
// then sits too high: its header under the address bar and a gap under the sheet. Put the window back at the top whenever
// it has moved and nothing is being typed in (not while zoomed in: that's the person's own doing).
function unshiftTrip() {
  if ($app.dataset.page !== 'trip' || document.activeElement?.matches('input, textarea, select, [contenteditable]')) return;
  const vv = window.visualViewport;
  if (vv && vv.scale > 1.01) return;
  if (scrollX || scrollY || vv?.offsetTop || vv?.offsetLeft) scrollTo(0, 0);
}
addEventListener('scroll', unshiftTrip);
window.visualViewport?.addEventListener('resize', unshiftTrip);
window.visualViewport?.addEventListener('scroll', unshiftTrip);
document.addEventListener('focusout', () => requestAnimationFrame(unshiftTrip));
addEventListener('resize', () => {
  $sheets.classList.toggle('wt-modal-root--side', isWide());
  if (!$app.dataset.trip) return;
  applySnap();
  centerFocus({ animate: false });
  if (map) {
    resizeMap();
    // The day, or the drive on show, re-fits the new size. A map you've moved, or brought to a stop, keeps its zoom
    // and what's in its middle, with the selected stop brought back into view if the new size hid it. (Turning the
    // phone used to throw the zoom away and show the whole day again.)
    const s = camFree && state.sel && cur?.stops?.find(x => x.id === state.sel);
    if (!camFree) refit();
    else if (s) zoomToStop(s, 0);
  }
  scheduleRender();
});

// How much of the map's bottom is covered: by the open stop's sheet, or else by the list. At full the map
// doesn't show, so the camera is placed for half, where the list goes back to. Nothing covers the map on a wide screen.
export function coveredBottom() {
  if (isWide()) return 0;
  const panel = (state.draft || sightOpen) && $sheets.querySelector('.wt-modal');
  return panel ? panel.offsetHeight : snaps().half;
}
// The header card covers the map's top on a phone; on a wide screen it sits in the side panel.
export const headBottom = () => { const h = $app.querySelector('.wt-trip-head'); return h.offsetTop + h.offsetHeight; };
export const coveredTop = () => (isWide() ? 0 : headBottom());
// Is this point in the part of the map you can see, with room to spare for its label?
export function inView(ll, margin = 40) {
  const top = coveredTop();
  const p = toScreen(ll), size = mapSize();
  return p.x > margin && p.x < size.x - margin && p.y > top + margin && p.y < size.y - coveredBottom() - margin;
}
