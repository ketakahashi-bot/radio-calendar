// アプリ本体をキャッシュしてオフラインで起動できるようにする。
// ファイルを変更したら VERSION を上げること。

const VERSION = 'v2';
const CACHE = `radio-calendar-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './js/app.js',
  './js/domain.js',
  './js/episodes.js',
  './js/gcal.js',
  './js/mail.js',
  './js/rrule.js',
  './js/sample.js',
  './js/store.js',
  './js/sync.js',
  './js/time.js',
  './js/ui.js',
  './js/views/calendar.js',
  './js/views/corners.js',
  './js/views/episode.js',
  './js/views/media.js',
  './js/views/memos.js',
  './js/views/programs.js',
  './js/views/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('radio-calendar-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // GAS など外部への通信と POST には触らない
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => hit || fetch(request).catch(() => caches.match('./index.html'))),
  );
});
