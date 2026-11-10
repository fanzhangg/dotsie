/* Spots: the guide's places, open to anyone, signed in or not. #/spots lists them, most viewed first (in the guide's
   own order once a city is picked), with a search and filters for country, state and city, kept in the address
   (#/spots?q=…&state=WA&city=seattle&page=2) so it can be reloaded, sent and gone back through.
   #/spots/<city>/<source>/<id> is one spot's guide entry, from which it can be added to a trip. The entries are
   written by a model from the sources each lists (pipeline/guides.py) and published under CC BY-SA 4.0. */
import { $app, AFTER_SIGN_IN, ICON, appBarHTML, avatarHTML, esc, failHint, uid } from './core.js';
import { api } from './backend.js';
import { me } from './signin.js';
import { setTrips } from './trips.js';
import { placeURL } from './routes.js';
import { regionName } from './regions.js';
import { toDate, toInput } from './time.js';
import { tripDates } from './home.js';
import { closeSheet, modalHead, openSheet } from './sheets.js';
import { failToast, toast } from './notices.js';

const countryName = (() => {
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
  return code => { try { return names?.of(code) ?? code; } catch { return code; } };
})();
// "2.1M", "48k", "950": how many times its Wikipedia article was read in the last 12 months
const views = n => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US');
const credit = img => `${esc(img.author || 'Unknown author')}, ${esc(img.licence || 'see Commons')}, via <a href="${esc(img.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
// "A, B and C"
const and = list => list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
const SOURCE_KIND = { wikipedia: 'Wikipedia', 'official website': 'the official website', 'National Park Service': 'the National Park Service' };

// What's asked and what's shown, kept while you go to a spot and back, or to Plan and back. `query` is the address's
// part after ?, as this state writes it: a different one (Back, Forward, a link) is asked again.
const s = { q: '', country: '', state: '', city: '', page: 1, query: null, cities: null, results: [], more: false, total: 0, loaded: false,
  asked: 0, key: null, scroll: 0, fromList: false, title: 'Spots · Dotsie', entry: null };
let timer = 0;

// ---------- The page ----------
// The app bar, as Home has it: the nav, and the account (or Sign in). The list, and a spot's entry over it, are filled
// in by script and kept while the page is open, so going back to the list finds it as it was.
const headHTML = () => appBarHTML('spots', me
  ? `<button class="wt-icon-btn" data-action="account" aria-label="Account">${avatarHTML({ name: me.name, image: me.image, identity: 1 })}</button>`
  : '<a class="wt-btn wt-btn--secondary" href="#/">Sign in</a>');

export function renderSpots(r) {
  $app.dataset.page = 'spots';
  if (!$app.querySelector('.spots')) mount();
  else $app.querySelector('.wt-app-bar').outerHTML = headHTML(); // signed in or out since
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
        <div class="spots-find">
          <label class="wt-input wt-input-group wt-search">${ICON.search}
            <input type="search" name="q" placeholder="Search spots, cities or states" aria-label="Search spots" autocomplete="off">
            <span class="wt-spinner" hidden></span>
            <button type="button" class="wt-search__clear" aria-label="Clear search" hidden>${ICON.close}</button></label>
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
    if (e.target.closest('[data-add-to-trip]')) addToTrip(s.entry);
    if (e.target.closest('[data-sign-in-to-add]')) { try { sessionStorage.setItem(AFTER_SIGN_IN, location.hash); } catch {} }
  });
  s.query = s.key = null; // asked again: renderSpots reads the address, and shows the spot afresh
  if (!s.cities) loadCities(); else renderFilters();
  if (s.results.length) showResults(); // as it was, while it's asked again
}
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
// A photo that won't load (offline, blocked) gives way to the card's pin
document.addEventListener('error', e => {
  const img = e.target;
  if (img.classList?.contains('wt-spot-card__photo')) img.outerHTML = `<span class="wt-spot-card__photo wt-spot-card__photo--none" aria-hidden="true">${ICON.pin}</span>`;
  else if (img.closest?.('.wt-guide__figure')) img.closest('.wt-guide__figure').remove();
}, true);

// ---------- One spot ----------
async function showEntry({ city, source, id }) {
  const key = `${city}/${source}/${id}`, el = $app.querySelector('.spots-entry');
  if (s.key === key) { if (el.querySelector('.wt-guide')) el.querySelector('.spots-actions').outerHTML = actionsHTML(s.entry); return; }
  s.key = key;
  s.entry = null;
  s.title = document.title = 'Spots · Dotsie';
  el.innerHTML = `${backHTML()}<span class="wt-spinner"></span>`;
  scrollTo(0, 0);
  let g;
  try { g = await api(`/spots/${encodeURIComponent(city)}/${encodeURIComponent(source)}/${encodeURIComponent(id)}`); } catch (err) {
    if (s.key !== key) return;
    el.innerHTML = `${backHTML()}<p class="wt-empty">${esc(err.code === 'not_found' ? 'This spot isn’t in the guide any more.' : `Couldn’t load this spot. ${failHint(err)}`)}</p>`;
    return;
  }
  if (s.key !== key) return;
  s.entry = g;
  s.title = document.title = `${g.name} · Spots · Dotsie`;
  el.innerHTML = backHTML() + entryHTML(g);
}
const backHTML = () => `<a class="wt-guide__back" href="#/spots${s.query ? `?${s.query}` : ''}">${ICON.back}All spots</a>`;
// Add it to a trip (signed in), or sign in first and come back here; then the maps app, and its website
function actionsHTML(g) {
  const maps = g.lat != null ? placeURL({ name: g.name, address: `${g.destination.name}, ${g.destination.state}`, lat: g.lat, lng: g.lng }) : null;
  return `<div class="spots-actions">
    ${g.lat == null ? '' : me ? `<button type="button" class="wt-btn wt-btn--primary" data-add-to-trip>${ICON.plus}Add to a trip</button>`
      : `<a class="wt-btn wt-btn--primary" href="#/" data-sign-in-to-add>${ICON.plus}Sign in to add to a trip</a>`}
    ${maps ? `<a class="wt-btn wt-btn--secondary" href="${esc(maps)}" target="_blank" rel="noopener">${ICON.map}Open in Maps</a>` : ''}
    ${g.website ? `<a class="wt-btn wt-btn--secondary" href="${esc(g.website)}" target="_blank" rel="noopener">${ICON.external}Website</a>` : ''}</div>`;
}
function entryHTML(g) {
  const figure = img => img?.thumb ? `<figure class="wt-guide__figure">
      <img src="${esc(img.thumb)}" alt="${esc(img.caption || '')}"${img.width ? ` width="${+img.width}" height="${+img.height}"` : ''} loading="lazy" decoding="async">
      <figcaption>${img.caption ? `${esc(img.caption)} ` : ''}<span class="wt-guide__credit">${credit(img)}</span></figcaption></figure>` : '';
  const inline = g.images?.inline ?? [];
  const after = n => inline.filter(i => i.after_paragraph === n).map(figure).join('');
  const photos = [g.images?.hero, ...inline].filter(i => i?.thumb);
  const at = `${g.destination.name}, ${regionName(g.destination.country, g.destination.state)}`;
  const sources = (g.sources ?? []).map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(SOURCE_KIND[x.kind] ?? x.kind)}</a>`);
  return `<article class="wt-guide">
    ${figure(g.images?.hero)}
    <header class="wt-guide__head">
      <p class="wt-guide__where">${esc(at)}</p>
      <h2 class="wt-guide__name">${esc(g.name)}</h2>
      <p class="wt-guide__lede">${esc(g.oneLiner)}</p>
    </header>
    ${(g.paragraphs ?? []).map((p, i) => `<p class="wt-guide__para">${esc(p.text)}</p>${after(i + 1)}`).join('')}
    ${g.practical?.length ? `<section class="wt-guide__facts"><h3>Before you go</h3>
      <dl>${g.practical.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join('')}</dl></section>` : ''}
    ${actionsHTML(g)}
    <footer class="wt-guide__foot">
      <p>Written by AI from ${sources.length ? and(sources) : 'its sources'}, and published under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.${g.views != null ? ` Its Wikipedia article was read ${views(g.views)} times in the last year.` : ''}</p>
      ${photos.length ? `<p>Photos: ${photos.map(credit).join('; ')}.</p>` : ''}
    </footer>
  </article>`;
}

