// Номера групп прошлого учебного года: по ним расписание отдаёт пересдачи и комиссии.
// Берутся со страниц программ timetable.spbu.ru, раздел «Промежуточная аттестация за предыдущий … уч. год».
// Запуск из корня проекта раз в год, после смены номеров групп: node src/session/build-previous.mjs
import { readFileSync, writeFileSync } from "node:fs";

const SITE = "https://timetable.spbu.ru";
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
writeFileSync(new URL("./previous-groups.json", import.meta.url),
  JSON.stringify({ academicYear, builtAt: now.toISOString(), ids: Object.fromEntries(Object.entries(ids).sort()) }, null, 1) + "\n");
const missing = [...known].filter((name) => !ids[name]);
console.log(`сопоставлено групп: ${Object.keys(ids).length} из ${known.size}; без прошлогоднего номера: ${missing.join(", ")}`);
