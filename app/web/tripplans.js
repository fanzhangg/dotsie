/* A guide: a trip plan, a destination's suggested days made from its spots (pipeline/plan.py, docs/trip-plans.md),
   told as an article, open to anyone, signed in or not. The Guides page lists them (guides.js); #/guides/<id> is one, a
   page to read laid out as a spot's guide entry is (.wt-guide):
   - its lead photo, with the way back to the guides over its corner, the headline, and who it's for;
   - the plan at a glance: the day tabs, the open day's map (planmap.js), and its places numbered as their pins, with
     the times;
   - a chapter for each day, opening with "Day 2", its heading and what it asks of you (places, time on foot and by
     car), the article's text with a quiet card where each place comes up: its photo, which day and part of the day,
     its name (to its guide entry), its one-liner, how long to stay, and a bookmark to save it to a trip, as a spot
     card has;
   - Good to know, the places that didn't fit, and the credits;
   - its one action floating at the bottom, as a spot's page has Save to a trip: the trip's first day, which you can
     change, and Make it my trip, which makes it a trip of yours, every stop at its time and the places that didn't
     fit on its Want to go list, and opens it.
   The article holds no facts of its own about the places: each card is drawn from the place's fact card and entry. */
import { $app, ICON, esc, failHint, uid } from './core.js';
import { api } from './backend.js';
import { me } from './signin.js';
import { STOP_KINDS } from './fields.js';
import { KINDS, addDays } from './plan.js';
import { MONTHS, fmtDur, fmtTime, nowStamp, toDate } from './time.js';
import { regionName } from './regions.js';
import { openTripOn } from './timeline.js';
import { failToast, toast } from './notices.js';
import { ideaOf, loadMyTrips, openSpotFromPage, saveSpot, savedIn } from './spots.js';
import { drawPlanMap, kindOfPlace } from './planmap.js';
import { backToGuides, guidesHref } from './guides.js';

const plans = new Map(); // id → the plan whole, once asked this visit
let open = null; // the plan on the page: { id, plan, start, map, day, scroll }
const scrolls = new Map(); // id → how far down it was read, for coming back from a place's entry

// ---------- Formats ----------
const minutes = m => fmtDur(m * 60);
const sentence = t => String(t ?? '').replace(/^./, c => c.toUpperCase());
// "A first visit": who it's for, the part before the colon
const forWhom = p => sentence(String(p.traveler ?? '').split(':')[0]);
const clock = hhmm => fmtTime(`2000-01-01T${hhmm}`);
// "Morning", "Afternoon", "Evening": when in the day, as an article says it; the plan at a glance has the clock times
const partOfDay = hhmm => { const h = Number(hhmm.slice(0, 2)); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; };
const placeOf = (p, id) => p.places?.[id] ?? null;
const spotHash = (p, pl) => `#/spots/${encodeURIComponent(p.destination.id)}/${encodeURIComponent(pl.source)}/${encodeURIComponent(pl.id)}`;
const photoCredit = img => `${img.caption ? `${esc(img.caption)}: ` : ''}${esc(img.author || 'Unknown author')}, ${esc(img.licence || 'see Commons')}, via <a href="${esc(img.page)}" target="_blank" rel="noopener">Wikimedia Commons</a>`;
// A place's facts in one line, for its card: how long, when it's open, whether to book
function factsLine(f = {}) {
  const h = f.hours, hour = t => clock(t).replace(':00 ', ' ');
  const hours = h?.kind === 'stated' && h.open && h.close ? `${hour(h.open)}–${hour(h.close)}${h.closed_days?.length ? `, closed ${h.closed_days.join(', ')}` : ''}`
    : h?.kind === 'always' ? 'Open any time' : '';
  return [f.visit_minutes && `About ${minutes(f.visit_minutes)}`, hours, f.book_ahead ? 'Book ahead' : f.admission === 'free' ? 'Free' : ''].filter(Boolean).join(' · ');
}
// The trip's dates from its first day: "Nov 20–22", "Nov 30 – Dec 2"
export function datesText(start, days) {
  const a = toDate(start), b = toDate(addDays(start, Math.max(0, days - 1))), mon = d => MONTHS[d.getMonth()];
  return days < 2 ? `${mon(a)} ${a.getDate()}` : mon(a) === mon(b) ? `${mon(a)} ${a.getDate()}–${b.getDate()}` : `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}`;
}
// The coming Friday (or the one after, if it's Friday already): a weekend is when most people would go
export function nextFriday(today = nowStamp().slice(0, 10)) {
  const d = toDate(today);
  return addDays(today, ((5 - d.getDay()) + 7) % 7 || 7);
}

