/*
 * service-worker.js — Progressive Operator
 * Gold Coins Casino System v2.6
 * AUTO-UPDATE: Detects new version, clears old cache, reloads all clients silently.
 * Bump CACHE_VER on every release — everything else is automatic.
 */
var CACHE_VER = 'prog-op-v3.19';

/* Files to pre-cache on install */
var CACHE_URLS = ['./index.html','./manifest.json','./progressive.js','./icons/icon-192x192.png','./icons/icon-512x512.png'];

/* ── INSTALL: cache files + skip waiting immediately ── */
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_VER)
      .then(function(cache) {
        return cache.addAll(CACHE_URLS).catch(function(err) {
          console.warn('[SW] Pre-cache failed (non-fatal):', err);
        });
      })
      .then(function() {
        /* Skip waiting — activate immediately without waiting for old SW to die */
        return self.skipWaiting();
      })
  );
});

/* ── ACTIVATE: nuke ALL old caches, claim all clients, force reload ── */
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys()
      .then(function(keys) {
        return Promise.all(
          keys.map(function(key) {
            if (key !== CACHE_VER) {
              console.log('[SW] Deleting stale cache:', key);
              return caches.delete(key);
            }
          })
        );
      })
      .then(function() {
        /* Claim all open tabs immediately */
        return self.clients.claim();
      })
      .then(function() {
        /* Tell all open clients to reload so they get fresh files */
        return self.clients.matchAll({ type: 'window' }).then(function(clients) {
          clients.forEach(function(client) {
            if ('navigate' in client) {
              /* Always navigate to our own index.html — never follow stale URLs */
              client.navigate('./index.html');
            }
          });
        });
      })
  );
});

/* ── FETCH: network-first for JS/HTML, cache-first for assets ── */
self.addEventListener('fetch', function(e) {
  /* Never intercept non-GET requests (POST/PATCH/PUT/DELETE) — these are
     Supabase mutations (RPC calls, inserts, updates). cache.put() only
     supports GET and throws on anything else. */
  if (e.request.method !== 'GET') return;

  var url = e.request.url;

  /* NEVER cache Supabase API responses — table reads (.select()) must
     always hit the network so the UI reflects current DB state. Caching
     these could serve stale data forever on repeat identical queries. */
  if (url.indexOf('supabase.co') !== -1) return;

  /* Network-first for JS/HTML/CDN assets */
  if (url.indexOf('.js')          !== -1 ||
      url.indexOf('.html')        !== -1 ||
      url.indexOf('jsdelivr.net') !== -1 ||
      url.indexOf('cdn.')         !== -1) {
    e.respondWith(
      fetch(e.request)
        .then(function(resp) {
          /* 206 Partial Content (audio/video range requests) cannot be
             cached — skip cache.put for those. */
          if (resp && resp.status !== 206) {
            var clone = resp.clone();
            caches.open(CACHE_VER).then(function(cache) { cache.put(e.request, clone); });
          }
          return resp;
        })
        .catch(function() { return caches.match(e.request); })
    );
    return;
  }

  /* Cache-first for icons / static assets (images, audio, video) */
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).then(function(resp) {
        if (resp && resp.status !== 206) {
          var clone = resp.clone();
          caches.open(CACHE_VER).then(function(cache) { cache.put(e.request, clone); });
        }
        return resp;
      });
    })
  );
});
