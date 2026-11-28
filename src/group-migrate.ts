// Номера групп в расписании меняются каждый учебный год, а названия («24.Б01-вшм») остаются.
// Поэтому вместе с номером запоминаем название и по нему находим новый номер.
import type { Prefs } from "./prefs.ts";

export interface KnownGroup {
  id: number;
  name: string;
}

/**
 * ok — номер действует (название при необходимости дописано); migrated — найден новый номер по названию;
 * unknown — группы с таким номером и названием в списке нет: нужно выбрать заново.
 */
export type GroupStatus = "ok" | "migrated" | "unknown";

export function reconcileGroup(prefs: Prefs, groups: readonly KnownGroup[]): { prefs: Prefs; status: GroupStatus } {
  if (prefs.groupId === null) return { prefs, status: "ok" };
  const current = groups.find((group) => group.id === prefs.groupId);
  if (current) {
    return { prefs: prefs.groupName === current.name ? prefs : { ...prefs, groupName: current.name }, status: "ok" };
  }
  const same = prefs.groupName ? groups.find((group) => group.name === prefs.groupName) : undefined;
  if (!same) return { prefs, status: "unknown" };
  // Выбор элективов и преподавателя хранится по номеру группы: переносим на новый.
  const electives = { ...prefs.electives };
  const old = electives[String(prefs.groupId)];
  if (old && !electives[String(same.id)]) electives[String(same.id)] = [...old];
  return { prefs: { ...prefs, groupId: same.id, electives }, status: "migrated" };
}
