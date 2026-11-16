/* A mockup of guides in Dotsie: a destination's places and suggested plans, each plan told as an article.

   #/                     the destination: its plans, then its places
   #/plan/<id>            a plan as an article, with a card for each of its places and a map of the plan
   #/plan/<id>/<day>      the plan hour by hour: 0 is the overview, 1… a day
   A place's guide opens in a sheet over any of them. The article's one button, Make it my trip, copies it into your trips; any place can be saved. See data.js for where the data comes from, and trips.js for what saving and copying keep. */
import { KINDS, TRAVEL, travelIcon } from '../../app/web/plan.js';
import { DAY_NAMES, data, dateText, dayName, esc, guideOf, hourText, icon, inPlans, marker, minutes, photoCredit, planOf, sentence, spots, storyOf, timeHTML, timeText } from './data.js';
import { mountMaps } from './maps.js';
import { article, datesText, floatBar, mapDays, saveButton } from './story.js';
import { copyToTrips, isSaved, nextFriday, savedList, toggleSaved } from './trips.js';

const $ = sel => document.querySelector(sel);
const kindOfItem = i => (i.kind === 'stop' ? spots.get(i.spot_id).kind : 'restaurant');

// ---------- The destination ----------
function planCard(p) {
  const shown = p.days.flatMap(d => d.items).filter(i => i.kind === 'stop').map(i => spots.get(i.spot_id)).filter(s => s.photo).slice(0, 3);
  const photos = shown.map(s => `<img class="wt-trip-card__photo" src="${esc(s.photo.url)}" alt="" title="${esc(photoCredit(s.photo))}">`).join('');
  const story = storyOf(p.plan_id);
  return `<a class="wt-trip-card" href="#/plan/${esc(p.plan_id)}">
    <span class="wt-trip-card__photos" aria-hidden="true">${photos}</span>
    <span class="wt-trip-card__body"><span class="wt-trip-card__text"><span class="wt-trip-card__name">${esc(story?.headline || p.title)}</span>
      <span class="wt-trip-card__dates">${p.days.length} days · ${p.stops} places · ${esc(sentence(p.traveler).split(':')[0])}</span></span></span></a>`;
}

function placeRow(s) {
  const g = guideOf(s.spot_id);
  return `<li><button class="g-place" data-spot="${esc(s.spot_id)}">
    ${marker(s.kind, 'g-place__marker')}<span class="g-place__name">${esc(s.name)}${isSaved(s.spot_id) ? `<span class="g-place__saved">${icon('check', 14)}Saved</span>` : ''}</span>
    ${s.photo ? `<img class="g-place__photo" src="${esc(s.photo.url)}" alt="" loading="lazy">` : ''}
    <span class="g-place__line">${esc(g?.one_liner || '')}</span>
    <span class="g-place__meta">${esc(KINDS[s.kind].label)} · ${esc(s.area.replace(/^Around /, 'Near '))}</span></button></li>`;
}

function home() {
  const d = data.destination;
  const places = [...data.spots].sort((a, b) => a.rank - b.rank);
  const n = savedList().length;
  return `<header class="g-head"><p class="g-head__over">Guide</p><h1>${esc(d.name)}</h1>
      <p class="g-head__text">${places.length} places worth the trip, and plans that string them together.</p>
      ${n ? `<button class="wt-btn wt-btn--secondary g-head__saved" data-action="saved">${icon('check')}Saved places · ${n}</button>` : ''}</header>
    <div class="g-page">
      <section class="g-group"><h2 class="g-group__title">Plans</h2><div class="g-cards">${data.plans.map(planCard).join('')}</div></section>
      <section class="g-group"><h2 class="g-group__title">Places</h2>
        <p class="g-group__hint">Each with a guide written from Wikipedia and the place's own site.</p>
        <ul class="g-places">${places.map(placeRow).join('')}</ul></section>
    </div>`;
}

// ---------- A plan, hour by hour ----------
function legRow(leg) {
  if (!leg) return '';
  const mode = leg.mode === 'walk' ? 'walk' : 'drive';
  return `<div class="wt-tl-drive"><span class="wt-tl-rail"><i class="wt-tl-car">${travelIcon(mode)}</i></span>
    <span class="wt-tl-drive__body"><span class="wt-tl-drive__what"><b>${minutes(leg.minutes)}</b> ${TRAVEL[mode].noun}</span></span></div>`;
}

