/* Helpers every module uses, and the trip screen's state (what's selected, which day, the sheet's height). */
export const params = new URLSearchParams(location.search);

// Saved keys and caches keep the app's first name, waythread, so what a device already saved outlives the rename to Dotsie
export const ROUTE_KEY = 'waythread:routes:v1';
export const $app = document.getElementById('app');
export const $sheets = document.getElementById('sheets');
// The app's name as its wordmark, with a stop for the i's dot (see Wordmark in the design system); read as plain text
export const WORDMARK = '<span aria-hidden="true">Dots<span class="wt-wordmark__i">ı</span>e</span><span class="wt-visually-hidden">Dotsie</span>';
// The logo, :D, as the app bar's home link: the D in the theme's ink, the colon the brand's two stops (see Logo in the
// design system; logo.svg is the same drawing)
export const LOGO = '<svg viewBox="14 14 72 72" aria-hidden="true" focusable="false"><circle class="wt-logo__top" cx="25.03" cy="35.5" r="7.5"/><circle class="wt-logo__bottom" cx="25.03" cy="64.5" r="7.5"/><path class="wt-logo__d" d="M58.11 75C73.31 75 82.47 65.6 82.47 49.97C82.47 34.4 73.31 25 58.28 25H40.53V75ZM50.76 66.17V33.83H57.67C67.24 33.83 72.27 38.79 72.27 49.97C72.27 61.21 67.24 66.17 57.61 66.17Z"/></svg>';
// The app's pages: Plan (Home, the trips) and Spots
const PAGES = [['plan', '#/', 'Plan', 'Your trips'], ['spots', '#/spots', 'Spots', 'Spots']];
export const navHTML = page => `<nav class="wt-nav" aria-label="Pages">${PAGES
  .map(([id, href, label]) => `<a class="wt-nav__link" href="${href}"${id === page ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
// The top of Home and Spots, in one row: the logo, the pages, then `end` (New trip, the account) on the right. The page's
// name is its heading, for screen readers: the nav shows it.
export const appBarHTML = (page, end) => `<header class="wt-app-bar">
  <a class="wt-logo" href="#/" aria-label="Dotsie">${LOGO}</a>${navHTML(page)}
  <h1 class="wt-visually-hidden">${PAGES.find(p => p[0] === page)[3]}</h1>
  <div class="wt-app-bar__end">${end}</div></header>`;
// The app bar's hairline, once something has scrolled under it
addEventListener('scroll', () => document.querySelector('.wt-app-bar')?.classList.toggle('is-scrolled', scrollY > 0), { passive: true });
// sel: the selected stop · selRow: which of its rows was tapped (a hotel can start and end the day) · leg: the drive whose route is shown · snap: the phone's list, 'half' or 'full' ·
// draft: the stop open in the stop sheet, as edited so far, which the map shows in its place
export const state = { sel: null, selRow: null, leg: null, hoverLeg: null, day: null, snap: 'half', draft: null, flash: new Set() };
// What to do when a request fails: wait out the server's rate limit, get a connection, or try again
export const failHint = err => err?.code === 'rate_limited' ? 'Too many tries. Wait a minute, then try again.'
  : err?.code === 'offline' ? 'Check your connection, then try again.' : 'Try again in a moment.';
// As one line, for a form's error text: what failed, then what to do
export const failMsg = (err, what) => (err?.code === 'rate_limited' ? failHint(err) : `${what} ${failHint(err)}`);

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The initial sits under the photo, so it shows while the photo loads and if it fails (see below).
// Google's photo host can refuse requests that carry a referrer.
export const avatarHTML = m => `<span class="wt-avatar" style="--wt-avatar-color: var(--wt-identity-${m.identity || 1})">${esc((m.name || '?')[0].toUpperCase())}${
  m.image ? `<img class="wt-avatar__img" src="${esc(m.image)}" alt="" referrerpolicy="no-referrer">` : ''}</span>`;
// Map drawing can't use CSS classes, so it reads the design tokens directly (theme-aware).
export const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Icons (design system) ----------
export const ICON = Object.fromEntries(['home', 'settings', 'back', 'forward', 'chevron-down', 'chevron-up-down', 'calendar', 'close', 'plus', 'edit', 'car', 'directions', 'map', 'list', 'check', 'fit', 'search', 'pin', 'download', 'saved', 'cloud-off', 'alert', 'link', 'external']
  .map(n => [n.replace(/-(\w)/g, (_, c) => c.toUpperCase()), DotsieIcons.svg(n)]));

// ---------- API ----------
export class ApiError extends Error {
  constructor(status, code) { super(code || `HTTP ${status}`); this.status = status; this.code = code; }
}

// Wide: the plan is a side panel (the design system's wt-trip container query), so there's nothing to snap or drag.
export const WIDE = 768;
