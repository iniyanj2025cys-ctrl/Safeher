// ══════════════════════════════════════
//  SafeHer — Service Worker (sw.js)
//  Handles offline caching so the app
//  works without internet connection.
// ══════════════════════════════════════

const CACHE_NAME = "safeher-v1";

// Files to cache for offline use
const CACHE_FILES = [
  "./sos.html",
  "./register.html",
  "./manifest.json",
  "./pwa.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// ── INSTALL: cache all core files ──
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[SafeHer SW] Caching app shell");
      // addAll fails if any file is missing — use add individually to be safe
      return Promise.allSettled(
        CACHE_FILES.map(url => cache.add(url).catch(err => {
          console.warn("[SafeHer SW] Skipping cache for:", url, err);
        }))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: remove old caches ──
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: serve from cache, fallback to network ──
self.addEventListener("fetch", (event) => {
  // Skip non-GET and cross-origin requests (Firebase, CDNs)
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Let Firebase, EmailJS, CDN requests go straight to network
  const passThrough = [
    "firebasejs",
    "googleapis.com",
    "firestore.googleapis.com",
    "emailjs",
    "cdnjs.cloudflare.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com"
  ];
  if (passThrough.some(domain => url.href.includes(domain))) {
    return; // don't intercept — let browser handle
  }

  // For local app files: Cache First → fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful responses for future offline use
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // If both cache and network fail, show sos.html as fallback
        if (event.request.destination === "document") {
          return caches.match("./sos.html");
        }
      });
    })
  );
});
