// Cache-first service worker — the whole game works offline after first load.
const CACHE = 'pixel-quest-v3';
const ASSETS = [
  '.', 'index.html', 'game.js', 'assets.js', 'input.js', 'entities.js', 'audio.js', 'zonegen.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'assets/pixely-up.png', 'assets/pixely-down.png', 'assets/pixely-left.png', 'assets/pixely-right.png',
  'assets/emily-up.png', 'assets/emily-down.png', 'assets/emily-left.png', 'assets/emily-right.png',
  'assets/queen-ant.png', 'assets/coin.png', 'assets/gem.png', 'assets/mushroom.png',
  'assets/bg-campsite.png', 'assets/bg-battlefield.png',
  'assets/screen-title.png', 'assets/screen-win.png', 'assets/screen-died.png',
  'assets/start-button.png', 'assets/pop.wav',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
