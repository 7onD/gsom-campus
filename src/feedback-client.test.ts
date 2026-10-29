import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPayload,
  sendFeedback,
  validateFeedback,
  type FeedbackDeps,
  type FeedbackInput,
} from "./feedback-client.ts";

const input: FeedbackInput = { kind: "idea", message: "Хорошая идея" };
const app: FeedbackDeps["app"] = {
  tab: "map",
  deviceId: "abcdefgh-secret-device-id",
  platform: "iOS",
  browser: "Safari",
  standalone: false,
  viewport: "390x844",
  appVersion: "1.0",
};

function storage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
  };
}

test("сообщение: границы после trim", () => {
  assert.equal(validateFeedback({ ...input, message: " 12345 " }), "ok");
  assert.equal(validateFeedback({ ...input, message: " 1234 " }), "invalid");
  assert.equal(validateFeedback({ ...input, message: "a".repeat(1000) }), "ok");
  assert.equal(validateFeedback({ ...input, message: "a".repeat(1001) }), "invalid");
});

test("контакт ограничен 100 символами, ловушка должна быть пустой", () => {
  assert.equal(validateFeedback({ ...input, contact: "a".repeat(100) }), "ok");
  assert.equal(validateFeedback({ ...input, contact: "a".repeat(101) }), "invalid");
  assert.equal(validateFeedback({ ...input, honeypot: "сайт" }), "invalid");
});

test("payload содержит только первые восемь символов ID", () => {
  const payload = buildPayload(input, { app, now: () => 0 });
  assert.equal(JSON.parse(payload).app.did, "abcdefgh");
  assert.equal(payload.includes(app.deviceId), false);
  assert.equal(JSON.parse(payload).ts, "1970-01-01T00:00:00.000Z");
});

test("ловушка передаётся под именем hp", () => {
  assert.equal(JSON.parse(buildPayload({ ...input, honeypot: "bot" }, { app })).hp, "bot");
});

test("без адреса отправка недоступна", async () => {
  assert.equal(await sendFeedback(input, { url: "", app }), "unavailable");
});

test("успех записывает время; повторная отправка ждёт 30 секунд", async () => {
  const saved = storage();
  let requests = 0;
  const deps: FeedbackDeps = {
    url: "https://example.test/feedback",
    app,
    storage: saved,
    now: () => 100_000,
    fetchImpl: async () => {
      requests++;
      return new Response('{"ok":true}', { status: 200 });
    },
  };
  assert.equal(await sendFeedback(input, deps), "ok");
  assert.equal(saved.getItem("vsm:fb-last"), "100000");
  assert.equal(await sendFeedback(input, deps), "cooldown");
  assert.equal(requests, 1);
  assert.equal(await sendFeedback(input, { ...deps, now: () => 130_000 }), "ok");
});

test("POST отправляет текст без cookie", async () => {
  const result = await sendFeedback(input, {
    url: "https://example.test/feedback",
    app,
    fetchImpl: async (_url, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(init?.credentials, "omit");
      assert.deepEqual(init?.headers, { "Content-Type": "text/plain;charset=UTF-8" });
      assert.equal(JSON.parse(String(init?.body)).message, input.message);
      return new Response('{"ok":true}');
    },
  });
  assert.equal(result, "ok");
});

test("сбой сети возвращает error", async () => {
  assert.equal(await sendFeedback(input, {
    url: "https://example.test/feedback",
    app,
    fetchImpl: async () => { throw new Error("offline"); },
  }), "error");
});

test("неуспешный ответ и отсутствие ok:true возвращают error", async () => {
  for (const response of [new Response('{"ok":true}', { status: 500 }), new Response('{"ok":false}')]) {
    assert.equal(await sendFeedback(input, {
      url: "https://example.test/feedback",
      app,
      fetchImpl: async () => response,
    }), "error");
  }
});
