/* The server: every /api request, the open trip's live socket, and sign-out. The prototype has its own backend.js with
   the same exports, which answers in the browser instead (see prototype/index.html). */
import { ApiError } from './core.js';
import { me, signedOut } from './signin.js';
import { cur, onEvent, reloadTrip } from './trips.js';
import { ask } from './notices.js';

export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, signal,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body && JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(0, 'offline');
  }
  if (res.status === 401 && !path.startsWith('/auth/')) { signedOut(); throw new ApiError(401, 'unauthorized'); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new ApiError(res.status, j.error || j.code); } // ours, or Better Auth's
  return res.status === 204 ? null : res.json();
}
// What the backend adds to trip settings, under the map's credits: nothing here (the prototype's says how to try it out)
export const settingsNoteHTML = () => '';
export async function signOut() {
  if (me.isGuest && !(await ask({ title: 'Sign out and lose your trips?', detail: 'As a guest, your trips are only in this browser. Sign in instead to keep them.', action: 'Sign out', danger: true }))) return;
  await api('/auth/sign-out', { method: 'POST', body: {} }).catch(() => {});
  location.hash = '#/';
  signedOut();
}

// ---------- Live edits from co-editors ----------
let live = null, liveTimer = 0, liveTries = 0;
export function connectLive(id) {
  disconnectLive();
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/trips/${id}/live`);
  let ping = 0;
  live = ws;
  ws.onopen = () => {
    if (liveTries) reloadTrip(); // catch up on edits made while disconnected
    liveTries = 0;
    ping = setInterval(() => ws.send('ping'), 30000);
  };
  ws.onmessage = e => { if (e.data !== 'pong') onEvent(JSON.parse(e.data)); };
  ws.onclose = e => {
    clearInterval(ping);
    if (live !== ws) return; // closed on purpose or replaced
    live = null;
    if (e.code === 4410 || e.code === 4403) return; // the trip was deleted, or you left it
    liveTimer = setTimeout(() => { if (cur?.id === id) connectLive(id); }, Math.min(30000, 1000 * 2 ** liveTries++));
  };
}
export function disconnectLive() {
  clearTimeout(liveTimer);
  const ws = live;
  live = null;
  ws?.close();
}
// Phones drop sockets while asleep; reconnect as soon as the app is back on screen.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && cur?.stops && !live) { liveTries = Math.max(liveTries, 1); connectLive(cur.id); }
});
