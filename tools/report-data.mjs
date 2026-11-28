// Итог ежедневной задачи с данными: при проблемах пишет в Telegram, в любом случае оставляет отметку
// приёмнику отзывов, чтобы основная проверка заметила, если задача перестала запускаться.
// Код выхода 1 при проблемах: GitHub тогда пришлёт письмо о неудачном запуске.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const env = process.env;
const TELEGRAM_API = env.TELEGRAM_API || "https://api.telegram.org";
const HEARTBEAT_URL = env.HEARTBEAT_URL || (env.FEEDBACK_URL ? env.FEEDBACK_URL.replace(/\/feedback\/?$/, "/heartbeat") : "");

const STEPS = {
  STEP_GROUPS: "Не обновился список групп (прежний сохранён)",
  STEP_PREVIOUS: "Не обновились прошлогодние номера (прежние сохранены)",
  STEP_VERIFY: "Новые списки не прошли тесты или сборку и не опубликованы",
  STEP_PUBLISH: "Не удалось сохранить или выложить обновление",
};
const problems = Object.entries(STEPS).filter(([key]) => env[key] === "failure").map(([, text]) => text);
if (existsSync("data-problems.json")) problems.push(...JSON.parse(readFileSync("data-problems.json", "utf8")));
else if (env.STEP_CHECK === "failure") problems.push("Проверка данных не выполнилась");

async function post(url, body, headers = {}) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok;
  } catch {
    return false; // текст ошибки не печатаем: в нём может быть адрес с токеном
  }
}

let delivered = true;
if (problems.length && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
  delivered = await post(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: `ВШМ.Кампус, данные расписания · GitHub\n${problems.map((p) => `🟠 ${p}`).join("\n")}\n\nПодробности: GitHub → Actions → Refresh groups.`,
  });
  console.log(delivered ? "Сообщение отправлено" : "Сообщение не отправлено");
}
if (HEARTBEAT_URL && env.TELEGRAM_BOT_TOKEN) {
  const key = createHash("sha256").update(`vsm-heartbeat|${env.TELEGRAM_BOT_TOKEN}`).digest("hex");
  const saved = await post(HEARTBEAT_URL, { job: "data", problems: problems.length > 0 }, { Authorization: `Bearer ${key}` });
  console.log(saved ? "Отметка о запуске сохранена" : "Отметка о запуске не сохранена");
}
console.log(problems.length ? "Есть проблемы" : "Всё в порядке");
process.exitCode = problems.length || !delivered ? 1 : 0;
