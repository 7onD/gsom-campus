import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  eventsUrl,
  isLessonShown,
  listRequired,
  teacherKey,
  loadLessons,
  lessonWindow,
  listOptionals,
  loadWindowCached,
  parseOptional,
  parseRoom,
  parseRooms,
  toLessons,
} from "./timetable.ts";

const fixture = JSON.parse(
  readFileSync(`${process.cwd()}/data/fixture-events-4w.json`, "utf8"),
) as unknown;

const realSubjects = [
  "Безопасность жизнедеятельности, аттестационное испытание",
  "Безопасность жизнедеятельности, консультация групповая",
  "Безопасность жизнедеятельности, лекция",
  "Безопасность жизнедеятельности, практическое занятие",
  "Безопасность жизнедеятельности, сам. работа в присутствии преподавателя",
  "Бизнес-аналитика для принятия управленческих решений, лекция",
  "Имитационное моделирование, семинар",
  "Курсовая работа по менеджменту, лекция",
  "Операционный менеджмент, лекция",
  "Управление цепями поставок (на английском языке), семинар",
  "Управленческий учет, лекция",
  "Факультатив. Испанский язык, практическое занятие",
  "Факультатив. Корпоративное волонтерство, семинар",
  "Факультатив. Немецкий язык, практическое занятие",
  "Факультатив. Основы теории игр, семинар",
  "Факультатив. Французский язык, практическое занятие",
  "Философия (онлайн-курс), зачёт",
  "Философия (онлайн-курс), консультация групповая",
  "Электив. Арт-менеджмент, зачёт",
  "Электив. Арт-менеджмент, показ работ",
  "Электив. Бизнес-аналитика в Excel, зачёт",
  "Электив. Бизнес-аналитика в Excel, показ работ",
  "Электив. Бизнес-аналитика в Excel, семинар",
  "Электив. Критическое мышление (на английском языке), зачёт",
  "Электив. Критическое мышление (на английском языке), показ работ",
  "Электив. Критическое мышление (на английском языке), семинар",
  "Электив. Международные стандарты финансовой отчетности (МСФО) (на английском языке), лекция",
  "Электив. Теория игр, зачёт",
  "Электив. Теория игр, показ работ",
  "Электив. Теория игр, семинар",
  "Электив. Управление конфликтами, зачёт",
  "Электив. Управление конфликтами, показ работ",
  "Электив. Управление конфликтами, семинар",
  "Электив. Управление продуктом (на английском языке), семинар",
  "Электив. Управление проектами, зачёт",
  "Электив. Управление проектами, показ работ",
  "Электив. Управление проектами, семинар",
  "Электив. Эффективные коммуникации в деловой среде (на английском языке), зачёт",
  "Электив. Эффективные коммуникации в деловой среде (на английском языке), лекция",
];

test("parseOptional: таблица из 39 названий", () => {
  assert.equal(realSubjects.length, 39);
  for (const subject of realSubjects) {
    const expected = /^(Факультатив|Электив)\. (.*), [^,]+$/.exec(subject);
    if (expected === null) {
      assert.equal(parseOptional(subject), null, subject);
    } else {
      assert.deepEqual(parseOptional(subject), {
        kind: expected[1],
        name: expected[2],
        key: `${expected[1]}:${expected[2]}`,
      }, subject);
    }
  }
});

test("parseOptional: зачёт, скобки и крайние случаи", () => {
  assert.deepEqual(parseOptional("Электив. Управление проектами, зачёт"), {
    kind: "Электив",
    name: "Управление проектами",
    key: "Электив:Управление проектами",
  });
  assert.equal(
    parseOptional("Электив. Критическое мышление (на английском языке), семинар")?.name,
    "Критическое мышление (на английском языке)",
  );
  assert.equal(parseOptional("Факультатив. Без типа")?.name, "Без типа");
  assert.deepEqual(parseOptional("электив.  Нижний регистр , лекция"), {
    kind: "Электив",
    name: "Нижний регистр",
    key: "Электив:Нижний регистр",
  });
  assert.equal(parseOptional("Факультативный курс, лекция"), null);
});

test("четыре недели: 136 пар и 14 курсов по выбору", () => {
  const lessons = toLessons(fixture);
  assert.equal(lessons.length, 136);
  for (const lesson of lessons) {
    assert.deepEqual(lesson.optional, parseOptional(lesson.subject));
  }

  const courses = listOptionals(lessons);
  assert.equal(courses.length, 14);
  assert.equal(courses.filter((course) => course.kind === "Факультатив").length, 5);
  assert.equal(courses.filter((course) => course.kind === "Электив").length, 9);
  assert.equal(courses[0].kind, "Факультатив");
  const projectCount = lessons.filter((lesson) =>
    !lesson.cancelled &&
    /^Электив\. Управление проектами(?:, |$)/.test(lesson.subject)
  ).length;
  assert.equal(
    courses.find((course) => course.key === "Электив:Управление проектами")?.count,
    projectCount,
  );
});

test("lessonWindow: воскресенье относится к предыдущему понедельнику", () => {
  const { from, to } = lessonWindow(new Date(2026, 10, 1, 12));
  assert.deepEqual(
    [from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()],
    [2026, 9, 26, 0],
  );
  assert.deepEqual(
    [to.getFullYear(), to.getMonth(), to.getDate(), to.getHours(),
      to.getMinutes(), to.getSeconds(), to.getMilliseconds()],
    [2026, 10, 22, 23, 59, 59, 999],
  );
});

