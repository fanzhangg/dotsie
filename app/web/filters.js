/* Filters, as Spots and Guides have them (see Filter in the design system): a row of chips, each of which drops its
   choices down as a menu under it. The pages keep what's set and what's on offer; this is the chip and its menu. */
import { ICON, esc } from './core.js';

// ---------- A filter's menu: its choices, dropped down under it ----------
// Tapping a filter drops its choices down under it, rather than the phone's own picker, whose wheel or popover is hard
// to aim at in a list of hundreds of cities, and opens wherever the phone puts it. On a phone the menu is as wide as
// the page, just under the row of filters; on a computer, under the filter. A long list (State, City) has a search at
// its top, which on a computer has the focus. Picking one applies it and closes the menu; Esc, a tap outside or
// tabbing away closes it with nothing changed. ↑ ↓ move between choices, and from the search to them; Return in the
// search picks the first that matches. See "Filter" in the design system.
export const FILTER_NAMES = { kind: 'Type', country: 'Country', state: 'State', city: 'City', sort: 'Sort' };
const PLURALS = { kind: 'types', country: 'countries', state: 'states', city: 'cities' };
const SEARCH_FROM = 12; // choices, for a search at the top
// The open one: { name, chip, el, choices, value, pick }. One at a time, on whichever page.
let menu = null;
export const menuOpen = () => !!menu;
const wide = matchMedia('(min-width: 768px)');
const fold = t => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function openHTML(name) {
  return `<button type="button" class="wt-filter__open" aria-label="${FILTER_NAMES[name]}" aria-haspopup="true" aria-expanded="false"></button>`;
}
// A filter chip (Type, Country, State, City): its name or what it's set to, the chevron, the button over it that opens
// its menu, and the × that clears it
export const chipHTML = (name, label) => `<div class="wt-filter" data-filter="${name}"><span class="wt-filter__value">${label}</span>${ICON.chevronDown}${openHTML(name)}<button type="button" class="wt-filter__clear" data-clear="${name}" aria-label="Clear ${label}" title="Clear" hidden>${ICON.close}</button></div>`;
// Opens chip's menu, or closes it if it's open. choices(): what it offers ({ value, text, meta, off }), value(): what
// it's set to, pick(value): what picking one does. It hangs from the chip's band (.spots-band) or row (.spots-head).
export function toggleMenu(chip, { choices, value, pick }) {
  const was = menu?.chip === chip;
  closeMenu(was);
  if (was) return;
  const name = chip.dataset.filter, host = chip.closest('.spots-band, .spots-head');
  const el = document.createElement('div');
  el.className = 'wt-menu wt-filter-menu';
  el.innerHTML = `${choices().length > SEARCH_FROM ? `<label class="wt-input wt-input-group wt-search wt-filter-menu__search">${ICON.search}<input type="search" aria-label="Search ${PLURALS[name]}" placeholder="Search ${PLURALS[name]}" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search" maxlength="60"></label>` : ''}<ul class="wt-options" role="radiogroup" aria-label="${FILTER_NAMES[name]}"></ul>`;
  host.append(el);
  menu = { name, chip, el, choices, value, pick };
  chip.querySelector('.wt-filter__open').setAttribute('aria-expanded', 'true');
  chip.scrollIntoView({ block: 'nearest', inline: 'nearest' }); // the whole of it in the row, for the menu to hang from
  listMenu();
  place();
  const search = el.querySelector('input'), on = el.querySelector('[aria-checked="true"]') || el.querySelector('[data-value]:not(:disabled)');
  if (on) el.querySelector('.wt-options').scrollTop = on.offsetTop - el.querySelector('.wt-options').clientHeight / 2 + on.offsetHeight / 2;
  // A computer's keyboard is there to type with; on a phone the search waits for a tap, so the keyboard doesn't cover the list
  (search && wide.matches ? search : on)?.focus({ preventScroll: true });
  search?.addEventListener('input', listMenu);
  el.addEventListener('keydown', menuKeys);
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-value]');
    if (!b || b.disabled) return;
    closeMenu();
    pick(b.dataset.value);
  });
  el.addEventListener('focusout', e => {
    if (menu?.el === el && e.relatedTarget && !el.contains(e.relatedTarget) && !chip.contains(e.relatedTarget)) closeMenu(false);
  });
  document.addEventListener('pointerdown', outside, true);
  visualViewport?.addEventListener('resize', place);
  addEventListener('resize', place);
}
export function closeMenu(refocus = true) {
  if (!menu) return;
  const { chip, el } = menu;
  menu = null;
  el.remove();
  document.removeEventListener('pointerdown', outside, true);
  visualViewport?.removeEventListener('resize', place);
  removeEventListener('resize', place);
  const open = chip.querySelector('.wt-filter__open');
  open.setAttribute('aria-expanded', 'false');
  if (refocus) open.focus({ preventScroll: true });
}
function outside(e) { if (menu && !menu.el.contains(e.target) && !menu.chip.contains(e.target)) closeMenu(false); }
// The choices, those that match the search if it has anything in it, the one it's set to ticked
function listMenu() {
  const { name, el, choices, value } = menu, input = el.querySelector('input'), q = fold(input?.value ?? '');
  const shown = choices().filter(c => !q || (c.value && fold(c.text).includes(q)));
  el.querySelector('.wt-options').innerHTML = shown.map(c => `<li><button type="button" class="wt-option" role="radio" data-value="${esc(c.value)}" aria-checked="${c.value === value()}"${c.off ? ' disabled' : ''}><span class="wt-option__text"><span class="wt-option__label">${esc(c.text)}</span></span>${c.meta != null ? `<span class="wt-option__meta">${c.meta}</span>` : ''}${ICON.check}</button></li>`).join('')
    || `<li class="wt-results__msg"><b>No ${PLURALS[name]} match “${esc(input.value.trim())}”</b>Try fewer letters.</li>`;
}
// Under the filter it hangs from, its top 4px below, lined up with one of its edges; on a phone, across the page's column. It goes no lower than the
// screen (or what the keyboard leaves of it), and scrolls inside.
// What it offers may have changed under it (a type's count, say): listed again
export function relistMenu() { if (menu) listMenu(); }
export function place() {
  if (!menu) return;
  const { chip, el } = menu, host = el.parentElement, cs = getComputedStyle(host);
  const h = host.getBoundingClientRect(), c = chip.getBoundingClientRect();
  const min = parseFloat(cs.paddingLeft) || 0, max = h.width - (parseFloat(cs.paddingRight) || 0);
  const width = wide.matches ? Math.min(Math.max(c.width, 280), max - min) : max - min;
  el.style.width = `${width}px`;
  // From the filter's left edge, or, where that would run past the column, back from its right edge
  const from = c.left - h.left + width <= max ? c.left - h.left : c.right - h.left - width;
  el.style.left = `${Math.max(min, Math.min(from, max - width))}px`;
  el.style.top = `${c.bottom - h.top + 4}px`;
  const bottom = (visualViewport?.height ?? innerHeight) + (visualViewport?.offsetTop ?? 0);
  el.style.maxHeight = `${Math.max(160, Math.min(420, bottom - c.bottom - 4 - 12))}px`;
}
function menuKeys(e) {
  const { el } = menu, input = el.querySelector('input');
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
  const all = [...el.querySelectorAll('[data-value]:not(:disabled)')];
  if (e.key === 'Enter' && e.target === input) { e.preventDefault(); all[0]?.click(); return; }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const i = all.indexOf(document.activeElement), down = e.key === 'ArrowDown';
  if (i < 0) { all[down ? 0 : all.length - 1]?.focus(); return; }
  if (!down && i === 0 && input) { input.focus(); return; }
  all[(i + (down ? 1 : all.length - 1)) % all.length].focus();
}
