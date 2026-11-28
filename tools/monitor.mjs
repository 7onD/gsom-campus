// Внешняя проверка сервисов: сайт, расписание, приём отзывов. Запускается по расписанию (.github/workflows/monitor.yml).
// Тревога — после двух неудач подряд одной проверки, затем одно сообщение о восстановлении.
// Отдельно: всплеск ошибок у пользователей за последние полтора часа (если заданы ERRORS_API_URL и ERRORS_API_KEY).
// Код выхода 1 — только когда появилась новая тревога (одно письмо GitHub на поломку) или не ушло сообщение в Telegram.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const env = process.env;
const SITE_URL = env.SITE_URL || "https://7ond.github.io/gsom-campus/";
const TIMETABLE_URL = env.TIMETABLE_URL || "https://timetable.spbu.ru/api/v1";
const HEALTH_URL = env.HEALTH_URL || (env.FEEDBACK_URL ? env.FEEDBACK_URL.replace(/\/feedback\/?$/, "/health") : "");
const TELEGRAM_API = env.TELEGRAM_API || "https://api.telegram.org";
const STATE_FILE = env.STATE_FILE || ".monitor-state.json";
const FAILS_TO_ALERT = 2;
const ERRORS_API_URL = env.ERRORS_API_URL || "";
const ERRORS_API_KEY = env.ERRORS_API_KEY || "";
const WINDOW_MINUTES = 90; // с запасом: запуски по расписанию могут задерживаться
// Тревога, только когда ошибок много и они не с одного устройства (один человек без сети — не поломка).
const ERROR_RULES = {
  schedule_error: { title: "Ошибки расписания у пользователей", count: Number(env.SCHEDULE_ERRORS_MIN) || 6, devices: 3 },
  feedback_error: { title: "Ошибки отправки отзывов у пользователей", count: Number(env.FEEDBACK_ERRORS_MIN) || 3, devices: 2 },
  session_error: { title: "Ошибки загрузки «Сессии» у пользователей", count: 6, devices: 3 },
};
const ERRORS_QUERY = `SELECT event, count(), count(DISTINCT distinct_id), arrayStringConcat(groupUniqArray(toString(properties.reason)), ', ')
FROM events
WHERE event IN ('schedule_error', 'feedback_error', 'session_error') AND timestamp > now() - INTERVAL ${WINDOW_MINUTES} MINUTE
GROUP BY event`;

