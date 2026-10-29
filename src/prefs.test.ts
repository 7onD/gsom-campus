import assert from "node:assert/strict";
import test from "node:test";
import { createPrefsStore, loadPrefs, type PrefsDeps } from "./prefs.ts";

function environment(): {
  deps: PrefsDeps;
  values: Map<string, string>;
  cookie: { value: string };
} {
  const values = new Map<string, string>();
  const cookie = { value: "" };
  return {
    values,
    cookie,
    deps: {
      local: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value); },
      },
      cookie: {
        get: () => cookie.value,
        set: (value) => { cookie.value = value; },
      },
    },
  };
}

test("импорт в Node и значения по умолчанию", () => {
  assert.deepEqual(loadPrefs(), { groupId: null, electives: {} });
});

test("чтение и запись в localStorage", () => {
  const { deps, values, cookie } = environment();
  const store = createPrefsStore(deps);
  const prefs = {
    groupId: 24,
    electives: { "24": ["Электив:Управление проектами", "Факультатив:Испанский язык"] },
  };
  store.save(prefs);
  assert.equal(values.get("vsm:prefs"), JSON.stringify(prefs));
  assert.deepEqual(store.load(), prefs);
  assert.equal(cookie.value, "");
});

test("миграция старого ключа", () => {
  const { deps, values } = environment();
  values.set("vsm:group", "24");
  const store = createPrefsStore(deps);
  assert.deepEqual(store.load(), { groupId: 24, electives: {} });
  assert.deepEqual(JSON.parse(values.get("vsm:prefs") ?? ""), {
    groupId: 24,
    electives: {},
  });
});

test("битый JSON и неверная структура дают значения по умолчанию", () => {
  const { deps, values } = environment();
  const store = createPrefsStore(deps);
  for (const input of [
    "{",
    "null",
    '{"groupId":"24","electives":{}}',
    '{"groupId":24,"electives":{"24":[123]}}',
    '{"groupId":24,"electives":[]}',
  ]) {
    values.set("vsm:prefs", input);
    assert.deepEqual(store.load(), { groupId: null, electives: {} }, input);
  }
});

test("без localStorage чтение и запись идут через cookie", () => {
  const { deps, cookie } = environment();
  deps.local = null;
  const store = createPrefsStore(deps);
  const prefs = { groupId: 24, electives: { "24": ["Электив:Теория игр"] } };
  store.save(prefs);
  assert.match(cookie.value, /^vsm_prefs=/);
  assert.match(cookie.value, /; Max-Age=31536000; Path=\/; SameSite=Lax$/);
  cookie.value = `a=1; ${cookie.value.split(";")[0]}; another=2`;
  assert.deepEqual(store.load(), prefs);
});

test("исключение localStorage переключает на cookie", () => {
  const { deps, cookie } = environment();
  deps.local = {
    getItem: () => { throw new Error("disabled"); },
    setItem: () => { throw new Error("disabled"); },
  };
  const store = createPrefsStore(deps);
  store.save({ groupId: 7, electives: {} });
  assert.match(cookie.value, /^vsm_prefs=/);
  assert.deepEqual(store.load(), { groupId: 7, electives: {} });
});

test("слишком большой набор в cookie сокращается до groupId", () => {
  const { deps, cookie } = environment();
  deps.local = null;
  const store = createPrefsStore(deps);
  store.save({
    groupId: 24,
    electives: { "24": Array.from({ length: 300 }, (_, index) =>
      `Электив:Очень длинное название курса ${index}`) },
  });
  assert.ok(cookie.value.split(";")[0].length < 3500);
  assert.deepEqual(store.load(), { groupId: 24, electives: {} });
});
