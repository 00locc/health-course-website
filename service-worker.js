const CACHE_NAME = "healthpath-shell-v156";
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/app.html",
  "/disclaimer.html",
  "/privacy.html",
  "/terms.html",
  "/contact.html",
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/assets/healthpath-brand-logo.png",
  "/assets/healthpath-crest.png",
  "/assets/dashboard-anatomy.svg",
  "/assets/healthpath-hero-heart.png",
  "/assets/review-avatar-alina.svg",
  "/assets/review-avatar-david.svg",
  "/assets/review-avatar-jessica.svg",
  "/assets/review-avatar-maya.svg",
  "/assets/review-avatar-omar.svg",
  "/assets/review-avatar-sarah.svg",
  "/assets/icon-192.svg",
  "/assets/icon-512.svg",
  "/assets/icon-maskable.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => {
      if (request.mode === "navigate") {
        return caches.match(url.pathname.includes("app") ? "/app.html" : "/index.html");
      }
      return caches.match(request);
    })
  );
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
