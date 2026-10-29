export interface OptionalInfo {
  kind: "Факультатив" | "Электив";
  name: string;
  key: string;
}

export interface Lesson {
  id: number | string;
  start: Date;
  end: Date;
  subject: string;
  educators: string;
  cancelled: boolean;
  rooms: string[];
  room: string | null;
  locationText: string;
  optional: OptionalInfo | null;
}

export interface OptionalCourse extends OptionalInfo {
  count: number;
  educators: string[];
}

type Row = Record<string, unknown>;

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function field(row: Row, ...names: string[]): unknown {
  for (const name of names) {
    if (Object.hasOwn(row, name)) return row[name];
  }
  return undefined;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function displayText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(displayText).filter(Boolean).join(", ");
  }
  if (isRow(value)) {
    return text(field(value, "displayName", "DisplayName", "name", "Name", "title", "Title"));
  }
  return text(value);
}

// Аудитория главного корпуса: адрес «Санкт-Петербургское шоссе, д. 109, лит. А» + номер из 3–4 цифр
// (допускается и английская форма). Другие адреса и онлайн-формат номеров не дают.
const MAIN_BUILDING_ROOM =
  /(?:санкт[-\s]*петербургское\s+шоссе\s*,?\s*д\.?\s*109\s*,?\s*лит\.?\s*[аa]|sankt[-\s]*peterburgskoe\s+shosse\s*,?\s*109\s*,?\s*letter\s*a)\s*,?\s*(\d{3,4})(?!\d)/giu;

export function parseRooms(value: unknown): string[] {
  const rooms: string[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    for (const match of displayText(item).matchAll(MAIN_BUILDING_ROOM)) {
      const room = match[1];
      if (room !== undefined && !rooms.includes(room)) rooms.push(room);
    }
  };
  visit(value);
  return rooms;
}

export function parseRoom(value: unknown): string | null {
  return parseRooms(value)[0] ?? null;
}

export function parseOptional(subject: string): OptionalInfo | null {
  const match = /^\s*(Факультатив|Электив)\.\s*(.*?)\s*$/iu.exec(subject);
  if (!match) return null;

  const kind = match[1].toLocaleLowerCase("ru") === "факультатив"
    ? "Факультатив"
    : "Электив";
  const remainder = match[2];
  let cut = -1;
  const separators = /,\s+/g;
  for (const separator of remainder.matchAll(separators)) {
    cut = separator.index;
  }
  const name = (cut < 0 ? remainder : remainder.slice(0, cut)).trim();
  if (!name) return null;

  return { kind, name, key: `${kind}:${name}` };
}

export function listOptionals(lessons: Lesson[]): OptionalCourse[] {
  const courses = new Map<string, OptionalCourse>();
  for (const lesson of lessons) {
    if (lesson.cancelled || lesson.optional === null) continue;
    const { key, kind, name } = lesson.optional;
    let course = courses.get(key);
    if (!course) {
      course = { key, kind, name, count: 0, educators: [] };
      courses.set(key, course);
    }
    course.count++;
    const educator = lesson.educators.trim();
    if (educator && !course.educators.includes(educator)) {
      course.educators.push(educator);
    }
  }
  return [...courses.values()].sort((a, b) =>
    (a.kind === b.kind ? 0 : a.kind === "Факультатив" ? -1 : 1) ||
    a.name.localeCompare(b.name, "ru")
  );
}

export function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  return monday;
}

