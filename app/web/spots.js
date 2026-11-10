/* Spots: the guide's places, open to anyone, signed in or not. #/spots lists them, most viewed first, with a search
   and filters for country, state and city; #/spots/<city>/<source>/<id> is one spot's guide entry. The entries are
   written by a model from the sources each lists (pipeline/guides.py) and published under CC BY-SA 4.0. */
import { $app, ICON, appBarHTML, avatarHTML, esc, failHint } from './core.js';
import { api } from './backend.js';
import { me } from './signin.js';
import { placeURL } from './routes.js';

// What each country's states (or provinces) are called; any other shows its code
const REGIONS = {
  US: { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
    MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
    PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
    VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' },
  CA: { AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick', NL: 'Newfoundland and Labrador', NS: 'Nova Scotia',
    NT: 'Northwest Territories', NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon' },
};
const regionName = (country, state) => REGIONS[country]?.[state] ?? state;
const countryName = (() => {
  let names = null;
  try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch {}
  return code => { try { return names?.of(code) ?? code; } catch { return code; } };
})();
// "2.1M", "48k", "950": how many times its Wikipedia article was read in the last 12 months
const views = n => n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US');
const VIEWS_TITLE = 'English Wikipedia views in the last 12 months';
const credit = img => `${esc(img.author || 'Unknown author')}, ${esc(img.licence || 'see Commons')}, via <a href="${esc(img.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
// "A, B and C"
const and = list => list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
const SOURCE_KIND = { wikipedia: 'Wikipedia', 'official website': 'the official website', 'National Park Service': 'the National Park Service' };

// What's asked and what's shown, kept while you go to a spot and back, or to Plan and back
const s = { q: '', country: '', state: '', city: '', cities: null, results: [], more: false, total: 0, page: 1, asked: 0, offset: 0, key: null, scroll: 0, fromList: false, title: 'Spots · Dotsie' };
let timer = 0;

// ---------- The page ----------
// The app bar, as Home has it: the logo, the nav, and the account (or Sign in). The list, and a spot's entry over it,
// are filled in by script and kept while the page is open, so going back to the list finds it as it was.
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
  } else {
    entry.hidden = true;
    entry.innerHTML = '';
    s.key = null;
    const back = list.hidden;
    list.hidden = false;
    if (back) scrollTo(0, s.scroll);
  }
}

function mount() {
  $app.innerHTML = `
    ${headHTML()}
    <main class="home spots">
      <section class="spots-list" aria-label="Spots">
        <div class="spots-find">
          <label class="wt-input wt-input-group wt-search">${ICON.search}
            <input type="search" name="q" placeholder="Search spots" aria-label="Search spots" autocomplete="off" value="${esc(s.q)}">
            <span class="wt-spinner" hidden></span></label>
          <div class="spots-filters">
            <select class="wt-input" name="country" aria-label="Country"></select>
            <select class="wt-input" name="state" aria-label="State"></select>
            <select class="wt-input" name="city" aria-label="City"></select>
          </div>
        </div>
        <div class="home-grid spots-grid" aria-live="polite"></div>
        <button type="button" class="wt-btn wt-btn--secondary spots-more" hidden>Show more</button>
        <nav class="wt-pager spots-pager" aria-label="Pages of spots" hidden></nav>
        <p class="spots-note">Most viewed first: by how often each place’s Wikipedia article was read in the last year. Each guide is written by AI from the sources it lists.</p>
      </section>
      <section class="spots-entry" hidden></section>
    </main>`;
  const list = $app.querySelector('.spots-list');
  list.querySelector('[name="q"]').addEventListener('input', e => { s.q = e.target.value; clearTimeout(timer); timer = setTimeout(search, 250); });
  list.querySelector('.spots-filters').addEventListener('change', e => pick(e.target.name, e.target.value));
  list.querySelector('.spots-more').addEventListener('click', () => search('more'));
  list.querySelector('.spots-pager').addEventListener('click', e => {
    const to = e.target.closest('[data-page]');
    if (!to || to.disabled || +to.dataset.page === s.page) return;
    search(+to.dataset.page).then(() => list.scrollIntoView({ block: 'start' }));
  });
  list.addEventListener('click', e => { if (e.target.closest('.wt-spot-card')) s.fromList = true; });
  $app.querySelector('.spots-entry').addEventListener('click', e => {
    // Back to the list you came from, as it was; from a link someone sent, to the list
    if (e.target.closest('.wt-guide__back') && s.fromList) { e.preventDefault(); s.fromList = false; history.back(); }
  });
  renderFilters();
  if (!s.cities) loadCities();
  if (s.results.length) showResults(); // as it was, while it's asked again
  search();
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
  const set = (name, html) => { const el = root.querySelector(`[name="${name}"]`); el.innerHTML = html; };
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
  search();
}

// ---------- The list ----------
// On a phone, a list that grows: Show more adds the next 30 under what you've scrolled through. On a computer, pages of
// 24 cards (rows of 2, 3 or 4) with a pager under them, so the page you're on, and how many there are, is clear.
const wide = matchMedia('(min-width: 768px)');
const perPage = () => (wide.matches ? 24 : 30);
wide.addEventListener('change', () => { if ($app.querySelector('.spots')) search(); });
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
  try {
    const got = await api(`/spots/search?${params}`);
    if (n !== s.asked) return; // a newer search is on its way
    Object.assign(s, { page, offset, more: got.more, total: got.total, results: to === 'more' ? [...s.results, ...got.results] : got.results });
    showResults();
  } catch (err) {
    if (n !== s.asked) return;
    const grid = $app.querySelector('.spots-grid');
    if (grid) grid.innerHTML = `<p class="wt-empty spots-empty">${esc(err.code === 'rate_limited' ? failHint(err) : `Couldn’t load the spots. ${failHint(err)}`)}</p>`;
  } finally {
    if (n === s.asked && spin?.isConnected) spin.hidden = true;
  }
}
function showResults() {
  const grid = $app.querySelector('.spots-grid');
  if (!grid) return;
  const filtered = s.q.trim() || s.country || s.state || s.city;
  grid.innerHTML = s.results.length ? s.results.map(cardHTML).join('')
    : `<p class="wt-empty spots-empty">${filtered ? (s.q.trim() ? `No spots match “${esc(s.q.trim())}”.` : 'No spots there yet.') + ' Try another name or place.' : 'No spots yet.'}</p>`;
  const pages = Math.ceil(s.total / perPage()), pager = $app.querySelector('.spots-pager');
  $app.querySelector('.spots-more').hidden = wide.matches || !s.more;
  pager.hidden = !wide.matches || pages < 2;
  pager.innerHTML = pager.hidden ? '' : `
    <button type="button" class="wt-pager__step" data-page="${s.page - 1}" aria-label="Previous page"${s.page > 1 ? '' : ' disabled'}>${ICON.back}</button>
    ${pageList(s.page, pages).map(p => p === '…' ? '<span class="wt-pager__gap" aria-hidden="true">…</span>'
      : `<button type="button" class="wt-pager__page" data-page="${p}" aria-label="Page ${p}"${p === s.page ? ' aria-current="page"' : ''}>${p}</button>`).join('')}
    <button type="button" class="wt-pager__step" data-page="${s.page + 1}" aria-label="Next page"${s.page < pages ? '' : ' disabled'}>${ICON.forward}</button>`;
}
const where = p => `${p.city.name}, ${p.state}`;
function cardHTML(p) {
  const photo = p.hero?.thumb
    ? `<img class="wt-spot-card__photo" src="${esc(p.hero.thumb)}" alt="" loading="lazy" decoding="async" title="Photo: ${esc(p.hero.author || 'Unknown author')} · ${esc(p.hero.licence || '')}">`
    : `<span class="wt-spot-card__photo wt-spot-card__photo--none" aria-hidden="true">${ICON.pin}</span>`;
  return `<a class="wt-spot-card" href="#/spots/${encodeURIComponent(p.city.id)}/${encodeURIComponent(p.source)}/${encodeURIComponent(p.id)}">
    ${photo}
    <span class="wt-spot-card__body"><span class="wt-spot-card__name">${esc(p.name)}</span>
      <span class="wt-spot-card__line">${esc(p.oneLiner)}</span>
      <span class="wt-spot-card__where">${esc(where(p))}${p.views != null ? ` · <span title="${VIEWS_TITLE}">${views(p.views)} views</span>` : ''}</span></span></a>`;
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
  if (s.key === key) return;
  s.key = key;
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
  s.title = document.title = `${g.name} · Spots · Dotsie`;
  el.innerHTML = backHTML() + entryHTML(g);
}
const backHTML = () => `<a class="wt-guide__back" href="#/spots">${ICON.back}All spots</a>`;
function entryHTML(g) {
  const figure = img => img?.thumb ? `<figure class="wt-guide__figure">
      <img src="${esc(img.thumb)}" alt="${esc(img.caption || '')}"${img.width ? ` width="${+img.width}" height="${+img.height}"` : ''} loading="lazy" decoding="async">
      <figcaption>${img.caption ? `${esc(img.caption)} ` : ''}<span class="wt-guide__credit">${credit(img)}</span></figcaption></figure>` : '';
  const inline = g.images?.inline ?? [];
  const after = n => inline.filter(i => i.after_paragraph === n).map(figure).join('');
  const photos = [g.images?.hero, ...inline].filter(i => i?.thumb);
  const at = `${g.destination.name}, ${regionName(g.destination.country, g.destination.state)}`;
  const maps = g.lat != null ? placeURL({ name: g.name, address: `${g.destination.name}, ${g.destination.state}`, lat: g.lat, lng: g.lng }) : null;
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
    ${maps || g.website ? `<div class="spots-actions">
      ${maps ? `<a class="wt-btn wt-btn--primary" href="${esc(maps)}" target="_blank" rel="noopener">${ICON.map}Open in Maps</a>` : ''}
      ${g.website ? `<a class="wt-btn wt-btn--secondary" href="${esc(g.website)}" target="_blank" rel="noopener">${ICON.external}Website</a>` : ''}</div>` : ''}
    <footer class="wt-guide__foot">
      <p>Written by AI from ${sources.length ? and(sources) : 'its sources'}, and published under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>.${g.views != null ? ` Its Wikipedia article was read ${views(g.views)} times in the last year.` : ''}</p>
      ${photos.length ? `<p>Photos: ${photos.map(credit).join('; ')}.</p>` : ''}
    </footer>
  </article>`;
}