// A plan's stops, day by day, numbered from 1 each day as the day's list and its map number them
const stopsOn = (p, day) => (p.days.find(d => d.day === day)?.items ?? []).filter(i => i.kind === 'stop' && placeOf(p, i.spot_id))
  .map((i, n) => ({ ...i, day, n: n + 1, place: placeOf(p, i.spot_id) }));
const allStops = p => p.days.flatMap(d => stopsOn(p, d.day));
// A day's one name everywhere it shows: the article's heading for it, or the plan's theme when it has no article
const dayName = (p, day) => p.story?.days?.find(d => d.day === day)?.heading || p.days.find(d => d.day === day)?.theme || '';
// What a day asks of you: how many places, and how long on foot and by car between them
function daySum(d) {
  const legs = d.items.map(i => i.leg).filter(Boolean);
  const walk = legs.filter(l => l.mode === 'walk').reduce((a, l) => a + l.minutes, 0);
  const drive = legs.filter(l => l.mode !== 'walk').reduce((a, l) => a + l.minutes, 0);
  const n = d.items.filter(i => i.kind === 'stop').length;
  return [`${n} ${n === 1 ? 'place' : 'places'}`, walk && `${minutes(walk)} on foot`, drive && `${minutes(drive)} by car`].filter(Boolean).join(' · ');
}
// What the map draws for each day: its stops, and each leg's route from the place before it
function mapDays(p) {
  return new Map(p.days.map(d => {
    const legs = [];
    let prev = null;
    for (const i of d.items) {
      const pl = placeOf(p, i.spot_id);
      if (!pl) continue;
      if (prev && i.leg && (prev.lat !== pl.lat || prev.lng !== pl.lng)) legs.push({ from: [prev.lat, prev.lng], to: [pl.lat, pl.lng], coords: i.leg.coords || null });
      prev = pl;
    }
    return [d.day, { stops: stopsOn(p, d.day), legs }];
  }));
}

// ---------- The page ----------
export function renderPlan({ id }) {
  $app.dataset.page = 'plan';
  if (open?.id === id && $app.querySelector('.plan')) return;
  leavePlan();
  open = { id, plan: plans.get(id) ?? null, start: open?.id === id ? open.start : nextFriday(), map: null, day: 1 };
  document.title = 'Guides · Dotsie';
  if (open.plan) return show();
  $app.innerHTML = `<main class="home plan"><article class="wt-guide">${topHTML(null, null)}<span class="wt-spinner"></span></article></main>`;
  scrollTo(0, 0);
  api(`/spots/plans/${encodeURIComponent(id)}`).then(p => {
    plans.set(id, p);
    if (open?.id !== id) return;
    open.plan = p;
    show();
  }, err => {
    if (open?.id !== id) return;
    $app.querySelector('.plan .wt-guide').innerHTML = `${topHTML(null, null)}<p class="wt-empty">${esc(err.code === 'not_found' ? 'This guide isn’t here any more.' : `Couldn’t load this guide. ${failHint(err)}`)}</p>`;
  });
}
// Off the page: its map goes, and with it its WebGL context
export function leavePlan() {
  if (open) scrolls.set(open.id, scrollY);
  open?.map?.then(m => m.remove());
  open = null;
}

function show() {
  const p = open.plan;
  document.title = `${p.story?.headline || p.title} · Guides · Dotsie`;
  $app.innerHTML = `<main class="home plan">${articleHTML(p)}</main>${makeBarHTML()}`;
  placeTabBar();
  const el = $app.querySelector('.plan-map__canvas');
  open.map = drawPlanMap(el, { days: mapDays(p), day: open.day, onSelect: showPicked, onCredit: html => { const c = $app.querySelector('.plan-map-credit'); if (c) c.innerHTML = `Map ${html}.`; } });
  scrollTo(0, scrolls.get(open.id) ?? 0);
  scrolls.delete(open.id);
  markSaved();
}

