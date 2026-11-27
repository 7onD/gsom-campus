import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlan, categoryOf, isPast, nextDate, parseSession, people, previousCards, seasonWindow } from "./model.ts";

const row = (Subject: string, Start: string, EducatorsDisplayText = "Иванов И. И., доцент", extra: object = {}) => ({
  Subject, Start, End: Start.replace(/T(\d\d)/, (_m, h) => `T${String(Number(h) + 1).padStart(2, "0")}`),
  EducatorsDisplayText, LocationsDisplayText: "Санкт-Петербургское шоссе, д. 109, лит. А, 1219", IsCancelled: false, ...extra,
});
const wrap = (...rows: object[]) => ({ Days: [{ DayStudyEvents: rows }] });
const ENG = "Электив. Английский язык";
const NEI = "Нейман Ю. Е., старший преподаватель";
const KLI = "Климова Я. Л., преподаватель";
const teacherSel = (educators: string) => `teacher:Английский язык:${educators}`;

test("тип события: пересдача и комиссия отдельно, консультация и показ работ — вспомогательные", () => {
  for (const [type, expected] of [
    ["зачёт", "assessment"], ["экзамен", "assessment"], ["аттестационное испытание", "assessment"],
    ["зачёт (пересдача)", "retake"], ["экзамен (комиссия)", "retake"], ["повторная аттестация", "retake"],
    ["консультация групповая", "consultation"], ["показ работ", "review"], ["лекция", null], ["семинар", null],
  ] as const) assert.equal(categoryOf(type), expected, type);
});

test("английский: комиссия из двух человек видна выбравшему любого, чужие строки и повторы скрыты", () => {
  const data = parseSession(wrap(
    row(`${ENG}, практическое занятие`, "2026-12-01T10:00:00", NEI),
    row(`${ENG}, практическое занятие`, "2026-12-02T10:00:00", KLI),
    row(`${ENG}, практическое занятие`, "2026-12-03T10:00:00", `${NEI}; ${KLI}`),
    row(`${ENG}, зачёт`, "2026-12-28T16:00:00", `${NEI}; ${KLI}`),
    row(`${ENG}, зачёт`, "2026-12-28T16:00:00", `${NEI}; ${KLI}`),
    row(`${ENG}, зачёт`, "2026-12-28T16:00:00", "Мартынова Т. А., доцент"),
  ));
  assert.deepEqual(data.teachers["Английский язык"], [KLI, NEI]);
  for (const chosen of [NEI, KLI, `${NEI}; ${KLI}`]) {
    const plan = buildPlan(data, new Set([teacherSel(chosen)]));
    assert.equal(plan.cards.length, 1);
    assert.equal(plan.cards[0]!.main.length, 1, chosen);
    assert.equal(plan.cards[0]!.severalDates, false);
  }
  const none = buildPlan(data, new Set());
  assert.equal(none.cards.length, 0);
  assert.deepEqual(none.needTeacher, [{ course: "Английский язык", teachers: [KLI, NEI] }]);
});

test("по выбору видно только выбранное, обязательное — всегда; список для выбора берётся за весь семестр", () => {
  const data = parseSession(wrap(
    row("Электив. Теория игр, зачёт", "2026-11-18T11:45:00"),
    row("Факультатив. Хинди (онлайн-курс), зачёт", "2026-12-18T11:45:00"),
    row("Операционный менеджмент, экзамен", "2027-01-16T11:00:00"),
  ));
  const plan = buildPlan(data, new Set(["Электив:Теория игр"]));
  assert.deepEqual(plan.cards.map((c) => c.title), ["Теория игр", "Операционный менеджмент"]);
  assert.deepEqual(plan.options.map((o) => [o.title, o.selected]), [["Теория игр", true], ["Хинди (онлайн-курс)", false]]);
});

