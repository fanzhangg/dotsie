/* Spots: the guide's places, open to anyone, signed in or not. #/spots lists them, most viewed first (in the guide's
   own order once a city is picked), with a search, filters for type, country, state and city, and an order (most
   viewed, nearest, A to Z), kept in the address (#/spots?q=…&kind=nature&state=WA&city=seattle&sort=near&page=2) so it
   can be reloaded, sent and gone back through.
   #/spots/<city>/<source>/<id> is one spot's guide entry, a page of its own with no app bar, its sources and other
   pages about it listed at the end. The entries are written by a model from the sources each lists
   (pipeline/guides.py) and published under CC BY-SA 4.0. */
import { $app, ICON, appBarHTML, avatarHTML, esc, failHint, uid } from './core.js';
import { api } from './backend.js';
import { me } from './signin.js';
import { MAPS_APPS, mapsApp, placeURL } from './routes.js';
import { regionName } from './regions.js';
import { IDEAS, dayOf, findIdea, findStop, guessKind } from './plan.js';
import { MAX, QID } from './fields.js';
import { fmtDay, nowStamp } from './time.js';
import { tripDates } from './home.js';
import { openTripOn } from './timeline.js';
import { closeSheet, modalHead, openSheet } from './sheets.js';
import { failToast, toast } from './notices.js';
import { SPOT_KINDS, kmBetween, spotKind } from './spotkinds.js';