function itemRow(i, { notes = true } = {}) {
  const meal = i.kind !== 'stop', s = spots.get(i.spot_id), g = guideOf(i.spot_id);
  const name = meal ? sentence(i.kind) : s.name;
  const lines = (!notes ? [] : meal ? [`Near ${s.name}`, minutes(i.minutes)] : [minutes(i.minutes), g?.one_liner]).filter(Boolean);
  return `<div class="wt-tl-stop" ${meal ? '' : `data-spot="${esc(i.spot_id)}" tabindex="0" role="button" aria-label="${esc(name)}, ${timeText(i.start)}. Open its guide"`} style="--wt-kind-color: var(--wt-kind-${kindOfItem(i)})">
    <span class="wt-tl-rail">${marker(kindOfItem(i))}</span>
    <span class="wt-tl-name">${esc(name)}</span>${lines.length ? `<span class="wt-tl-notes">${lines.map(n => `<span class="wt-tl-note">${esc(n)}</span>`).join('')}</span>` : ''}
    <span class="wt-tl-time">${timeHTML(i.start)}</span></div>`;
}

function dayTabs(p, open) {
  const tabs = ['Overview', ...p.days.map(d => `Day ${d.day}`)];
  return `<div class="wt-day-bar"><div class="wt-day-tabs" role="tablist" aria-label="Days">
    ${tabs.map((t, n) => `<a class="wt-day-tab" role="tab" href="#/plan/${esc(p.plan_id)}/${n}" aria-selected="${n === open}">${t}</a>`).join('')}
    <span class="wt-day-tabs__bar" aria-hidden="true"></span></div></div>`;
}

function overview(p) {
  return `<div class="wt-tl">${p.days.map(d => `<a class="wt-tl-day" href="#/plan/${esc(p.plan_id)}/${d.day}" aria-label="Day ${d.day}. Open this day">
      <span class="wt-tl-day__name">Day ${d.day} · ${esc(dayName(p, d.day))}</span><span class="wt-tl-day__open" aria-hidden="true">View day</span></a>
    ${d.items.filter(i => i.kind === 'stop').map((i, n) => (n ? legRow(i.leg) : '') + itemRow(i, { notes: false })).join('')}`).join('')}</div>`;
}

function hourByHour(p, open) {
  const d = p.days[open - 1];
  return `<div class="g-plan-top">
      <header class="wt-trip-head"><a class="wt-icon-btn" href="#/plan/${esc(p.plan_id)}" aria-label="Back to the article">${icon('back')}</a>
        <span class="wt-trip-head__name">${esc(p.title)}</span></header>
      ${dayTabs(p, open)}</div>
    <section class="g-day" aria-label="${d ? `Day ${d.day}` : 'Overview'}">
      ${d ? `<p class="g-day__intro">${esc(d.intro)}</p><div class="wt-tl">${d.items.map(i => legRow(i.leg) + itemRow(i)).join('')}</div>` : overview(p)}
      <p class="g-note">${esc(data.destination.travel_note)} Times are suggestions; hours were noted ${esc(dateText(data.destination.built))}.</p></section>`;
}

// The day a copied plan starts on, as picked at the end of the article
let start = nextFriday();

