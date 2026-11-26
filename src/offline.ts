// Регистрация офлайн-режима. Только в собранной версии: при разработке кэш мешал бы видеть правки.
export function registerOffline(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = async (): Promise<void> => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js");
      // Установленное приложение подолгу не перезагружается: проверяем обновление при возвращении в него.
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void registration.update().catch(() => {});
      });
    } catch {
      // Без офлайн-режима приложение работает как обычный сайт.
    }
  };
  if (document.readyState === "complete") void register();
  else window.addEventListener("load", () => void register(), { once: true });
}