const countryName = (() => {
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
  return code => { try { return names?.of(code) ?? code; } catch { return code; } };
})();
// "2.1M", "48k", "950": how many times its Wikipedia article was read in the last 12 months
const views = n => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US');
const credit = img => `${img.caption ? `${esc(img.caption)}: ` : ''}${esc(img.author || 'Unknown author')}, ${esc(img.licence || 'see Commons')}, via <a href="${esc(img.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
const SOURCE_KIND = { wikipedia: 'Wikipedia', 'official website': 'Official website', 'National Park Service': 'National Park Service' };
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

// What's asked and what's shown, kept while you go to a spot and back, or to Plan and back. `query` is the address's
// part after ?, as this state writes it: a different one (Back, Forward, a link) is asked again.
// `kinds`: how many of each type the search and the place filters hold, for the Type filter. `sort`: '' for the usual
// order, else 'views' (in a city), 'near' or 'name'. `near`: where you are, once asked for Nearest ("47.61,-122.33").
const s = { q: '', kind: '', country: '', state: '', city: '', sort: '', page: 1, query: null, cities: null, kinds: null, near: null,
  locating: false, results: [], more: false, total: 0, loaded: false, asked: 0, key: null, scroll: 0, fromList: false, title: 'Spots · Dotsie' };
const FILTERS = ['kind', 'country', 'state', 'city']; // what narrows the list, besides the search
let timer = 0, busy = 0;

// ---------- The page ----------
// The app bar, as Home has it: the nav, and the account (or Sign in). The list, and a spot's entry over it, are filled
// in by script and kept while the page is open, so going back to the list finds it as it was.
const headHTML = () => appBarHTML('spots', me
  ? `<button class="wt-icon-btn" data-action="account" aria-label="Account">${avatarHTML({ name: me.name, image: me.image, identity: 1 })}</button>`
  : '<a class="wt-btn wt-btn--secondary" href="#/">Sign in</a>');

export function renderSpots(r) {
  if (!$app.querySelector('.spots')) mount();
  else $app.querySelector('.wt-app-bar').outerHTML = headHTML(); // signed in or out since
  if (!me) myTrips = null;
  // A spot is a page of its own, to read: no app bar, one column (see #app[data-page="spot"] in styles.css)
  $app.dataset.page = r.page === 'spot' ? 'spot' : 'spots';
  $app.querySelector('.wt-app-bar').hidden = r.page === 'spot';
  stickUnderBar(); // once the page's own layout applies
  const list = $app.querySelector('.spots-list'), entry = $app.querySelector('.spots-entry');
  document.title = r.page === 'spot' ? s.title : 'Spots · Dotsie';
  if (r.page === 'spot') {
    if (!list.hidden) s.scroll = scrollY;
    list.hidden = true;
    entry.hidden = false;
    showEntry(r);
    return;
  }
  entry.hidden = true;
  entry.innerHTML = '';
  s.key = null;
  const back = list.hidden;
  list.hidden = false;
  if ((r.query ?? '') !== s.query) { // a new address: what it asks for
    readQuery(r.query ?? '');
    search(s.page).then(() => { if (s.page > 1) list.scrollIntoView({ block: 'start' }); });
  } else if (back) scrollTo(0, s.scroll);
}

// Under the search and the filters, how many, and across from it the order, where it's in sight however many filters
// the row holds
function mount() {
  $app.innerHTML = `
    ${headHTML()}
    <main class="home spots">
      <section class="spots-list" aria-label="Spots">
        <div class="spots-find spots-band">
          <label class="wt-input wt-input-group wt-search">${ICON.search}
            <input type="search" name="q" placeholder="Search spots, cities or states" aria-label="Search spots" autocomplete="off">
            <span class="wt-spinner" hidden></span>
            <button type="button" class="wt-search__clear" aria-label="Clear search" hidden>${ICON.close}</button></label>
          <div class="spots-filters">${[['kind', 'Type'], ['country', 'Country'], ['state', 'State'], ['city', 'City']].map(([name, label]) =>
            `<label class="wt-filter" data-filter="${name}"><span class="wt-filter__value">${label}</span>${ICON.chevronDown}<select name="${name}" aria-label="${label}"></select><button type="button" class="wt-filter__clear" data-clear="${name}" aria-label="Clear ${label}" title="Clear" hidden>${ICON.close}</button></label>`).join('')}
            <button type="button" class="wt-filter wt-filter--action spots-clear" hidden>Clear all</button></div>
        </div>
        <div class="spots-head"><p class="spots-count" role="status"></p>
          <label class="wt-filter wt-filter--plain" data-filter="sort"><span class="wt-filter__value">Most viewed</span>${ICON.chevronUpDown}<select name="sort" aria-label="Sort"></select></label></div>
        <div class="home-grid spots-grid"></div>
        <button type="button" class="wt-btn wt-btn--secondary spots-more" hidden>Show more</button>
        <nav class="wt-pager spots-pager" aria-label="Pages of spots" hidden></nav>
        <p class="spots-note"></p>
      </section>
      <section class="spots-entry" hidden></section>
    </main>`;
  const list = $app.querySelector('.spots-list'), input = list.querySelector('[name="q"]');
  input.addEventListener('input', () => {
    s.q = input.value;
    showClear();
    clearTimeout(timer);
    timer = setTimeout(() => { writeQuery(); search(); }, 250);
  });
  // Enter searches now, rather than after the pause, and on a phone puts the keyboard away, to see the spots it found
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    clearTimeout(timer);
    writeQuery();
    search();
    if (coarse.matches) input.blur();
  });
  list.querySelector('.wt-search__clear').addEventListener('click', e => {
    e.preventDefault();
    input.value = s.q = '';
    showClear();
    input.focus();
    writeQuery();
    search();
  });
  const filters = list.querySelector('.spots-filters');
  for (const el of [filters, list.querySelector('.spots-head')]) el.addEventListener('change', e => pick(e.target.name, e.target.value));
  filters.addEventListener('click', e => {
    // A set filter's ×: back to every one, with the focus on the filter, as the × is gone
    const x = e.target.closest('[data-clear]');
    if (x) { e.preventDefault(); pick(x.dataset.clear, ''); filters.querySelector(`select[name="${x.dataset.clear}"]`)?.focus(); }
    if (e.target.closest('.spots-clear')) clearAll();
  });
  list.querySelector('.spots-more').addEventListener('click', () => search('more'));
  list.querySelector('.spots-pager').addEventListener('click', e => {
    const to = e.target.closest('[data-page]');
    if (!to || to.disabled || +to.dataset.page === s.page) return;
    s.page = +to.dataset.page;
    writeQuery(true); // a page of its own in the history, so Back goes to the page before
    search(s.page).then(() => list.scrollIntoView({ block: 'start' }));
  });
  list.addEventListener('click', e => {
    if (e.target.closest('.wt-spot-card__link')) s.fromList = true;
    if (e.target.closest('[data-retry]')) search(s.page);
    if (e.target.closest('[data-unfilter]')) clearAll({ keepSearch: true });
    if (e.target.closest('[data-unsearch]')) list.querySelector('.wt-search__clear').click();
  });
  $app.querySelector('.spots-entry').addEventListener('click', e => {
    // Back to the list you came from, as it was; from a link someone sent, to the list
    if (e.target.closest('.wt-guide__back') && s.fromList) { e.preventDefault(); s.fromList = false; history.back(); }
  });
  s.query = s.key = null; // asked again: renderSpots reads the address, and shows the spot afresh
  if (!s.cities) loadCities(); else renderFilters();
  if (s.results.length) showResults(); // as it was, while it's asked again
  markSaved();
}
// The search and the filters stay at the top of the list as it scrolls, just under the app bar, whatever height the
// bar is (the phone's safe area adds to it), or at the very top while a phone's bar is tucked away: see .spots-band
// in styles.css
function stickUnderBar() {
  const bar = $app.querySelector('.wt-app-bar');
  if (bar && !bar.hidden) $app.style.setProperty('--spots-stick', `${bar.offsetHeight}px`);
}
addEventListener('resize', () => { if ($app.dataset.page === 'spots') stickUnderBar(); });
const showClear = () => { const b = $app.querySelector('.wt-search__clear'); if (b) b.hidden = !s.q; };
const coarse = matchMedia('(pointer: coarse)');

// ---------- The address: what's asked, after #/spots? ----------
function readQuery(query) {
  const p = new URLSearchParams(query), sort = p.get('sort') ?? '';
  Object.assign(s, { q: p.get('q') ?? '', kind: spotKind(p.get('kind') ?? '') ? p.get('kind') : '', country: p.get('country') ?? '',
    state: p.get('state') ?? '', city: p.get('city') ?? '', page: wide.matches ? Math.max(1, Number.parseInt(p.get('page') ?? '1', 10) || 1) : 1, query });
  s.sort = sortsFor().some(([v]) => v && v === sort) ? sort : '';
  const input = $app.querySelector('.spots-list [name="q"]');
  if (input) input.value = s.q;
  showClear();
  renderFilters();
  if (s.sort === 'near' && !s.near) locate(); // a link to the nearest: yours, once the browser says where you are
}
// Searching and filtering change the address in place; a page of the pager is a step of its own (push)
function writeQuery(push = false) {
  const p = new URLSearchParams();
  for (const k of ['q', ...FILTERS, 'sort']) if (s[k].trim()) p.set(k, s[k].trim());
  if (push && s.page > 1) p.set('page', String(s.page));
  else s.page = push ? s.page : 1;
  s.query = p.toString();
  history[push ? 'pushState' : 'replaceState'](push ? null : history.state, '', `#/spots${s.query ? `?${s.query}` : ''}`);
}

