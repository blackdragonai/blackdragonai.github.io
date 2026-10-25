// BLACK DRAGON AI - service worker: network-first so the studio is always fresh.
const CACHE = "black-dragon-v6";
const SHELL = [
  "./", "./index.html", "./css/style.css", "./js/config.js", "./js/app.js",
  "./js/logo-data.js", "./js/pwa.js", "./manifest.webmanifest", "./icon.svg"
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith("supabase.co") || url.hostname.endsWith("fal.run") || url.hostname.endsWith("fal.media")) return;
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match("./index.html")))
  );
});
