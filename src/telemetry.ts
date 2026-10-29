export type Props = Record<string, string | number | boolean | null | undefined>;

export interface TelemetryWindow {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  document: {
    visibilityState: string;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  };
  location: { origin: string; pathname: string; hash: string };
  navigator: { userAgent: string; language: string; standalone?: boolean };
  matchMedia(query: string): { matches: boolean };
  innerWidth: number;
  innerHeight: number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface TelemetryDeps {
  key: string;
  host: string;
  appVersion: string;
  fetchImpl?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
  random?: () => string;
  win?: TelemetryWindow;
}

export interface Telemetry {
  track(event: string, props?: Props): void;
  setContext(key: string, value: string | number | boolean | null): void;
  flush(): Promise<void>;
  getDeviceId(): string;
  getCommonContext(): {
    platform: string;
    browser: string;
    standalone: boolean;
    viewport: string;
    appVersion: string;
  };
  destroy(): void;
}

interface BatchEvent {
  uuid: string;
  event: string;
  distinct_id: string;
  properties: Record<string, string | number | boolean | null>;
  timestamp: string;
}

const emptyContext = () => ({
  platform: "other",
  browser: "other",
  standalone: false,
  viewport: "",
  appVersion: "",
});

function noop(): Telemetry {
  return {
    track() {},
    setContext() {},
    async flush() {},
    getDeviceId: () => "",
    getCommonContext: emptyContext,
    destroy() {},
  };
}

function defaultWindow(): TelemetryWindow | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return undefined;
  return {
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
    document,
    location: window.location,
    navigator: window.navigator,
    matchMedia: (query) => window.matchMedia(query),
    get innerWidth() { return window.innerWidth; },
    get innerHeight() { return window.innerHeight; },
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (id) => window.clearTimeout(id as number),
  };
}

function uuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 3) | 8).toString(16);
  });
}

function filename(value: string): string {
  return value.split(/[?#]/, 1)[0].split(/[/\\]/).pop() ?? "";
}

// Адреса в тексте ошибок сворачиваем до имени файла: query и hash могут нести лишнее.
function stripUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s)]+/g, (address) => {
    try {
      return filename(new URL(address).pathname);
    } catch {
      return filename(address);
    }
  });
}

function cleanStack(value: string): string {
  return stripUrls(value).slice(0, 800);
}

function sanitize(
  input: Record<string, unknown>,
  limit: number,
  stackLimit = false,
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input)) {
    if (Object.keys(result).length >= limit) break;
    if (typeof value === "string") result[key] = value.slice(0, stackLimit && key === "stack" ? 800 : 200);
    else if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      result[key] = value;
    }
  }
  return result;
}

