// Номера групп прошлого учебного года: по ним расписание отдаёт пересдачи и комиссии.
// Берутся со страниц программ timetable.spbu.ru, раздел «Промежуточная аттестация за предыдущий … уч. год».
// Запуск из корня проекта раз в год, после смены номеров групп: node src/session/build-previous.mjs
// Если сайт вернул меньше 80% ожидаемых групп, прежний файл не трогаем и выходим с ошибкой.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Другой адрес задаётся только для репетиции сбоев на локальном стенде.
const SITE = (process.env.SPBU_SITE || "https://timetable.spbu.ru").replace(/\/+$/, "");
const OUTPUT = new URL("./previous-groups.json", import.meta.url);
const { programs } = JSON.parse(readFileSync(new URL("../data/groups.json", import.meta.url), "utf8"));
const known = new Set(programs.flatMap((program) => program.groups.map((group) => group.name)));
const now = new Date();
const academicYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
const label = `${academicYear - 1}-${academicYear}`;

async function text(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { Cookie: "_culture=ru" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

const ids = {};
for (const programId of new Set(programs.map((program) => program.programId))) {
  const page = await text(`${SITE}/GSOM/StudyProgram/${programId}`);
  const start = page.indexOf(`за предыдущий ${label}`);
  if (start < 0) continue; // у первого курса прошлого года нет
  const end = page.indexOf("Текущий", start);
  const section = page.slice(start, end < 0 ? undefined : end);
  for (const [, id] of section.matchAll(/StudentGroupEvents\/Attestation\/(\d+)/g)) {
    // Название группы подтверждаем самим API, а не разметкой страницы.
    const data = JSON.parse(await text(`${SITE}/api/v1/groups/${id}/events`));
    const name = String(data.StudentGroupDisplayName ?? "").match(/\d{2}\.[^\s]*-вшм/)?.[0];
    if (!name || !known.has(name)) continue;
    if (ids[name] && ids[name] !== Number(id)) console.log(`два номера для ${name}: ${ids[name]} и ${id}`);
    ids[name] = Number(id);
  }
}
const sorted = Object.fromEntries(Object.entries(ids).sort());
// Прошлый год есть у всех, кроме первого курса.
const expected = programs.filter((program) => program.admission < academicYear).flatMap((program) => program.groups);
if (!expected.length || Object.keys(sorted).length < expected.length * 0.8) {
  console.log(`ОШИБКА: сопоставлено ${Object.keys(sorted).length} из ${expected.length} групп. Прежний файл не изменён.`);
  process.exit(1);
}
const old = existsSync(OUTPUT) ? JSON.parse(readFileSync(OUTPUT, "utf8")) : null;
if (old && old.academicYear === academicYear && JSON.stringify(old.ids) === JSON.stringify(sorted)) {
  console.log(`Без изменений: ${Object.keys(sorted).length} групп.`);
} else {
  writeFileSync(OUTPUT, JSON.stringify({ academicYear, builtAt: now.toISOString(), ids: sorted }, null, 1) + "\n");
  console.log(`Обновлено: ${Object.keys(sorted).length} из ${expected.length} групп.`);
}