/** Строки [событие, всего, устройств, причины] за окно. */
async function loadErrorRows() {
  const response = await fetch(ERRORS_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ERRORS_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: ERRORS_QUERY } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`запрос ошибок: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.results)) throw new Error("запрос ошибок: неожиданный ответ");
  return data.results;
}

let errorRows = null; // заполняется проверкой доступа; null — данных нет, отметки тревог не меняются

async function get(url, timeoutMs = 20_000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  return { status: response.status, text: await response.text() };
}

async function expectOk(url, name, timeoutMs) {
  const { status, text } = await get(url, timeoutMs);
  if (status !== 200) throw new Error(`${name}: HTTP ${status}`);
  return text;
}

const checks = {
  "Сайт": async () => {
    const html = await expectOk(SITE_URL, "страница");
    const script = /<script[^>]+src="([^"]+\.js)"/.exec(html)?.[1];
    if (!html.includes('id="app"') || !script) throw new Error("страница не похожа на приложение");
    const code = await expectOk(new URL(script, SITE_URL), "основной скрипт");
    if (code.length < 10_000) throw new Error("основной скрипт подозрительно мал");
    await expectOk(new URL("sw.js", SITE_URL), "офлайн-воркер sw.js");
  },
  "Расписание СПбГУ": async () => {
    const groups = JSON.parse(readFileSync(new URL("../src/data/groups.json", import.meta.url), "utf8"));
    const id = JSON.stringify(groups).match(/"id":(\d+)/)?.[1];
    if (!id) throw new Error("не найден id группы для проверки");
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    const day = (date) => date.toISOString().slice(0, 10);
    // Сервер расписания отвечает медленно: ждём дольше, чем приложение.
    JSON.parse(await expectOk(`${TIMETABLE_URL}/groups/${id}/events/${day(monday)}/${day(sunday)}`, "расписание", 45_000));
  },
  "Приём отзывов": async () => {
    if (!HEALTH_URL) throw new Error("не задан FEEDBACK_URL");
    const { status, text } = await get(HEALTH_URL);
    let health = {};
    try { health = JSON.parse(text); } catch { /* ответ не JSON */ }
    if (status !== 200 || health.ok !== true) {
      const why = health.configured === false ? "не заданы секреты" : health.telegram === false ? "бот недоступен" : `HTTP ${status}`;
      throw new Error(`воркер: ${why}`);
    }
  },
};

// Доступ к данным об ошибках — обычная проверка: сломанный ключ тоже приведёт к тревоге.
if (ERRORS_API_URL && ERRORS_API_KEY) {
  checks["Данные об ошибках"] = async () => {
    errorRows = await loadErrorRows();
  };
} else {
  console.log("Данные об ошибках не настроены: всплески не проверяются");
}

async function notify(text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log("Telegram не настроен: сообщение не отправлено");
    return false;
  }
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok;
  } catch {
    // Текст ошибки не печатаем: в нём может оказаться адрес с токеном.
    return false;
  }
}

let state = {};
try { state = JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { /* первый запуск */ }

const broken = [];
const recovered = [];
const next = {};
await Promise.all(Object.entries(checks).map(async ([name, check]) => {
  const before = state[name] ?? { fails: 0, alerted: false };
  try {
    await check();
    console.log(`OK    ${name}`);
    if (before.alerted) recovered.push(name);
    next[name] = { fails: 0, alerted: false };
  } catch (error) {
    const reason = error?.name === "TimeoutError" ? "нет ответа вовремя"
      : error?.message === "fetch failed" ? "нет соединения"
      : String(error?.message ?? error);
    const fails = before.fails + 1;
    console.log(`FAIL  ${name} (подряд: ${fails}): ${reason}`);
    if (fails >= FAILS_TO_ALERT && !before.alerted) broken.push({ name, reason });
    next[name] = { fails, alerted: before.alerted || fails >= FAILS_TO_ALERT };
  }
}));

// Всплески: тревога сразу (окно уже сглаживает случайности), одно сообщение на эпизод и одно о спаде.
const spikes = [];
const calmed = [];
for (const [event, rule] of Object.entries(ERROR_RULES)) {
  const before = state[event] ?? { alerted: false };
  if (errorRows === null) {
    next[event] = before;
    continue;
  }
  const row = errorRows.find((item) => item[0] === event);
  const count = Number(row?.[1] ?? 0);
  const devices = Number(row?.[2] ?? 0);
  const high = count >= rule.count && devices >= rule.devices;
  // Журналы запусков в публичном репозитории видны всем: цифры уходят только в Telegram.
  console.log(`${high ? "FAIL " : "OK   "} ${rule.title}`);
  if (high && !before.alerted) spikes.push({ event, title: rule.title, count, devices, reasons: String(row[3] ?? "").split(", ").filter((r) => r && r !== "null" && r !== "None").join(", ") });
  // Спад объявляем, когда ошибок стало меньше половины порога, чтобы сообщения не мигали на границе.
  const calm = before.alerted && count < rule.count / 2;
  if (calm) calmed.push({ event, title: rule.title });
  next[event] = { alerted: high || (before.alerted && !calm) };
}

let exitCode = broken.length || spikes.length ? 1 : 0;
if (broken.length || recovered.length || spikes.length || calmed.length) {
  const lines = [
    ...broken.map(({ name, reason }) => `🔴 ${name}: не работает две проверки подряд (${reason})`),
    ...spikes.map(({ title, count, devices, reasons }) =>
      `🟠 ${title}: ${count} за ${WINDOW_MINUTES} мин. на ${devices} устр.${reasons ? ` (причины: ${reasons})` : ""}`),
    ...recovered.map((name) => `🟢 ${name}: снова работает`),
    ...calmed.map(({ title }) => `🟢 ${title}: всплеск прошёл`),
  ];
  if (await notify(`ВШМ.Кампус, проверка сервисов\n${lines.join("\n")}`)) {
    console.log("Сообщение отправлено");
  } else {
    // Не отправилось: оставляем прежние отметки, чтобы повторить в следующий запуск.
    exitCode = 1;
    for (const { name } of broken) next[name].alerted = false;
    for (const name of recovered) next[name].alerted = true;
    for (const { event } of spikes) next[event].alerted = false;
    for (const { event } of calmed) next[event].alerted = true;
  }
}
// Ручной запуск с галочкой: проверяет, что токен и чат из секретов действительно работают.
if (env.TEST_MESSAGE === "true") {
  const summary = Object.keys(checks).map((name) => `${next[name].fails ? "🔴" : "🟢"} ${name}`).join("\n");
  if (await notify(`ВШМ.Кампус: проверка связи, это не тревога\n${summary}`)) {
    console.log("Тестовое сообщение отправлено");
  } else {
    console.log("FAIL  тестовое сообщение не отправлено");
    exitCode = 1;
  }
}
writeFileSync(STATE_FILE, JSON.stringify(next));

// Отметка «проверка по расписанию прошла»: по ней бот показывает, жив ли монитор. Ручные запуски не отмечаются.
// Неудача отметки запуск не роняет: сломанный приём отзывов уже ловит отдельная проверка.
if (env.GITHUB_EVENT_NAME === "schedule" && HEALTH_URL && env.TELEGRAM_BOT_TOKEN) {
  const key = createHash("sha256").update(`vsm-heartbeat|${env.TELEGRAM_BOT_TOKEN}`).digest("hex");
  try {
    const response = await fetch(HEALTH_URL.replace(/\/health$/, "/heartbeat"), {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ problems: Object.keys(checks).some((name) => next[name].fails > 0) }),
      signal: AbortSignal.timeout(15_000),
    });
    console.log(response.ok ? "Отметка о запуске сохранена" : `Отметка о запуске не сохранена: HTTP ${response.status}`);
  } catch {
    console.log("Отметка о запуске не сохранена: нет соединения");
  }
}
process.exitCode = exitCode;
