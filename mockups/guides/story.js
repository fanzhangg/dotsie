/* A plan as an article: the story story.py wrote, read like a blog post, laid out as a place's guide is (the sheet in
   guides.js): a bar with Back at the top, which names the day you're reading, and its one button, Make it my trip,
   floating at the bottom beside the trip's dates.
   - Each day is a chapter that opens with "Day 2", its heading, and what the day asks of you: how many places, how
     long on foot and by car.
   - Where a place comes up, a quiet card: its photo, which day and part of the day, its name with Save beside it, its
     one-liner, and how long to stay. No number: a number in an article reads as a rating, not as a stop. The photos'
     credits are at the end, as a magazine has them.
   - One map near the top, the trip map's (maps.js), one day at a time with the app's day tabs. As in the app's day
     view, the numbers start at 1 each day, and the list under the map has the same numbers as its pins.
   The article holds no facts of its own about the places: each card is drawn here from the spot's guide and fact card. */
import { data, dayName, esc, factsLine, guideOf, icon, minutes, photoCredit, spots, stopsOf } from './data.js';
import { isSaved } from './trips.js';

export const numHTML = (n, kind) => `<span class="g-num" style="--wt-kind-color: var(--wt-kind-${kind})">${n}</span>`;
// Save, as a button: full size in the guide's sheet and the saved list, small beside a card's name in the article
export const saveButton = (id, cls = 'wt-btn wt-btn--secondary') => {
  const on = isSaved(id), small = cls.includes('g-save');
  return `<button class="${cls}" data-save="${esc(id)}" aria-pressed="${on}" title="${on ? 'In your saved places' : 'Save to your places'}">${icon(on ? 'check' : 'plus', small ? 14 : undefined)}${on ? 'Saved' : 'Save'}</button>`;
};
// The trip's dates from its first day, as the bar at the bottom shows them: "Nov 20–22", "Nov 30 – Dec 2"
export function datesText(start, days) {
  const [y, m, d] = start.split('-').map(Number), a = new Date(y, m - 1, d), b = new Date(y, m - 1, d + days - 1);
  const mon = x => x.toLocaleDateString('en-US', { month: 'short' });
  return days < 2 ? `${mon(a)} ${a.getDate()}` : mon(a) === mon(b) ? `${mon(a)} ${a.getDate()}–${b.getDate()}` : `${mon(a)} ${a.getDate()} – ${mon(b)} ${b.getDate()}`;
}
// "Morning", "Afternoon", "Evening": when in the day, as an article says it; the hour-by-hour plan has the clock times
export const partOfDay = hhmm => { const h = Number(hhmm.slice(0, 2)); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; };
// A day's stops, numbered from 1 as the day's list and its map number them
export const dayStops = (p, day) => stopsOf(p).filter(s => s.day === day).map((s, i) => ({ ...s, n: i + 1 }));

// What a day asks of you: how many places, and how long on foot and by car between them
export function daySum(d) {
  const legs = d.items.map(i => i.leg).filter(Boolean);
  const walk = legs.filter(l => l.mode === 'walk').reduce((a, l) => a + l.minutes, 0);
  const drive = legs.filter(l => l.mode !== 'walk').reduce((a, l) => a + l.minutes, 0);
  const places = d.items.filter(i => i.kind === 'stop').length;
  return [`${places} places`, walk && `${minutes(walk)} on foot`, drive && `${minutes(drive)} by car`].filter(Boolean).join(' · ');
}

function card(stop) {
  const s = stop.spot, g = guideOf(s.spot_id), id = esc(s.spot_id);
  return `<figure class="g-card" id="card-${id}">
    ${s.photo ? `<a class="g-card__photo" href="#" data-spot="${id}" tabindex="-1" aria-hidden="true"><img src="${esc(s.photo.url)}" alt="" loading="lazy"></a>` : ''}
    <figcaption class="g-card__body">
      <p class="g-card__meta"><b>Day ${stop.day}</b> · ${partOfDay(stop.start)}</p>
      <div class="g-card__head"><h3 class="g-card__name"><a href="#" data-spot="${id}">${esc(s.name)}</a></h3>${saveButton(s.spot_id, 'g-save')}</div>
      ${g?.one_liner ? `<p class="g-card__line">${esc(g.one_liner)}</p>` : ''}
      <p class="g-card__facts">${esc(factsLine(s.facts).replace(' · Check hours', ''))}</p>
    </figcaption></figure>`;
}

