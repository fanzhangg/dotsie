/* Guides: the guide's trip plans, a destination's days strung together from its spots (pipeline/plan.py,
   docs/trip-plans.md), open to anyone, signed in or not. A page of its own in the nav, laid out and worked as Spots is:
   the app bar, a search and filters for country, state and city kept in the address (#/guides?q=…&state=WA&city=seattle)
   so it can be reloaded, sent and gone back through, how many, and a grid of cards (rows on a phone), each a guide.
   #/guides/<id> is one, an article (tripplans.js). There are few guides, so the page asks for them all once a visit
   and searches and filters them itself. */
import { $app, ICON, appBarHTML, avatarHTML, esc, failHint } from './core.js';
import { api } from './backend.js';
import { me } from './signin.js';
import { regionName, regionsMatching } from './regions.js';
import { FILTER_NAMES, chipHTML, closeMenu, menuOpen, place, relistMenu, toggleMenu } from './filters.js';

// What's asked, kept while you read a guide and come back. `query`: the address's part after ?, as this state writes it.
const g = { q: '', country: '', state: '', city: '', query: null, all: null, failed: null, scroll: 0, fromList: false };
const FILTERS = ['country', 'state', 'city'];
let choices = { country: [], state: [], city: [] };

// The way back from a guide: to the list as it was, by going back when you came from it
export const guidesHref = () => `#/guides${g.query ? `?${g.query}` : ''}`;
export function backToGuides(e) {
  if (!g.fromList) return;
  e.preventDefault();
  g.fromList = false;
  history.back();
}

const headHTML = () => appBarHTML('guides', me
  ? `<button class="wt-icon-btn" data-action="account" aria-label="Account">${avatarHTML({ name: me.name, image: me.image, identity: 1 })}</button>`
  : '<a class="wt-btn wt-btn--secondary" href="#/">Sign in</a>');

export function renderGuides(r) {
  closeMenu(false);
  document.title = 'Guides · Dotsie';
  const back = $app.dataset.page !== 'guides' && (r.query ?? '') === g.query;
  $app.dataset.page = 'guides';
  mount();
  readQuery(r.query ?? '');
  if (!g.all) load(); else show();
  if (back) scrollTo(0, g.scroll);
}

// Under the search and the filters, how many; then the cards
function mount() {
  $app.innerHTML = `
    ${headHTML()}
    <main class="home spots guides">
      <section class="spots-list" aria-label="Guides">
        <div class="spots-find spots-band">
          <label class="wt-input wt-input-group wt-search">${ICON.search}
            <input type="search" name="q" placeholder="Search guides, cities or states" aria-label="Search guides" autocomplete="off">
            <button type="button" class="wt-search__clear" aria-label="Clear search" hidden>${ICON.close}</button></label>
          <div class="spots-filters">${[['country', 'Country'], ['state', 'State'], ['city', 'City']].map(([name, label]) => chipHTML(name, label)).join('')}
            <button type="button" class="wt-filter wt-filter--action spots-clear" hidden>Clear all</button></div>
        </div>
        <div class="spots-head"><p class="spots-count" role="status"></p></div>
        <div class="home-grid spots-grid"></div>
        <p class="spots-note"></p>
      </section>
    </main>`;
  const list = $app.querySelector('.spots-list'), input = list.querySelector('[name="q"]');
  // A search shows what it finds as you type: there's nothing to wait for
  input.addEventListener('input', () => { g.q = input.value; writeQuery(); show(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (matchMedia('(pointer: coarse)').matches) input.blur(); } });
  list.querySelector('.wt-search__clear').addEventListener('click', e => {
    e.preventDefault();
    input.value = g.q = '';
    input.focus();
    writeQuery();
    show();
  });
  const filters = list.querySelector('.spots-filters');
  filters.addEventListener('click', e => {
    const open = e.target.closest('.wt-filter__open');
    if (open) {
      const chip = open.closest('.wt-filter'), name = chip.dataset.filter;
      toggleMenu(chip, { choices: () => choices[name], value: () => g[name], pick: v => pick(name, v) });
    }
    const x = e.target.closest('[data-clear]');
    if (x) { e.preventDefault(); closeMenu(false); pick(x.dataset.clear, ''); filters.querySelector(`[data-filter="${x.dataset.clear}"] .wt-filter__open`)?.focus(); }
    if (e.target.closest('.spots-clear')) { closeMenu(false); clearAll(); }
  });
  filters.addEventListener('scroll', () => { if (menuOpen()) place(); }, { passive: true });
  list.addEventListener('click', e => {
    if (e.target.closest('.wt-spot-card__link')) { g.fromList = true; g.scroll = scrollY; }
    if (e.target.closest('[data-retry]')) load();
    if (e.target.closest('[data-unfilter]')) clearAll({ keepSearch: true });
    if (e.target.closest('[data-unsearch]')) list.querySelector('.wt-search__clear').click();
  });
  // The search and the filters stay at the top as the list scrolls, just under the app bar, as on Spots
  const bar = $app.querySelector('.wt-app-bar');
  $app.style.setProperty('--spots-stick', `${bar.offsetHeight}px`);
}
addEventListener('resize', () => { if ($app.dataset.page === 'guides') $app.style.setProperty('--spots-stick', `${$app.querySelector('.wt-app-bar')?.offsetHeight ?? 64}px`); });

