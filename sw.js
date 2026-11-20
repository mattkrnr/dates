// Offline support: serve the app from cache when there's no connection.
// Same-origin files are network-first (so list edits show up right away), cached as a fallback.
const CACHE = 'whimsy-v7';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  const isLib = url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('googleapis.com') || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isLib) return; // APIs (GitHub, weather, maps) go straight to the network
  // Same-origin files always revalidate with GitHub Pages (skipping its 10-minute browser cache),
  // so a new deploy shows up on the next open. Offline, fall back to the cached copy.
  const req = sameOrigin ? new Request(e.request, { cache: 'no-cache' }) : e.request;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