// The lead photo across the top, with the way back over its corner: to the guides, as you left them
const topHTML = (p, hero) => `<div class="wt-guide__top${hero?.thumb ? ' wt-guide__top--photo' : ''}">
    <a class="wt-guide__back" href="${guidesHref()}" aria-label="All guides" data-plan-back>${ICON.back}</a>
    ${hero?.thumb ? `<img class="wt-guide__hero" src="${esc(hero.thumb)}" alt="${esc(hero.caption || '')}" decoding="async">` : ''}</div>`;

function articleHTML(p) {
  const stops = allStops(p), story = p.story;
  const hero = stops.map(s => s.place.hero).find(h => h?.thumb) ?? null;
  const first = new Map();
  for (const s of stops) if (!first.has(s.spot_id)) first.set(s.spot_id, s);
  // The article's days, or, before it has one, the plan's own: each day's intro, and a card for each place
  const chapters = story?.days?.length ? story.days : p.days.map(d => ({ day: d.day, heading: d.theme,
    parts: [{ kind: 'text', text: d.intro }, ...d.items.filter(i => i.kind === 'stop').map(i => ({ kind: 'spot', spot_id: i.spot_id }))] }));
  const shown = new Set();
  const chapterHTML = c => {
    const d = p.days.find(x => x.day === c.day);
    const parts = c.parts.map(x => {
      if (x.kind !== 'spot') return x.text ? `<p>${esc(x.text)}</p>` : '';
      const pl = placeOf(p, x.spot_id);
      if (!pl || shown.has(x.spot_id)) return '';
      shown.add(x.spot_id);
      return cardHTML(p, pl, x.spot_id, first.get(x.spot_id));
    }).join('');
    return `<section class="plan-chapter" aria-labelledby="plan-day-${c.day}">
      <header class="plan-chapter__head"><p class="plan-chapter__day">Day ${c.day}</p>
        <h2 class="plan-chapter__name" id="plan-day-${c.day}">${esc(c.heading || '')}</h2>
        ${d ? `<p class="plan-chapter__sum">${esc(daySum(d))}</p>` : ''}</header>
      <div class="wt-guide__body">${parts}</div></section>`;
  };
  const ideas = (p.ideas ?? []).map(i => ({ id: i.spot_id, place: placeOf(p, i.spot_id) })).filter(i => i.place && !first.has(i.id));
  const photos = [...new Map([...first.values()].map(s => s.place).filter(pl => pl.hero?.thumb).map(pl => [pl.hero.page, pl.hero])).values()];
  const where = `${p.destination.name}${p.destination.state ? `, ${regionName(p.destination.country || 'US', p.destination.state)}` : ''}`;
  return `<article class="wt-guide plan-article has-save">
    ${topHTML(p, hero)}
    <header class="wt-guide__head">
      <p class="wt-guide__where">${esc(where)}</p>
      <h1 class="wt-guide__name">${esc(story?.headline || p.title)}</h1>
      ${story?.dek ? `<p class="wt-guide__lede">${esc(story.dek)}</p>` : ''}
      <p class="plan-by">${p.days.length} ${p.days.length === 1 ? 'day' : 'days'} · ${stops.length} places · For ${esc(forWhom(p).replace(/^./, c => c.toLowerCase()))}</p>
    </header>
    ${story?.intro?.length ? `<div class="wt-guide__body">${story.intro.map(t => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
    ${glanceHTML(p)}
    ${chapters.map(chapterHTML).join('')}
    ${story?.good_to_know?.length ? `<section class="wt-guide__section"><h2>Good to know</h2><ul class="plan-know">${story.good_to_know.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : ''}
    ${story?.closing ? `<p class="plan-closing">${esc(story.closing)}</p>` : ''}
    ${ideas.length ? `<section class="wt-guide__section"><h2>If there’s time</h2>
      <p class="plan-note">Places that didn’t fit. Made your trip, they wait on its Want to go list.</p>
      <ul class="wt-guide__links">${ideas.map(i => `<li><a class="wt-guide__link" href="${spotHash(p, i.place)}" data-plan-spot>
        <span class="wt-guide__link-text"><span class="wt-guide__link-label">${esc(i.place.name)}</span>${i.place.oneLiner ? `<span class="wt-guide__link-detail">${esc(i.place.oneLiner)}</span>` : ''}</span>${ICON.forward}</a></li>`).join('')}</ul></section>` : ''}
    <footer class="wt-guide__foot">
      <p>Written by AI from the guide’s entries and the sources each lists, and published under <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA 4.0</a>. Times are suggestions: check hours before you go.</p>
      <p>Routes from OpenStreetMap. <span class="plan-map-credit"></span></p>
      ${photos.length ? `<p>Photos: ${photos.map(photoCredit).join('; ')}.</p>` : ''}
    </footer>
  </article>`;
}

// A place where it comes up in the text: a photo and a caption, with no box around it. No number: in an article a
// number reads as a rating, not as a stop.
function cardHTML(p, pl, spotId, stop) {
  const href = spotHash(p, pl), facts = factsLine(pl.facts);
  return `<figure class="plan-card" id="plan-card-${esc(spotId)}">
    ${pl.hero?.thumb ? `<a class="plan-card__photo" href="${href}" data-plan-spot tabindex="-1" aria-hidden="true"><img src="${esc(pl.hero.thumb)}" alt="" loading="lazy" decoding="async"></a>` : ''}
    <figcaption class="plan-card__body">
      ${stop ? `<span class="plan-card__meta"><b>Day ${stop.day}</b> · ${partOfDay(stop.start)}</span>` : ''}
      <span class="plan-card__head"><a class="plan-card__name" href="${href}" data-plan-spot>${esc(pl.name)}</a>${bookmarkHTML(p, pl)}</span>
      ${pl.oneLiner ? `<span class="plan-card__line">${esc(pl.oneLiner)}</span>` : ''}
      ${facts ? `<span class="plan-card__facts">${esc(facts)}</span>` : ''}
    </figcaption></figure>`;
}

// The plan: the day tabs, the open day's map, and its places numbered as its pins, with their times. Tapping a place
// in the list selects it on the map, as tapping a row does on the trip screen; the selected row offers its card.
function glanceHTML(p) {
  const tabs = p.days.map(d => `<button type="button" class="wt-day-tab" role="tab" data-plan-day="${d.day}" aria-selected="${d.day === open.day}" aria-controls="plan-glance-${d.day}">Day ${d.day}</button>`).join('');
  const lists = p.days.map(d => `<div class="plan-glance__day" id="plan-glance-${d.day}" role="tabpanel" aria-label="Day ${d.day}"${d.day === open.day ? '' : ' hidden'}>
      <p class="plan-glance__head">${esc(dayName(p, d.day))} <span>${esc(daySum(d))}</span></p>
      <ol class="plan-stops">${stopsOn(p, d.day).map(s => `<li data-row="${esc(s.spot_id)}"><button type="button" class="plan-stop" data-plan-pick="${esc(s.spot_id)}" aria-pressed="false"><span class="plan-num" style="--wt-kind-color: var(--wt-kind-${kindOfPlace(s.place)})">${s.n}</span><span class="plan-stop__name">${esc(s.place.name)}</span><span class="plan-stop__time">${clock(s.start)}</span></button>
        <button type="button" class="wt-icon-btn plan-stop__read" data-plan-jump="${esc(s.spot_id)}" aria-label="Read about ${esc(s.place.name)}">${ICON.forward}</button></li>`).join('')}</ol></div>`).join('');
  return `<section class="plan-glance" aria-label="The plan, day by day">
    ${p.days.length > 1 ? `<div class="wt-day-bar"><div class="wt-day-tabs" role="tablist" aria-label="Days">${tabs}<span class="wt-day-tabs__bar" aria-hidden="true"></span></div></div>` : ''}
    <div class="plan-map__canvas" role="region" aria-label="Map of the day"></div>
    ${lists}</section>`;
}

// ---------- Saving a place to a trip, as a spot card's bookmark does (spots.js) ----------
const placeFor = (p, pl) => ({ key: `${p.destination.id}/${pl.source}/${pl.id}`, name: pl.name, city: p.destination.name,
  address: `${p.destination.name}${p.destination.state ? `, ${p.destination.state}` : ''}`, lat: pl.lat, lng: pl.lng, source: pl.source, id: pl.id, kind: pl.kind });
function bookmarkHTML(p, pl) {
  const on = savedIn(placeFor(p, pl));
  return `<button type="button" class="wt-icon-btn plan-card__save" data-plan-save="${esc(`${pl.source}/${pl.id}`)}" aria-pressed="${on.length > 0}"
    aria-label="${esc(on.length ? `Saved to ${on.length === 1 ? on[0].name : `${on.length} trips`}. Change` : `Save ${pl.name} to a trip`)}" title="${on.length ? 'Saved' : 'Save to a trip'}">${ICON.bookmark}</button>`;
}
function showSaved() {
  const p = open?.plan;
  if (!p) return;
  for (const b of $app.querySelectorAll('[data-plan-save]')) { const pl = placeOf(p, b.dataset.planSave); if (pl) b.outerHTML = bookmarkHTML(p, pl); }
}
// Signed in, which places are on your trips already, for their bookmarks
async function markSaved() {
  if (!me) return;
  try { await loadMyTrips(); showSaved(); } catch {}
}

// ---------- Make it my trip ----------
const makeBarHTML = (busy = false) => {
  const p = open.plan;
  return `<div class="wt-float-bar plan-make">
    <label class="plan-make__dates" title="First day of the trip">${ICON.calendar}<span>${esc(datesText(open.start, p.days.length))}</span>
      <input class="plan-make__picker" type="date" value="${esc(open.start)}" data-plan-start aria-label="First day of the trip"></label>
    <button type="button" class="wt-btn wt-btn--primary wt-btn--block" data-plan-make${busy ? ' disabled aria-busy="true"' : ''}>${busy ? '<span class="wt-spinner"></span>Making your trip…' : `${ICON.plus}Make it my trip`}</button></div>`;
};
// The plan's days from the first day, as a trip's stops: each place at its time, how long to stay and how to get
// there, its Wikidata item (so its sheet says what Wikipedia says) and its pages as links (its spot's page first); a meal as a restaurant stop
// near the place it's at
export function stopsFrom(p, start, page = location.origin + location.pathname) {
  return p.days.flatMap(d => d.items.map((i, n) => {
    const pl = placeOf(p, i.spot_id);
    if (!pl) return null;
    const meal = i.kind !== 'stop', kind = meal ? 'restaurant' : STOP_KINDS.includes(pl.kind) ? pl.kind : '';
    const links = meal ? [] : [
      { url: `${page}${spotHash(p, pl)}`, label: 'Spot' },
      ...(pl.wikipedia ? [{ url: `https://en.wikipedia.org/wiki/${encodeURIComponent(pl.wikipedia.replace(/ /g, '_'))}`, label: 'Wikipedia' }] : []),
      ...(pl.website ? [{ url: pl.website, label: 'Website' }] : []),
    ];
    return {
      id: uid(), name: meal ? sentence(i.kind) : pl.name, address: `${p.destination.name}${p.destination.state ? `, ${p.destination.state}` : ''}`,
      lat: pl.lat, lng: pl.lng, time: `${addDays(start, d.day - 1)}T${i.start}`, tz: null, duration: i.minutes > 0 ? Math.min(i.minutes, 24 * 60) : null,
      note: meal ? `Near ${pl.name}` : '', kind, nights: null, checkout: null, travel: n && (!i.leg || i.leg.mode === 'walk') ? 'walk' : 'drive', back: {},
      links, wikidata: !meal && pl.source === 'wikidata' ? pl.id : null,
    };
  })).filter(Boolean);
}
async function makeTrip() {
  const p = open?.plan;
  if (!p) return;
  if (!me) { toast({ title: 'Sign in to make it your trip', detail: 'Your trips, and who’s on them, are in your account.' }, 'Sign in', () => { location.hash = '#/'; }); return; }
  const planId = p.planId, start = open.start;
  $app.querySelector('.plan-make').outerHTML = makeBarHTML(true);
  let tripId = null;
  try {
    const { trip } = await api('/trips', { method: 'POST', body: { name: p.title } });
    tripId = trip.id;
    await Promise.all(stopsFrom(p, start).map(({ id, ...stop }) => api(`/trips/${tripId}/stops/${id}`, { method: 'PUT', body: stop })));
    const planned = new Set(allStops(p).map(s => s.spot_id));
    await Promise.all((p.ideas ?? []).filter(i => !planned.has(i.spot_id) && placeOf(p, i.spot_id))
      .map(i => api(`/trips/${tripId}/ideas/${uid()}`, { method: 'PUT', body: ideaOf(placeFor(p, placeOf(p, i.spot_id))) })));
  } catch (err) {
    // Half a trip is no use: it goes again, and the plan's button comes back to try once more
    if (tripId) api(`/trips/${tripId}`, { method: 'DELETE' }).catch(() => {});
    if (open?.id === planId) $app.querySelector('.plan-make').outerHTML = makeBarHTML();
    if (err.status !== 401) failToast(err, 'Couldn’t make the trip');
    return;
  }
  // Its first day, as you'd start it
  openTripOn(start);
  location.hash = `#/trip/${tripId}`;
}

// ---------- Taps ----------
// The selected place on the map, highlighted in the plan's list, as the trip screen highlights its row
function showPicked(id) {
  for (const li of $app.querySelectorAll('.plan-stops li')) {
    const on = li.dataset.row === id;
    li.classList.toggle('is-selected', on);
    li.querySelector('[data-plan-pick]').setAttribute('aria-pressed', on);
  }
}
// The open tab's bar under it, as on the trip screen
function placeTabBar(slide = false) {
  const tab = $app.querySelector('.plan-glance .wt-day-tab[aria-selected="true"]'), bar = $app.querySelector('.plan-glance .wt-day-tabs__bar');
  if (!tab || !bar) return;
  bar.style.transition = slide ? '' : 'none';
  bar.style.transform = `translateX(${tab.offsetLeft + tab.offsetWidth / 2 - bar.offsetWidth / 2}px)`;
}
function openDay(d) {
  open.day = d;
  for (const t of $app.querySelectorAll('.plan-glance .wt-day-tab')) t.setAttribute('aria-selected', t.dataset.planDay === String(d));
  for (const l of $app.querySelectorAll('.plan-glance__day')) l.hidden = l.id !== `plan-glance-${d}`;
  placeTabBar(true);
  open.map?.then(m => m.show(d));
}
// "Read about it": bring a place's card into view, and flash it
function jumpTo(id) {
  const c = document.getElementById(`plan-card-${id}`);
  if (!c) return;
  c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  c.classList.remove('is-flash');
  void c.offsetWidth;
  c.classList.add('is-flash');
}
document.addEventListener('click', e => {
  if (open && e.target.closest?.('[data-plan-back]')) return backToGuides(e);
  if (!open?.plan || !$app.querySelector('.plan')) return;
  const t = e.target.closest?.('[data-plan-day], [data-plan-pick], [data-plan-jump], [data-plan-save], [data-plan-make], [data-plan-spot]');
  if (!t) return;
  if (t.dataset.planDay) openDay(Number(t.dataset.planDay));
  else if (t.dataset.planPick) open.map?.then(m => m.select(t.dataset.planPick, { fly: true }));
  else if (t.dataset.planJump) jumpTo(t.dataset.planJump);
  else if (t.dataset.planSave) { const pl = placeOf(open.plan, t.dataset.planSave); if (pl) saveSpot(placeFor(open.plan, pl), t, showSaved); }
  else if ('planMake' in t.dataset) makeTrip();
  else if ('planSpot' in t.dataset) { scrolls.set(open.id, scrollY); openSpotFromPage(); }
});
// The dates in the bar at the bottom open the date picker; another first day moves the whole plan with it
document.addEventListener('click', e => {
  const i = e.target.closest?.('.plan-make__dates')?.querySelector('input');
  if (!i) return;
  e.preventDefault();
  try { i.showPicker(); } catch { i.focus(); }
});
document.addEventListener('change', e => {
  if (!e.target.matches?.('[data-plan-start]') || !e.target.value || !open?.plan) return;
  open.start = e.target.value;
  $app.querySelector('.plan-make').outerHTML = makeBarHTML();
});
addEventListener('resize', () => { if (open?.plan) placeTabBar(); });