test("консультация уходит к следующему испытанию, показ — к предыдущему, пересдача отдельной карточкой", () => {
  const data = parseSession(wrap(
    row("Учёт, консультация групповая", "2027-01-10T10:00:00"),
    row("Учёт, экзамен", "2027-01-12T14:00:00", "Н. Н. Н., доцент", { TimeWasChanged: true }),
    row("Учёт, показ работ", "2027-01-15T19:00:00"),
    row("Учёт, консультация групповая", "2027-03-10T10:00:00"),
    row("Учёт, экзамен (пересдача)", "2027-03-12T17:45:00"),
    row("Учёт, показ работ", "2027-03-19T19:00:00"),
  ));
  const [main, retake] = buildPlan(data, new Set()).cards;
  assert.equal(main!.retake, false);
  assert.deepEqual([main!.consultations.length, main!.reviews.length, main!.main[0]!.changed], [1, 1, ["время"]]);
  assert.equal(retake!.retake, true);
  assert.deepEqual([retake!.consultations.length, retake!.reviews.length], [1, 1]);
  assert.equal(isPast(main!, new Date("2027-02-01T00:00:00")), true);
  assert.equal(isPast(retake!, new Date("2027-02-01T00:00:00")), false);
});

test("несколько дат одного вида помечаются, а не объявляются пересдачей", () => {
  const data = parseSession(wrap(row("БЖД, зачёт", "2026-12-04T10:00:00"), row("БЖД, зачёт", "2026-12-17T09:00:00")));
  const [card] = buildPlan(data, new Set()).cards;
  assert.equal(card!.severalDates, true);
  assert.equal(card!.retake, false);
  assert.equal(nextDate(card!, new Date("2026-12-10T00:00:00")), "2026-12-17T09:00:00");
  assert.equal(nextDate(card!, new Date("2027-02-01T00:00:00")), "2026-12-04T10:00:00");
});

test("период запроса по сезону и фамилии из строки", () => {
  const win = (value: string) => { const w = seasonWindow(new Date(value)); return [w.from, w.to].map((d) => `${d.getFullYear()}-${d.getMonth() + 1}`).join(" "); };
  assert.equal(win("2026-11-27T12:00:00"), "2026-9 2027-4");
  assert.equal(win("2027-01-20T12:00:00"), "2026-9 2027-4");
  assert.equal(win("2027-02-02T12:00:00"), "2027-2 2027-11");
  assert.equal(win("2027-06-02T12:00:00"), "2027-2 2027-11");
  assert.deepEqual(people(`${NEI}; ${KLI}`), ["Нейман Ю. Е.", "Климова Я. Л."]);
});

test("прошлогодние пересдачи и комиссии: без учёта выбора, повторы схлопнуты, обычные зачёты не попадают", () => {
  const data = parseSession(wrap(
    row("Электив. Теория игр, зачёт", "2026-04-01T10:00:00"),
    row("Электив. Теория игр, зачёт (пересдача)", "2026-10-03T10:00:00"),
    row("Электив. Теория игр, зачёт (пересдача)", "2026-10-03T10:00:00"),
    row("Электив. Теория игр, зачёт (комиссия)", "2026-11-09T16:00:00"),
    row(`${ENG}, зачёт (комиссия)`, "2026-11-05T17:45:00", "Мартынова Т. А., доцент"),
    row("Теория игр, показ работ", "2026-11-10T16:00:00"),
  ));
  const cards = previousCards(data.events);
  assert.deepEqual(cards.map((c) => [c.title, c.main.map((e) => e.type)]), [
    ["Английский язык", ["зачёт (комиссия)"]],
    ["Теория игр", ["зачёт (пересдача)", "зачёт (комиссия)"]],
  ]);
  assert.ok(cards.every((c) => c.retake && !c.severalDates));
});

test("пересдача по английскому в этом семестре видна и без совпадения преподавателя", () => {
  const data = parseSession(wrap(row(`${ENG}, зачёт (комиссия)`, "2027-03-05T17:45:00", "Мартынова Т. А., доцент")));
  assert.equal(buildPlan(data, new Set()).cards.length, 1);
  assert.equal(buildPlan(data, new Set([teacherSel(NEI)])).cards.length, 1);
});
