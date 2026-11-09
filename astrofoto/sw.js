const CACHE = 'astrofoto-v6';

self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Always network for API calls
  if(url.includes('api.open-meteo.com') ||
     url.includes('nominatim.openstreetmap.org') ||
     url.includes('api.github.com')){
    e.respondWith(fetch(e.request).catch(() => new Response('', {status: 503})));
    return;
  }

  // Always network-first for index.html and data.json (must always be fresh)
  if(url.includes('index.html') || url.endsWith('/astrofoto/') || url.endsWith('/astrofoto') || url.includes('data.json')){
    e.respondWith(
      fetch(e.request).then(res => {
        if(res.ok){
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for images (they never change once uploaded)
  if(url.includes('/img/')){
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if(res.ok){
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }))
    );
    return;
  }

  // Network-first for everything else
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
