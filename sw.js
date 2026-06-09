// My Bank Service Worker - força atualização do app instalado
const APP_VERSION = '20260609-card-limit-2';
const CACHE_NAME = `my-bank-${APP_VERSION}`;
const APP_SHELL = [
  './',
  './index.html',
  './arquivo.html',
  './manifest.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL).catch(() => null))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isNavigation = req.mode === 'navigate' || req.destination === 'document';

  // HTML sempre tenta rede primeiro para o PWA instalado receber alterações novas.
  if (isNavigation) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./', copy)).catch(() => null);
          return res;
        })
        .catch(() => caches.match('./').then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // Assets: tenta rede, salva versão nova, usa cache se estiver offline.
  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        if (url.origin === self.location.origin) {
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => null);
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