async function load() {
  g.failed = null;
  show();
  try { g.all = await api('/spots/plans'); } catch (err) { g.failed = err; }
  if ($app.dataset.page === 'guides') show();
}

// ---------- The address: what's asked, after #/guides? ----------
function readQuery(query) {
  const p = new URLSearchParams(query);
  Object.assign(g, { q: p.get('q') ?? '', country: p.get('country') ?? '', state: p.get('state') ?? '', city: p.get('city') ?? '', query });
  const input = $app.querySelector('.spots-list [name="q"]');
  if (input) input.value = g.q;
}
function writeQuery() {
  const p = new URLSearchParams();
  for (const k of ['q', ...FILTERS]) if (g[k].trim()) p.set(k, g[k].trim());
  g.query = p.toString();
  history.replaceState(history.state, '', `#/guides${g.query ? `?${g.query}` : ''}`);
}

// ---------- Filters: country, then state and city, from where the guides are ----------
const placeOf = c => c.destination;
function renderFilters() {
  const root = $app.querySelector('.spots-list');
  if (!root) return;
  const all = [...new Map((g.all ?? []).map(c => [placeOf(c).id, placeOf(c)])).values()];
  const countries = [...new Set(all.map(c => c.country))];
  const inCountry = all.filter(c => !g.country || c.country === g.country);
  const states = [...new Map(inCountry.map(c => [`${c.country}-${c.state}`, c])).values()]
    .sort((a, b) => regionName(a.country, a.state).localeCompare(regionName(b.country, b.state)));
  const cities = inCountry.filter(c => !g.state || c.state === g.state).sort((a, b) => a.name.localeCompare(b.name));
  const o = (value, text) => ({ value, text, meta: null, off: false });
  choices = {
    country: [o('', 'All countries'), ...countries.map(c => o(c, countryName(c)))],
    state: [o('', 'All states'), ...states.map(c => o(c.state, regionName(c.country, c.state)))],
    city: [o('', 'All cities'), ...cities.map(c => o(c.id, g.state ? c.name : `${c.name}, ${c.state}`))],
  };
  for (const chip of root.querySelectorAll('.wt-filter[data-filter]')) {
    const name = chip.dataset.filter, now = choices[name].find(c => c.value === g[name]), on = !!g[name];
    const text = on ? now?.text ?? g[name] : FILTER_NAMES[name];
    chip.classList.toggle('is-set', on);
    chip.querySelector('.wt-filter__value').textContent = text;
    chip.querySelector('.wt-filter__open').setAttribute('aria-label', on ? `${FILTER_NAMES[name]}: ${text}` : text);
    chip.querySelector('.wt-filter__clear').hidden = !on;
  }
  // One country so far: nothing to choose, so it stays out of the way until there's a second
  root.querySelector('[data-filter="country"]').hidden = countries.length < 2 && !g.country;
  root.querySelector('.spots-clear').hidden = [g.q.trim(), ...FILTERS.map(k => g[k])].filter(Boolean).length < 2;
  relistMenu();
}
const countryName = (() => {
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
  return code => { try { return names?.of(code) ?? code; } catch { return code; } };
})();
// A wider choice drops the narrower ones it doesn't hold; a city sets its state
function pick(name, value) {
  const city = name === 'city' && value && (g.all ?? []).map(placeOf).find(c => c.id === value);
  if (city) Object.assign(g, { city: city.id, state: city.state });
  else g[name] = value;
  const fits = c => (!g.country || c.country === g.country) && (!g.state || c.state === g.state);
  const places = (g.all ?? []).map(placeOf);
  if (name === 'country' && g.state && !places.some(fits)) g.state = '';
  if (g.city && !places.some(c => c.id === g.city && fits(c))) g.city = '';
  writeQuery();
  show();
}
function clearAll({ keepSearch = false } = {}) {
  if (!keepSearch) {
    g.q = '';
    const input = $app.querySelector('.spots-list [name="q"]');
    if (input) input.value = '';
  }
  for (const k of FILTERS) g[k] = '';
  writeQuery();
  show();
}

