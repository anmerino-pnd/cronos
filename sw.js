const CACHE_NAME = 'cronos-shell-v2';

const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/token.js',
  './manifest.json',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never intercept POST requests or Google Apps Script webhook calls
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (
    url.hostname.includes('script.google.com') ||
    url.hostname.includes('script.googleusercontent.com')
  ) {
    return;
  }

  // Navigation requests: network-first, fall back to cached app shell
  if (request.mode === 'navigate') {
    const isAdminSubdir = /\/admin(\/index\.html|\/)?$/i.test(url.pathname);
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok && !isAdminSubdir) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match('./index.html')) || (await cache.match('./'));
        })
    );
    return;
  }

  // Static same-origin assets & fonts: stale-while-revalidate
  if (url.origin === self.location.origin || url.hostname.includes('fonts.g')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkPromise;
      })
    );
  }
});
