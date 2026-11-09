/* Toasts and questions (see "Messages" in the design system). */
import { ICON, esc, failHint, token, uid } from './core.js';

// ---------- Notices: toasts and questions (see "Messages" in the design system) ----------
// A toast is news at the top of the screen. `msg` is a line of text, or { icon, title, detail, error } for one that needs
// a second line (.wt-toast--rich): what happened, then what still works or what to do. An error gets the alert icon (or
// its own, such as offline) in red, and is read out at once. `label` and `onAction` add an action, such as Undo.
// - It stays long enough to read: a quarter second a word on top of a second, at least 3 seconds (5 with an action,
//   which takes time to reach), at most 8. The pointer on it, or focus in it, holds it there.
// - A tap or a swipe up puts it away.
// - One at a time: a new toast replaces the one showing, except that news waits behind a toast with an action, so a
//   co-editor's change arriving doesn't take Undo away.
// On the trip screen it shows below the header (--wt-toast-top in styles.css), so Home and settings stay in reach.
const $toast = Object.assign(document.createElement('div'), { className: 'wt-toast' });
$toast.setAttribute('role', 'status');
document.body.append($toast);
let toastNow = null, toastNext = null, toastTimer = 0, toastLeft = 0, toastStart = 0;
const toastHold = new Set(); // 'hover', 'focus': what's holding the toast on screen
export function toast(msg, label, onAction) {
  const n = { ...(typeof msg === 'object' ? msg : { title: msg }), label, onAction };
  if (toastNow?.label && !n.label) { toastNext = n; return; }
  showToast(n);
}
// A request failed: what failed, as the heading, and what to do about it. Offline has its own icon.
export function failToast(err, title) {
  toast({ error: true, icon: err?.code === 'offline' ? ICON.cloudOff : null, title, detail: failHint(err) });
}
function showToast(n) {
  toastNow = n;
  const rich = !!(n.detail || n.icon || n.error), icon = n.icon || (n.error ? ICON.alert : '');
  $toast.className = `wt-toast${rich ? ' wt-toast--rich' : ''}${n.error ? ' wt-toast--error' : ''} is-visible`;
  $toast.setAttribute('role', n.error ? 'alert' : 'status');
  $toast.innerHTML = (rich
    ? `${icon ? `<span class="wt-toast__icon">${icon}</span>` : ''}<span class="wt-toast__text"><b class="wt-toast__title">${esc(n.title)}</b>${n.detail ? `<span class="wt-toast__detail">${esc(n.detail)}</span>` : ''}</span>`
    : `<span>${esc(n.title)}</span>`) + (n.label ? `<button class="wt-toast__action">${esc(n.label)}</button>` : '');
  if (n.label) $toast.querySelector('.wt-toast__action').onclick = () => { hideToast(); n.onAction(); };
  const words = `${n.title} ${n.detail || ''}`.trim().split(/\s+/).length;
  toastLeft = Math.min(8000, Math.max(n.label ? 5000 : 3000, 1000 + words * 250));
  toastHold.delete('hover'); // a new toast hasn't been pointed at yet
  runToast();
}
function runToast() {
  clearTimeout(toastTimer);
  if (!toastNow || toastHold.size) return;
  toastStart = Date.now();
  toastTimer = setTimeout(hideToast, toastLeft);
}
function hideToast() {
  clearTimeout(toastTimer);
  $toast.classList.remove('is-visible');
  const next = toastNext;
  toastNow = toastNext = null;
  toastHold.clear();
  // the news that waited: now, or after whatever took its place (Undo's own notice, say)
  if (next) setTimeout(() => { if (!toastNow) showToast(next); else toastNext ||= next; }, 300);
}
function holdToast(why, on) {
  const was = toastHold.size;
  if (on) toastHold.add(why); else toastHold.delete(why);
  if (!was && toastHold.size) { clearTimeout(toastTimer); toastLeft = Math.max(1500, toastLeft - (Date.now() - toastStart)); }
  if (was && !toastHold.size) runToast();
}
$toast.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') holdToast('hover', true); });
$toast.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') holdToast('hover', false); });
$toast.addEventListener('focusin', () => holdToast('focus', true));
$toast.addEventListener('focusout', () => holdToast('focus', false));
// A tap puts it away; so does a swipe up, which it follows (and resists going down)
let toastDrag = null;
$toast.addEventListener('pointerdown', e => {
  if (!toastNow || e.target.closest('button')) return;
  toastDrag = { id: e.pointerId, y: e.clientY, dy: 0, moved: 0 };
  $toast.setPointerCapture(e.pointerId);
  $toast.classList.add('is-dragging');
});
$toast.addEventListener('pointermove', e => {
  if (toastDrag?.id !== e.pointerId) return;
  const dy = e.clientY - toastDrag.y;
  toastDrag.dy = dy < 0 ? dy : dy / 4;
  toastDrag.moved = Math.max(toastDrag.moved, Math.abs(dy));
  $toast.style.setProperty('--wt-toast-drag', `${toastDrag.dy}px`);
});
const endToastDrag = e => {
  if (toastDrag?.id !== e.pointerId) return;
  const { dy, moved } = toastDrag;
  toastDrag = null;
  $toast.classList.remove('is-dragging');
  $toast.style.removeProperty('--wt-toast-drag');
  if (e.type === 'pointerup' && (dy < -24 || moved < 6)) hideToast();
};
$toast.addEventListener('pointerup', endToastDrag);
$toast.addEventListener('pointercancel', endToastDrag);