// ---------- Filters: the type, then country, state and city; and the order ----------
async function loadCities() {
  try { s.cities = await api('/spots/cities'); } catch { s.cities = null; return; }
  if ($app.dataset.page === 'spots') renderFilters();
}
// The orders on offer, the usual one first (as ''): in a city, the guide's; else most viewed. Nearest needs a browser
// that can say where you are.
const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator;
const sortsFor = () => [['', s.city ? 'Guide’s order' : 'Most viewed'], ...(s.city ? [['views', 'Most viewed']] : []),
  ...(canLocate ? [['near', 'Nearest']] : []), ['name', 'A to Z']];
const order = () => (s.sort === 'near' && !s.near ? '' : s.sort) || (s.city ? 'guide' : 'views');
function renderFilters() {
  const root = $app.querySelector('.spots-list');
  if (!root) return;
  const all = s.cities || [];
  const countries = [...new Set(all.map(c => c.country))];
  const inCountry = all.filter(c => !s.country || c.country === s.country);
  const states = [...new Map(inCountry.map(c => [`${c.country}-${c.state}`, c])).values()]
    .sort((a, b) => regionName(a.country, a.state).localeCompare(regionName(b.country, b.state)));
  const cities = inCountry.filter(c => !s.state || c.state === s.state).sort((a, b) => a.name.localeCompare(b.name));
  const option = (value, text, on, off = false) => `<option value="${esc(value)}"${on ? ' selected' : ''}${off ? ' disabled' : ''}>${esc(text)}</option>`;
  const set = (name, html) => { root.querySelector(`[name="${name}"]`).innerHTML = html; };
  // Each type says how many of the spots asked for are of it, once the list has come; one with none can't be picked
  set('kind', option('', 'All types') + SPOT_KINDS.map(k => {
    const n = s.kinds?.[k.id];
    return option(k.id, n == null ? k.label : `${k.label} (${n})`, k.id === s.kind, n === 0 && k.id !== s.kind);
  }).join(''));
  set('country', option('', 'All countries') + countries.map(c => option(c, countryName(c), c === s.country)).join(''));
  set('state', option('', 'All states') + states.map(c => option(c.state, regionName(c.country, c.state), c.state === s.state)).join(''));
  set('city', option('', 'All cities') + cities.map(c => option(c.id, s.state ? c.name : `${c.name}, ${c.state}`, c.id === s.city)).join(''));
  set('sort', sortsFor().map(([v, text]) => option(v, text, v === s.sort)).join(''));
  // Each filter shows what it's set to, with a × to clear it, or its name when it's every one. The order always says
  // which it is, on grey once it isn't the usual one.
  for (const chip of root.querySelectorAll('.wt-filter[data-filter]')) {
    const name = chip.dataset.filter, select = chip.querySelector('select'), on = !!select.value;
    chip.classList.toggle('is-set', on);
    chip.querySelector('.wt-filter__value').textContent = name === 'sort' ? (s.locating ? 'Finding you…' : select.selectedOptions[0]?.textContent ?? '')
      : !on ? select.getAttribute('aria-label') : name === 'kind' ? spotKind(s.kind).label : select.selectedOptions[0].textContent;
    const x = chip.querySelector('.wt-filter__clear');
    if (x) x.hidden = !on;
  }
  root.querySelector('[data-filter="sort"]').toggleAttribute('aria-busy', s.locating);
  // One country so far: nothing to choose, so it stays out of the way until there's a second
  root.querySelector('[data-filter="country"]').hidden = countries.length < 2 && !s.country;
  // Clear all, once there's more than one thing to clear
  root.querySelector('.spots-clear').hidden = [s.q.trim(), ...FILTERS.map(k => s[k])].filter(Boolean).length < 2;
}
// A wider choice drops the narrower ones it doesn't hold; a city sets its state
function pick(name, value) {
  if (name === 'sort') return sortBy(value);
  const city = name === 'city' && value && s.cities?.find(c => c.id === value);
  if (city) Object.assign(s, { city: city.id, state: city.state });
  else s[name] = value;
  const fits = c => (!s.country || c.country === s.country) && (!s.state || c.state === s.state);
  if (name === 'country' && s.state && !s.cities?.some(fits)) s.state = '';
  if (s.city && !s.cities?.some(c => c.id === s.city && fits(c))) s.city = '';
  if (!s.city && s.sort === 'views') s.sort = ''; // most viewed is the usual order again
  renderFilters();
  writeQuery();
  search();
}
// The search and every filter back to every spot; the order stays. keepSearch: the empty list's Clear filters, which
// leaves what you typed.
function clearAll({ keepSearch = false } = {}) {
  if (!keepSearch) {
    s.q = '';
    const input = $app.querySelector('.spots-list [name="q"]');
    if (input) input.value = '';
    showClear();
  }
  for (const k of FILTERS) s[k] = '';
  if (s.sort === 'views') s.sort = '';
  renderFilters();
  writeQuery();
  search();
}
// Nearest asks the browser where you are first, the first time; the list stays as it is until it says
function sortBy(value) {
  const before = s.sort;
  s.sort = value;
  writeQuery();
  if (value === 'near' && !s.near) { locate(before); return; }
  renderFilters();
  search();
}
// Where you are, to a km or so (two decimals): near enough to sort by, and the same for everyone close by, so the
// answer can be cached. If the browser can't say, the order goes back to what it was, and a toast says why.
function locate(before = '') {
  if (s.locating) return;
  s.locating = true;
  renderFilters();
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    s.locating = false;
    s.near = `${coords.latitude.toFixed(2)},${coords.longitude.toFixed(2)}`;
    renderFilters();
    if (s.sort === 'near') search();
  }, err => {
    s.locating = false;
    if (s.sort === 'near') {
      s.sort = before;
      if ($app.dataset.page === 'spots') writeQuery();
    }
    renderFilters();
    toast({ title: 'Couldn’t tell where you are', error: true,
      detail: err.code === err.PERMISSION_DENIED ? 'To sort by nearest, allow location for Dotsie in your browser.' : 'Try Nearest again in a moment.' });
  }, { timeout: 15000, maximumAge: 10 * 60_000 });
}

