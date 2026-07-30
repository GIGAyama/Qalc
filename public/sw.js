// 版を上げると古いキャッシュが捨てられ、新しい成果物が配られる。
// JS/CSS をキャッシュ優先で持つので、中身をかえたら必ずここを上げること
// (上げわすれると、旧版を持った端末が新版のへやに入れず「アプリが古い」と言われつづける)
const CACHE = 'qalc-cache-v3';
const SHELL = [
  '/Qalc/',
  '/Qalc/index.html',
  '/Qalc/manifest.webmanifest',
  '/Qalc/favicon.png',
  '/Qalc/icon-192.png',
  '/Qalc/icon-512.png',
  '/Qalc/icon-maskable-192.png',
  '/Qalc/icon-maskable-512.png',
  '/Qalc/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

// 同一オリジン(gigayama.github.io)には他の学習アプリも同居している。
// 古いキャッシュの掃除は、かならず自アプリのプレフィックスが付いたものだけに限る
const CACHE_PREFIX = 'qalc-cache-';

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // SPA navigation: serve cached app shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/Qalc/index.html'))
    );
    return;
  }

  // Static assets: cache-first, fall back to network and cache the result.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
