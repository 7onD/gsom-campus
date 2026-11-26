// Аварийное отключение офлайн-режима (сборка с VITE_SW=off): удаляет сохранённые файлы и снимает воркер.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("vsm-shell-")).map((name) => caches.delete(name)));
    await self.registration.unregister();
  })());
});
