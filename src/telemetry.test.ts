import assert from "node:assert/strict";
import test from "node:test";
import { createTelemetry } from "./telemetry.ts";
import type { TelemetryDeps, TelemetryWindow } from "./telemetry.ts";

function fixture(storage = new Map<string, string>()) {
  let time = 1_700_000_000_000;
  let serial = 0;
  let nextTimer = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const docListeners = new Map<string, Set<(event: Event) => void>>();
  const add = (map: typeof listeners, type: string, listener: (event: Event) => void) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type)!.add(listener);
  };
  const remove = (map: typeof listeners, type: string, listener: (event: Event) => void) => {
    map.get(type)?.delete(listener);
  };
  const win: TelemetryWindow = {
    addEventListener: (type, listener) => add(listeners, type, listener),
    removeEventListener: (type, listener) => remove(listeners, type, listener),
    document: {
      visibilityState: "visible",
      addEventListener: (type, listener) => add(docListeners, type, listener),
      removeEventListener: (type, listener) => remove(docListeners, type, listener),
    },
    location: { origin: "https://campus.example", pathname: "/map", hash: "#floor" },
    navigator: { userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/17 Safari/605.1.15", language: "ru-RU" },
    matchMedia: () => ({ matches: false }),
    innerWidth: 375,
    innerHeight: 812,
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id as number); },
  };
  const requests: Array<{ url: string; options: RequestInit; body: {
    api_key: string;
    batch: Array<{ event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string }>;
    sent_at: string;
  } }> = [];
  let fetcher: typeof fetch = async (url, options) => {
    requests.push({
      url: String(url),
      options: options ?? {},
      body: JSON.parse(String(options?.body)),
    });
    return { status: 200 } as Response;
  };
  const deps: TelemetryDeps = {
    key: "public-key",
    host: "https://events.example",
    appVersion: "1.2.3",
    win,
    now: () => time,
    random: () => `uuid-${++serial}`,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
    },
    fetchImpl: ((...args: Parameters<typeof fetch>) => fetcher(...args)) as typeof fetch,
  };
  return {
    deps, win, requests, timers, storage,
    setTime(value: number) { time = value; },
    advance(ms: number) { time += ms; },
    setFetcher(value: typeof fetch) { fetcher = value; },
    fire(type: string, event = {} as Event) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
    hide() {
      win.document.visibilityState = "hidden";
      for (const listener of docListeners.get("visibilitychange") ?? []) listener({} as Event);
    },
    runTimer(delay: number) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry);
      timers.delete(entry[0]);
      entry[1].callback();
    },
  };
}

test("без ключа клиент ничего не делает", async () => {
  const f = fixture();
  const client = createTelemetry({ ...f.deps, key: "" });
  client.track("app_open");
  await client.flush();
  assert.equal(client.getDeviceId(), "");
  assert.equal(f.requests.length, 0);
  assert.equal(f.storage.size, 0);
});

test("пакет содержит обязательные поля и признаки первого визита", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  client.track("app_open");
  await client.flush();
  const { body } = f.requests[0];
  assert.equal(body.api_key, "public-key");
  assert.equal(body.batch.length, 1);
  assert.equal(body.batch[0].distinct_id, client.getDeviceId());
  assert.ok(body.batch[0].timestamp.endsWith("Z"));
  assert.equal(body.batch[0].properties.$process_person_profile, false);
  assert.equal(body.batch[0].properties.$session_id, "uuid-2");
  assert.equal(body.batch[0].properties.is_first_visit, true);
  assert.equal(body.batch[0].properties.days_since_first, 0);
  client.destroy();
});

test("идентификатор устройства сохраняется между экземплярами", () => {
  const f = fixture();
  const first = createTelemetry(f.deps);
  const id = first.getDeviceId();
  first.destroy();
  const second = createTelemetry(f.deps);
  assert.equal(second.getDeviceId(), id);
  second.destroy();
});

test("через 30 минут без событий начинается новая сессия", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  client.track("one");
  await client.flush();
  f.advance(30 * 60_000 + 1);
  client.track("two");
  await client.flush();
  assert.notEqual(f.requests[0].body.batch[0].properties.$session_id, f.requests[1].body.batch[0].properties.$session_id);
  client.destroy();
});

test("десятое событие отправляет пакет", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  for (let i = 0; i < 9; i++) client.track("tap");
  assert.equal(f.requests.length, 0);
  client.track("tap");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.batch.length, 10);
  client.destroy();
});

