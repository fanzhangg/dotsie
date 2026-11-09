/* Who's signed in: starting the app, signing in and out, and the sign-in screens. */
import { $app, ICON, WORDMARK, esc, failMsg, params } from './core.js';
import { closeTrip, setTrips } from './trips.js';
import { api } from './backend.js';
import { anySaved, forgetOffline, keepShell, offline, registerOffline, rememberSession } from './offline.js';
import { parseHash, render } from './app.js';
import { closeSheet } from './sheets.js';
import { failToast, toast } from './notices.js';

// Who's signed in, the home list, and the open trip ({ id, name, members, stops } or { id, error })
export let me = null, config = { google: false, apple: false, password: false };
// Whether any real sign-in is set up; without one, guests aren't offered an upgrade they can't do.
export const canSignIn = () => config.google || config.apple || config.password;

// ---------- Session ----------
// An assistant connecting through OAuth sends you here to sign in (/?next=/api/oauth/authorize?…): once you're
// signed in, back to that page to allow it. Only that page, so the link can't send you anywhere else.
function nextURL() {
  const next = params.get('next');
  if (!next) return null;
  const u = new URL(next, location.origin);
  return u.origin === location.origin && u.pathname === '/api/oauth/authorize' ? u.pathname + u.search : null;
}
export async function boot() {
  // With no connection, whoever saved trips on this device is still signed in (see Offline)
  [config, me] = await Promise.all([
    api('/config').catch(e => (e.code === 'offline' && offline.config) || config),
    api('/me').catch(e => (e.code === 'offline' && offline.me) || null),
  ]);
  if (me && nextURL()) { location.replace(nextURL()); return; }
  if (anySaved()) { rememberSession(); registerOffline(); keepShell(); }
  render();
  const msg = socialErrorMessage();
  if (msg) toast(msg);
}
export function signedOut() {
  me = null; setTrips(null);
  forgetOffline(); // what's saved on this device was theirs
  closeTrip();
  closeSheet();
  render();
}
// Come back to the same screen (a share link, say, or connecting an assistant) after Google, whether it worked or not.
const callbackURL = () => location.pathname + location.search + location.hash;
export async function signInSocial(provider) {
  try {
    const { url } = await api('/auth/sign-in/social', { method: 'POST', body: { provider, callbackURL: callbackURL(), errorCallbackURL: callbackURL() } });
    location.href = url;
  } catch (err) { failToast(err, 'Sign-in isn’t available right now'); }
}
// Better Auth returns a failed provider sign-in as ?error=…; say what happened, then tidy the address.
// An existing password account isn't joined to Google automatically, since its email was never verified.
function socialErrorMessage() {
  const code = params.get('error');
  if (!code) return null;
  params.delete('error');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  if (code === 'access_denied') return null; // they cancelled
  if (code === 'account_not_linked' || code === 'unable_to_link_account') return { error: true, title: 'This email already has a password', detail: 'Use Continue with email to sign in.' };
  return { error: true, title: 'Couldn’t sign in with Google', detail: 'Try again in a moment.' };
}

// ---------- Sign in ----------
/* One choice per screen. Start: Google, email, or guest. The email step asks only for the address,
   then goes where it leads: the password for an existing account, "use Google" for a Google account,
   or a new account. A guest gives only a name. The same steps run in the Account sheet when a guest
   saves their trips (without the guest option, and without asking their name again). */
let invite = { token: null, name: null };
export function renderSignIn(r) {
  const joining = r.page === 'join', connecting = !joining && !!nextURL();
  $app.innerHTML = `
    <header class="home-head"><h1 class="signin-title${joining || connecting ? '' : ' wt-wordmark'}">${joining ? esc(invite.token === r.token && invite.name ? `Join ${invite.name}` : 'Join the trip') : connecting ? 'Connect your assistant' : WORDMARK}</h1></header>
    <main class="signin"></main>`;
  // Connecting an assistant needs an account: a guest's trips are only reachable from this browser
  authFlow($app.querySelector('.signin'), { joining, connecting, guest: !connecting });
  if (joining && invite.token !== r.token) {
    invite = { token: r.token, name: null };
    api(`/invite/${encodeURIComponent(r.token)}`).then(({ name }) => {
      invite.name = name;
      const h = $app.querySelector('.signin-title');
      if (h && parseHash().token === r.token) h.textContent = `Join ${name}`;
    }, () => {});
  }
}

