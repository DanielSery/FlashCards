const CACHE_NAME = 'flashcards-v2-1';

// Every file the app loads. A missing entry breaks offline use without any error, and
// tests/precache.test.mjs fails when a file in the repo is neither listed here nor excluded.
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/app.js',
  './js/base45.js',
  './js/card-list.js',
  './js/crc32.js',
  './js/envelope.js',
  './js/files.js',
  './js/frames.js',
  './js/ids.js',
  './js/install.js',
  './js/legacy.js',
  './js/library.js',
  './js/merge.js',
  './js/qr.js',
  './js/scan-worker.js',
  './js/scanner.js',
  './js/sender.js',
  './js/store.js',
  './js/ui.js',
  './vendor/jsQR.js',
  './vendor/qrcode-generator.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// cache: 'reload' skips the HTTP cache, which could otherwise mix files from two releases.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// Cache-first for same-origin GETs. Share links (?import=, ?store=) carry a query string,
// so navigations ignore it to find the cached page offline.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  const ignoreSearch = e.request.mode === 'navigate';
  e.respondWith(
    caches.match(e.request, { ignoreSearch }).then(cached => cached || fetch(e.request))
  );
});
