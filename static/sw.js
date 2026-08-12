/* Service-Worker: App-Hülle offline verfügbar, API-Aufrufe immer live (Netzwerk). */
const CACHE = 'beetown-shell-v2.9.09';
const SHELL = [
  './', './index.html', './app.js', './styles.css', './manifest.json',
  './icon-192.png', './icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API & Fotos: nie cachen, immer frisch vom Server
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  // App-Hülle: zuerst Cache, sonst Netzwerk
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