// ---------- A place's guide, in a sheet ----------
function factsList(f) {
  const h = f.hours;
  const hours = h.kind === 'stated' ? `${hourText(h.open)}–${hourText(h.close)}${h.closed_days.length ? `, closed ${h.closed_days.map(x => DAY_NAMES[x]).join(' and ')}` : ''}`
    : h.kind === 'always' ? 'Open any time' : 'Not in our sources: check before going';
  const rows = [['Time there', `About ${minutes(f.visit_minutes)}`], ['Hours', hours],
    ['Best time', sentence(f.best_time === 'any' ? 'any time' : f.best_time)],
    ['Tickets', f.book_ahead ? 'Book ahead' : f.admission === 'free' ? 'Free' : f.admission === 'paid' ? 'Pay at the door' : null]];
  return `<dl class="g-facts">${rows.filter(r => r[1]).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

function guideSheet(id) {
  const s = spots.get(id), g = guideOf(id), wiki = s.links.find(l => l.label === 'Wikipedia');
  const about = `<div class="wt-about">${s.photo ? `<img class="wt-about__photo" src="${esc(s.photo.url)}" alt="">` : ''}
    <div class="wt-about__body"><p class="wt-about__text">${esc(g?.one_liner || KINDS[s.kind].label)}</p>
      ${s.photo ? `<div class="wt-about__src"><a class="wt-about__credit" href="${esc(s.photo.page)}" target="_blank" rel="noopener">${esc(photoCredit(s.photo))}</a></div>` : ''}</div></div>`;
  const body = g ? `<div class="g-sheet-prose">${g.body.map(b => `<p>${esc(b.text)}</p>`).join('')}</div>
      ${g.tips.length ? `<h3 class="g-sub">Tips</h3><ul class="g-tips">${g.tips.map(t => `<li>${esc(t.text)}</li>`).join('')}</ul>` : ''}`
    : `<p class="wt-empty">No guide for this place yet.</p>`;
  const links = `<span class="wt-tl-links">${s.links.map(l => `<a class="wt-tl-link" href="${esc(l.url)}" target="_blank" rel="noopener"><span class="wt-tl-link__label">${esc(l.label)}</span>${icon('external')}</a>`).join('')}</span>`;
  const uses = (inPlans.get(id) || []).map(u => `<li><a href="#/plan/${esc(u.plan.plan_id)}/${u.day}" data-close>${esc(u.plan.title)}</a>, day ${u.day} at ${timeText(u.start)}</li>`).join('');
  return `<div class="wt-modal-root is-open"><div class="wt-modal__backdrop" data-close></div>
    <div class="wt-modal g-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="wt-modal__head wt-modal__head--sticky"><h2 class="wt-modal__title" id="sheet-title">${esc(s.name)}</h2>
        <button class="wt-icon-btn" aria-label="Close" data-close>${icon('close')}</button></div>
      ${about}${factsList(s.facts)}${body}${links}
      ${uses ? `<h3 class="g-sub">In plans</h3><ul class="g-in">${uses}</ul>` : ''}
      <p class="g-credit">Guide text CC BY-SA 4.0${wiki ? `, adapted from <a href="${esc(wiki.url)}" target="_blank" rel="noopener">Wikipedia</a>` : ''} and the place's own site. Facts noted ${esc(dateText(s.fetched))}.</p>
      <div class="wt-modal__actions wt-modal__actions--sticky">${saveButton(id, 'wt-btn wt-btn--primary wt-btn--block')}</div>
    </div></div>`;
}

function savedSheet() {
  const list = savedList();
  return `<div class="wt-modal-root is-open"><div class="wt-modal__backdrop" data-close></div>
    <div class="wt-modal g-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="wt-modal__head wt-modal__head--sticky"><h2 class="wt-modal__title" id="sheet-title">Saved places</h2>
        <button class="wt-icon-btn" aria-label="Close" data-close>${icon('close')}</button></div>
      ${list.length ? `<ul class="g-places">${list.map(s => `<li class="g-saved"><button class="g-place" data-spot="${esc(s.spot_id)}">${marker(s.kind, 'g-place__marker')}
          <span class="g-place__name">${esc(s.name)}</span><span class="g-place__line">${esc(guideOf(s.spot_id)?.one_liner || '')}</span></button>
          ${saveButton(s.spot_id)}</li>`).join('')}</ul>
        <p class="g-credit">Saved in this browser. In the app, a saved place goes on a trip's Want to go list, where it waits for a day.</p>`
      : `<p class="wt-empty">Save places from a guide, and they wait here.</p>`}
    </div></div>`;
}

let lastFocus = null;
function openSheet(html) {
  if (!$('#modal').innerHTML) lastFocus = document.activeElement;
  $('#modal').innerHTML = html;
  $('#modal .wt-modal__head .wt-icon-btn').focus();
}
function closeSheet() {
  if (!$('#modal').innerHTML) return;
  $('#modal').innerHTML = '';
  lastFocus?.focus?.();
}

// ---------- Toast ----------
let toastTimer;
function toast(html, ms = 5000) {
  const t = $('#toast');
  t.className = 'wt-toast is-visible';
  t.innerHTML = html;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), ms);
}

// ---------- Routing ----------
let maps = null;
function render() {
  const [, page, id, n] = location.hash.replace(/^#\/?/, '#/').split('/');
  const p = page === 'plan' && planOf(id), story = p && storyOf(p.plan_id);
  const read = p && n === undefined && story;
  maps?.unmount();
  $('#app').dataset.page = read ? 'story' : p ? 'plan' : 'home';
  $('#app').innerHTML = read ? article(p, story, start) : p ? hourByHour(p, Math.max(0, Math.min(p.days.length, Number(n) || 0))) : home();
  document.title = read ? `${story.headline} · Dotsie` : p ? `${p.title} · Dotsie` : `${data.destination.name} guide · Dotsie`;
  maps = read ? mountMaps($('#app'), () => ({ days: mapDays(p), day: 1, onSelect: showPicked })) : null;
  placeBar();
  scrollTo(0, 0);
}

// The stop selected on the map, highlighted in the plan's list, as the trip screen highlights its row
function showPicked(id) {
  for (const li of document.querySelectorAll('.g-glance__stops li')) {
    const on = li.dataset.row === id;
    li.classList.toggle('is-selected', on);
    li.querySelector('[data-pick]').setAttribute('aria-pressed', on);
  }
}
const pick = (id, opts) => maps?.map('plan')?.then(m => m.select(id, opts));

// A day tab over the plan's map: that day's places under it, and that day on the map
function openDay(d) {
  for (const t of document.querySelectorAll('.g-glance .wt-day-tab')) t.setAttribute('aria-selected', t.dataset.day === String(d));
  for (const l of document.querySelectorAll('.g-glance__day')) l.hidden = l.id !== `glance-day-${d}`;
  const sched = $('[data-sched]');
  if (sched) { sched.href = `#/plan/${sched.dataset.sched}/${d}`; sched.querySelector('span').textContent = `Day ${d} schedule, with times`; }
  placeBar(true);
  maps?.map('plan')?.then(m => m.show(d));
}

