const CACHE_NAME = 'my-bank-pwa-v3';
const ASSETS = ['./', './arquivo.html', './manifest.json', './icons/icon-192x192.png', './icons/icon-512x512.png', './icons/logo.png'];
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(()=>{}))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => { if (event.request.method !== 'GET') return; event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(()=>{}); return response; }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./arquivo.html')))); });
