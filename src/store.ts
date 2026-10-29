// Общее состояние приложения: вкладка, группа, расписание, выбранные факультативы, запросы маршрута.
// Экраны не знают друг о друге — общаются через это хранилище.
import { loadPrefs, savePrefs, type Prefs } from "./prefs.ts";
import {
  isLessonShown,
  listOptionals,
  listRequired,
  loadWindowCached,
  teacherKey,
  type Lesson,
  type OptionalCourse,
  type RequiredCourse,
} from "./timetable.ts";
import { setContext, track } from "./telemetry.ts";

export type Tab = "schedule" | "map" | "settings";
export const TABS: Tab[] = ["schedule", "map", "settings"];

export interface AppState {
  tab: Tab;
  groupId: number | null;
  /** Занятия окна в 4 недели (все, включая скрытые факультативы); null, пока не загружены. */
  lessons: Lesson[] | null;
  loading: boolean;
  error: boolean;
  /** Ключи выбранных факультативов/элективов текущей группы (Lesson.optional.key). */
  selected: string[];
}

export interface RouteRequest {
  /** Номер аудитории (id якоря плана). */
  room: string;
  /** Необязательная точка старта (id якоря). */
  from?: string;
  /** Откуда пришёл запрос (для служебных событий): schedule — карточка пары. */
  source?: string;
}

// ?now=2026-11-01T12:00 — подмена текущего времени для проверок
const fakeNow = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("now");
export function now(): Date {
  return fakeNow ? new Date(fakeNow) : new Date();
}

function tabFromHash(): Tab {
  const h = typeof location === "undefined" ? "" : location.hash.replace(/^#\/?/, "");
  return (TABS as string[]).includes(h) ? (h as Tab) : "schedule";
}

let prefs: Prefs = loadPrefs();
let state: AppState = {
  tab: tabFromHash(),
  groupId: prefs.groupId,
  lessons: null,
  loading: false,
  error: false,
  selected: prefs.groupId === null ? [] : [...(prefs.electives[String(prefs.groupId)] ?? [])],
};
const listeners = new Set<() => void>();
let requestId = 0;

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const fn of [...listeners]) fn();
}

export function getState(): AppState {
  return state;
}

/** Подписка на любые изменения состояния; возвращает функцию отписки. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---- вкладки
export function goTab(tab: Tab): void {
  if (state.tab === tab) return;
  if (typeof history !== "undefined") history.replaceState(null, "", `#${tab}`);
  setContext("tab", tab);
  set({ tab });
}
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const tab = tabFromHash();
    if (tab !== state.tab) set({ tab });
  });
}

// ---- расписание
export function reload(): void {
  const groupId = state.groupId;
  const id = ++requestId;
  if (groupId === null) {
    set({ lessons: null, loading: false, error: false });
    return;
  }
  set({ loading: true, error: false });
  const started = Date.now();
  let shownCache = false; // сначала мог прийти кэш (fresh = false)
  let reported = false;
  void loadWindowCached(groupId, now(), (lessons, fresh) => {
    if (id !== requestId) return;
    if (!fresh) shownCache = true;
    if (fresh && !reported) {
      reported = true;
      track("schedule_loaded", { ms: Date.now() - started, lessons: lessons.length, cached_first: shownCache });
    }
    set({ lessons });
  })
    .then(() => {
      if (id === requestId) set({ loading: false });
    })
    .catch((error: unknown) => {
      if (id !== requestId) return;
      track("schedule_error", { ms: Date.now() - started, message: error instanceof Error ? error.message : "unknown" });
      set({ loading: false, error: true });
    });
}

export function setGroup(groupId: number): void {
  prefs = { ...prefs, groupId };
  savePrefs(prefs);
  set({ groupId, lessons: null, selected: [...(prefs.electives[String(groupId)] ?? [])] });
  reload();
}

function saveSelected(selected: string[]): void {
  if (state.groupId === null) return;
  prefs = { ...prefs, electives: { ...prefs.electives, [String(state.groupId)]: selected } };
  savePrefs(prefs);
  set({ selected });
}

export function setElective(key: string, on: boolean): void {
  const rest = state.selected.filter((k) => k !== key);
  saveSelected(on ? [...rest, key] : rest);
  track("electives_changed", { count: state.selected.length });
}

/** Выбрать преподавателя обязательного предмета (например, английского): прежний выбор по нему заменяется. */
export function setTeacher(course: string, educators: string): void {
  const prefix = `teacher:${course}:`;
  const rest = state.selected.filter((k) => !k.startsWith(prefix));
  saveSelected([...rest, teacherKey(course, educators)]);
}

/** «Сбросить выбор» убирает только факультативы и элективы; выбранный преподаватель обязательного предмета остаётся. */
export function resetElectives(): void {
  saveSelected(state.selected.filter((k) => k.startsWith("teacher:")));
}

/** Занятия с учётом выбора: обычные пары + выбранные факультативы/элективы. */
export function visibleLessons(): Lesson[] {
  const selected = new Set(state.selected);
  return (state.lessons ?? []).filter((l) => isLessonShown(l, selected));
}

/** Обязательные предметы с потоками по преподавателям (английский), найденные в загруженном окне. */
export function requiredCourses(): RequiredCourse[] {
  return state.lessons ? listRequired(state.lessons) : [];
}

/** Обязательные предметы, у которых преподаватель ещё не выбран (или выбранного нет в расписании). */
export function courseNeedsTeacher(): RequiredCourse[] {
  const selected = new Set(state.selected);
  return requiredCourses().filter((c) => !c.teachers.some((t) => selected.has(t.key)));
}

/** Пары «по выбору», найденные в загруженном окне (для экрана настроек). */
export function optionalCourses(): OptionalCourse[] {
  return state.lessons ? listOptionals(state.lessons) : [];
}

// ---- запрос маршрута из расписания на карту
let pending: RouteRequest | null = null;
const routeListeners = new Set<(req: RouteRequest) => void>();

/** Открыть карту и построить маршрут до аудитории. */
export function requestRoute(room: string, from?: string, source = "schedule"): void {
  pending = { room, from, source };
  goTab("map");
  for (const fn of [...routeListeners]) fn(pending);
}

export function onRouteRequest(fn: (req: RouteRequest) => void): () => void {
  routeListeners.add(fn);
  return () => routeListeners.delete(fn);
}

/** Забрать необработанный запрос (если карта ещё не была подписана). */
export function takePendingRoute(): RouteRequest | null {
  const p = pending;
  pending = null;
  return p;
}
