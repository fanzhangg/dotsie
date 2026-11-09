/* Sheets, and the ones for a new trip, trip settings and the account. */
import { $sheets, ICON, avatarHTML, esc } from './core.js';
import { MONTHS } from './time.js';
import { authFlow, canSignIn, me } from './signin.js';
import { closeTrip, cur, fromSnapshot, openTripOf, save, setCur } from './trips.js';
import { api, connectLive, settingsNoteHTML } from './backend.js';
import { isWide } from './timeline.js';
import { MAPS_APPS, mapsApp, setMapsApp } from './routes.js';
import { offlineJob, removeOffline, saveOffline, setOfflineField, showOffline } from './offline.js';
import { render } from './app.js';
import { mapCredit } from './map.js';
import { choicePage, choicePageHTML, optionHTML } from './stopsheet.js';
import { ask, failToast, toast } from './notices.js';

// ---------- Sheets ----------
const closeBtn = `<button class="wt-icon-btn" data-action="close-sheet" aria-label="Close">${ICON.close}</button>`;
// A long form's head can stay put while its fields scroll (sticky), so Close is always in reach
export const modalHead = (title, sticky) => `<div class="wt-modal__head${sticky ? ' wt-modal__head--sticky' : ''}"><h2 class="wt-modal__title">${title}</h2>${closeBtn}</div>`;
// A panel (the stop sheet) has no backdrop, so the map stays in view and usable beside or above it.
// onClose runs however the sheet goes away: closed, replaced by another sheet, or left with the trip.
// A sheet has its own history entry, so the phone's Back button closes it rather than leaving the page under it.
let onSheetClose = null;
export function openSheet(html, mount, { panel = false, onClose = null } = {}) {
  runSheetClose();
  if (!history.state?.wtSheet) history.pushState({ wtSheet: true }, '');
  // over the trip's side panel on a wide screen; a dialog in the middle elsewhere, a bottom sheet on a phone
  $sheets.classList.toggle('wt-modal-root--side', isWide());
  $sheets.classList.toggle('wt-modal-root--panel', panel);
  $sheets.innerHTML = `${panel ? '' : '<div class="wt-modal__backdrop" data-action="close-sheet"></div>'}<div class="wt-modal" role="dialog" aria-modal="${!panel}">${html}</div>`;
  onSheetClose = onClose;
  mount?.($sheets.querySelector('.wt-modal'));
  requestAnimationFrame(() => requestAnimationFrame(() => $sheets.classList.add('is-open')));
}
export function closeSheet() {
  const was = !!$sheets.innerHTML;
  $sheets.classList.remove('is-open', 'wt-modal-root--panel');
  $sheets.innerHTML = '';
  runSheetClose();
  // Take the sheet's history entry with it, a moment later: unless another sheet has opened in its place,
  // or the page has moved on (and so off that entry) meanwhile
  if (was) setTimeout(() => { if (!$sheets.innerHTML && history.state?.wtSheet) history.back(); });
}
// Close the sheet and go to another page, which takes the sheet's history entry, so Back from there skips it
function closeSheetTo(hash) {
  const had = history.state?.wtSheet;
  closeSheet();
  if (had) location.replace(hash); else location.hash = hash;
}
// Back (or forward, or any other page) to an entry without a sheet: close what's open, wherever it was opened
addEventListener('popstate', () => { if (!history.state?.wtSheet && $sheets.innerHTML) closeSheet(); });
function runSheetClose() { const f = onSheetClose; onSheetClose = null; f?.(); }