// ---------- The list ----------
// On a phone, a list that grows: Show more adds the next 30 under what you've scrolled through. On a computer, pages of
// 24 cards (rows of 2, 3 or 4) with a pager under them, so the page you're on, and how many there are, is clear.
const wide = matchMedia('(min-width: 768px)');
const perPage = () => (wide.matches ? 24 : 30);
wide.addEventListener('change', () => { if ($app.querySelector('.spots')) { s.page = 1; writeQuery(); search(); } });
// The pages to offer: all of them up to 7, else the first, the last, and this one with its neighbours, … between
function pageList(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const mid = page <= 4 ? [2, 3, 4, 5] : page >= pages - 3 ? [pages - 4, pages - 3, pages - 2, pages - 1] : [page - 1, page, page + 1];
  return [1, ...(mid[0] > 2 ? ['…'] : []), ...mid, ...(mid.at(-1) < pages - 1 ? ['…'] : []), pages];
}
// to: a page number (a computer's pager), 'more' (a phone's Show more), or nothing for the first page of a new search
async function search(to) {
  const n = ++s.asked, limit = perPage();
  const page = to === 'more' ? s.page + 1 : typeof to === 'number' ? to : 1, offset = (page - 1) * limit;
  const sort = order() === 'guide' || (order() === 'views' && !s.city) ? '' : order();
  const params = new URLSearchParams({ q: s.q.trim(), kind: s.kind, country: s.country, state: s.state, city: s.city, sort,
    near: sort === 'near' ? s.near : '', offset: String(offset), limit: String(limit) });
  for (const [k, v] of [...params]) if (!v || (k === 'offset' && v === '0')) params.delete(k);
  const spin = $app.querySelector('.spots-list .wt-spinner'), grid = $app.querySelector('.spots-grid');
  if (spin) spin.hidden = false;
  if (!s.loaded) showLoading();
  // What's shown fades a little while what's asked comes, if it takes a moment, so it's clear it's about to change
  grid?.setAttribute('aria-busy', 'true');
  clearTimeout(busy);
  if (s.loaded && to !== 'more') busy = setTimeout(() => grid?.classList.add('is-busy'), 150);
  try {
    const got = await api(`/spots/search?${params}`);
    if (n !== s.asked) return; // a newer search is on its way
    const fresh = to === undefined && s.loaded;
    Object.assign(s, { page, more: got.more, total: got.total, loaded: true, results: to === 'more' ? [...s.results, ...got.results] : got.results });
    if (got.kinds && JSON.stringify(got.kinds) !== JSON.stringify(s.kinds)) { s.kinds = got.kinds; renderFilters(); }
    showResults();
    // A new search from far down the list: back up to its top, under the search and filters, to see what it found
    const list = $app.querySelector('.spots-list');
    if (fresh && list && list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: 'start' });
  } catch (err) {
    if (n !== s.asked) return;
    const grid = $app.querySelector('.spots-grid');
    if (grid) grid.innerHTML = `<div class="wt-empty spots-empty"><p>${esc(err.code === 'rate_limited' ? failHint(err) : `Couldn’t load the spots. ${failHint(err)}`)}</p>
      <button type="button" class="wt-btn wt-btn--secondary" data-retry>Try again</button></div>`;
    const count = $app.querySelector('.spots-count');
    if (count) count.textContent = '';
  } finally {
    if (n === s.asked) {
      if (spin?.isConnected) spin.hidden = true;
      clearTimeout(busy);
      grid?.classList.remove('is-busy');
      grid?.removeAttribute('aria-busy');
    }
  }
}
// The first time, until the spots come: grey cards in their place, so the page doesn't jump when they do
function showLoading() {
  const grid = $app.querySelector('.spots-grid');
  if (grid && !grid.children.length) {
    grid.innerHTML = Array.from({ length: 6 }, () => `<span class="wt-spot-card wt-spot-card--loading" aria-hidden="true"><span class="wt-spot-card__photo"></span>
      <span class="wt-spot-card__body"><span class="wt-spot-card__bar"></span><span class="wt-spot-card__bar"></span><span class="wt-spot-card__bar"></span></span></span>`).join('');
  }
}
function showResults() {
  const grid = $app.querySelector('.spots-grid');
  if (!grid) return;
  const q = s.q.trim(), narrowed = FILTERS.some(k => s[k]), city = s.cities?.find(c => c.id === s.city);
  // None: why, and the way out, the filters first, since they're what's most often forgotten
  grid.innerHTML = s.results.length ? s.results.map(cardHTML).join('') : `<div class="wt-empty spots-empty"><p>${
    q ? `No spots match “${esc(q)}”${narrowed ? ' with these filters' : ''}.` : narrowed ? 'No spots fit these filters yet.' : 'No spots yet.'}${
    q && !narrowed ? ' Try another name or place.' : ''}</p>${
    narrowed ? '<button type="button" class="wt-btn wt-btn--secondary" data-unfilter>Clear filters</button>'
    : q ? '<button type="button" class="wt-btn wt-btn--secondary" data-unsearch>Clear search</button>' : ''}</div>`;
  // How many, which a screen reader hears once, rather than every card again
  $app.querySelector('.spots-count').textContent = s.total ? `${s.total.toLocaleString('en-US')} ${s.total === 1 ? 'spot' : 'spots'}` : '';
  const how = { guide: `In the guide’s order for ${city?.name ?? 'the city'}: where to go first, first.`,
    views: 'Most viewed first: by how often each place’s Wikipedia article was read in the last year.',
    near: 'Nearest first, as the crow flies from where you are.', name: 'A to Z, by name.' }[order()];
  $app.querySelector('.spots-note').textContent = `${how} Each guide is written by AI from the sources it lists.`;
  const pages = Math.ceil(s.total / perPage()), pager = $app.querySelector('.spots-pager');
  $app.querySelector('.spots-more').hidden = wide.matches || !s.more;
  pager.hidden = !wide.matches || pages < 2;
  pager.innerHTML = pager.hidden ? '' : `
    <button type="button" class="wt-pager__step" data-page="${s.page - 1}" aria-label="Previous page"${s.page > 1 ? '' : ' disabled'}>${ICON.back}</button>
    ${pageList(s.page, pages).map(p => p === '…' ? '<span class="wt-pager__gap" aria-hidden="true">…</span>'
      : `<button type="button" class="wt-pager__page" data-page="${p}" aria-label="Page ${p}"${p === s.page ? ' aria-current="page"' : ''}>${p}</button>`).join('')}
    <button type="button" class="wt-pager__step" data-page="${s.page + 1}" aria-label="Next page"${s.page < pages ? '' : ' disabled'}>${ICON.forward}</button>`;
}
// How far, in miles where people go by them, else km: "0.4 mi", "12 mi", "1,050 km"
const MILES = /-(US|GB|LR|MM)\b/i.test(globalThis.navigator?.language ?? '');
const distance = km => { const n = Math.max(0.1, MILES ? km / 1.609344 : km); return `${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n).toLocaleString('en-US')} ${MILES ? 'mi' : 'km'}`; };
const nearOf = () => { const [lat, lng] = (s.near ?? '').split(',').map(Number); return { lat, lng }; };
const spotHash = p => `#/spots/${encodeURIComponent(p.city.id)}/${encodeURIComponent(p.source)}/${encodeURIComponent(p.id)}`;
function cardHTML(p) {
  const photo = p.hero?.thumb
    ? `<img class="wt-spot-card__photo" src="${esc(p.hero.thumb)}" alt="" loading="lazy" decoding="async" title="Photo: ${esc(p.hero.author || 'Unknown author')} · ${esc(p.hero.licence || '')}">`
    : `<span class="wt-spot-card__photo wt-spot-card__photo--none" aria-hidden="true">${ICON.pin}</span>`;
  // the card is the link to its page; its bookmark, in its corner, saves it to trips without leaving the list
  const pl = cardPlace(p);
  return `<div class="wt-spot-card${canSave(pl) ? ' has-save' : ''}"><a class="wt-spot-card__link" href="${spotHash(p)}">
    ${photo}
    <span class="wt-spot-card__body"><span class="wt-spot-card__name">${esc(p.name)}</span>
      <span class="wt-spot-card__line">${esc(p.oneLiner)}</span>
      <span class="wt-spot-card__where">${esc(`${p.city.name}, ${p.state}${order() === 'near' && p.lat != null ? ` · ${distance(kmBetween(nearOf(), p))}` : ''}`)}</span></span></a>${canSave(pl) ? bookmarkHTML(pl) : ''}</div>`;
}
// A photo that won't load (offline, blocked) gives way: to the card's pin, or to the text
document.addEventListener('error', e => {
  const img = e.target;
  if (img.classList?.contains('wt-spot-card__photo')) img.outerHTML = `<span class="wt-spot-card__photo wt-spot-card__photo--none" aria-hidden="true">${ICON.pin}</span>`;
  else if (img.closest?.('.wt-guide__figure')) img.closest('.wt-guide__figure').remove();
  else if (img.classList?.contains('wt-guide__hero')) { img.parentElement.classList.remove('wt-guide__top--photo'); img.remove(); }
}, true);

