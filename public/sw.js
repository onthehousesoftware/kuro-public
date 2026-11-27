// Kuro service worker: keeps the app shell available offline. API calls always go to the network.
const CACHE = "kuro-public-v1";
// Clean URLs only: the asset server redirects /x.html to /x, and a cached redirect can't be shown for a page offline.
const SHELL = ["/", "/styles.css", "/app.js", "/core.js", "/prompts.js", "/gemini.js", "/privacy", "/terms", "/guide", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/fonts/zen-maru-gothic-latin-500-normal.woff2", "/fonts/zen-maru-gothic-latin-700-normal.woff2", "/fonts/zen-maru-gothic-latin-900-normal.woff2", "/fonts/nunito-sans-latin-400-normal.woff2", "/fonts/nunito-sans-latin-600-normal.woff2", "/fonts/nunito-sans-latin-700-normal.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // Network first so updates show up; fall back to the cached copy offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && url.origin === location.origin) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/")))
  );
});