export function openNewTrip() {
  openSheet(`${modalHead('New trip')}
    <form><input class="wt-input" name="title" placeholder="Trip to White Sands, NM" autocomplete="off" required maxlength="120" aria-label="Trip name">
    <div class="wt-modal__actions"><button class="wt-btn wt-btn--primary">Create</button></div></form>`, el => {
    const f = el.querySelector('form');
    f.elements.title.focus();
    f.onsubmit = async e => {
      e.preventDefault();
      f.elements[1].disabled = true;
      try {
        const snap = await api('/trips', { method: 'POST', body: { name: f.elements.title.value.trim() } });
        closeTrip();
        setCur(fromSnapshot(snap));
        connectLive(cur.id);
        closeSheetTo(`#/trip/${cur.id}`);
      } catch (err) {
        f.elements[1].disabled = false;
        if (err.status !== 401) failToast(err, 'Couldn’t create the trip');
      }
    };
  });
}

// Everything about the trip that isn't the plan, one section each: its name, who's on it, the share link, saving it for
// offline, and deleting it (the owner, who made it) or leaving it (everyone else). Then the map's credits.
export function openSettings(trip) {
  const owner = trip.owner === me.id;
  openSheet(`${modalHead('Trip settings')}
    <form class="wt-section settings-name">
      <label class="wt-section__title" for="trip-name">Name</label>
      <input class="wt-input" id="trip-name" name="title" autocomplete="off" required maxlength="120">
    </form>
    <section class="wt-section"><h3 class="wt-section__title">People</h3>
      <ul class="wt-people">${trip.members.map(m => `<li class="wt-people__item">${avatarHTML(m)}<span>${esc(m.name)}${m.id === me.id ? ' <span class="wt-people__meta">(you)</span>' : ''}${m.id === trip.owner ? ' <span class="wt-people__meta">· Owner</span>' : ''}</span></li>`).join('')}</ul></section>
    <section class="wt-section"><h3 class="wt-section__title">Share link</h3>
      <p class="wt-section__text">Anyone with the link can join and edit this trip.</p>
      <div class="wt-copy-row"><input class="wt-input" readonly value="" placeholder="Loading…" aria-label="Trip link"><button class="wt-btn wt-btn--secondary" data-action="copy" disabled>Copy</button>${navigator.share ? '<button class="wt-btn wt-btn--secondary" data-share disabled>Share</button>' : ''}</div>
      <button class="wt-btn wt-btn--secondary" data-new-link>Make a new link</button></section>
    <section class="wt-section settings-offline"></section>
    <div class="wt-section">${owner ? '<button class="wt-btn wt-btn--danger" data-del>Delete trip</button>' : '<button class="wt-btn wt-btn--danger" data-leave>Leave trip</button>'}</div>
    <p class="wt-credit">Map ${mapCredit}</p>${settingsNoteHTML(trip)}`, async el => {
    // Offline: Save for offline, how far it's got, or what's saved
    const off = el.querySelector('.settings-offline');
    setOfflineField({ el: off, trip, kind: '' });
    showOffline();
    off.addEventListener('click', e => {
      if (e.target.closest('[data-offline-save]')) saveOffline(trip);
      else if (e.target.closest('[data-offline-remove]')) {
        const cancel = offlineJob?.id === trip.id && offlineJob.first;
        removeOffline(trip);
        toast(cancel ? 'Stopped saving for offline' : 'Removed from this device');
      }
    });
    // The name saves when you leave the field or press Return; no separate button
    const f = el.querySelector('.settings-name');
    f.elements.title.value = trip.name;
    f.onsubmit = e => { e.preventDefault(); f.elements.title.blur(); };
    f.elements.title.addEventListener('change', () => {
      const name = f.elements.title.value.trim();
      if (!name || name === trip.name) { f.elements.title.value = trip.name; return; }
      const t = openTripOf(trip.id);
      if (t) t.name = name;
      render();
      save(api(`/trips/${trip.id}`, { method: 'PATCH', body: { name } })).then(r => { if (r !== undefined) toast('Name saved'); });
    });
    // Deleting is for everyone, so it asks first; it can still be undone from the notice.
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!(await ask({ title: `Delete “${trip.name}”?`, detail: 'It’s deleted for everyone on the trip. You can undo right after.', action: 'Delete trip', danger: true }))) return;
      try { await api(`/trips/${trip.id}`, { method: 'DELETE' }); } catch (err) {
        if (err.status !== 401) failToast(err, 'Couldn’t delete the trip');
        return;
      }
      closeTrip();
      closeSheetTo('#/');
      toast(`Deleted ${trip.name}`, 'Undo', async () => {
        try { await api(`/trips/${trip.id}/restore`, { method: 'POST' }); location.hash = `#/trip/${trip.id}`; } catch (err) { failToast(err, 'Couldn’t restore the trip'); }
      });
    });
    // Leaving takes the trip off your home screen only; the share link brings you back.
    el.querySelector('[data-leave]')?.addEventListener('click', async () => {
      if (!(await ask({ title: `Leave “${trip.name}”?`, detail: 'It stays for everyone else. The share link can bring you back.', action: 'Leave trip', danger: true }))) return;
      try { await api(`/trips/${trip.id}/leave`, { method: 'POST' }); } catch (err) {
        if (err.status !== 401) failToast(err, 'Couldn’t leave the trip');
        return;
      }
      closeTrip();
      closeSheetTo('#/');
      toast(`Left ${trip.name}`);
    });
    const input = el.querySelector('.wt-copy-row input'), copy = el.querySelector('[data-action="copy"]'), share = el.querySelector('[data-share]');
    const show = url => { input.value = url; copy.dataset.text = url; copy.disabled = false; if (share) share.disabled = false; };
    // Share opens the phone's (or computer's) own share sheet, so the link goes straight into a chat or a post. Only
    // where the browser has one; Copy covers the rest.
    if (share) share.onclick = () => navigator.share({ title: trip.name, text: `Join “${trip.name}” on Dotsie`, url: input.value })
      .catch(err => { if (err.name !== 'AbortError') toast({ error: true, title: 'Couldn’t share', detail: 'Copy the link instead.' }); });
    // A new link is for when the old one went somewhere it shouldn't have: the old one stops working.
    el.querySelector('[data-new-link]').onclick = async () => {
      if (!(await ask({ title: 'Make a new link?', detail: 'The current link stops working. Everyone already on the trip stays on it.', action: 'Make new link' }))) return;
      try { show((await api(`/trips/${trip.id}/invite/rotate`, { method: 'POST' })).url); toast('New link ready'); } catch (err) { failToast(err, 'Couldn’t make a new link'); }
    };
    try { show((await api(`/trips/${trip.id}/invite`)).url); } catch { input.placeholder = 'Couldn’t load the link'; }
  });
}

