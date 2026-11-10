/* Spots: the guide's places, open to anyone, signed in or not. #/spots lists them, most viewed first (in the guide's
   own order once a city is picked), with a search and filters for country, state and city, kept in the address
   (#/spots?q=…&state=WA&city=seattle&page=2) so it can be reloaded, sent and gone back through.
   #/spots/<city>/<source>/<id> is one spot's guide entry, a page of its own with no app bar, its sources and other
   pages about it listed at the end. The entries are written by a model from the sources each lists
   (pipeline/guides.py) and published under CC BY-SA 4.0. */
import { $app, ICON, appBarHTML, avatarHTML, esc, failHint } from './core.js';
import { api } from './backend.js';
import { me } from './signin.js';
import { MAPS_APPS, mapsApp, placeURL } from './routes.js';
import { regionName } from './regions.js';

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
const s = { q: '', country: '', state: '', city: '', page: 1, query: null, cities: null, results: [], more: false, total: 0, loaded: false,
  asked: 0, key: null, scroll: 0, fromList: false, title: 'Spots · Dotsie' };
let timer = 0;

// ---------- The page ----------
// The app bar, as Home has it: the nav, and the account (or Sign in). The list, and a spot's entry over it, are filled
// in by script and kept while the page is open, so going back to the list finds it as it was.
const headHTML = () => appBarHTML('spots', me
  ? `<button class="wt-icon-btn" data-action="account" aria-label="Account">${avatarHTML({ name: me.name, image: me.image, identity: 1 })}</button>`
  : '<a class="wt-btn wt-btn--secondary" href="#/">Sign in</a>');

