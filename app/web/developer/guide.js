'use strict';

/* Guide preview: each destination's picks and their guidebook entries (GET /api/developer/spots/guides/*), at
   /developer/guide, to review what the model wrote before any of it reaches the app. Read-only and open to anyone.
   Product-only: nothing to show without the server, so the prototype has no copy.
   #<destination> is a destination's picks; #<destination>/<source>/<id> one pick's entry. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text ?? href)}</a>`;
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const SOURCE_KIND = { wikipedia: 'Wikipedia', 'official website': 'Official website', 'National Park Service': 'National Park Service' };

async function api(path) {
  const res = await fetch(`/api/developer/spots/guides${path}`);
  if (res.status === 429) throw new Error('Too many lookups from here. Try again in a minute.');
  if (res.status === 404) throw new Error('It isn’t in the guide any more.');
  if (!res.ok) throw new Error('The guide couldn’t be loaded. Try again.');
  return res.json();
}
const message = (title, text) => `<p class="wt-results__msg"><b>${esc(title)}</b>${esc(text)}</p>`;
const head = (crumbs, title, intro) => `<header class="dev__head">
    <p class="dev__crumb">${crumbs.map(([href, text]) => `<a href="${esc(href)}">${esc(text)}</a>`).join(' / ')}</p>
    <h1 class="dev__title">${esc(title)}</h1>${intro ? `<p class="dev__intro">${intro}</p>` : ''}</header>`;
const REVIEW = 'Written by a model from the sources each entry lists, for review: not in the app yet.';

// A Commons photo, with its credit: author, licence, and a link to its page there
const credit = img => `${esc(img.author || 'Unknown author')}, ${esc(img.licence || 'see Commons')}, via ${link(img.page, 'Wikimedia Commons')}`;
const figure = (img, cls) => img ? `<figure class="guide__figure ${cls}">
    <img src="${esc(img.thumb)}" alt="${esc(img.caption)}" width="${img.width ?? ''}" height="${img.height ?? ''}" loading="lazy">
    <figcaption>${esc(img.caption)} <span class="guide__credit">${credit(img)}</span></figcaption></figure>` : '';

// ---------- The destinations ----------
async function showDestinations() {
  const dests = await api('');
  document.title = 'Guide preview · Dotsie';
  $('#guide').innerHTML = head([['/developer', 'Developers']], 'Guide preview', esc(REVIEW)) + (dests.length
    ? `<div class="dev__results">${dests.map(d => `<a class="wt-option" href="#${esc(d.id)}">
        <span class="wt-option__text"><span class="wt-option__label">${esc(d.name)}</span>
        <span class="wt-option__detail">${esc([d.kind, d.state, `${d.picks} picks`, day(d.builtAt)].filter(Boolean).join(' · '))}</span></span></a>`).join('')}</div>`
    : message('No destinations yet', 'The guides workflow hasn’t written one yet.'));
}

// ---------- A destination's picks ----------
async function showPicks(dest) {
  const d = await api(`/${encodeURIComponent(dest)}`);
  document.title = `${d.name} · Guide preview · Dotsie`;
  const c = d.counts ?? {};
  const how = c.candidates ? `Chosen from ${c.candidates.toLocaleString('en-US')} places with a Wikipedia article or an NPS page: ${c.sights} judged sights, the ${c.shortlist} most read of them shortlisted. ` : '';
  $('#guide').innerHTML = head([['/developer', 'Developers'], ['#', 'Guide preview']], d.name,
    `${esc(d.picks.length)} places worth a special trip. ${esc(how)}${esc(REVIEW)} Built ${esc(day(d.builtAt))}.`) +
    `<ol class="guide__picks">${d.picks.map(p => `<li><a class="guide__pick" href="#${esc(d.id)}/${esc(p.source)}/${esc(p.id)}">
        ${p.hero ? `<img src="${esc(p.hero.thumb)}" alt="" loading="lazy">` : '<span class="guide__nophoto"></span>'}
        <span class="guide__pick-text"><span class="guide__rank">${p.rank}</span> <span class="wt-option__label">${esc(p.name)}</span>
        <span class="guide__oneliner">${esc(p.oneLiner)}</span></span></a></li>`).join('')}</ol>` +
    (d.leftOut.length ? `<section class="dev__section"><h2 class="dev__h2">Left out</h2>
      <p class="dev__hint">Shortlisted, and not picked: the model’s reasons.</p>
      <dl class="dev__fields">${d.leftOut.map(l => `<dt>${esc(l.name)}</dt><dd>${esc(l.reason)}</dd>`).join('')}</dl></section>` : '');
}

// ---------- One pick's entry ----------
async function showEntry(dest, source, id) {
  const g = await api(`/${encodeURIComponent(dest)}/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
  document.title = `${g.name} · ${g.destination.name} · Guide preview · Dotsie`;
  const after = n => g.images.inline.filter(i => i.after_paragraph === n).map(i => figure(i, 'guide__figure--inline')).join('');
  const where = g.lat != null ? `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}` : null;
  const photos = [g.images.hero, ...g.images.inline].filter(Boolean);
  $('#guide').innerHTML = `
    <p class="dev__crumb"><a href="/developer">Developers</a> / <a href="#">Guide preview</a> / <a href="#${esc(dest)}">${esc(g.destination.name)}</a></p>
    <article class="guide">
      ${figure(g.images.hero, 'guide__hero')}
      <header class="guide__head">
        <p class="dev__overline">${esc(g.destination.name)} · pick ${g.rank}</p>
        <h1 class="guide__name">${esc(g.name)}</h1>
        <p class="guide__lede">${esc(g.oneLiner)}</p>
      </header>
      ${g.paragraphs.map((p, i) => `<p class="guide__para">${esc(p.text)}<span class="guide__cites">${(p.sources ?? []).map(u => link(u, host(u))).join(' ')}</span></p>${after(i + 1)}`).join('')}
      ${g.practical.length ? `<section class="guide__practical"><h2 class="dev__h3">Before you go</h2>
        <dl class="dev__fields">${g.practical.map(f => `<dt>${esc(f.label)}</dt><dd>${esc(f.value)} ${f.source ? link(f.source, host(f.source)) : ''}</dd>`).join('')}</dl></section>` : ''}
      ${where ? `<p><a class="wt-btn wt-btn--secondary" href="${esc(where)}" target="_blank" rel="noopener">Open in Maps</a></p>` : ''}
      <section class="guide__review">
        <h2 class="dev__h3">For review</h2>
        <dl class="dev__fields">
          <dt>Why it’s a pick</dt><dd>${esc(g.reason)}</dd>
          <dt>Shared wording</dt><dd>${g.overlap != null ? `${(g.overlap * 100).toFixed(1)}% of its 8-word phrases are also in the sources` : '–'}</dd>
          <dt>Written by</dt><dd>${esc(g.model)} (${esc(g.prompt)}), ${esc(day(g.createdAt))}</dd>
        </dl>
      </section>
      <footer class="guide__foot">
        <p>Sources: ${g.sources.map(s => link(s.url, SOURCE_KIND[s.kind] ?? s.kind)).join(', ')}. This entry is adapted from them and published under ${link('https://creativecommons.org/licenses/by-sa/4.0/', 'CC BY-SA 4.0')}.</p>
        ${photos.length ? `<p>Photos: ${photos.map(credit).join('; ')}.</p>` : ''}
      </footer>
    </article>`;
}

async function route() {
  const [dest, source, ...rest] = decodeURIComponent(location.hash.slice(1)).split('/');
  $('#guide').innerHTML = '<span class="wt-spinner"></span>';
  try {
    if (dest && source) await showEntry(dest, source, rest.join('/'));
    else if (dest) await showPicks(dest);
    else await showDestinations();
  } catch (err) {
    $('#guide').innerHTML = head([['/developer', 'Developers'], ['#', 'Guide preview']], 'Guide preview', '') + message('This couldn’t be shown', err.message);
  }
  scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
