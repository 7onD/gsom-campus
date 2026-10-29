import type { Lesson } from "./timetable.ts";

export type KindKey = "lecture" | "seminar" | "practice" | "optional" | "exam" | "other";

export interface LessonView {
  /** Название предмета без префикса «Электив./Факультатив.» и без типа занятия. */
  title: string;
  /** Тип занятия в нижнем регистре, как в расписании: «лекция», «семинар», «зачёт»… */
  type: string;
  /** Ключ типа для CSS-класса kind-<key>. */
  kind: KindKey;
  /** «Электив» / «Факультатив» или null. */
  optionalKind: "Электив" | "Факультатив" | null;
}

/** Разбор названия пары «<Префикс>. <Предмет>, <тип>» на части для отображения. */
export function lessonView(lesson: Lesson): LessonView {
  let rest = lesson.subject.trim();
  let optionalKind: LessonView["optionalKind"] = null;
  const prefix = /^(Факультатив|Электив)\.\s*/i.exec(rest);
  if (prefix) {
    optionalKind = /^ф/i.test(prefix[1] ?? "") ? "Факультатив" : "Электив";
    rest = rest.slice(prefix[0].length);
  }
  const cut = rest.lastIndexOf(", ");
  const title = (cut < 0 ? rest : rest.slice(0, cut)).trim();
  const type = (cut < 0 ? "" : rest.slice(cut + 2)).trim().toLowerCase();

  let kind: KindKey = "other";
  if (optionalKind) kind = "optional";
  else if (type.startsWith("лекц")) kind = "lecture";
  else if (type.startsWith("семинар")) kind = "seminar";
  else if (type.startsWith("практ") || type.startsWith("лаборатор")) kind = "practice";
  else if (/зач[её]т|экзамен|аттестац|показ/.test(type)) kind = "exam";
  return { title: title || lesson.subject, type, kind, optionalKind };
}
