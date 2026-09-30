/* Работа без сети: оболочка приложения из кэша, расписание — сначала из сети. */
const CACHE = "rasp-v8";
const NET_WAIT = 4000; // мс
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

  // расписание, изменения и страница: сеть, при её отсутствии — сохранённая копия.
  // Если сеть молчит дольше NET_WAIT (на мобильном интернете с ограничениями запрос часто просто висит),
  // сразу отдаём копию — иначе установленная страница не открылась бы вовсе.
  if (url.pathname.endsWith("/data/schedule.json") || url.pathname.endsWith("/data/feed.json") || e.request.mode === "navigate") {
    const req = e.request;
    const net = fetch(req, { cache: "no-cache" }).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    });
    const saved = caches.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : undefined));
    const slow = new Promise((ok) => setTimeout(ok, NET_WAIT)).then(() => saved).then((r) => r || net);
    e.respondWith(Promise.race([net, slow]).catch(() => saved.then((r) => r || Response.error())));
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
