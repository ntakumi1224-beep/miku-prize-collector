const CACHE_PREFIX = `miku-prize-collector:${self.registration.scope}:`;
const CACHE_NAME = `${CACHE_PREFIX}v1.1.4`;
const CORE = [
  './', './index.html', './styles.css', './app.js', './products.json',
  './manifest.webmanifest', './config.js', './identify.js', './icons/icon-180.png', './icons/icon-192.png',
  './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Leave other GitHub Pages projects and external sites outside this cache.
  if(req.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;

  const networkFirst = req.mode === 'navigate' ||
    url.pathname.endsWith('/products.json') || url.pathname.endsWith('/index.html');
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if(!networkFirst && cached) return cached;
    try {
      const response = await fetch(req);
      if(response.ok) await cache.put(req, response.clone());
      return response;
    } catch(error) {
      if(cached) return cached;
      // Only page navigations may fall back to HTML; JSON must stay JSON.
      if(req.mode === 'navigate') {
        const index = await cache.match('./index.html');
        if(index) return index;
      }
      throw error;
    }
  })());
});