// ---------- One spot ----------
async function showEntry({ city, source, id }) {
  const key = `${city}/${source}/${id}`, el = $app.querySelector('.spots-entry');
  if (s.key === key) return;
  s.key = key;
  s.title = document.title = 'Spots · Dotsie';
  el.innerHTML = `<article class="wt-guide">${topHTML(null)}<span class="wt-spinner"></span></article>`;
  scrollTo(0, 0);
  let g;
  try { g = await api(`/spots/${encodeURIComponent(city)}/${encodeURIComponent(source)}/${encodeURIComponent(id)}`); } catch (err) {
    if (s.key !== key) return;
    el.innerHTML = `<article class="wt-guide">${topHTML(null)}<p class="wt-empty">${esc(err.code === 'not_found' ? 'This spot isn’t in the guide any more.' : `Couldn’t load this spot. ${failHint(err)}`)}</p></article>`;
    return;
  }
  if (s.key !== key) return;
  s.title = document.title = `${g.name} · Spots · Dotsie`;
  s.spot = g;
  el.innerHTML = entryHTML(g);
}

// ---------- Save to trips: a spot goes on the Want to go list of as many trips as you like ----------
// From its card in the list (a bookmark on it) or its page (the button floating at the bottom, as Plan's does). A sheet
// of your trips still to come (or under way, or with no dates), soonest first, each a checkbox: ticking one saves the
// spot to it, at once, and unticking takes it off again; then a new trip named for the spot's city. Closing it says
// what changed, with Open for one trip. A spot is saved to a trip when it's on its Want to go or already planned on one
// of its days: that trip is ticked, says the day, and isn't unticked here, since that would take the stop off its day
// (its own sheet does that). A saved spot's bookmark is filled, and its page's button says Saved, not where: it can be
// on several trips, and a trip's name can read as a place's ("Saved to Yosemite National Park").
// Signed out, it asks you to sign in first.
let myTrips = null; // your trips, as Home's cards have them (with each one's stops and Want to go places), once asked this visit
async function loadMyTrips() {
  const today = nowStamp().slice(0, 10);
  const list = await api('/trips');
  myTrips = list.filter(t => !t.end || t.end.slice(0, 10) >= today)
    .sort((a, b) => (a.start ? 0 : 1) - (b.start ? 0 : 1) || (a.start || '').localeCompare(b.start || ''));
  return myTrips;
}
// A spot as a place, from its card or its page: the place and only the place, as on any Want to go list
const cardPlace = p => ({ key: `${p.city.id}/${p.source}/${p.id}`, name: p.name, city: p.city.name, address: `${p.city.name}, ${p.state}`, lat: p.lat, lng: p.lng, source: p.source, id: p.id });
const pagePlace = g => ({ key: `${g.destination.id}/${g.source}/${g.id}`, name: g.name, city: g.destination.name, address: `${g.destination.name}, ${g.destination.state}`, lat: g.lat, lng: g.lng, source: g.source, id: g.id });
const ideaOf = pl => ({
  name: pl.name, address: pl.address, lat: pl.lat, lng: pl.lng, kind: guessKind(pl.name) === 'place' ? 'attraction' : guessKind(pl.name),
  wikidata: pl.source === 'wikidata' && QID.test(pl.id) ? pl.id : null,
});
const onTrip = (t, pl) => !!(findIdea(t, pl) || findStop(t, pl));
// Planned, and not on Want to go too: the stop, whose day the trip's row says
const plannedOn = (t, pl) => (findIdea(t, pl) ? null : findStop(t, pl));
const savedIn = pl => (myTrips || []).filter(t => onTrip(t, pl));
const canSave = pl => pl.lat != null && pl.lng != null;