export function createTelemetry(deps: TelemetryDeps): Telemetry {
  if (!deps.key.trim() || !deps.host.trim()) return noop();
  const resolvedWindow = deps.win ?? defaultWindow();
  if (!resolvedWindow) return noop();
  const win: TelemetryWindow = resolvedWindow;

  const now = deps.now ?? Date.now;
  const random = deps.random ?? uuid;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const storage = deps.storage === undefined
    ? (() => {
        try { return globalThis.localStorage; } catch { return null; }
      })()
    : deps.storage;

  const read = (key: string): string | null => {
    try { return storage?.getItem(key) ?? null; } catch { return null; }
  };
  const write = (key: string, value: string): void => {
    try { storage?.setItem(key, value); } catch { /* Хранилище может быть отключено. */ }
  };

  const savedId = read("vsm:did");
  const firstVisit = !savedId;
  const deviceId: string = savedId ?? random();
  if (!savedId) write("vsm:did", deviceId);
  const savedFirst = Number(read("vsm:first-seen"));
  const firstSeen = savedFirst > 0 ? savedFirst : now();
  if (!savedFirst) write("vsm:first-seen", String(firstSeen));

  let session: { id: string; last: number };
  try {
    const stored = JSON.parse(read("vsm:sid") ?? "null") as { id?: unknown; last?: unknown } | null;
    session = stored && typeof stored.id === "string" && typeof stored.last === "number"
      ? { id: stored.id, last: stored.last }
      : { id: random(), last: now() };
  } catch {
    session = { id: random(), last: now() };
  }

  const queue: BatchEvent[] = [];
  const context: Props = {};
  const retryTimers = new Set<unknown>();
  let timer: unknown;
  let destroyed = false;
  let errorCount = 0;
  const errorMessages = new Set<string>();
  let activeStart: number | null = win.document.visibilityState === "visible" ? now() : null;
  let activeMs = 0;
  let eventCount = 0;

  function updateSession(): void {
    const time = now();
    if (time - session.last > 30 * 60 * 1000) {
      session = { id: random(), last: time };
      errorCount = 0;
      errorMessages.clear();
    }
    session.last = time;
    write("vsm:sid", JSON.stringify(session));
  }

  function getCommonContext(): ReturnType<Telemetry["getCommonContext"]> {
    const agent = win.navigator.userAgent.toLowerCase();
    const platform = /iphone|ipad|ipod/.test(agent) ? "ios"
      : /android/.test(agent) ? "android"
      : /windows|macintosh|linux/.test(agent) ? "desktop" : "other";
    const browser = /edg\//.test(agent) ? "edge"
      : /firefox|fxios/.test(agent) ? "firefox"
      : /chrome|crios/.test(agent) ? "chrome"
      : /safari/.test(agent) ? "safari" : "other";
    let standalone = win.navigator.standalone === true;
    try { standalone ||= win.matchMedia("(display-mode: standalone)").matches; } catch { /* Не все браузеры поддерживают запрос. */ }
    return {
      platform,
      browser,
      standalone,
      viewport: `${Math.round(win.innerWidth / 10) * 10}x${Math.round(win.innerHeight / 10) * 10}`,
      appVersion: deps.appVersion,
    };
  }

  async function send(batch: BatchEvent[], retry: boolean): Promise<void> {
    if (destroyed) return;
    let shouldRetry = false;
    try {
      const response = await fetchImpl(`${deps.host.replace(/\/+$/, "")}/batch/?ip=0`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          api_key: deps.key,
          batch,
          sent_at: new Date(now()).toISOString(),
        }),
        keepalive: true,
        credentials: "omit",
      });
      shouldRetry = response.status >= 500;
    } catch {
      shouldRetry = true;
    }
    if (shouldRetry && !retry && !destroyed) {
      const id = win.setTimeout(() => {
        retryTimers.delete(id);
        void send(batch, true);
      }, 2000);
      retryTimers.add(id);
    }
  }

  function flush(): Promise<void> {
    if (timer !== undefined) {
      win.clearTimeout(timer);
      timer = undefined;
    }
    if (destroyed || queue.length === 0) return Promise.resolve();
    const parts: Promise<void>[] = [];
    while (queue.length > 0) parts.push(send(queue.splice(0, 50), false));
    return Promise.all(parts).then(() => undefined);
  }

  function track(event: string, props: Props = {}): void {
    if (destroyed || typeof event !== "string" || !event) return;
    try {
      updateSession();
      const common = getCommonContext();
      const pathname = win.location.pathname;
      const properties: Record<string, unknown> = {
        $process_person_profile: false,
        $session_id: session.id,
        $lib: "vsm-campus",
        $lib_version: deps.appVersion,
        app_version: deps.appVersion,
        platform: common.platform,
        browser: common.browser,
        standalone: common.standalone,
        viewport: common.viewport,
        locale: win.navigator.language,
        $current_url: win.location.origin + pathname + win.location.hash,
        $pathname: pathname,
      };
      for (const [key, value] of Object.entries({ ...context, ...props })) {
        if (!(key in properties)) properties[key] = value;
      }
      // Признаки первого визита добавляются только к app_open.
      if (event === "app_open") {
        properties.is_first_visit = firstVisit;
        properties.days_since_first = Math.max(0, Math.floor((now() - firstSeen) / 86_400_000));
      }
      queue.push({
        uuid: random(),
        event: event.slice(0, 64),
        distinct_id: deviceId,
        properties: sanitize(properties, 30, event === "app_error"),
        timestamp: new Date(now()).toISOString(),
      });
      if (queue.length > 200) queue.shift();
      if (activeStart !== null && event !== "app_leave" && event !== "app_error") eventCount++;
      if (queue.length >= 10) void flush();
      else if (timer === undefined) timer = win.setTimeout(() => { timer = undefined; void flush(); }, 3000);
    } catch {
      // Аналитика не влияет на работу приложения.
    }
  }

  function reportError(event: Event, source: "window" | "promise"): void {
    try {
      updateSession();
      const details = event as Event & {
        message?: string;
        error?: { message?: string; stack?: string };
        reason?: unknown;
        filename?: string;
        lineno?: number;
        colno?: number;
      };
      const reason = source === "promise" ? details.reason : details.error;
      const error = reason && typeof reason === "object" ? reason as { message?: string; stack?: string } : null;
      const message = stripUrls(String(details.message ?? error?.message ?? reason ?? "Неизвестная ошибка")).slice(0, 200);
      if (errorCount >= 5 || errorMessages.has(message)) return;
      errorCount++;
      errorMessages.add(message);
      track("app_error", {
        message,
        stack: cleanStack(error?.stack ?? ""),
        source,
        filename: filename(details.filename ?? ""),
        line: details.lineno,
        col: details.colno,
      });
    } catch {
      // Ошибки обработчика не передаются приложению.
    }
  }

  const onError = (event: Event) => reportError(event, "window");
  const onRejection = (event: Event) => reportError(event, "promise");
  const onInstalled = () => track("app_installed");
  const onPageHide = () => { void flush(); };
  const onVisibility = () => {
    if (win.document.visibilityState === "visible") {
      activeStart = now();
      return;
    }
    if (activeStart !== null) activeMs += Math.max(0, now() - activeStart);
    activeStart = null;
    const seconds = Math.floor(activeMs / 1000);
    if (seconds >= 1 || eventCount > 0) track("app_leave", { active_s: seconds, events: eventCount });
    activeMs = 0;
    eventCount = 0;
    void flush();
  };

  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  win.addEventListener("appinstalled", onInstalled);
  win.addEventListener("pagehide", onPageHide);
  win.document.addEventListener("visibilitychange", onVisibility);

  return {
    track,
    setContext(key, value) { context[key] = value; },
    flush,
    getDeviceId: () => deviceId,
    getCommonContext,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.removeEventListener("error", onError);
      win.removeEventListener("unhandledrejection", onRejection);
      win.removeEventListener("appinstalled", onInstalled);
      win.removeEventListener("pagehide", onPageHide);
      win.document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== undefined) win.clearTimeout(timer);
      for (const id of retryTimers) win.clearTimeout(id);
      retryTimers.clear();
      queue.length = 0;
    },
  };
}

let singleton: Telemetry | undefined;

export function initTelemetry(deps: TelemetryDeps): Telemetry {
  singleton?.destroy();
  singleton = createTelemetry(deps);
  return singleton;
}

export function track(event: string, props?: Props): void {
  singleton?.track(event, props);
}

export function setContext(key: string, value: string | number | boolean | null): void {
  singleton?.setContext(key, value);
}

export function getDeviceId(): string {
  return singleton?.getDeviceId() ?? "";
}

export function getCommonContext(): ReturnType<Telemetry["getCommonContext"]> {
  return singleton?.getCommonContext() ?? emptyContext();
}
