/* Service worker dell'Hub: rete per prima (così gli aggiornamenti si vedono subito),
   copia in cache come ripiego quando non c'è connessione. */
const CACHE = 'hub-v1';
const PRECACHE = ['./', 'assets/hub.css', 'assets/hub.js', 'assets/config.js', 'assets/icon-192.png', 'manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(PRECACHE.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.indexOf('hub-') === 0 && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;                       // API, mappe, font: sempre dalla rete
  if (/\/(img|images)\//.test(url.pathname)) return;                 // immagini pesanti: non le copio qui

  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() =>
      caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : Response.error()))
    )
  );
});