// A question before an action that can't be undone, or that others will notice (.wt-dialog): the title asks it, a line
// under it says what happens, and the buttons are Cancel and one that names the action. It sits over everything, so a
// sheet can ask without closing. When the action destroys something its button is red and Cancel has the focus;
// otherwise the action has it. Esc or a tap outside cancels; Tab stays inside. Resolves to true if the action is chosen.
export function ask({ title, detail = '', action, danger = false }) {
  return new Promise(resolve => {
    const back = document.activeElement, id = `ask-${uid()}`;
    const root = Object.assign(document.createElement('div'), { className: 'wt-dialog-root' });
    root.innerHTML = `<div class="wt-dialog__backdrop" data-answer="no"></div>
      <div class="wt-dialog" role="alertdialog" aria-modal="true" aria-labelledby="${id}-t"${detail ? ` aria-describedby="${id}-d"` : ''}>
        <h2 class="wt-dialog__title" id="${id}-t">${esc(title)}</h2>${detail ? `<p class="wt-dialog__text" id="${id}-d">${esc(detail)}</p>` : ''}
        <div class="wt-dialog__actions"><button type="button" class="wt-btn wt-btn--secondary" data-answer="no">Cancel</button>
          <button type="button" class="wt-btn ${danger ? 'wt-btn--destructive' : 'wt-btn--primary'}" data-answer="yes">${esc(action)}</button></div>
      </div>`;
    document.body.append(root);
    const btns = [...root.querySelectorAll('button')];
    const answer = yes => {
      document.removeEventListener('keydown', onKey, true);
      root.classList.remove('is-open');
      setTimeout(() => root.remove(), parseFloat(token('--wt-duration-base')) || 0);
      if (back?.isConnected) back.focus({ preventScroll: true });
      resolve(yes);
    };
    // Before the page's own keys: Esc here cancels the question, not the sheet under it
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answer(false); }
      if (e.key === 'Tab') { e.preventDefault(); btns[(btns.indexOf(document.activeElement) + 1) % btns.length].focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    root.addEventListener('click', e => { const a = e.target.closest('[data-answer]'); if (a) answer(a.dataset.answer === 'yes'); });
    btns[danger ? 0 : 1].focus({ preventScroll: true });
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('is-open')));
  });
}
