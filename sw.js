// アプリ本体をキャッシュしてオフラインで起動できるようにする。
// ファイルを変更したら VERSION を上げること。

const VERSION = 'v3';
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
  './js/digest.js',
  './js/domain.js',
  './js/episodes.js',
  './js/files.js',
  './js/gcal.js',
  './js/links.js',
  './js/mail.js',
  './js/migrate.js',
  './js/qr.js',
  './js/rrule.js',
  './js/rrule-lite.js',
  './js/sample.js',
  './js/share.js',
  './js/stats.js',
  './js/store.js',
  './js/sync.js',
  './js/time.js',
  './js/ui.js',
  './js/views/calendar.js',
  './js/views/corners.js',
  './js/views/episode.js',
  './js/views/guide.js',
  './js/views/media.js',
  './js/views/memos.js',
  './js/views/programs.js',
  './js/views/settings.js',
  './js/views/share-ui.js',
  './js/views/unheard.js',
  './vendor/qrcode.js',
  './vendor/jsQR.js',
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
