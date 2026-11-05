'use strict';

/* Waythread offline — the same file in app/web and prototype.
   The app saves a trip for offline itself, from trip settings (see "Offline" in app.js): the app's own files go in the
   waythread-shell cache, and the trip's map tiles in one cache per trip. This worker only answers from those caches:
   - the app's files: from the network, and from the saved copy when the network fails or is too slow (a weak signal);
     a fresh copy replaces the saved one whenever it comes;
   - map tiles: the saved tile first, so a saved trip's map costs nothing to show; any other tile from the network;
   - everything else (the API, its WebSocket, place search) isn't touched. */
const SHELL = 'waythread-shell';
const SLOW = 4000; // ms to wait for the network before showing the saved copy of a page or file
const TILES = 'tiles.stadiamaps.com';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === TILES) { e.respondWith(caches.match(req.url).then(hit => hit || fetch(req))); return; }
  const mine = url.origin === location.origin && !url.pathname.startsWith('/api/');
  if (mine || url.hostname === 'unpkg.com') e.respondWith(shellFile(e, req, url));
});

// A page is saved without its query (?as=sam in the prototype, ?today=…), so any of them opens offline.
async function shellFile(e, req, url) {
  const cache = await caches.open(SHELL);
  const key = req.mode === 'navigate' ? url.origin + url.pathname : req.url;
  const saved = await cache.match(key);
  const net = fetch(req).then(res => {
    // Only same-origin files can be checked (a script from unpkg comes back opaque); unpkg's are pinned versions
    if (saved && res.ok && res.type === 'basic') e.waitUntil(cache.put(key, res.clone()));
    return res;
  });
  if (!saved) return net;
  net.catch(() => {}); // the saved copy answers; a failed fetch isn't an error then
  return Promise.race([net.catch(() => saved), new Promise(r => setTimeout(() => r(saved), SLOW))]);
}
