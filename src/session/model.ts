// Сессия: отбор и группировка аттестаций из расписания. Без DOM и сети.
import { lessonView } from "../lesson-kind.ts";
import { isRequiredOptional, toLessons } from "../timetable.ts";

export type Category = "assessment" | "retake" | "consultation" | "review";

/** Одно событие сессии в компактном виде: так же оно лежит в кэше. */
export interface SessionEvent {
  /** Ключ курса: для «по выбору» совпадает с ключом выбора в настройках, иначе название. */
  courseKey: string;
  title: string;
  optionalKind: "Электив" | "Факультатив" | null;
  /** Обязательный предмет с потоками по преподавателям (английский). */
  byTeacher: boolean;
  category: Category;
  /** Тип, как в расписании: «зачёт», «экзамен (пересдача)»… */
  type: string;
  start: string;
  end: string;
  location: string;
  rooms: string[];
  educators: string;
  cancelled: boolean;
  /** Что расписание пометило как изменённое. */
  changed: string[];
}

export interface SessionData {
  events: SessionEvent[];
  /** Преподаватели потоков по обязательным предметам с выбором (по занятиям всего семестра). */
  teachers: Record<string, string[]>;
}

export function categoryOf(type: string): Category | null {
  const t = type.toLowerCase();
  if (/консультац/.test(t)) return "consultation";
  if (/показ/.test(t)) return "review";
  // Отдельного типа в осенней выгрузке нет; так пересдачи названы в официальных расписаниях.
  if (/пересда|повторн|комисси|задолж/.test(t)) return "retake";
  if (/экзамен|зач[её]т|аттестац|защит/.test(t)) return "assessment";
  return null;
}

/** Фамилии с инициалами из строки преподавателей: «Нейман Ю. Е., ст. преп.; Климова Я. Л., преп.». */
export function people(educators: string): string[] {
  return educators.split(";").map((part) => (part.split(",")[0] ?? "").trim()).filter(Boolean);
}

type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export function parseSession(raw: unknown): SessionData {
  const rows = list(isRow(raw) ? raw.Days : null)
    .flatMap((day) => list(isRow(day) ? day.DayStudyEvents : null))
    .filter(isRow);
  const events: SessionEvent[] = [];
  const teachers = new Map<string, Set<string>>();
  for (const row of rows) {
    const lesson = toLessons([row])[0];
    if (!lesson || Number.isNaN(lesson.start.getTime())) continue;
    const view = lessonView(lesson);
    const byTeacher = isRequiredOptional(lesson.optional);
    const category = categoryOf(view.type);
    if (category === null) {
      // Обычное занятие: нужно только, чтобы знать преподавателей потоков. Совместные строки — не отдельный человек.
      const educators = lesson.educators.trim();
      if (byTeacher && educators && !educators.includes(";")) {
        const name = lesson.optional!.name;
        teachers.set(name, (teachers.get(name) ?? new Set()).add(educators));
      }
      continue;
    }
    const changed = [
      row.TimeWasChanged === true ? "время" : "",
      row.LocationsWereChanged === true ? "место" : "",
      row.EducatorsWereReassigned === true ? "преподаватель" : "",
    ].filter(Boolean);
    events.push({
      courseKey: lesson.optional?.key ?? view.title,
      title: view.title,
      optionalKind: view.optionalKind,
      byTeacher,
      category,
      type: view.type,
      start: String(row.Start),
      end: String(row.End),
      location: lesson.locationText,
      rooms: lesson.rooms,
      educators: lesson.educators.trim(),
      cancelled: lesson.cancelled,
      changed,
    });
  }
  return {
    events,
    teachers: Object.fromEntries([...teachers].map(([name, set]) => [name, [...set].sort((a, b) => a.localeCompare(b, "ru"))])),
  };
}