export function lessonWindow(now: Date): { from: Date; to: Date } {
  const from = mondayOf(now);
  const to = new Date(from);
  to.setDate(to.getDate() + 27);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

function dateOf(value: unknown): Date {
  if (isRow(value)) {
    return dateOf(field(value, "dateTime", "DateTime", "value", "Value", "date", "Date"));
  }
  return new Date(value instanceof Date || typeof value === "string" || typeof value === "number"
    ? value
    : NaN);
}

function eventRows(value: unknown, result: Row[] = []): Row[] {
  if (Array.isArray(value)) {
    for (const item of value) eventRows(item, result);
  } else if (isRow(value)) {
    const start = field(value, "start", "Start", "startTime", "StartTime", "startDateTime", "StartDateTime");
    const end = field(value, "end", "End", "endTime", "EndTime", "endDateTime", "EndDateTime");
    const subject = field(value, "subject", "Subject", "subjectName", "SubjectName");
    if (start !== undefined && end !== undefined && subject !== undefined) {
      result.push(value);
    } else {
      for (const child of Object.values(value)) eventRows(child, result);
    }
  }
  return result;
}

export function toLessons(raw: unknown): Lesson[] {
  return eventRows(raw).map((event, index) => {
    const subject = displayText(field(event, "subject", "Subject", "subjectName", "SubjectName"));
    const locations = field(event, "rooms", "Rooms", "locations", "Locations", "eventLocations",
      "EventLocations", "room", "Room", "location", "Location");
    const locationText = displayText(field(event, "locationText", "LocationText",
      "locationsDisplayText", "LocationsDisplayText")) || displayText(locations);
    const rooms = locations === undefined ? parseRooms(locationText) : parseRooms(locations);
    const cancellation = field(event, "cancelled", "Cancelled", "canceled", "Canceled",
      "isCancelled", "IsCancelled", "isCanceled", "IsCanceled");
    const id = field(event, "id", "Id", "ID");
    return {
      id: typeof id === "string" || typeof id === "number" ? id : index,
      start: dateOf(field(event, "start", "Start", "startTime", "StartTime",
        "startDateTime", "StartDateTime")),
      end: dateOf(field(event, "end", "End", "endTime", "EndTime",
        "endDateTime", "EndDateTime")),
      subject,
      educators: displayText(field(event, "educators", "Educators", "educatorsDisplayText",
        "EducatorsDisplayText", "educator", "Educator")),
      cancelled: cancellation === true || cancellation === 1 || cancellation === "true",
      rooms,
      room: rooms[0] ?? null,
      locationText,
      optional: parseOptional(subject),
    };
  });
}

function localDate(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Адрес API: диапазон дат задаётся в пути, а не в query (query отдаёт только текущую неделю). */
export function eventsUrl(groupId: number, from: Date, to: Date): string {
  return `https://timetable.spbu.ru/api/v1/groups/${groupId}/events/${localDate(from)}/${localDate(to)}`;
}

/** Сервер отвечает медленно (10–30 с): таймаут 30 с и одна повторная попытка при сетевой ошибке или 5xx. */
export async function loadLessons(
  groupId: number,
  from: Date,
  to: Date,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Lesson[]> {
  const url = eventsUrl(groupId, from, to);
  const timeoutMs = opts.timeoutMs ?? 30_000;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (opts.signal?.aborted) throw new Error("Запрос расписания отменён");

    const controller = new AbortController();
    const cancel = (): void => controller.abort();
    opts.signal?.addEventListener("abort", cancel, { once: true });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch {
      if (opts.signal?.aborted) throw new Error("Запрос расписания отменён");
      if (attempt === 0) continue;
      throw new Error(
        timedOut
          ? "Не удалось загрузить расписание: превышено время ожидания"
          : "Не удалось загрузить расписание: ошибка сети",
      );
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", cancel);
    }

    if (!response.ok) {
      if (response.status >= 500 && attempt === 0) continue;
      throw new Error(`Не удалось загрузить расписание: ошибка сервера HTTP ${response.status}`);
    }
    return toLessons(await response.json());
  }
  throw new Error("Не удалось загрузить расписание");
}

function lessonCacheKey(groupId: number, from: Date, to: Date): string {
  return `vsm:lessons:${groupId}:${localDate(from)}:${localDate(to)}`;
}

export async function loadLessonsCached(
  groupId: number,
  from: Date,
  to: Date,
  onUpdate: (lessons: Lesson[], fresh: boolean) => void,
): Promise<void> {
  const key = lessonCacheKey(groupId, from, to);
  let hadCache = false;
  try {
    const saved = globalThis.localStorage.getItem(key);
    if (saved !== null) {
      const lessons = toLessons(JSON.parse(saved) as unknown);
      hadCache = true;
      onUpdate(lessons, false);
    }
  } catch {
    // Кэш может отсутствовать, быть повреждён или быть недоступным.
  }

  try {
    const lessons = await loadLessons(groupId, from, to);
    try {
      globalThis.localStorage.setItem(key, JSON.stringify(lessons));
    } catch {
      // Отсутствие хранилища не мешает показать свежие данные.
    }
    onUpdate(lessons, true);
  } catch (error) {
    if (!hadCache) throw error;
  }
}

export function loadWindowCached(
  groupId: number,
  now: Date,
  onUpdate: (lessons: Lesson[], fresh: boolean) => void,
): Promise<void> {
  const { from, to } = lessonWindow(now);
  return loadLessonsCached(groupId, from, to, onUpdate);
}

export function lessonsOfDay(lessons: Lesson[], day: Date): Lesson[] {
  return lessons
    .filter((lesson) =>
      lesson.start.getFullYear() === day.getFullYear() &&
      lesson.start.getMonth() === day.getMonth() &&
      lesson.start.getDate() === day.getDate()
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function pickNextLesson(lessons: Lesson[], now: Date): Lesson | null {
  return lessons
    .filter((lesson) => !lesson.cancelled && lesson.end.getTime() > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
}

export function pickNextLessonAfter(lessons: Lesson[], after: Date | Lesson): Lesson | null {
  const time = after instanceof Date ? after.getTime() : after.start.getTime();
  return lessons
    .filter((lesson) => !lesson.cancelled && lesson.start.getTime() > time)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
}
