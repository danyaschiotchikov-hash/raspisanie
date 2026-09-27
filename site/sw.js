/* Работа без сети: оболочка приложения из кэша, расписание — сначала из сети. */
const CACHE = "rasp-v4";
const SHELL = ["./", "index.html", "app.css", "app.js", "i18n.js", "manifest.webmanifest", "icons/icon-192.png", "icons/favicon.svg"];

self.addEventListener("install", (e) => {
  // cache: "reload" — мимо HTTP-кэша браузера, иначе новая версия подхватит старые файлы
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith(".apk")) return;

  // расписание и страница: сеть, при её отсутствии — сохранённая копия
  if (url.pathname.endsWith("/data/schedule.json") || e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request, { cache: "no-cache" }).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
    );
    return;
  }
  // остальное: из кэша, в фоне обновляем
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request, { cache: "no-cache" }).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return r;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
