// Общее состояние приложения: вкладка, группа, расписание, выбранные факультативы, запросы маршрута.
// Экраны не знают друг о друге — общаются через это хранилище.
import { loadPrefs, savePrefs, type Prefs } from "./prefs.ts";
import { listOptionals, loadWindowCached, type Lesson, type OptionalCourse } from "./timetable.ts";

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
  void loadWindowCached(groupId, now(), (lessons) => {
    if (id !== requestId) return;
    set({ lessons });
  })
    .then(() => {
      if (id === requestId) set({ loading: false });
    })
    .catch(() => {
      if (id === requestId) set({ loading: false, error: true });
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
}

export function resetElectives(): void {
  saveSelected([]);
}

/** Занятия с учётом выбора: обычные пары + выбранные факультативы/элективы. */
export function visibleLessons(): Lesson[] {
  const selected = new Set(state.selected);
  return (state.lessons ?? []).filter((l) => !l.optional || selected.has(l.optional.key));
}

/** Пары «по выбору», найденные в загруженном окне (для экрана настроек). */
export function optionalCourses(): OptionalCourse[] {
  return state.lessons ? listOptionals(state.lessons) : [];
}

// ---- запрос маршрута из расписания на карту
let pending: RouteRequest | null = null;
const routeListeners = new Set<(req: RouteRequest) => void>();

/** Открыть карту и построить маршрут до аудитории. */
export function requestRoute(room: string, from?: string): void {
  pending = { room, from };
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
