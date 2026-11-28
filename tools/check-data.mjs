// Полная ежедневная проверка данных расписания: то, что приложение может показать неправильно,
// даже когда сайт расписания отвечает. Находки пишет в data-problems.json, при них выходит с кодом 1.
// Запуск из корня проекта: node --experimental-strip-types tools/check-data.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const API = (process.env.TIMETABLE_URL || "https://timetable.spbu.ru/api/v1").replace(/\/+$/, "");
const root = new URL("../", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const { toLessons, lessonWindow } = await import(new URL("src/timetable.ts", root));
// Раздел «Сессия» отделяемый: без него проверяется только расписание.
const session = existsSync(new URL("src/session/model.ts", root)) ? await import(new URL("src/session/model.ts", root)) : null;
const previous = session && existsSync(new URL("src/session/previous-groups.json", root)) ? json("src/session/previous-groups.json") : null;

const groups = json("src/data/groups.json").programs.flatMap((program) => program.groups.map((g) => ({ ...g, admission: program.admission })));
const rooms = new Set([...json("src/data/floor1.json").anchors, ...json("src/data/floor2.json").anchors].map((a) => a.id));
const now = process.env.CHECK_NOW ? new Date(process.env.CHECK_NOW) : new Date();
const academicYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
const KNOWN_CLASS = /^(лекция|семинар|практическое занятие|лабораторная работа|сам\. работа|контрольная работа|коллоквиум)/;
const MAIN_BUILDING = /санкт-петербургское шоссе, д\. 109, лит\. а/i;

const unknownTypes = new Set();
const offPlan = new Set();
let requests = 0, failures = 0, broken = 0, noRoom = 0, emptyGroups = 0, mainRoomLessons = 0, retakeGroups = 0, mappedGroups = 0;

async function load(url) {
  requests++;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
      if (response.ok) return await response.json();
    } catch {
      // вторая попытка
    }
  }
  failures++;
  return null;
}

const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const events = (data) => data.Days.flatMap((d) => d.DayStudyEvents);

const queue = [...groups];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const group = queue.shift();
    const { from, to } = lessonWindow(now);
    const data = await load(`${API}/groups/${group.id}/events/${day(from)}/${day(to)}`);
    if (data) {
      try {
        if (!Array.isArray(data.Days)) throw new Error("формат");
        const raw = events(data);
        if (!raw.length) emptyGroups++;
        const lessons = toLessons(data);
        // Событие без названия или даты приложение молча потеряет — это смена формата.
        if (lessons.length !== raw.length || lessons.some((l) => !l.subject || Number.isNaN(+l.start) || Number.isNaN(+l.end))) broken++;
        for (const lesson of lessons) {
          for (const room of lesson.rooms) if (!rooms.has(room)) offPlan.add(room);
          if (MAIN_BUILDING.test(lesson.locationText)) {
            mainRoomLessons++;
            if (!lesson.rooms.length) noRoom++;
          }
          const type = lesson.subject.split(", ").pop().toLowerCase();
          if (session && session.categoryOf(type) === null && !KNOWN_CLASS.test(type)) unknownTypes.add(type.slice(0, 60));
        }
      } catch {
        broken++;
      }
    }
    const oldId = previous && previous.academicYear === academicYear ? previous.ids[group.name] : undefined;
    if (oldId) {
      const past = await load(`${API}/groups/${oldId}/events/${academicYear}-02-01/${academicYear + 1}-02-28`);
      if (past) {
        mappedGroups++;
        try {
          if (session.parseSession(past).events.some((event) => event.category === "retake")) retakeGroups++;
        } catch {
          broken++;
        }
      }
    }
  }
}));

const problems = [];
const month = (now.getMonth() + 1) * 100 + now.getDate();
// Дни, когда занятия точно идут: вне их пустое расписание — каникулы или сессия, а не поломка.
const studyTime = (month >= 915 && month <= 1220) || (month >= 301 && month <= 515);
if (failures > requests * 0.2) problems.push("Расписание не отвечает на заметную часть запросов");
if (broken) problems.push("Изменился формат ответа расписания: часть событий не разбирается");
if (unknownTypes.size) problems.push(`Новый тип события, приложение его не понимает: ${[...unknownTypes].slice(0, 5).join("; ")}`);
if (offPlan.size) problems.push(`Аудитории из расписания, которых нет на плане: ${[...offPlan].slice(0, 8).join(", ")}`);
if (mainRoomLessons && noRoom > mainRoomLessons * 0.1) problems.push("Приложение перестало распознавать номера аудиторий в адресе главного корпуса");
if (studyTime && emptyGroups > groups.length * 0.8) problems.push("В учебное время расписание пустое почти у всех групп");
if (session) {
  const settled = now >= new Date(academicYear, 8, 15);
  if (previous && previous.academicYear !== academicYear && settled) problems.push("Список прошлогодних номеров относится к прошлому учебному году");
  // В сентябре пересдач за прошлый год может ещё не быть.
  if (mappedGroups && !retakeGroups && now.getMonth() !== 8) problems.push("Прошлогодние пересдачи и комиссии не отдаются ни для одной группы");
}
// У групп первого набора и старше список мог не обновиться после смены года.
if (!groups.some((group) => group.admission === academicYear) && now >= new Date(academicYear, 8, 15)) {
  problems.push("В списке нет групп нового набора: список групп не обновился");
}

console.log(`проверено групп: ${groups.length}`);
console.log(problems.length ? problems.map((p) => `ПРОБЛЕМА: ${p}`).join("\n") : "Проблем не найдено");
writeFileSync(new URL("data-problems.json", root), JSON.stringify(problems));
process.exitCode = problems.length ? 1 : 0;