// Your name as others on your trips see it, the maps app, and AI assistants (not for guests); guests are
// offered a real sign-in, which keeps their trips; everyone can sign out. One section each, as in trip settings.
export function openAccount() {
  const upgrade = me.isGuest && canSignIn();
  openSheet(`<div class="account-main">${modalHead('Account')}
    <form class="wt-section account-name">
      <label class="wt-section__title" for="account-name">Your name</label>
      <input class="wt-input" id="account-name" name="name" autocomplete="name" maxlength="40" required aria-describedby="account-name-hint">
      <p class="wt-section__hint" id="account-name-hint">People on your trips see this name.${me.isGuest && !upgrade ? ' As a guest, you can only reach your trips from this browser.' : ''}</p>
    </form>
    ${upgrade ? `<section class="wt-section"><h3 class="wt-section__title">Keep your trips</h3>
      <p class="wt-section__text">As a guest, you can only reach your trips from this browser. Sign in to keep them on any device.</p>
      <div class="signin"></div></section>` : ''}
    <div class="wt-section"><span class="wt-section__title" id="maps-label">Maps app</span>
      <div class="wt-field"><button type="button" class="wt-picker wt-picker--text" data-maps-open aria-labelledby="maps-label maps-value"></button></div></div>
    ${me.isGuest ? '' : '<section class="wt-section account-mcp"></section>'}
    <div class="wt-section"><button class="wt-btn wt-btn--secondary" data-action="sign-out">Sign out</button></div></div>
    ${choicePageHTML('account-maps', 'Maps app', Object.entries(MAPS_APPS).map(([k, label]) => optionHTML(k, label)).join(''), 'Places and directions open in this app. Saved on this device.')}`, el => {
    const f = el.querySelector('.account-name');
    f.elements.name.value = me.name;
    // Saves when you leave the field or press Return; no separate button
    const saveName = async () => {
      const name = f.elements.name.value.trim().replace(/\s+/g, ' ');
      if (!name || name === me.name) { f.elements.name.value = me.name; return; }
      try {
        await api('/auth/update-user', { method: 'POST', body: { name } });
        me.name = name;
        toast('Name saved');
        render();
      } catch (err) { failToast(err, 'Couldn’t save your name'); }
    };
    f.onsubmit = e => { e.preventDefault(); f.elements.name.blur(); };
    f.elements.name.addEventListener('change', saveName);
    // Maps app: the picker row, and its page
    const mapsPicker = el.querySelector('[data-maps-open]');
    const maps = choicePage(el, { main: el.querySelector('.account-main'), page: el.querySelector('.account-maps'), picker: mapsPicker, onPick: app => { setMapsApp(app); showMaps(); } });
    const showMaps = () => {
      mapsPicker.innerHTML = `<span class="wt-picker__value" id="maps-value">${MAPS_APPS[mapsApp]}</span>${ICON.forward}`;
      maps.mark(mapsApp);
    };
    showMaps();
    if (!me.isGuest) assistantField(el.querySelector('.account-mcp'));
    if (upgrade) authFlow(el.querySelector('.signin'));
  });
}

