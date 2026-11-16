'use strict';

/* Trip plans: the days the Trip plans workflow suggests for a guide's destinations (GET /api/developer/spots/plans*),
   at /developer/plans, for review before any of it reaches the app. Read-only and open to anyone. Product-only, like the
   guide preview: the prototype has no copy. #<plan id> is one plan, day by day, with its article; each place links to
   its entry in the guide preview, where its text is. */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = iso => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const plural = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const dur = m => m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ''}`;
const clock = hhmm => { const [h, m] = hhmm.split(':').map(Number); return `${(h + 11) % 12 + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const KIND = { attraction: 'Attraction', museum: 'Museum', nature: 'Nature', shopping: 'Shopping', viewpoint: 'Viewpoint' };
const MEAL = { lunch: 'Lunch', dinner: 'Dinner' };
const REVIEW = 'Made by a model from the guide’s picks and their entries, then checked in code: open at that time, time to get from one place to the next, a day’s travel and length, lunch every day. A plan that still fails a check isn’t loaded.';

async function api(path) {
  const res = await fetch(`/api/developer/spots/plans${path}`);
  if (res.status === 429) throw new Error('Too many lookups from here. Try again in a minute.');
  if (res.status === 404) throw new Error('That plan isn’t in the data any more.');
  if (!res.ok) throw new Error('The plans couldn’t be loaded. Try again.');
  return res.json();
}
const message = (title, text) => `<p class="wt-results__msg"><b>${esc(title)}</b>${esc(text)}</p>`;
const head = (crumbs, title, intro) => `<header class="dev__head">
    <p class="dev__crumb">${crumbs.map(([href, text]) => href ? `<a href="${esc(href)}">${esc(text)}</a>` : esc(text)).join(' / ')}</p>
    <h1 class="dev__title">${esc(title)}</h1>${intro ? `<p class="dev__lede">${intro}</p>` : ''}</header>`;

// ---------- Every plan ----------
async function showPlans() {
  const plans = await api('');
  document.title = 'Trip plans · Dotsie';
  $('#plans').innerHTML = head([[null, 'Data']], 'Trip plans', esc(REVIEW)) + (plans.length
    ? `<div class="dev__results">${plans.map(p => `<a class="wt-option" href="#${esc(p.planId)}">
        <span class="wt-option__text"><span class="wt-option__label">${esc(p.headline || p.title)}</span>
        <span class="wt-option__detail">${esc([p.destinationName, plural(p.days, 'day'), plural(p.stops, 'place'), `for ${p.traveler.split(':')[0]}`, day(p.built)].filter(Boolean).join(' · '))}</span></span></a>`).join('')}</div>`
    : message('No plans yet', 'The Trip plans workflow hasn’t loaded one yet.'));
}

// ---------- One plan ----------
async function showPlan(id) {
  const p = await api(`/${encodeURIComponent(id)}`);
  const s = p.story, place = sid => p.places[sid];
  document.title = `${s?.headline || p.title} · Trip plans · Dotsie`;
  const entry = sid => { const x = place(sid); return x ? `/developer/guide#${encodeURIComponent(p.destination.id)}/${encodeURIComponent(x.source)}/${encodeURIComponent(x.id)}` : '#'; };
  const name = sid => `<a href="${esc(entry(sid))}">${esc(place(sid)?.name ?? sid)}</a>`;
  const leg = l => l ? `${dur(l.minutes)} ${l.mode === 'walk' ? 'on foot' : 'by car'}${l.coords ? '' : ' (estimate)'} from the place before` : '';
  const days = p.days.map(d => {
    const heading = s?.days.find(x => x.day === d.day)?.heading || d.theme;
    return `<section class="dev__section" aria-labelledby="day-${d.day}">
      <h2 class="dev__h2" id="day-${d.day}">Day ${d.day} · ${esc(heading)}</h2>
      <p class="dev__hint">${esc(d.intro)}</p>
      <ol class="plan__items">${d.items.map(i => {
        const x = place(i.spot_id);
        return `<li class="plan__item${MEAL[i.kind] ? ' plan__item--meal' : ''}"><span class="plan__time">${esc(clock(i.start))}</span>
          <span class="plan__what"><span>${MEAL[i.kind] ? `<b>${MEAL[i.kind]}</b> near ${name(i.spot_id)}` : `<b>${name(i.spot_id)}</b>`}</span>
            <span class="plan__meta">${esc([dur(i.minutes), !MEAL[i.kind] && x ? KIND[x.kind] ?? x.kind : '', leg(i.leg)].filter(Boolean).join(' · '))}</span>
            ${!MEAL[i.kind] && x?.oneLiner ? `<span class="plan__line">${esc(x.oneLiner)}</span>` : ''}
            <span class="plan__why">${esc(i.why)}</span></span></li>`;
      }).join('')}</ol></section>`;
  }).join('');
  const article = s ? `<details class="plan__article"><summary>Read it as an article</summary><div class="dev__prose">
      <p class="dev__lede">${esc(s.dek)}</p>${s.intro.map(t => `<p>${esc(t)}</p>`).join('')}
      ${s.days.map(x => `<h3 class="dev__h3">Day ${x.day}: ${esc(x.heading)}</h3>${x.parts.map(t => t.kind === 'text' ? `<p>${esc(t.text)}</p>` : `<p class="plan__card">${name(t.spot_id)}</p>`).join('')}`).join('')}
      <h3 class="dev__h3">Good to know</h3><ul>${s.good_to_know.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      <p>${esc(s.closing)}</p></div></details>` : '';
  const ideas = p.ideas.map(i => `<dt>${name(i.spot_id)}</dt><dd>${esc(i.why)}</dd>`).join('');
  $('#plans').innerHTML = head([[null, 'Data'], ['#', 'Trip plans'], [`/developer/guide#${encodeURIComponent(p.destination.id)}`, p.destination.name]],
    s?.headline || p.title, esc(s?.dek ?? '')) + `
    <dl class="dev__fields">
      <dt>Plan</dt><dd>${esc(`${p.title} (${p.planId})`)}</dd>
      <dt>For</dt><dd>${esc(p.traveler)}</dd>
      <dt>Places</dt><dd>${esc(`${p.stops}, in ${plural(p.days.length, 'day')}`)}</dd>
      <dt>Built</dt><dd>${esc(day(p.built))}, loaded ${esc(day(p.loadedAt))}</dd>
      <dt>Travel</dt><dd>OpenStreetMap routes, on foot or by car; driving doesn’t count parking.</dd>
    </dl>
    ${article}${days}
    ${ideas ? `<section class="dev__section" aria-labelledby="ideas"><h2 class="dev__h2" id="ideas">Left out, as ideas</h2>
      <p class="dev__hint">Places that didn’t fit, as a trip’s Want to go list.</p><dl class="dev__fields">${ideas}</dl></section>` : ''}`;
}

async function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  $('#plans').innerHTML = '<span class="wt-spinner"></span>';
  try {
    if (id) await showPlan(id);
    else await showPlans();
  } catch (err) {
    $('#plans').innerHTML = head([[null, 'Data'], ['#', 'Trip plans']], 'Trip plans', '') + message('This couldn’t be shown', err.message);
  }
  DevShell.update();
  scrollTo(0, 0);
}
addEventListener('hashchange', route);
route();
