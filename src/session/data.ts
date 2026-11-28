// Загрузка семестра и прошлогодних пересдач; компактный кэш (в нём только события сессии).
import groups from "../data/groups.json";
import { track } from "../telemetry.ts";
import { eventsUrl } from "../timetable.ts";
import previous from "./previous-groups.json";
import { needsPreviousTerm, parseSession, previousTermWindow, withPreviousTerm, type SessionData, type SessionEvent } from "./model.ts";

/**
 * Что известно о расписании прошлого года: loading — ещё грузится, ok — загружено, none — для группы его нет
 * (первый курс), outdated — список прошлогодних номеров ещё не обновлён под новый учебный год, failed — не загрузилось.
 */
export type PreviousState = "loading" | "ok" | "none" | "outdated" | "failed";

export interface Cached extends SessionData {
  savedAt: number;
  previous: SessionEvent[];
  previousState: PreviousState;
  /** Вместе с нынешним семестром показан прошлый. */
  carried?: boolean;
}

/** Сообщение о сбое для проверок: без сети его всё равно не отправить, и это не поломка. */
export function reportFailure(stage: "current" | "previous" | "previous_term", cached: boolean): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  track("session_error", { stage, cached });
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
function previousId(groupId: number, now: Date): number | "none" | "outdated" {
  const academicYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  // Номера привязаны к учебному году: после его смены список нужно собрать заново.
  if (academicYear !== previous.academicYear) return "outdated";
  const name = groups.programs.flatMap((program) => program.groups).find((group) => group.id === groupId)?.name;
  return (name ? (previous.ids as Record<string, number>)[name] : undefined) ?? "none";
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
  const pastRequest = typeof oldId === "number"
    ? load(oldId, new Date(year, 1, 1), new Date(year + 1, 1, 28)).catch(() => undefined)
    : Promise.resolve(null);
  let current = await load(groupId, from, to);
  let carried = false;
  if (needsPreviousTerm(current, from, now)) {
    const earlier = previousTermWindow(from);
    try {
      const data = await load(groupId, earlier.from, earlier.to);
      if (data.events.some((event) => event.category === "assessment")) {
        current = withPreviousTerm(current, data);
        carried = true;
      }
    } catch {
      reportFailure("previous_term", cached !== null);
    }
  }
  const keptPrevious = cached?.previous ?? [];
  const keptState: PreviousState = cached && cached.previousState !== "loading" ? cached.previousState : "failed";
  const savedAt = Date.now();
  if (typeof oldId === "number") {
    // Промежуточная копия на случай, если приложение закроют, пока грузятся пересдачи.
    writeCache(groupId, from, { ...current, carried, previous: keptPrevious, previousState: keptState, savedAt });
    onCurrent({ ...current, carried, previous: keptPrevious, previousState: "loading", savedAt });
  }
  const past = await pastRequest;
  if (past === undefined) reportFailure("previous", keptPrevious.length > 0);
  const data: Cached = {
    ...current,
    carried,
    previous: past ? past.events.filter((event) => event.category === "retake") : past === null ? [] : keptPrevious,
    previousState: past ? "ok" : past === undefined ? "failed" : (oldId as "none" | "outdated"),
    savedAt,
  };
  writeCache(groupId, from, data);
  return data;
}