test("loadWindowCached восстанавливает даты и пересчитывает optional", async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map<string, string>();
  const lessons = toLessons(fixture);
  const key = "vsm:lessons:24:2026-10-26:2026-11-22";
  data.set(key, JSON.stringify(lessons.map((lesson) => ({
    ...lesson,
    optional: null,
  }))));

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (name: string): string | null => data.get(name) ?? null,
      setItem: (name: string, value: string): void => { data.set(name, value); },
    },
  });
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => fixture,
  })) as unknown as typeof fetch;

  try {
    const updates: Array<{ fresh: boolean; count: number }> = [];
    await loadWindowCached(24, new Date(2026, 10, 1), (restored, fresh) => {
      assert.equal(restored.length, 136);
      assert.ok(restored[0].start instanceof Date);
      for (const lesson of restored) {
        assert.deepEqual(lesson.optional, parseOptional(lesson.subject));
      }
      updates.push({ fresh, count: restored.length });
    });
    assert.deepEqual(updates, [
      { fresh: false, count: 136 },
      { fresh: true, count: 136 },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalStorage);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
});

test("адрес запроса: диапазон дат в пути, окно — 4 недели", () => {
  const { from, to } = lessonWindow(new Date(2026, 10, 1, 12));
  assert.equal(
    eventsUrl(474251, from, to),
    "https://timetable.spbu.ru/api/v1/groups/474251/events/2026-10-26/2026-11-22",
  );
});

test("loadLessons: одна повторная попытка после сетевой ошибки и сообщение при HTTP 404", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) throw new TypeError("network");
    return { ok: true, status: 200, json: async () => ({ Days: [] }) };
  }) as unknown as typeof fetch;
  try {
    assert.deepEqual(await loadLessons(1, new Date(2026, 9, 26), new Date(2026, 10, 1)), []);
    assert.equal(calls, 2);

    globalThis.fetch = (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    await assert.rejects(() => loadLessons(1, new Date(2026, 9, 26), new Date(2026, 10, 1)), /404/);
  } finally {
    globalThis.fetch = original;
  }
});

test("parseRooms: только аудитории главного корпуса", () => {
  const cases: [string, string[]][] = [
    ["Санкт-Петербургское шоссе, д. 109, лит. А, 2228", ["2228"]],
    ["Санкт-Петербургское шоссе, д. 109, лит. А, 1219", ["1219"]],
    ["Средний пр. В.О., д. 41, лит. А, 510", []],
    ["С использованием информационно-коммуникационных технологий", []],
    ["", []],
    [
      "Санкт-Петербургское шоссе, д. 109, лит. А, 1207; Санкт-Петербургское шоссе, д. 109, лит. А, 1210",
      ["1207", "1210"],
    ],
    ["Sankt-Peterburgskoe shosse 109, letter A, 2228", ["2228"]],
    [
      "Санкт-Петербургское шоссе, д. 109, лит. А, 1301; Санкт-Петербургское шоссе, д. 109, лит. А, 1301",
      ["1301"],
    ],
    ["Санкт-Петербургское шоссе, д. 109, лит. А", []],
  ];
  for (const [text, expected] of cases) assert.deepEqual(parseRooms(text), expected, text);
  assert.equal(parseRoom("Средний пр. В.О., д. 41, лит. А, 510"), null);
});

test("фикстура: номера аудиторий — только 3–4 цифры, чужие адреса не дают аудиторий", () => {
  const lessons = toLessons(fixture);
  for (const lesson of lessons) {
    for (const room of lesson.rooms) assert.match(room, /^\d{3,4}$/);
    if (lesson.locationText.includes("Средний пр.")) assert.deepEqual(lesson.rooms, [], lesson.locationText);
  }
  assert.ok(lessons.some((lesson) => lesson.locationText.includes("Средний пр.")), "в фикстуре есть другой корпус");
});

test("английский — обязательный предмет: выбор по преподавателю, а не переключатель", () => {
  const room = (n: string): string =>
    `Санкт-Петербургское шоссе, д. 109, лит. А, ${n}`;
  const event = (id: number, subject: string, educators: string, where: string, day: number) => ({
    Id: id,
    Start: `2026-11-0${day}T09:30:00`,
    End: `2026-11-0${day}T11:00:00`,
    Subject: subject,
    EducatorsDisplayText: educators,
    LocationsDisplayText: room(where),
    IsCancelled: false,
  });
  const en = "Электив. Английский язык, практическое занятие";
  const lessons = toLessons({
    Days: [{ DayStudyEvents: [
      event(1, en, "Рогоза О. Н., старший преподаватель", "1302", 2),
      event(2, en, "Догот Т. В., старший преподаватель", "1209", 2),
      event(3, en, "Рогоза О. Н., старший преподаватель", "1302", 4),
      event(4, "Электив. Теория игр, лекция", "Иванов И. И., доцент", "1101", 3),
    ] }],
  });

  assert.deepEqual(listOptionals(lessons).map((c) => c.name), ["Теория игр"]);
  const [english] = listRequired(lessons);
  assert.equal(english?.name, "Английский язык");
  assert.deepEqual(english?.teachers.map((t) => [t.educators, t.count, t.rooms]), [
    ["Догот Т. В., старший преподаватель", 1, ["1209"]],
    ["Рогоза О. Н., старший преподаватель", 2, ["1302"]],
  ]);

  const none = new Set<string>();
  assert.deepEqual(lessons.filter((l) => isLessonShown(l, none)).length, 0);
  const chosen = new Set([
    teacherKey("Английский язык", "Рогоза О. Н., старший преподаватель"),
    "Электив:Английский язык", // устаревший ключ прежнего переключателя ничего не включает
  ]);
  assert.deepEqual(lessons.filter((l) => isLessonShown(l, chosen)).map((l) => l.id), [1, 3]);
});
