// Внешние адреса и ключи задаются при сборке через переменные окружения Vite (VITE_*); в Node-тестах их нет.
const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
/** Ключ и адрес приёма служебных событий (задаются при сборке). Пусто — отправка отключена. */
export const EVENTS_KEY: string = (env.VITE_EVENTS_KEY ?? "").trim();
export const EVENTS_HOST: string = (env.VITE_EVENTS_HOST ?? "").trim().replace(/\/+$/, "");
/** Адрес приёма отзывов. Пусто — отправка отзывов недоступна. */
export const FEEDBACK_URL: string = (env.VITE_FEEDBACK_URL ?? "").trim();