// ---------- The list ----------
const fold = t => String(t ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// In its name, headline or dek, its city's name, or its state's name or code ("washington", "WA")
function matches(c, q) {
  if (!q) return true;
  const d = placeOf(c), text = fold([c.title, c.headline, c.dek, d.name].join(' ')), regions = regionsMatching(q);
  return text.includes(fold(q)) || regions.includes(`${d.country}-${d.state}`);
}
function show() {
  const grid = $app.querySelector('.spots-grid');
  if (!grid) return;
  $app.querySelector('.wt-search__clear').hidden = !g.q;
  renderFilters();
  const count = $app.querySelector('.spots-count'), note = $app.querySelector('.spots-note');
  if (g.failed) {
    grid.innerHTML = `<div class="wt-empty spots-empty"><p>${esc(g.failed.code === 'rate_limited' ? failHint(g.failed) : `Couldn’t load the guides. ${failHint(g.failed)}`)}</p>
      <button type="button" class="wt-btn wt-btn--secondary" data-retry>Try again</button></div>`;
    count.textContent = note.textContent = '';
    return;
  }
  // The first time, until they come: grey cards in their place, so the page doesn't jump when they do
  if (!g.all) {
    grid.innerHTML = Array.from({ length: 3 }, () => `<span class="wt-spot-card wt-spot-card--loading" aria-hidden="true"><span class="wt-spot-card__photo"></span>
      <span class="wt-spot-card__body"><span class="wt-spot-card__bar"></span><span class="wt-spot-card__bar"></span><span class="wt-spot-card__bar"></span></span></span>`).join('');
    return;
  }
  const q = g.q.trim(), narrowed = FILTERS.some(k => g[k]);
  const shown = g.all.filter(c => matches(c, q) && (!g.country || placeOf(c).country === g.country)
    && (!g.state || placeOf(c).state === g.state) && (!g.city || placeOf(c).id === g.city));
  grid.innerHTML = shown.length ? shown.map(cardHTML).join('') : `<div class="wt-empty spots-empty"><p>${
    q ? `No guides match “${esc(q)}”${narrowed ? ' with these filters' : ''}.` : narrowed ? 'No guides fit these filters yet.' : 'No guides yet.'}${
    q && !narrowed ? ' Try another name or place.' : ''}</p>${
    narrowed ? '<button type="button" class="wt-btn wt-btn--secondary" data-unfilter>Clear filters</button>'
    : q ? '<button type="button" class="wt-btn wt-btn--secondary" data-unsearch>Clear search</button>' : ''}</div>`;
  count.textContent = shown.length ? `${shown.length} ${shown.length === 1 ? 'guide' : 'guides'}` : '';
  note.textContent = 'Each guide is a few days of a city’s spots, strung together and written up by AI from the sources the spots list.';
}
// Who it's for, before it has an article to say more: "For a day trip"
const forWhom = c => `For ${String(c.traveler ?? '').split(':')[0]}`;
// A guide as a spot card: its lead photo, where it is and how long, its name, and its dek
function cardHTML(c) {
  const d = placeOf(c), photo = c.photos?.find(x => x?.thumb);
  const img = photo ? `<img class="wt-spot-card__photo" src="${esc(photo.thumb)}" alt="" loading="lazy" decoding="async" title="Photo: ${esc(photo.author || 'Unknown author')} · ${esc(photo.licence || '')}">`
    : `<span class="wt-spot-card__photo wt-spot-card__photo--none" aria-hidden="true">${ICON.map}</span>`;
  return `<div class="wt-spot-card"><a class="wt-spot-card__link" href="#/guides/${esc(encodeURIComponent(c.planId))}">
    ${img}
    <span class="wt-spot-card__body"><span class="wt-spot-card__name">${esc(c.title)}</span>
      <span class="wt-spot-card__line">${esc(c.dek || c.headline || forWhom(c))}</span>
      <span class="wt-spot-card__where">${esc(`${d.name}, ${d.state} · ${c.days} ${c.days === 1 ? 'day' : 'days'} · ${c.stops} places`)}</span></span></a></div>`;
}
