import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileGroup } from "./group-migrate.ts";
import { createPrefsStore, type Prefs } from "./prefs.ts";

const groups = [{ id: 500001, name: "24.Б01-вшм" }, { id: 500002, name: "24.Б02-вшм" }];

test("действующий номер: название дописывается один раз, выбор не трогается", () => {
  const first = reconcileGroup({ groupId: 500001, electives: { "500001": ["a"] } }, groups);
  assert.equal(first.status, "ok");
  assert.deepEqual(first.prefs, { groupId: 500001, electives: { "500001": ["a"] }, groupName: "24.Б01-вшм" });
  assert.equal(reconcileGroup(first.prefs, groups).prefs, first.prefs);
});

test("номера сменились: новый находится по названию вместе с выбором", () => {
  const result = reconcileGroup({ groupId: 474251, groupName: "24.Б01-вшм", electives: { "474251": ["a", "b"] } }, groups);
  assert.equal(result.status, "migrated");
  assert.equal(result.prefs.groupId, 500001);
  assert.deepEqual(result.prefs.electives["500001"], ["a", "b"]);
});

test("номер неизвестен и названия нет или группы больше нет — выбрать заново, настройки не стираются", () => {
  const cases: Prefs[] = [
    { groupId: 474251, electives: { "474251": ["a"] } },
    { groupId: 474251, groupName: "20.Б01-вшм", electives: {} },
  ];
  for (const saved of cases) {
    const result = reconcileGroup(saved, groups);
    assert.equal(result.status, "unknown");
    assert.equal(result.prefs, saved);
  }
  assert.equal(reconcileGroup({ groupId: null, electives: {} }, groups).status, "ok");
});

test("название группы переживает сохранение и чтение, включая запасную cookie", () => {
  for (const useLocal of [true, false]) {
    const values = new Map<string, string>();
    let cookie = "";
    const store = createPrefsStore({
      local: useLocal ? { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } } : null,
      cookie: { get: () => cookie.split(";")[0] ?? "", set: (v) => { cookie = v; } },
    });
    store.save({ groupId: 1, groupName: "24.Б01-вшм", electives: {} });
    assert.equal(store.load().groupName, "24.Б01-вшм", useLocal ? "localStorage" : "cookie");
  }
});
