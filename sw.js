// Stand: 03.10.2026 - Service Worker: die App startet auch ohne Netz.
// Bei jeder Aenderung an den Dateien die Nummer in CACHE erhoehen, damit Geraete die neue Version laden.
const CACHE = 'kanban_v3';
const CORE = ['./', 'index.html', 'style.css', 'app.js', 'logic.js', 'manifest.json', 'icon.svg'];
const OPTIONAL = ['icon180.png', 'icon192.png', 'icon512.png', 'icon512maskable.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(CORE).then(() =>
        Promise.all(OPTIONAL.map((f) => cache.add(f).catch(() => {})))
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) =>
      hit || fetch(req).catch(() => caches.match('index.html'))
    )
  );
});