// The bar at the top names the day you're reading: "Day 2 · Space Needle and Seattle Center", from the moment its
// chapter reaches the bar, and the destination above the first one
let barFrame = 0;
function nameDay() {
  barFrame = 0;
  const title = $('.g-bar__title'), bar = $('.g-bar');
  if (!title || !bar) return;
  const line = bar.getBoundingClientRect().bottom + 8;
  const ch = [...document.querySelectorAll('[data-chapter]')].filter(c => c.getBoundingClientRect().top <= line && c.getBoundingClientRect().bottom > line).pop();
  const text = ch ? `Day ${ch.dataset.chapter} · ${ch.dataset.title}` : data.destination.name;
  if (title.textContent !== text) title.textContent = text;
}
addEventListener('scroll', () => { if (!barFrame) barFrame = requestAnimationFrame(nameDay); }, { passive: true });

// "Read about it": bring a place's card into view, and flash it
function jumpTo(id) {
  const c = document.getElementById(`card-${id}`);
  if (!c) return;
  c.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
  c.classList.remove('is-flash');
  void c.offsetWidth;
  c.classList.add('is-flash');
}

// The open tab's bar under it, as in the app
function placeBar(slide = false) {
  const tab = $('.wt-day-tab[aria-selected="true"]'), bar = $('.wt-day-tabs__bar');
  if (!tab || !bar) return;
  bar.style.transition = slide ? '' : 'none';
  bar.style.transform = `translateX(${tab.offsetLeft + tab.offsetWidth / 2 - bar.offsetWidth / 2}px)`;
}

// Every Save button for a place, on the page and in a sheet, shows the same
function refreshSaved(id) {
  for (const b of document.querySelectorAll(`[data-save="${CSS.escape(id)}"]`)) b.outerHTML = saveButton(id, b.className);
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-spot], [data-close], [data-action], [data-save], [data-jump], [data-pick], [data-day]');
  if (!t) return;
  if (t.matches('a[href="#"]')) e.preventDefault();
  if (t.dataset.save) {
    const on = toggleSaved(t.dataset.save), name = spots.get(t.dataset.save).name;
    refreshSaved(t.dataset.save);
    toast(`<span>${on ? `Saved ${esc(name)}` : `Removed ${esc(name)}`}</span>`, 3000);
    if ($('#app').dataset.page === 'home' && !$('#modal').innerHTML) render();
  } else if (t.dataset.jump) jumpTo(t.dataset.jump);
  else if (t.dataset.pick) pick(t.dataset.pick, { fly: true });
  else if (t.dataset.day) openDay(Number(t.dataset.day));
  else if (t.dataset.spot) openSheet(guideSheet(t.dataset.spot));
  else if ('close' in t.dataset) { closeSheet(); if ($('#app').dataset.page === 'home') render(); }
  else if (t.dataset.action === 'saved') openSheet(savedSheet());
  else if (t.dataset.action === 'copy') {
    const p = planOf(t.dataset.plan), trip = copyToTrips(p, start);
    if (!trip) return toast('<span>Couldn’t add it. Try again in a moment.</span>', 6000);
    $('.g-float').outerHTML = floatBar(p, start, trip);
    toast(`<span>${esc(data.destination.name)}, ${esc(datesText(start, p.days.length))}, is in your trips</span>`, 4000);
  }
});
// The dates in the bar at the bottom open the date picker; a new first day makes the next copy a new trip
document.addEventListener('click', e => { const i = e.target.closest('.g-float__dates')?.querySelector('input'); if (i) { e.preventDefault(); try { i.showPicker(); } catch { i.focus(); } } });
document.addEventListener('change', e => {
  if (!e.target.matches('[data-start]') || !e.target.value) return;
  start = e.target.value;
  const p = planOf(location.hash.split('/')[2]);
  if (p) $('.g-float').outerHTML = floatBar(p, start);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#modal').innerHTML) closeSheet(); else pick(null); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.wt-tl-stop[data-spot]')) { e.preventDefault(); openSheet(guideSheet(e.target.dataset.spot)); }
});
addEventListener('hashchange', () => { if (/^#card-/.test(location.hash)) return; closeSheet(); render(); });
addEventListener('resize', () => placeBar());
render();
