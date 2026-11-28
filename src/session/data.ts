// Загрузка семестра и прошлогодних пересдач; компактный кэш (в нём только события сессии).
import groups from "../data/groups.json";
import { eventsUrl } from "../timetable.ts";
import previous from "./previous-groups.json";
import { parseSession, type SessionData, type SessionEvent } from "./model.ts";

/**
 * Что известно о расписании прошлого года: loading — ещё грузится, ok — загружено, none — для группы его нет,
 * failed — не загрузилось.
 */
export type PreviousState = "loading" | "ok" | "none" | "failed";

export interface Cached extends SessionData {
  savedAt: number;
  previous: SessionEvent[];
  previousState: PreviousState;
}

const PREFIX = "vsm:session:v2:";
const key = (groupId: number, from: Date): string =>
  `${PREFIX}${groupId}:${from.getFullYear()}-${from.getMonth() + 1}`;

export function readCache(groupId: number, from: Date): Cached | null {
  try {
    const data = JSON.parse(localStorage.getItem(key(groupId, from)) ?? "null") as Cached | null;
    return data && Array.isArray(data.events) && Array.isArray(data.previous) ? data : null;
  } catch {
    return null;
  }
}

/** Номер той же группы в прошлом учебном году (в расписании он другой). */
function previousId(groupId: number, now: Date): number | null {
  const academicYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  // Номера привязаны к учебному году: после его смены список нужно собрать заново.
  if (academicYear !== previous.academicYear) return null;
  const name = groups.programs.flatMap((program) => program.groups).find((group) => group.id === groupId)?.name;
  return (name ? (previous.ids as Record<string, number>)[name] : undefined) ?? null;
}

async function load(groupId: number, from: Date, to: Date): Promise<SessionData> {
  const response = await fetch(eventsUrl(groupId, from, to), { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseSession(await response.json());
}

function writeCache(groupId: number, from: Date, data: Cached): void {
  try {
    // Держим одну копию: прежние группы и семестры не копим.
    for (const old of Object.keys(localStorage)) if (old.startsWith("vsm:session:")) localStorage.removeItem(old);
    localStorage.setItem(key(groupId, from), JSON.stringify(data));
  } catch {
    // Без кэша раздел работает, пока есть сеть.
  }
}

/**
 * Нынешний семестр отдаётся через onCurrent сразу, не дожидаясь прошлогоднего расписания: оно тяжелее и
 * нужно только для пересдач. Итог с пересдачами возвращается после.
 */
export async function fetchSession(
  groupId: number,
  from: Date,
  to: Date,
  now: Date,
  cached: Cached | null,
  onCurrent: (data: Cached) => void,
): Promise<Cached> {
  const oldId = previousId(groupId, now);
  const year = previous.academicYear;
  // Прошлогоднее расписание берём с февраля: раньше пересдач за него ещё нет, а ответ вдвое меньше.
  const pastRequest = oldId === null
    ? Promise.resolve(null)
    : load(oldId, new Date(year, 1, 1), new Date(year + 1, 1, 28)).catch(() => undefined);
  const current = await load(groupId, from, to);
  const keptPrevious = cached?.previous ?? [];
  const keptState: PreviousState = cached && cached.previousState !== "loading" ? cached.previousState : "failed";
  const savedAt = Date.now();
  if (oldId !== null) {
    // Промежуточная копия на случай, если приложение закроют, пока грузятся пересдачи.
    writeCache(groupId, from, { ...current, previous: keptPrevious, previousState: keptState, savedAt });
    onCurrent({ ...current, previous: keptPrevious, previousState: "loading", savedAt });
  }
  const past = await pastRequest;
  const data: Cached = {
    ...current,
    previous: past ? past.events.filter((event) => event.category === "retake") : past === null ? [] : keptPrevious,
    previousState: past ? "ok" : past === null ? "none" : "failed",
    savedAt,
  };
  writeCache(groupId, from, data);
  return data;
}
