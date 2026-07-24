/**
 * Service Worker
 *
 * 方針:
 *   - アプリシェル（HTML/CSS/JS/種データ）は precache して、オフラインでも完全に動くようにする
 *   - HTML は network-first（更新をすぐ拾う）、それ以外は cache-first（速い）
 *   - 写真は IndexedDB にあるので、ここでは扱わない
 *
 * アプリを更新したら CACHE のバージョンを上げること。
 */

const CACHE = 'frog-zukan-v3';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './data/frogs.json',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/exif.js',
  './js/cropper.js',
  './js/photos.js',
  './js/species.js',
  './js/backup.js',
  './js/views/list.js',
  './js/views/detail.js',
  './js/views/facilities.js',
  './js/views/settings.js',
  './js/views/photo-editor.js',
  './js/views/species-editor.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // 1ファイルでも 404 だと addAll 全体が失敗するので、個別に入れる
      .then((c) => Promise.all(ASSETS.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isHtml = req.mode === 'navigate'
    || (req.headers.get('accept') || '').includes('text/html');

  if (isHtml) {
    // network-first：オンラインなら最新の index.html、駄目ならキャッシュ
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // それ以外は cache-first、取れたらキャッシュも更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