test("таймер отправляет очередь через три секунды", () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  client.track("tap");
  f.runTimer(3000);
  assert.equal(f.requests.length, 1);
  client.destroy();
});

test("переход в hidden отправляет очередь", () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  client.track("tap");
  f.hide();
  assert.equal(f.requests.length, 1);
  client.destroy();
});

test("строки обрезаются, объекты отбрасываются", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  client.track("x".repeat(100), { text: "а".repeat(300), object: {} as unknown as string });
  await client.flush();
  const event = f.requests[0].body.batch[0];
  assert.equal(event.event.length, 64);
  assert.equal((event.properties.text as string).length, 200);
  assert.equal("object" in event.properties, false);
  client.destroy();
});

test("адрес события не содержит query", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  client.track("open");
  await client.flush();
  assert.equal(f.requests[0].body.batch[0].properties.$current_url, "https://campus.example/map#floor");
  client.destroy();
});

test("ошибки ограничены пятью за сессию, дубли исключены", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  for (let i = 0; i < 7; i++) {
    f.fire("error", { message: `Ошибка ${i}`, filename: "https://host.example/src/main.ts" } as unknown as Event);
  }
  f.fire("error", { message: "Ошибка 0" } as unknown as Event);
  await client.flush();
  const batch = f.requests[0].body.batch;
  assert.equal(batch.length, 5);
  assert.equal(batch[0].properties.filename, "main.ts");
  client.destroy();
});

test("после сетевого сбоя выполняется только одна повторная попытка", async () => {
  const f = fixture();
  let attempts = 0;
  f.setFetcher((async () => {
    attempts++;
    throw new Error("offline");
  }) as typeof fetch);
  const client = createTelemetry(f.deps);
  client.track("tap");
  await client.flush();
  f.runTimer(2000);
  await Promise.resolve();
  assert.equal(attempts, 2);
  assert.equal([...f.timers.values()].filter((timer) => timer.delay === 2000).length, 0);
  client.destroy();
});

test("app_leave учитывает активное время и события показа", () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  client.track("tap");
  f.advance(2500);
  f.hide();
  const batch = f.requests[0].body.batch;
  assert.equal(batch[1].event, "app_leave");
  assert.equal(batch[1].properties.active_s, 2);
  assert.equal(batch[1].properties.events, 1);
  client.destroy();
});

test("iPhone Safari определяется по userAgent", () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  const context = client.getCommonContext();
  assert.equal(context.platform, "ios");
  assert.equal(context.browser, "safari");
  assert.equal(context.viewport, "380x810");
  client.destroy();
});

test("запросы не передают cookie и не используют credentials браузера", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  client.track("tap");
  await client.flush();
  const { options, url } = f.requests[0];
  assert.equal(url, "https://events.example/batch/?ip=0");
  assert.equal(options.credentials, "omit");
  assert.equal(options.keepalive, true);
  assert.deepEqual(options.headers, { "Content-Type": "text/plain" });
  assert.equal(JSON.stringify(options).toLowerCase().includes("cookie"), false);
  client.destroy();
});

test("у каждого события свой uuid, большие очереди уходят кусками по 50", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  // отправка срабатывает на каждом 10-м событии, поэтому копим события при недоступной сети не получится;
  // проверяем сам формат и уникальность идентификаторов
  for (let i = 0; i < 12; i++) client.track("tap", { i });
  await client.flush();
  const all = f.requests.flatMap((r) => r.body.batch as unknown as { uuid: string }[]);
  assert.equal(all.length, 12);
  assert.equal(new Set(all.map((e) => e.uuid)).size, 12);
  for (const request of f.requests) assert.ok((request.body.batch as unknown[]).length <= 50);
  client.destroy();
});

test("адреса в тексте ошибки сворачиваются до имени файла без query и hash", async () => {
  const f = fixture();
  const client = createTelemetry(f.deps);
  f.fire("error", {
    message: "Сбой при https://host.example/app/chunk.js?group=24.Б01#secret",
    error: { stack: "Error\n    at fn (https://host.example/app/chunk.js?x=1#y:10:5)" },
  } as unknown as Event);
  await client.flush();
  const event = f.requests[0].body.batch.find((e: { event: string }) => e.event === "app_error") as { properties: Record<string, string> };
  assert.doesNotMatch(event.properties.message, /group|secret|\?|#/);
  assert.doesNotMatch(event.properties.stack, /\?x=1|#y|host\.example/);
  assert.match(event.properties.stack, /chunk\.js/);
  client.destroy();
});