// Google's mark, in its own colors as Google's sign-in guidelines ask; the only colored icon in the app.
const GOOGLE_MARK = '<svg class="wt-icon" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const googleBtnHTML = `<button type="button" class="wt-btn wt-btn--secondary wt-btn--block" data-action="social" data-provider="google">${GOOGLE_MARK}Continue with Google</button>`;
const appleBtnHTML = '<button type="button" class="wt-btn wt-btn--secondary wt-btn--block" data-action="social" data-provider="apple">Continue with Apple</button>';
// A password field with a Show button, so a typo is easy to spot on a phone keyboard
const passwordHTML = (autocomplete, placeholder) => `<div class="signin__pw">
  <input class="wt-input" name="password" type="password" placeholder="${placeholder}" autocomplete="${autocomplete}" ${autocomplete === 'new-password' ? 'minlength="8"' : ''} maxlength="128" required aria-label="Password">
  <button type="button" class="signin__show" data-show aria-label="Show password">Show</button></div>`;
// Password managers pair a password with the address it belongs to
const usernameHTML = email => `<input class="wt-visually-hidden" type="email" name="username" autocomplete="username" value="${esc(email)}" tabindex="-1" aria-hidden="true">`;

// Better Auth's codes (and ours), in words
const AUTH_ERRORS = {
  INVALID_EMAIL_OR_PASSWORD: 'That password isn’t right.',
  INVALID_EMAIL: 'That email address doesn’t look right.',
  PASSWORD_TOO_SHORT: 'Use at least 8 characters.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  invalid: 'That email address doesn’t look right.',
};