// AI assistant, in Account: how to connect one (Dotsie's MCP server address, which an assistant adds as a
// connector; it then sends you to sign in and allow it), and the assistants you've connected, each with Disconnect.
async function assistantField(box) {
  const day = ms => { const d = new Date(ms); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
  const head = `<h3 class="wt-section__title">AI assistant</h3>
    <p class="wt-section__text">Connect Claude or another assistant that supports MCP, so it can see your trips’ stops and change them for you.</p>`;
  const show = ({ url, connections }) => {
    box.innerHTML = `${head}
      <div class="wt-copy-row"><input class="wt-input" readonly value="${esc(url)}" aria-label="Server address" aria-describedby="mcp-hint">
        <button class="wt-btn wt-btn--secondary" data-action="copy" data-text="${esc(url)}" data-copied="Address copied">Copy</button></div>
      <p class="wt-section__hint" id="mcp-hint">In Claude, add a custom connector with this address (Customize → Connectors → Add custom connector), then sign in here when it asks.</p>
      ${connections.length ? `<ul class="account-mcp__list" aria-label="Connected assistants">${connections.map(c => `<li class="account-mcp__item">
        <span class="account-mcp__name">${esc(c.name)}<span class="account-mcp__meta">${c.domain ? `${esc(c.domain)} · ` : ''}connected ${day(c.createdAt)}</span></span>
        <button class="wt-btn wt-btn--danger" data-mcp-off="${esc(c.id)}">Disconnect</button></li>`).join('')}</ul>` : ''}`;
    for (const btn of box.querySelectorAll('[data-mcp-off]')) btn.onclick = async () => {
      const c = connections.find(x => x.id === btn.dataset.mcpOff);
      if (!(await ask({ title: `Disconnect ${c.name}?`, detail: 'It won’t be able to see or change your trips. You can connect it again anytime.', action: 'Disconnect', danger: true }))) return;
      try {
        await api(`/assistants/${encodeURIComponent(c.id)}`, { method: 'DELETE' });
        show({ url, connections: connections.filter(x => x !== c) });
        toast(`${c.name} disconnected`);
      } catch (err) { if (err.status !== 401) failToast(err, `Couldn’t disconnect ${c.name}`); }
    };
  };
  box.innerHTML = head;
  try { show(await api('/assistants')); } catch { box.innerHTML = `${head}<p class="wt-section__hint">Couldn’t load this. Check your connection.</p>`; }
}