export interface Card {
  key: string;
  courseKey: string;
  title: string;
  optionalKind: SessionEvent["optionalKind"];
  retake: boolean;
  /** Сами испытания (или пересдачи) по дате. */
  main: SessionEvent[];
  consultations: SessionEvent[];
  reviews: SessionEvent[];
  /** Несколько разных дат одного вида: из расписания нельзя понять, какая чья. */
  severalDates: boolean;
}

export interface SessionPlan {
  cards: Card[];
  /** «По выбору» с аттестацией, не включённые пользователем (кроме английского). */
  options: { key: string; title: string; kind: "Электив" | "Факультатив"; selected: boolean }[];
  /** Предметы с потоками, где преподаватель не выбран, и потому их аттестации скрыты. */
  needTeacher: { course: string; teachers: string[] }[];
}

export function buildPlan(data: SessionData, selected: ReadonlySet<string>): SessionPlan {
  const chosenPeople = (course: string): string[] => {
    const prefix = `teacher:${course}:`;
    return [...selected].filter((key) => key.startsWith(prefix)).flatMap((key) => people(key.slice(prefix.length)));
  };
  const options = new Map<string, SessionPlan["options"][number]>();
  const needTeacher = new Map<string, string[]>();
  const seen = new Set<string>();
  const visible: SessionEvent[] = [];

  for (const event of data.events) {
    if (event.byTeacher) {
      // Пересдачу и комиссию принимают не обязательно «свои» преподаватели: показываем без отбора.
      if (event.category !== "retake") {
        const chosen = chosenPeople(event.title);
        if (!chosen.length) {
          needTeacher.set(event.title, data.teachers[event.title] ?? []);
          continue;
        }
        // Достаточно, чтобы выбранный преподаватель был среди указанных в строке (зачёт вдвоём).
        if (!people(event.educators).some((person) => chosen.includes(person))) continue;
      }
    } else if (event.optionalKind) {
      const on = selected.has(event.courseKey);
      if (event.category === "assessment" || event.category === "retake") {
        options.set(event.courseKey, { key: event.courseKey, title: event.title, kind: event.optionalKind, selected: on });
      }
      if (!on) continue;
    }
    // Расписание повторяет строки: одинаковые по смыслу схлопываем.
    const id = [event.courseKey, event.type, event.start, event.end, event.location, event.educators, event.cancelled].join("|");
    if (seen.has(id)) continue;
    seen.add(id);
    visible.push(event);
  }

  const byStart = (a: SessionEvent, b: SessionEvent): number => a.start.localeCompare(b.start);
  const cards: Card[] = [];
  const courses = new Map<string, SessionEvent[]>();
  for (const event of visible) courses.set(event.courseKey, [...(courses.get(event.courseKey) ?? []), event]);

  for (const [courseKey, events] of courses) {
    const first = events[0]!;
    const tests = events.filter((e) => e.category === "assessment" || e.category === "retake").sort(byStart);
    const make = (retake: boolean): Card | null => {
      const main = tests.filter((e) => (e.category === "retake") === retake);
      if (!main.length) return null;
      const datesByType = new Map<string, Set<string>>();
      for (const e of main) datesByType.set(e.type, (datesByType.get(e.type) ?? new Set()).add(`${e.start}|${e.location}`));
      return {
        key: `${courseKey}:${retake ? "retake" : "main"}`,
        courseKey,
        title: first.title,
        optionalKind: first.optionalKind,
        retake,
        main,
        consultations: [],
        reviews: [],
        severalDates: [...datesByType.values()].some((set) => set.size > 1),
      };
    };
    const own = [make(false), make(true)].filter((card): card is Card => card !== null);
    const cardOf = (test: SessionEvent): Card => own.find((card) => card.retake === (test.category === "retake"))!;
    for (const event of events.sort(byStart)) {
      if (!tests.length) break;
      // Консультация относится к ближайшему следующему испытанию, показ работ — к предыдущему.
      if (event.category === "consultation") {
        cardOf(tests.find((t) => t.start >= event.start) ?? tests[tests.length - 1]!).consultations.push(event);
      } else if (event.category === "review") {
        cardOf([...tests].reverse().find((t) => t.start <= event.start) ?? tests[0]!).reviews.push(event);
      }
    }
    cards.push(...own);
  }
  cards.sort((a, b) => a.main[0]!.start.localeCompare(b.main[0]!.start) || a.title.localeCompare(b.title, "ru"));
  return {
    cards,
    options: [...options.values()].sort((a, b) => a.title.localeCompare(b.title, "ru")),
    needTeacher: [...needTeacher].map(([course, teachers]) => ({ course, teachers })),
  };
}

