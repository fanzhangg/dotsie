'use strict';

/* Spots data: search and read what outside sources say about places (GET /api/developer/spots/*), at /developer/spots.
   Read-only and open to anyone. Product-only: it has nothing to show without the server, so the prototype has no copy.
   A place opens at #place/<source>/<id>, so it can be linked to. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOURCES = { wikidata: 'Wikidata' };
const sourceName = s => SOURCES[s] ?? (s.startsWith('nps:') ? 'National Park Service' : s);
const count = n => n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString('en-US');
const day = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

$('#search-icon').innerHTML = DotsieIcons.svg('search', 20);

async function api(path) {
  const res = await fetch(`/api/developer/spots/${path}`);
  if (res.status === 429) throw new Error('Too many lookups from here. Try again in a minute.');
  if (res.status === 404) throw new Error('That place isn’t in the data any more.');
  if (!res.ok) throw new Error('The data couldn’t be loaded. Try again.');
  return res.json();
}
const message = (title, text) => `<p class="wt-results__msg"><b>${esc(title)}</b>${esc(text)}</p>`;

// ---------- The states loaded so far ----------
api('states').then(states => {
  for (const s of states) $('#state').insertAdjacentHTML('beforeend', `<option value="${esc(s.state)}">${esc(s.state)}</option>`);
  const total = states.reduce((n, s) => n + s.records, 0);
  if (states.length) {
    $('#loaded').textContent += ` Loaded so far: ${states.map(s => `${s.state} (${count(s.records)}, ${day(s.loadedAt)})`).join(', ')}; ${total.toLocaleString('en-US')} records.`;
  }
}).catch(() => {});

// ---------- Search ----------
let offset = 0, asked = 0, timer;
function search(more = false) {
  offset = more ? offset + 50 : 0;
  const n = ++asked, q = $('#q').value.trim();
  const params = new URLSearchParams({ q, state: $('#state').value, source: $('#source').value, offset: String(offset) });
  $('#spinner').hidden = false;
  api(`search?${params}`).then(({ results, more: hasMore }) => {
    if (n !== asked) return; // a newer search is on its way
    const rows = results.map(p => `<button type="button" class="wt-option" data-place="${esc(p.source)}/${esc(p.id)}">
        <span class="wt-option__text"><span class="wt-option__label">${esc(p.name)}</span>
        <span class="wt-option__detail">${esc([p.types.slice(0, 2).join(', '), p.description, p.state].filter(Boolean).join(' · '))}</span></span>
        ${p.views != null ? `<span class="data__views" title="English Wikipedia views, last 12 months">${count(p.views)}</span>` : ''}</button>`).join('');
    if (more) $('#results').insertAdjacentHTML('beforeend', rows);
    else $('#results').innerHTML = rows || message(q ? `Nothing named like “${q}”` : 'No places loaded yet', q ? 'Try part of the name, or another state or source.' : 'The data workflow hasn’t loaded a state yet.');
    $('#more').hidden = !hasMore;
  }).catch(err => {
    if (n === asked) $('#results').innerHTML = message('Search didn’t work', err.message);
  }).finally(() => { if (n === asked) $('#spinner').hidden = true; });
}
$('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 250); });
$('#state').addEventListener('change', () => search());
$('#source').addEventListener('change', () => search());
$('#more').addEventListener('click', () => search(true));
document.addEventListener('click', e => {
  const row = e.target.closest('[data-place]');
  if (row) location.hash = `place/${row.dataset.place}`;
});

// ---------- One place ----------
const link = (href, text) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text ?? href)}</a>` : '';
const field = (label, value) => value ? `<dt>${esc(label)}</dt><dd>${value}</dd>` : '';
function showPlace(p) {
  const at = p.lat != null ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '';
  const ids = Object.entries(p.ids).filter(([s]) => s !== 'url').map(([s, vs]) =>
    field(p.schemes[s] ? `${p.schemes[s]} (${s})` : s, vs.map(v => /^https?:\/\//.test(v) ? link(v) : esc(v)).join('<br>'))).join('');
  const links = p.links.map(l => `<button type="button" class="wt-option" data-place="${esc(l.source)}/${esc(l.id)}">
      <span class="wt-option__text"><span class="wt-option__label">${esc(l.name)}</span>
      <span class="wt-option__detail">${esc(sourceName(l.source))} · shares ${esc(p.schemes[l.via] ?? l.via)}</span></span></button>`).join('');
  $('#detail').innerHTML = `
    <button type="button" class="wt-btn wt-btn--secondary data__back" id="back">Back to search</button>
    <h2 class="data__name">${esc(p.name)}</h2>
    <dl class="data__fields">
      ${field('Description', esc(p.description))}
      ${field('Type', esc(p.types.join(', ')))}
      ${field('Source', link(p.url, `${sourceName(p.source)}: ${p.id}`) || esc(`${sourceName(p.source)}: ${p.id}`))}
      ${field('State', esc(p.state))}
      ${field('Location', at && link(`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=16/${p.lat}/${p.lng}`, at))}
      ${field('Wikipedia', p.wikipedia && link(`https://en.wikipedia.org/wiki/${encodeURIComponent(p.wikipedia.replace(/ /g, '_'))}`, p.wikipedia))}
      ${field('Wikipedia views', p.views != null ? `${p.views.toLocaleString('en-US')} in the last 12 months` : '')}
      ${field('Website', link(p.website))}
    </dl>
    ${ids ? `<h3 class="data__section">Identifiers</h3><dl class="data__fields">${ids}</dl>` : ''}
    ${links ? `<h3 class="data__section">Same place in other sources</h3><div class="data__results">${links}</div>` : ''}`;
  $('#back').addEventListener('click', () => { history.length > 1 ? history.back() : (location.hash = ''); });
}
async function route() {
  const m = location.hash.match(/^#place\/([^/]+)\/(.+)$/);
  $('#list').hidden = !!m;
  $('#detail').hidden = !m;
  if (!m) { document.title = 'Spots data · Dotsie'; return; }
  $('#detail').innerHTML = '<span class="wt-spinner"></span>';
  try {
    const p = await api(`place/${encodeURIComponent(decodeURIComponent(m[1]))}/${encodeURIComponent(decodeURIComponent(m[2]))}`);
    document.title = `${p.name} · Spots data · Dotsie`;
    showPlace(p);
  } catch (err) {
    $('#detail').innerHTML = `<button type="button" class="wt-btn wt-btn--secondary data__back" onclick="location.hash=''">Back to search</button>${message('This place couldn’t be shown', err.message)}`;
  }
  scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
search();
