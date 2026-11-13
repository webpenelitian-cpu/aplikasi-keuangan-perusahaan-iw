// Service worker: aplikasi tetap terbuka tanpa internet.
// Naikkan versi CACHE setiap kali file aplikasi diperbarui.
const CACHE = 'keuangan-umkm-v32';
const ASSETS = [
  './', './index.html', './app.js', './erp.js', './unggah.js', './panduan.js', './cloud.js', './firebase-config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];

// Program Firebase (login dan database) ikut disimpan, agar akun dan data perusahaan tetap terbuka tanpa internet.
// Alamatnya memuat nomor versi sehingga isinya tidak pernah berubah; aman dipakai langsung dari simpanan.
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
// Sidik SHA-256 resmi tiap file. File yang isinya berbeda (dirusak di jalan atau di server) ditolak dan tidak disimpan.
const SDK_SHA = {'firebase-app.js': 'CLg/AoWTKKq7ms6pNw1gD/5znZ4sJRtmaLb2/1ai4dE=', 'firebase-auth.js': 'my67pv/O1GV+EjAPQYfVPI/Bdi6YGI5eIAVAeobpJrY=',
  'firebase-firestore.js': 'rssrW3ItGkVCYybNFEvAJdW+qMSPOlPso5FK1Yc2G9Q=', 'firebase-app-check.js': 'jWNyP8OtW3NCIwu+pKamCvkaNnJwP8C05PnWAWkYJAM='};
const SDK_FILES = Object.keys(SDK_SHA).map(f => SDK + f);
async function sdkGenuine(res, url) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer()));
  let s = ''; for (const x of d) s += String.fromCharCode(x);
  return btoa(s) === SDK_SHA[url.slice(SDK.length).split('?')[0]];
}
// Panduan PDF ikut disimpan bila sempat, agar bisa diunduh tanpa internet; gagal di sini tidak menggagalkan pemasangan
const OPTIONAL = ['pimpinan', 'keuangan', 'penjualan', 'gudang', 'sdm', 'hanya-lihat'].map(r => `./panduan/panduan-${r}.pdf`);

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ASSETS);
    await Promise.all(SDK_FILES.map(u => fetch(u, {mode: 'cors'}).then(async r => r.ok && await sdkGenuine(r, u) ? c.put(u, r) : null).catch(() => {})));
    await Promise.all(OPTIONAL.map(u => fetch(u).then(r => r.status === 200 ? c.put(u, r) : null).catch(() => {})));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Utamakan jaringan agar versi terbaru langsung terpakai; cache dipakai saat offline
self.addEventListener('fetch', e => {
  if (e.request.method === 'GET' && e.request.url.startsWith(SDK)) {
    e.respondWith(caches.match(e.request, {ignoreVary: true}).then(hit => hit || fetch(e.request).then(async res => {
      if (!res.ok) return res;
      if (!await sdkGenuine(res, e.request.url)) return Response.error(); // isi tidak asli: jangan dijalankan
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    })));
    return;
  }
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    // no-cache: selalu ditanyakan ke server, jadi versi lama tidak tertahan di cache browser
    fetch(e.request, {cache: 'no-cache'})
      .then(res => {
        // Hanya jawaban utuh yang disimpan, agar halaman galat tidak ikut tampil saat offline
        if (res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match('./index.html')))
  );
});
