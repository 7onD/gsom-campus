// Офлайн-режим: сохраняет файлы приложения и отдаёт их без сети. Собирается в dist/sw.js (vite.config.ts).
// Чужие адреса (расписание, статистика, отзывы) не перехватываются.
const PREFIX = "vsm-shell-";
const CACHE = PREFIX + "__VERSION__";
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Всё или ничего: если хоть один файл не скачался, остаётся прежняя версия. HTTP-кэш обходим.
    await cache.addAll(FILES.map((file) => new Request(file, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Только свои кэши: на одном адресе *.github.io могут жить и другие проекты.
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith(self.registration.scope)) return;
  const path = new URL(request.url).pathname.slice(new URL(self.registration.scope).pathname.length);
  const page = request.mode === "navigate" && (path === "" || path === "index.html");
  event.respondWith((async () => {
    // Сначала сохранённая копия: приложение открывается и при плохой связи, версия файлов всегда согласована.
    // Новая версия скачивается в фоне и применяется при следующем открытии.
    const cache = await caches.open(CACHE);
    const saved = await cache.match(page ? "./index.html" : request, { ignoreVary: true });
    return saved ?? fetch(request);
  })());
});
