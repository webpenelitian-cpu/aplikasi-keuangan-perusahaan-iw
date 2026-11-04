// Service worker: aplikasi tetap terbuka tanpa internet.
// Naikkan versi CACHE setiap kali file aplikasi diperbarui.
const CACHE = 'keuangan-umkm-v21';
const ASSETS = [
  './', './index.html', './app.js', './erp.js', './cloud.js', './firebase-config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Utamakan jaringan agar versi terbaru langsung terpakai; cache dipakai saat offline
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // no-cache: selalu ditanyakan ke server, jadi versi lama tidak tertahan di cache browser
    fetch(e.request, {cache: 'no-cache'})
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./index.html')))
  );
});