// The plan: the app's day tabs, the open day's map, and its places numbered as its pins. Tapping a place in the list
// selects it on the map, as tapping a row does on the trip screen; the selected row gets an arrow to its card. Under
// it, a button to the open day's schedule, with the times the article leaves out.
function glance(p) {
  const tabs = p.days.map(d => `<button class="wt-day-tab" role="tab" data-day="${d.day}" aria-selected="${d.day === 1}" aria-controls="glance-day-${d.day}">Day ${d.day}</button>`).join('');
  const lists = p.days.map(d => `<div class="g-glance__day" id="glance-day-${d.day}" role="tabpanel" ${d.day === 1 ? '' : 'hidden'}>
      <p class="g-glance__head">${esc(dayName(p, d.day))} <span>${esc(daySum(d))}</span></p>
      <ol class="g-glance__stops">${dayStops(p, d.day).map(s => `<li data-row="${esc(s.spot_id)}"><button class="g-glance__pick" data-pick="${esc(s.spot_id)}" aria-pressed="false">${numHTML(s.n, s.spot.kind)}<span>${esc(s.spot.name)}</span></button>
        <a class="wt-icon-btn g-glance__read" href="#" data-jump="${esc(s.spot_id)}" aria-label="Read about ${esc(s.spot.name)}">${icon('forward', 18)}</a></li>`).join('')}</ol></div>`).join('');
  return `<section class="g-glance" aria-label="The plan, day by day">
    <div class="wt-day-bar"><div class="wt-day-tabs" role="tablist" aria-label="Days">${tabs}<span class="wt-day-tabs__bar" aria-hidden="true"></span></div></div>
    <figure class="g-map"><div class="g-map__canvas" data-map="plan" role="region" aria-label="Map of the day"></div><figcaption class="g-map__credit"></figcaption></figure>
    ${lists}
    <a class="wt-btn wt-btn--secondary g-glance__sched" href="#/plan/${esc(p.plan_id)}/1" data-sched="${esc(p.plan_id)}">${icon('list')}<span>Day 1 schedule, with times</span></a></section>`;
}

export function article(p, story, start) {
  const stops = stopsOf(p), at = new Map(stops.map(s => [s.spot_id, s])), plan = new Map(p.days.map(d => [d.day, d]));
  const hero = stops.map(s => s.spot).find(s => s.photo), photos = [...new Set(stops.map(s => s.spot))].filter(s => s.photo);
  const chapters = story.days.map(d => {
    const parts = d.parts.map(x => x.kind === 'spot' ? (at.has(x.spot_id) ? card(at.get(x.spot_id)) : '') : `<p>${esc(x.text)}</p>`).join('');
    return `<section class="g-chapter" data-chapter="${d.day}" data-title="${esc(d.heading)}" aria-labelledby="day-${d.day}-h">
      <header class="g-chapter__head"><p class="g-chapter__day">Day ${d.day}</p>
        <h2 class="g-story__h2" id="day-${d.day}-h">${esc(d.heading)}</h2>
        ${plan.has(d.day) ? `<p class="g-chapter__sum">${esc(daySum(plan.get(d.day)))}</p>` : ''}</header>
      <div class="g-prose">${parts}</div></section>`;
  }).join('');
  const wiki = stops.some(s => s.spot.links.some(l => l.label === 'Wikipedia'));
  return `<article class="g-story">
    <div class="g-bar"><a class="wt-icon-btn" href="#/" aria-label="${esc(data.destination.name)} guide">${icon('back')}</a>
      <span class="g-bar__title" aria-live="polite">${esc(data.destination.name)}</span></div>
    <header class="g-hero">
      <h1 class="g-story__title">${esc(story.headline)}</h1>
      <p class="g-story__dek">${esc(story.dek)}</p>
      <p class="g-story__by">${p.days.length} days · ${stops.length} places</p>
      ${hero ? `<figure class="g-hero__photo"><img src="${esc(hero.photo.url)}" alt="${esc(hero.name)}"></figure>` : ''}
    </header>
    <div class="g-story__body">
      <div class="g-prose g-prose--lede">${story.intro.map(t => `<p>${esc(t)}</p>`).join('')}</div>
      ${glance(p)}
      ${chapters}
      <section class="g-know" aria-labelledby="know"><h2 class="g-story__h2" id="know">Good to know</h2>
        <ul>${story.good_to_know.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>
      <p class="g-closing">${esc(story.closing)}</p>
      <p class="g-credit">Check hours before you go. Routes from OpenStreetMap${wiki ? '; place text adapted from Wikipedia (CC BY-SA 4.0)' : ''}.
        Photos: ${photos.map(s => `<a href="${esc(s.photo.page)}" target="_blank" rel="noopener">${esc(s.name)}, ${esc(photoCredit(s.photo).replace(/^Photo: /, ''))}</a>`).join('; ')}.</p>
    </div></article>
    ${floatBar(p, start)}`;
}

// The one action, always in reach: the trip's dates, which you can change, and Make it my trip. Once it's yours, the
// button opens it (guides.js swaps it for Open my trip).
export function floatBar(p, start, trip = null) {
  return `<div class="g-float" role="region" aria-label="Make this trip yours">
      <label class="g-float__dates">${icon('calendar')}<span data-dates>${esc(datesText(start, p.days.length))}</span>
        <input class="g-float__picker" type="date" value="${start}" data-start aria-label="First day of the trip"></label>
      ${trip ? `<a class="wt-btn wt-btn--primary" href="../../prototype/#/trip/${esc(trip)}">Open my trip${icon('forward')}</a>`
        : `<button class="wt-btn wt-btn--primary" data-action="copy" data-plan="${esc(p.plan_id)}">${icon('plus')}Make it my trip</button>`}</div>`;
}

// What the map draws for each day: its stops, numbered from 1, and each leg's route from the place before it
export function mapDays(p) {
  return new Map(p.days.map(d => {
    const legs = [];
    let prev = null;
    for (const i of d.items) {
      const s = spots.get(i.spot_id);
      if (prev && i.leg) legs.push({ from: [prev.lat, prev.lng], to: [s.lat, s.lng], coords: i.leg.coords || null });
      prev = s;
    }
    return [d.day, { stops: dayStops(p, d.day), legs }];
  }));
}