async function saveSpot(pl, btn) {
  if (!me) { toast({ title: 'Sign in to save places to a trip', detail: 'Your trips, and who’s on them, are in your account.' }, 'Sign in', () => { location.hash = '#/'; }); return; }
  btn.disabled = true;
  try { await loadMyTrips(); } catch (err) { if (err.status !== 401) failToast(err, 'Couldn’t load your trips'); return; } finally { btn.disabled = false; }
  const before = new Set(savedIn(pl).map(t => t.id));
  // A new trip is offered until one of yours has the city's name: tapping it again would make another of the same name
  const named = () => myTrips.some(t => t.name.trim().toLowerCase() === pl.city.trim().toLowerCase());
  const row = t => {
    const stop = plannedOn(t, pl), detail = stop ? `Planned for ${fmtDay(dayOf(stop))}` : tripDates(t);
    return `<li><button type="button" class="wt-option" role="checkbox" aria-checked="${onTrip(t, pl)}" data-trip="${esc(t.id)}"><i class="wt-marker spot-save__trip">${ICON.map}</i><span class="wt-option__text"><span class="wt-option__label">${esc(t.name)}</span><span class="wt-option__detail">${esc(detail)}</span></span>${ICON.check}</button></li>`;
  };
  // New trip is named for the spot's city; its pencil turns the row into a field to name it something else first
  const newHTML = `<li class="spot-save__new"><button type="button" class="wt-option" data-new><i class="wt-marker spot-save__trip">${ICON.plus}</i><span class="wt-option__text"><span class="wt-option__label">New trip: ${esc(pl.city)}</span></span></button><button type="button" class="wt-icon-btn spot-save__rename" data-rename aria-label="Name the new trip" title="Name it">${ICON.edit}</button></li>`;
  const nameHTML = `<form class="spot-save__name"><i class="wt-marker spot-save__trip">${ICON.plus}</i><input class="wt-input" name="name" value="${esc(pl.city)}" required maxlength="${MAX.tripName}" autocomplete="off" enterkeyhint="done" aria-label="New trip’s name"><button type="submit" class="wt-icon-btn" aria-label="Make the trip" title="Make the trip">${ICON.check}</button></form>`;
  openSheet(`${modalHead(`Save ${esc(pl.name)}`)}
    <p class="wt-modal__text">It goes on the Want to go list of each trip you tick, for everyone on the trip, until someone gives it a day.</p>
    <ul class="wt-options" aria-label="Trips">${myTrips.map(row).join('')}${named() ? '' : newHTML}</ul>`, el => {
    const ul = el.querySelector('.wt-options');
    // A trip whose change is on its way takes no other tap until it's done: a second would save the spot to it twice
    const busy = new Set();
    // Ticks trip t or unticks it; with no t, makes a new trip of that name and ticks it
    async function change(t, name) {
      const key = t ? t.id : 'new';
      if (busy.has(key)) return;
      const stop = t && plannedOn(t, pl);
      if (stop) { toast({ title: `Planned for ${fmtDay(dayOf(stop))}`, detail: `To take it off, delete the stop in ${t.name}.` }); return; }
      busy.add(key);
      // A new trip's row takes the place, and the focus, of New trip or its field
      const li = ul.querySelector('.spot-save__new'), made = !t;
      try {
        if (!t) {
          const { trip } = await api('/trips', { method: 'POST', body: { name } });
          t = { id: trip.id, name: trip.name, start: null, end: null, stops: [], ideas: [] };
          myTrips.push(t);
          li.insertAdjacentHTML('beforebegin', row(t));
          if (named()) li.remove(); else li.outerHTML = newHTML;
        }
        const had = findIdea(t, pl);
        if (had) {
          await api(`/trips/${t.id}/ideas/${had.id}`, { method: 'DELETE' });
          t.ideas = t.ideas.filter(i => i !== had);
        } else {
          const id = uid();
          await api(`/trips/${t.id}/ideas/${id}`, { method: 'PUT', body: ideaOf(pl) });
          (t.ideas ||= []).push({ id, name: pl.name, lat: pl.lat, lng: pl.lng });
        }
      } catch (err) {
        if (err.status !== 401) failToast(err, 'Couldn’t change the trip');
      } finally {
        busy.delete(key);
      }
      // Its row says where it is now
      const tb = t && ul.querySelector(`[data-trip="${CSS.escape(t.id)}"]`);
      if (tb) { tb.setAttribute('aria-checked', String(onTrip(t, pl))); if (made) tb.focus(); }
      showSaved();
    }
    ul.addEventListener('click', e => {
      const b = e.target.closest('.wt-option, [data-rename]');
      if (!b) return;
      if (b.hasAttribute('data-rename')) {
        const li = b.closest('li');
        li.innerHTML = nameHTML;
        const input = li.querySelector('input');
        input.focus(); input.select();
        return;
      }
      if (b.hasAttribute('data-new')) return change(null, pl.city);
      const t = myTrips.find(x => x.id === b.dataset.trip);
      if (t) change(t);
    });
    ul.addEventListener('submit', e => {
      e.preventDefault();
      change(null, e.target.elements.name.value.trim() || pl.city);
    });
    // Esc puts New trip back as it was, rather than closing the sheet
    ul.addEventListener('keydown', e => {
      const form = e.target.closest('.spot-save__name');
      if (e.key !== 'Escape' || !form) return;
      e.stopPropagation();
      form.closest('li').outerHTML = newHTML;
      ul.querySelector('[data-rename]').focus();
    });
  }, {
    onClose: () => {
      const now = savedIn(pl), added = now.filter(t => !before.has(t.id)), gone = [...before].filter(id => !now.some(t => t.id === id));
      // Which list, then which trips: a trip's name alone can read as a place's
      if (added.length === 1) toast({ title: 'Saved to Want to go', detail: added[0].name }, 'Open', () => { openTripOn(IDEAS); location.hash = `#/trip/${added[0].id}`; });
      else if (added.length) toast({ title: 'Saved to Want to go', detail: `On ${added.length} trips` });
      else if (gone.length) toast({ title: 'Removed from Want to go', detail: gone.length === 1 ? myTrips.find(t => t.id === gone[0])?.name : `On ${gone.length} trips` });
    },
  });
}
// The bookmark on a card, and the page's button: filled once the spot is on a trip. Both say only Saved; which trips is
// for screen readers, and the sheet the button opens
const savedLabel = on => `Saved to ${on.length === 1 ? on[0].name : `${on.length} trips`}. Change`;
function bookmarkHTML(pl) {
  const on = savedIn(pl), label = on.length ? savedLabel(on) : `Save ${pl.name} to a trip`;
  return `<button type="button" class="wt-icon-btn wt-spot-card__save" data-spot-save="${esc(pl.key)}" aria-pressed="${on.length > 0}" aria-label="${esc(label)}" title="${on.length ? 'Saved' : 'Save to a trip'}">${ICON.bookmark}</button>`;
}
const saveButton = pl => { const on = savedIn(pl); return on.length ? { html: `${ICON.bookmark}Saved`, label: savedLabel(on) } : { html: `${ICON.bookmark}Save to a trip`, label: null }; };
function showSaved() {
  for (const b of $app.querySelectorAll('.wt-spot-card__save')) {
    const p = s.results.find(r => cardPlace(r).key === b.dataset.spotSave);
    if (p) b.outerHTML = bookmarkHTML(cardPlace(p));
  }
  const b = $app.querySelector('.spot-save .wt-btn');
  if (b && s.spot) {
    const { html, label } = saveButton(pagePlace(s.spot));
    b.innerHTML = html; b.classList.toggle('is-saved', !!label);
    if (label) b.setAttribute('aria-label', label); else b.removeAttribute('aria-label');
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest?.('[data-spot-save]');
  if (!b || !$app.querySelector('.spots')) return;
  e.preventDefault();
  if ($app.dataset.page === 'spot' && s.spot) return saveSpot(pagePlace(s.spot), b);
  const p = s.results.find(r => cardPlace(r).key === b.dataset.spotSave);
  if (p) saveSpot(cardPlace(p), b);
});
// Signed in, which spots are on your trips already, for their bookmarks: asked once a visit, when Spots opens
async function markSaved() {
  if (!me || myTrips) return;
  try { await loadMyTrips(); showSaved(); } catch {}
}
// The lead photo across the top, with the way back over its corner; with none, the way back on its own
const topHTML = hero => `<div class="wt-guide__top${hero?.thumb ? ' wt-guide__top--photo' : ''}">
    <a class="wt-guide__back" href="#/spots${s.query ? `?${s.query}` : ''}" aria-label="All spots">${ICON.back}</a>
    ${hero?.thumb ? `<img class="wt-guide__hero" src="${esc(hero.thumb)}" alt="${esc(hero.caption || '')}" decoding="async">` : ''}</div>`;