/**
 * Пересдачи и комиссии из расписания прошлого года. Выбор элективов и преподавателя к ним не применяется:
 * долг может быть по предмету, которого в нынешнем выборе уже нет. Поэтому показываем все по группе.
 */
export function previousCards(events: SessionEvent[]): Card[] {
  const seen = new Set<string>();
  const courses = new Map<string, SessionEvent[]>();
  for (const event of [...events].sort((a, b) => a.start.localeCompare(b.start))) {
    if (event.category !== "retake") continue;
    const id = [event.courseKey, event.type, event.start, event.end, event.location, event.educators, event.cancelled].join("|");
    if (seen.has(id)) continue;
    seen.add(id);
    courses.set(event.courseKey, [...(courses.get(event.courseKey) ?? []), event]);
  }
  return [...courses].map(([courseKey, main]) => ({
    key: `previous:${courseKey}`,
    courseKey,
    title: main[0]!.title,
    optionalKind: main[0]!.optionalKind,
    retake: true,
    main,
    consultations: [],
    reviews: [],
    severalDates: false,
  })).sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

/** Прошла ли карточка целиком: все сами испытания закончились. */
export function isPast(card: Card, now: Date): boolean {
  return card.main.every((event) => new Date(event.end).getTime() < now.getTime());
}

/** Первые недели семестра экзамены публикуются постепенно: прошлую сессию пока не убираем. */
const CARRY_DAYS = 60;

/**
 * Нужно ли вместе с нынешним семестром показать прошлый: пока в нынешнем нет ни одного испытания
 * или он только начался. Пересдачи не считаются: зимние идут уже в весеннем семестре.
 */
export function needsPreviousTerm(data: SessionData, from: Date, now: Date): boolean {
  if (!data.events.some((event) => event.category === "assessment")) return true;
  return now.getTime() - from.getTime() < CARRY_DAYS * 86_400_000;
}

export function previousTermWindow(from: Date): { from: Date; to: Date } {
  return seasonWindow(new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1, 12));
}

/** Объединяет два семестра. Пересекающиеся по датам события схлопнет buildPlan. */
export function withPreviousTerm(current: SessionData, earlier: SessionData): SessionData {
  const teachers = { ...earlier.teachers };
  for (const [course, names] of Object.entries(current.teachers)) {
    teachers[course] = [...new Set([...(teachers[course] ?? []), ...names])].sort((a, b) => a.localeCompare(b, "ru"));
  }
  return { events: [...earlier.events, ...current.events], teachers };
}

/** Дата, по которой карточка стоит в списке: ближайшее незавершённое испытание, иначе первое. */
export function nextDate(card: Card, now: Date): string {
  return (card.main.find((event) => new Date(event.end).getTime() >= now.getTime()) ?? card.main[0]!).start;
}

/**
 * Какой период запрашивать. Осенний захватывает апрель: в прошлые годы зимние пересдачи шли в феврале–апреле.
 * С февраля показываем весенний семестр (в нём окажутся и зимние пересдачи февраля–апреля).
 */
export function seasonWindow(now: Date): { from: Date; to: Date } {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 9) return { from: new Date(year, 8, 1), to: new Date(year + 1, 3, 30) };
  if (month === 1) return { from: new Date(year - 1, 8, 1), to: new Date(year, 3, 30) };
  return { from: new Date(year, 1, 1), to: new Date(year, 10, 30) };
}