export function renderSpots(r) {
  if (!$app.querySelector('.spots')) mount();
  else $app.querySelector('.wt-app-bar').outerHTML = headHTML(); // signed in or out since
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

function mount() {
  $app.innerHTML = `
    ${headHTML()}
    <main class="home spots">
      <section class="spots-list" aria-label="Spots">
        <div class="spots-find spots-band">
          <div class="spots-search spots-band"><label class="wt-input wt-input-group wt-search">${ICON.search}
            <input type="search" name="q" placeholder="Search spots, cities or states" aria-label="Search spots" autocomplete="off">
            <span class="wt-spinner" hidden></span>
            <button type="button" class="wt-search__clear" aria-label="Clear search" hidden>${ICON.close}</button></label></div>
          <div class="spots-filters">
            <select class="wt-input" name="country" aria-label="Country"></select>
            <select class="wt-input" name="state" aria-label="State"></select>
            <select class="wt-input" name="city" aria-label="City"></select>
          </div>
        </div>
        <p class="spots-count" role="status"></p>
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
  list.querySelector('.wt-search__clear').addEventListener('click', e => {
    e.preventDefault();
    input.value = s.q = '';
    showClear();
    input.focus();
    writeQuery();
    search();
  });
  list.querySelector('.spots-filters').addEventListener('change', e => pick(e.target.name, e.target.value));
  list.querySelector('.spots-more').addEventListener('click', () => search('more'));
  list.querySelector('.spots-pager').addEventListener('click', e => {
    const to = e.target.closest('[data-page]');
    if (!to || to.disabled || +to.dataset.page === s.page) return;
    s.page = +to.dataset.page;
    writeQuery(true); // a page of its own in the history, so Back goes to the page before
    search(s.page).then(() => list.scrollIntoView({ block: 'start' }));
  });
  list.addEventListener('click', e => {
    if (e.target.closest('.wt-spot-card')) s.fromList = true;
    if (e.target.closest('[data-retry]')) search(s.page);
  });
  $app.querySelector('.spots-entry').addEventListener('click', e => {
    // Back to the list you came from, as it was; from a link someone sent, to the list
    if (e.target.closest('.wt-guide__back') && s.fromList) { e.preventDefault(); s.fromList = false; history.back(); }
  });
  s.query = s.key = null; // asked again: renderSpots reads the address, and shows the spot afresh
  if (!s.cities) loadCities(); else renderFilters();
  if (s.results.length) showResults(); // as it was, while it's asked again
}
// The search (and on a computer, the filters) stay at the top of the list as it scrolls, just under the app bar,
// whatever height the bar is (the phone's safe area adds to it): see .spots-band in styles.css
function stickUnderBar() {
  const bar = $app.querySelector('.wt-app-bar');
  if (bar && !bar.hidden) $app.style.setProperty('--spots-stick', `${bar.offsetHeight}px`);
}
addEventListener('resize', () => { if ($app.dataset.page === 'spots') stickUnderBar(); });
const showClear = () => { const b = $app.querySelector('.wt-search__clear'); if (b) b.hidden = !s.q; };

// ---------- The address: what's asked, after #/spots? ----------
function readQuery(query) {
  const p = new URLSearchParams(query);
  Object.assign(s, { q: p.get('q') ?? '', country: p.get('country') ?? '', state: p.get('state') ?? '', city: p.get('city') ?? '',
    page: wide.matches ? Math.max(1, Number.parseInt(p.get('page') ?? '1', 10) || 1) : 1, query });
  const input = $app.querySelector('.spots-list [name="q"]');
  if (input) input.value = s.q;
  showClear();
  renderFilters();
}
// Searching and filtering change the address in place; a page of the pager is a step of its own (push)
function writeQuery(push = false) {
  const p = new URLSearchParams();
  for (const k of ['q', 'country', 'state', 'city']) if (s[k].trim()) p.set(k, s[k].trim());
  if (push && s.page > 1) p.set('page', String(s.page));
  else s.page = push ? s.page : 1;
  s.query = p.toString();
  history[push ? 'pushState' : 'replaceState'](push ? null : history.state, '', `#/spots${s.query ? `?${s.query}` : ''}`);
}

// ---------- Filters: country, then state, then city ----------
async function loadCities() {
  try { s.cities = await api('/spots/cities'); } catch { s.cities = null; return; }
  if ($app.dataset.page === 'spots') renderFilters();
}
function renderFilters() {
  const root = $app.querySelector('.spots-filters');
  if (!root) return;
  const all = s.cities || [];
  const countries = [...new Set(all.map(c => c.country))];
  const inCountry = all.filter(c => !s.country || c.country === s.country);
  const states = [...new Map(inCountry.map(c => [`${c.country}-${c.state}`, c])).values()]
    .sort((a, b) => regionName(a.country, a.state).localeCompare(regionName(b.country, b.state)));
  const cities = inCountry.filter(c => !s.state || c.state === s.state).sort((a, b) => a.name.localeCompare(b.name));
  const option = (value, text, on) => `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
  const set = (name, html) => { root.querySelector(`[name="${name}"]`).innerHTML = html; };
  set('country', option('', 'All countries') + countries.map(c => option(c, countryName(c), c === s.country)).join(''));
  set('state', option('', 'All states') + states.map(c => option(c.state, regionName(c.country, c.state), c.state === s.state)).join(''));
  set('city', option('', 'All cities') + cities.map(c => option(c.id, s.state ? c.name : `${c.name}, ${c.state}`, c.id === s.city)).join(''));
  // One country so far: nothing to choose, so it stays out of the way until there's a second
  root.querySelector('[name="country"]').hidden = countries.length < 2 && !s.country;
}
// A wider choice drops the narrower ones it doesn't hold; a city sets its state
function pick(name, value) {
  const city = name === 'city' && value && s.cities?.find(c => c.id === value);
  if (city) Object.assign(s, { city: city.id, state: city.state });
  else s[name] = value;
  const fits = c => (!s.country || c.country === s.country) && (!s.state || c.state === s.state);
  if (name === 'country' && s.state && !s.cities?.some(fits)) s.state = '';
  if (s.city && !s.cities?.some(c => c.id === s.city && fits(c))) s.city = '';
  renderFilters();
  writeQuery();
  search();
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
  const params = new URLSearchParams({ q: s.q.trim(), country: s.country, state: s.state, city: s.city, offset: String(offset), limit: String(limit) });
  for (const [k, v] of [...params]) if (!v || (k === 'offset' && v === '0')) params.delete(k);
  const spin = $app.querySelector('.spots-list .wt-spinner');
  if (spin) spin.hidden = false;
  if (!s.loaded) showLoading();
  try {
    const got = await api(`/spots/search?${params}`);
    if (n !== s.asked) return; // a newer search is on its way
    Object.assign(s, { page, more: got.more, total: got.total, loaded: true, results: to === 'more' ? [...s.results, ...got.results] : got.results });
    showResults();
  } catch (err) {
    if (n !== s.asked) return;
    const grid = $app.querySelector('.spots-grid');
    if (grid) grid.innerHTML = `<div class="wt-empty spots-empty"><p>${esc(err.code === 'rate_limited' ? failHint(err) : `Couldn’t load the spots. ${failHint(err)}`)}</p>
      <button type="button" class="wt-btn wt-btn--secondary" data-retry>Try again</button></div>`;
    const count = $app.querySelector('.spots-count');
    if (count) count.textContent = '';
  } finally {
    if (n === s.asked && spin?.isConnected) spin.hidden = true;
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
  const filtered = s.q.trim() || s.country || s.state || s.city, city = s.cities?.find(c => c.id === s.city);
  grid.innerHTML = s.results.length ? s.results.map(cardHTML).join('')
    : `<p class="wt-empty spots-empty">${filtered ? (s.q.trim() ? `No spots match “${esc(s.q.trim())}”.` : 'No spots there yet.') + ' Try another name or place.' : 'No spots yet.'}</p>`;
  // How many, which a screen reader hears once, rather than every card again
  $app.querySelector('.spots-count').textContent = s.total ? `${s.total.toLocaleString('en-US')} ${s.total === 1 ? 'spot' : 'spots'}` : '';
  $app.querySelector('.spots-note').textContent = `${city ? `In the guide’s order for ${city.name}: where to go first, first.`
    : 'Most viewed first: by how often each place’s Wikipedia article was read in the last year.'} Each guide is written by AI from the sources it lists.`;
  const pages = Math.ceil(s.total / perPage()), pager = $app.querySelector('.spots-pager');
  $app.querySelector('.spots-more').hidden = wide.matches || !s.more;
  pager.hidden = !wide.matches || pages < 2;
  pager.innerHTML = pager.hidden ? '' : `
    <button type="button" class="wt-pager__step" data-page="${s.page - 1}" aria-label="Previous page"${s.page > 1 ? '' : ' disabled'}>${ICON.back}</button>
    ${pageList(s.page, pages).map(p => p === '…' ? '<span class="wt-pager__gap" aria-hidden="true">…</span>'
      : `<button type="button" class="wt-pager__page" data-page="${p}" aria-label="Page ${p}"${p === s.page ? ' aria-current="page"' : ''}>${p}</button>`).join('')}
    <button type="button" class="wt-pager__step" data-page="${s.page + 1}" aria-label="Next page"${s.page < pages ? '' : ' disabled'}>${ICON.forward}</button>`;
}
const spotHash = p => `#/spots/${encodeURIComponent(p.city.id)}/${encodeURIComponent(p.source)}/${encodeURIComponent(p.id)}`;
function cardHTML(p) {
  const photo = p.hero?.thumb
    ? `<img class="wt-spot-card__photo" src="${esc(p.hero.thumb)}" alt="" loading="lazy" decoding="async" title="Photo: ${esc(p.hero.author || 'Unknown author')} · ${esc(p.hero.licence || '')}">`
    : `<span class="wt-spot-card__photo wt-spot-card__photo--none" aria-hidden="true">${ICON.pin}</span>`;
  return `<a class="wt-spot-card" href="${spotHash(p)}">
    ${photo}
    <span class="wt-spot-card__body"><span class="wt-spot-card__name">${esc(p.name)}</span>
      <span class="wt-spot-card__line">${esc(p.oneLiner)}</span>
      <span class="wt-spot-card__where">${esc(`${p.city.name}, ${p.state}`)}</span></span></a>`;
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
  el.innerHTML = entryHTML(g);
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
  return `<article class="wt-guide">
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
  </article>`;
}
