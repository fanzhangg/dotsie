/* The data every view reads, joined by spot id, and the small helpers they share.

   data/<area>.json holds a destination's rows, as pipeline/export_plans.py --mockup writes them (docs/trip-plans.md) (destination, spots, blocks, plans,
   stories), as an API would send them. A plan holds spot ids, never guide text; a guide block is a spot's, never a
   plan's; a story is the one product that reads both. The stop types, their icons and the travel words are the app's
   own (app/web/plan.js). */
import { KINDS } from '../../app/web/plan.js';
import { MONTHS, fmtDur, pad } from '../../app/web/time.js';

export const AREA = new URLSearchParams(location.search).get('area') || 'SEA';
export const data = await fetch(`data/${AREA}.json`).then(r => r.json());
export const spots = new Map(data.spots.map(s => [s.spot_id, s]));
export const planOf = id => data.plans.find(p => p.plan_id === id) || null;
export const storyOf = id => (data.stories || []).find(s => s.plan_id === id) || null;
// A day's one name everywhere it shows: the article's heading for it, or the plan's theme when it has no article
export const dayName = (p, day) => storyOf(p.plan_id)?.days.find(d => d.day === day)?.heading || p.days.find(d => d.day === day)?.theme || '';

const guides = new Map();
for (const b of data.blocks) {
  const g = guides.get(b.spot_id) || { one_liner: null, body: [], tips: [] };
  if (b.kind === 'one_liner') g.one_liner = b.text; else (b.kind === 'body' ? g.body : g.tips).push(b);
  guides.set(b.spot_id, g);
}
export const guideOf = id => guides.get(id) || null;

// Where each place comes up in a plan: the other way round from a plan's stops (guide_plan_spots)
export const inPlans = new Map();
for (const p of data.plans) for (const d of p.days) for (const i of d.items) if (i.kind === 'stop') {
  inPlans.set(i.spot_id, [...(inPlans.get(i.spot_id) || []), { plan: p, day: d.day, start: i.start }]);
}
// A plan's stops, numbered through the whole trip, as its overview list numbers them: the numbers on every map
export const stopsOf = p => p.days.flatMap(d => d.items.filter(i => i.kind === 'stop').map(i => ({ ...i, day: d.day })))
  .map((i, n) => ({ ...i, n: n + 1, spot: spots.get(i.spot_id) }));

// ---------- Formats, as the design system's Content section has them ----------
export const icon = (name, size) => DotsieIcons.svg(name, size);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = hhmm => { const [h, m] = hhmm.split(':').map(Number); return { t: `${(h % 12) || 12}:${pad(m)}`, ap: h < 12 || h === 24 ? 'AM' : 'PM' }; };
export const timeHTML = hhmm => { const c = clock(hhmm); return `${c.t}<span class="wt-tl-meridiem">${c.ap}</span>`; };
export const timeText = hhmm => { const c = clock(hhmm); return `${c.t} ${c.ap}`; };
export const hourText = hhmm => { const c = clock(hhmm); return `${c.t.replace(/:00$/, '')} ${c.ap}`; };
export const minutes = m => fmtDur(m * 60);
// "2026-11-15" as "Nov 15, 2026"
export const dateText = iso => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
export const sentence = s => s.replace(/^./, c => c.toUpperCase());
export const DAY_NAMES = { Mon: 'Mondays', Tue: 'Tuesdays', Wed: 'Wednesdays', Thu: 'Thursdays', Fri: 'Fridays', Sat: 'Saturdays', Sun: 'Sundays' };

export const marker = (kind, cls = 'wt-tl-marker') => `<i class="wt-marker ${cls}" role="img" aria-label="${esc(KINDS[kind].label)}" style="--wt-kind-color: var(--wt-kind-${kind})">${icon(KINDS[kind].icon)}</i>`;
export const photoCredit = p => `Photo: ${p.author || 'unknown'} · ${p.license}`;

// A spot's facts in one line, for its card: how long, when it's open, whether to book
export function factsLine(f) {
  const h = f.hours;
  const hours = h.kind === 'stated' ? `${hourText(h.open)}–${hourText(h.close)}${h.closed_days.length ? `, closed ${h.closed_days.join(', ')}` : ''}`
    : h.kind === 'always' ? 'Open any time' : 'Check hours';
  return [`About ${minutes(f.visit_minutes)}`, hours, f.book_ahead ? 'Book ahead' : f.admission === 'free' ? 'Free' : ''].filter(Boolean).join(' · ');
}