// ---------- Adding a spot to a trip ----------
// Your trips, to pick one, and a new trip named after the spot's city. The stop goes two hours after the trip's last
// stop (by 10 PM, or else 9 AM the day after), or 9 AM tomorrow in a trip with none, as an attraction, with its
// Wikidata item (so its stop sheet has its photo and lines) and a link back to its guide.
function addToTrip(g) {
  if (!g) return;
  openSheet(`${modalHead('Add to a trip')}<div class="spots-trips"><span class="wt-spinner"></span></div>`, async el => {
    const box = el.querySelector('.spots-trips');
    let list;
    try { list = await api('/trips'); } catch (err) {
      box.innerHTML = `<p class="wt-results__msg"><b>Couldn’t load your trips</b>${esc(failHint(err))}</p>`;
      return;
    }
    const item = (value, label, detail, icon = '') => `<li><button type="button" class="wt-option" data-trip="${esc(value)}">${icon}
      <span class="wt-option__text"><span class="wt-option__label">${esc(label)}</span>${detail ? `<span class="wt-option__detail">${esc(detail)}</span>` : ''}</span></button></li>`;
    box.innerHTML = `<ul class="wt-options" aria-label="Your trips">${list.map(t => item(t.id, t.name, tripDates(t))).join('')}
      ${item('', `New trip: ${g.destination.name}`, '', ICON.plus)}</ul>`;
    box.addEventListener('click', async e => {
      const b = e.target.closest('[data-trip]');
      if (!b || box.dataset.busy) return;
      box.dataset.busy = '1';
      b.disabled = true;
      try {
        const trip = b.dataset.trip ? list.find(t => t.id === b.dataset.trip)
          : (await api('/trips', { method: 'POST', body: { name: g.destination.name } })).trip;
        await api(`/trips/${trip.id}/stops/${uid()}`, { method: 'PUT', body: stopFor(g, trip.stops ?? []) });
        setTrips(null); // Home's cards ask again
        closeSheet();
        toast(`Added to ${trip.name}`, 'Open', () => { location.hash = `#/trip/${trip.id}`; });
      } catch (err) {
        delete box.dataset.busy;
        b.disabled = false;
        if (err.status !== 401) failToast(err, 'Couldn’t add it to the trip');
      }
    });
  });
}
function stopFor(g, stops) {
  const last = stops.map(x => x.time).filter(Boolean).sort().at(-1);
  let d;
  if (last) {
    d = toDate(last);
    const day = d.getDate();
    d.setHours(d.getHours() + 2, 0, 0, 0);
    if (d.getDate() !== day || d.getHours() > 22) { d = toDate(last); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  } else { d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  const guide = `${location.origin}${location.pathname}#/spots/${encodeURIComponent(g.destination.id)}/${encodeURIComponent(g.source)}/${encodeURIComponent(g.id)}`;
  return { name: g.name, address: `${g.destination.name}, ${g.destination.state}`, lat: g.lat, lng: g.lng, time: toInput(d), note: '',
    kind: 'attraction', wikidata: g.source === 'wikidata' ? g.id : null, links: [{ url: guide, label: 'Guide' }] };
}