export function authFlow(root, { joining = false, connecting = false, guest = false } = {}) {
  const s = { step: 'start', email: '' };
  const head = (title, back) => `<div class="signin__head">
    <button type="button" class="wt-icon-btn signin__back" data-to="${back}" aria-label="Back">${ICON.back}</button>
    <h2 class="signin__title">${title}</h2></div>`;
  const emailLine = () => `<p class="signin__text">${esc(s.email)} · <button type="button" class="signin__link" data-to="email">Change</button></p>`;
  const errorHTML = '<p class="signin__error" role="alert" hidden></p>';
  const STEPS = {
    start: () => `
      ${connecting ? '<p class="signin__text">Sign in to Dotsie, then allow your assistant to see and change your trips.</p>' : ''}
      ${guest ? `<p class="signin__text">${joining ? 'Everyone on the trip can see and edit the plan.' : 'Plan a trip together, in one place.'}</p>` : ''}
      ${config.google ? googleBtnHTML : ''}
      ${config.apple ? appleBtnHTML : ''}
      ${config.password ? '<button type="button" class="wt-btn wt-btn--secondary wt-btn--block" data-to="email">Continue with email</button>' : ''}
      ${guest ? `<button type="button" class="wt-btn wt-btn--secondary wt-btn--block" data-to="guest">${joining ? 'Join as a guest' : 'Continue as a guest'}</button>
      <p class="signin__hint signin__hint--center">No account needed, but you can only reach your trips from this browser.</p>` : ''}`,
    email: () => `${head('Continue with email', 'start')}
      <form data-submit="lookup">
        <input class="wt-input" name="email" type="email" placeholder="you@example.com" autocomplete="email" required aria-label="Email" value="${esc(s.email)}">
        ${errorHTML}<button class="wt-btn wt-btn--primary wt-btn--block">Continue</button></form>`,
    password: () => `${head('Welcome back', 'email')}${emailLine()}
      <form data-submit="sign-in">${usernameHTML(s.email)}
        ${passwordHTML('current-password', 'Password')}
        ${errorHTML}<button class="wt-btn wt-btn--primary wt-btn--block">Sign in</button></form>
      <p class="signin__hint">Forgot it? Password reset isn’t available yet.</p>`,
    'sign-up': () => `${head('Create your account', 'email')}${emailLine()}
      <form data-submit="sign-up">${usernameHTML(s.email)}
        ${me?.isGuest ? '' : '<input class="wt-input" name="name" placeholder="Your name" autocomplete="name" maxlength="40" required aria-label="Your name">'}
        ${passwordHTML('new-password', 'Choose a password')}
        <p class="signin__hint">At least 8 characters.${me?.isGuest ? ' Your trips move to this account.' : ''}</p>
        ${errorHTML}<button class="wt-btn wt-btn--primary wt-btn--block">Create account</button></form>`,
    google: () => `${head('Use Google for this email', 'email')}
      <p class="signin__text">${esc(s.email)} signs in with Google.</p>${googleBtnHTML}`,
    guest: () => `${head(joining ? 'Join as a guest' : 'Continue as a guest', 'start')}
      <form data-submit="guest">
        <input class="wt-input" name="name" placeholder="Your name" autocomplete="given-name" maxlength="40" required aria-label="Your name">
        <p class="signin__hint">Others on the trip see this name.</p>
        ${errorHTML}<button class="wt-btn wt-btn--primary wt-btn--block">${joining ? 'Join the trip' : 'Continue'}</button></form>`,
  };
  const go = (step, patch) => {
    Object.assign(s, patch, { step });
    root.innerHTML = STEPS[step]();
    if (step !== 'start') root.querySelector('input:not([tabindex="-1"])')?.focus();
  };
  // Signed in: a guest who saved their trips lands back where they were, now with an account
  const done = async msg => {
    if (connecting && nextURL()) { location.replace(nextURL()); return; }
    me = await api('/me');
    setTrips(null);
    closeSheet();
    render();
    if (msg) toast(msg);
  };
  // Shown under the form; thrown by a step to explain something that isn't an API error
  const say = message => Object.assign(new Error(message), { local: true });
  const ACTIONS = {
    lookup: async F => {
      const email = F.email.value.trim();
      const { account } = await api('/sign-in-options', { method: 'POST', body: { email } });
      go(account === 'password' ? 'password' : account === 'none' ? 'sign-up' : 'google', { email });
    },
    'sign-in': async F => {
      const wasGuest = me?.isGuest;
      await api('/auth/sign-in/email', { method: 'POST', body: { email: s.email, password: F.password.value } });
      await done(wasGuest ? { icon: ICON.check, title: 'Signed in', detail: 'Your trips are saved to your account.' } : null);
    },
    'sign-up': async F => {
      const wasGuest = me?.isGuest;
      const name = wasGuest ? me.name : F.name.value.trim();
      try {
        await api('/auth/sign-up/email', { method: 'POST', body: { email: s.email, password: F.password.value, name } });
      } catch (err) {
        // The account appeared a moment ago (another tab?): ask for its password instead
        if (err.code?.startsWith('USER_ALREADY_EXISTS')) { go('password'); throw say('You already have an account. Enter its password.'); }
        throw err;
      }
      await done(wasGuest ? { icon: ICON.check, title: 'Account created', detail: 'Your trips are saved to it.' } : null);
    },
    guest: async F => {
      // A guest session may already exist from an attempt that failed halfway; reuse it rather than
      // asking for another, which Better Auth refuses.
      if (!(await api('/auth/get-session'))) await api('/auth/sign-in/anonymous', { method: 'POST', body: {} });
      await api('/auth/update-user', { method: 'POST', body: { name: F.name.value.trim() } });
      await done();
    },
  };
  root.onclick = e => {
    const to = e.target.closest('[data-to]')?.dataset.to;
    if (to) return go(to);
    const show = e.target.closest('[data-show]');
    if (show) {
      const input = show.previousElementSibling, hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      show.textContent = hidden ? 'Hide' : 'Show';
      show.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
      input.focus();
    }
  };
  root.onsubmit = async e => {
    e.preventDefault();
    const f = e.target, submit = f.querySelector('button:not([type])');
    submit.disabled = true;
    f.querySelector('.signin__error').hidden = true;
    try { await ACTIONS[f.dataset.submit](f.elements); } catch (err) {
      // The step may have changed (sign-up → password); explain on whatever form is showing now
      const box = root.querySelector('.signin__error');
      if (box) { box.textContent = err.local ? err.message : AUTH_ERRORS[err.code] || failMsg(err, 'Couldn’t sign in.'); box.hidden = false; }
      const btn = root.querySelector('form button:not([type])');
      if (btn) btn.disabled = false;
    }
  };
  go('start');
}