// Every page the entry was written from, and the others about the place, once each: its Wikipedia article, its official
// website, the maps app, its record at its source, then any other source
function linksOf(g) {
  const out = [], seen = new Set();
  const add = (url, label, detail) => { if (url && !seen.has(url)) { seen.add(url); out.push({ url, label, detail }); } };
  if (g.wikipedia) add(`https://en.wikipedia.org/wiki/${encodeURIComponent(g.wikipedia.replace(/ /g, '_'))}`, 'Wikipedia', g.wikipedia);
  for (const x of g.sources ?? []) if (x.kind === 'wikipedia') add(x.url, 'Wikipedia', decodeURIComponent(x.url.split('/wiki/')[1] ?? '').replace(/_/g, ' ') || host(x.url));
  if (g.website) add(g.website, 'Official website', host(g.website));
  for (const x of g.sources ?? []) if (x.kind === 'official website') add(x.url, 'Official website', host(x.url));
  if (g.lat != null) add(placeURL({ name: g.name, address: `${g.destination.name}, ${g.destination.state}`, lat: g.lat, lng: g.lng }), MAPS_APPS[mapsApp], 'Directions, hours and reviews');
  if (g.url) add(g.url, g.source === 'wikidata' ? 'Wikidata' : 'National Park Service', g.source === 'wikidata' ? g.id : host(g.url));
  for (const x of g.sources ?? []) add(x.url, SOURCE_KIND[x.kind] ?? x.kind, host(x.url));
  return out;
}
function entryHTML(g) {
  const inline = g.images?.inline ?? [];
  const figure = img => `<figure class="wt-guide__figure"><img src="${esc(img.thumb)}" alt="${esc(img.caption || '')}"${img.width ? ` width="${+img.width}" height="${+img.height}"` : ''} loading="lazy" decoding="async">${img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : ''}</figure>`;
  const after = n => inline.filter(i => i.after_paragraph === n && i.thumb).map(figure).join('');
  const photos = [g.images?.hero, ...inline].filter(i => i?.thumb);
  const links = linksOf(g);
  const pl = pagePlace(g);
  // Save to a trip floats at the bottom of the page, as Plan's main button does, so it's in reach however far you've read
  const sb = saveButton(pl);
  const save = canSave(pl) ? `<div class="wt-float-bar spot-save"><button type="button" class="wt-btn wt-btn--primary wt-btn--block${sb.label ? ' is-saved' : ''}" data-spot-save${sb.label ? ` aria-label="${esc(sb.label)}"` : ''}>${sb.html}</button></div>` : '';
  return `<article class="wt-guide${save ? ' has-save' : ''}">
    ${topHTML(g.images?.hero)}
    <header class="wt-guide__head">
      <p class="wt-guide__where">${esc(`${g.destination.name}, ${regionName(g.destination.country, g.destination.state)}`)}</p>
      <h1 class="wt-guide__name">${esc(g.name)}</h1>
      <p class="wt-guide__lede">${esc(g.oneLiner)}</p>
    </header>
    <div class="wt-guide__body">${(g.paragraphs ?? []).map((p, i) => `<p>${esc(p.text)}</p>${after(i + 1)}`).join('')}</div>
    ${g.practical?.length ? `<section class="wt-guide__section"><h2>Before you go</h2>
      <dl class="wt-guide__facts">${g.practical.map(f => `<div><dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd></div>`).join('')}</dl></section>` : ''}
    ${links.length ? `<section class="wt-guide__section"><h2>Sources and links</h2>
      <ul class="wt-guide__links">${links.map(l => `<li><a class="wt-guide__link" href="${esc(l.url)}" target="_blank" rel="noopener">
        <span class="wt-guide__link-text"><span class="wt-guide__link-label">${esc(l.label)}</span><span class="wt-guide__link-detail">${esc(l.detail)}</span></span>${ICON.external}</a></li>`).join('')}</ul></section>` : ''}
    <footer class="wt-guide__foot">
      <p>Written by AI from the sources above, and published under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.${g.views != null ? ` Its Wikipedia article was read ${views(g.views)} times in the last year.` : ''}</p>
      ${photos.length ? `<p>Photos: ${photos.map(credit).join('; ')}.</p>` : ''}
    </footer>
    ${save}
  </article>`;
}
