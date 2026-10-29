import type { Anchor } from "./routing.ts";

/** Якорь плана с описанием для интерфейса. */
export interface Place extends Anchor {
  kind: "room" | "poi" | "stair";
  number?: string;
  name?: string;
  duplicate?: boolean;
  /** Чем различаются одноимённые аудитории на плане. */
  where?: string;
  approx?: boolean;
}

export function placeLabel(p: Place): string {
  if (p.kind === "room") {
    const suffix = p.duplicate && p.where ? ` (${p.where})` : "";
    return `Аудитория ${p.number}${suffix}`;
  }
  return p.name ?? p.id;
}

export function placeSub(p: Place): string {
  const parts = [p.name && p.kind === "room" ? p.name : "", `${p.floor} этаж`].filter(Boolean);
  return parts.join(" · ");
}

/** Поиск по номеру (префикс) и по названию (подстрока), номера идут первыми. */
export function searchPlaces(places: Place[], query: string, limit = 8): Place[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const byNumber = places.filter((p) => p.kind === "room" && p.number!.startsWith(q));
  const byName = places.filter(
    (p) => p.kind !== "stair" && !byNumber.includes(p) && (p.name ?? "").toLowerCase().includes(q),
  );
  return [...byNumber, ...byName].slice(0, limit);
}

/** Ближайший к точке плана объект, если он ближе radius пикселей. */
export function nearestPlace(places: Place[], floor: number, x: number, y: number, radius = 60): Place | null {
  let best: Place | null = null;
  let bestD = radius;
  for (const p of places) {
    if (p.floor !== floor || p.kind === "stair") continue;
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { best = p; bestD = d; }
  }
  return best;
}
