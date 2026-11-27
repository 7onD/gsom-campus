// Функция «Сессия». Подключается одной строкой в main.ts и только при VITE_SESSION=1.
// Живёт пунктом в «Настройках»; сам экран настроек не меняется. Как удалить целиком: см. README.md в этой папке.
import { icon } from "../icons.ts";
import { createSessionView } from "./view.ts";
import "./session.css";

export function mountSession(section: HTMLElement, hasRoom: (room: string) => boolean): void {
  const panel = document.createElement("div");
  panel.className = "session";
  panel.hidden = true;

  function open(on: boolean): void {
    // Экран настроек не пересоздаём: только прячем, пока открыта сессия.
    section.classList.toggle("is-session", on);
    panel.hidden = !on;
    section.scrollTop = 0;
    if (on) view.show();
  }
  const view = createSessionView(panel, hasRoom, () => open(false));

  // Карточка в стиле соседних пунктов настроек.
  const card = document.createElement("section");
  card.className = "settings-view__card settings-view__about session-entry";
  const heading = document.createElement("h2");
  heading.className = "settings-view__section-title";
  heading.textContent = "Сессия";
  const rows = document.createElement("div");
  rows.className = "settings-view__about-rows";
  const row = document.createElement("button");
  row.type = "button";
  row.className = "settings-view__about-row";
  const symbol = document.createElement("span");
  symbol.className = "settings-view__icon";
  symbol.innerHTML = icon("calendar", { size: 20 });
  const label = document.createElement("span");
  label.className = "settings-view__about-label";
  label.textContent = "Экзамены и зачёты";
  const arrow = document.createElement("span");
  arrow.className = "settings-view__arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.innerHTML = icon("chevronRight", { size: 19 });
  row.append(symbol, label, arrow);
  row.addEventListener("click", () => open(true));
  rows.append(row);
  card.append(heading, rows);

  // Сразу после блока «Моя группа» вместе с подписью к нему.
  section.querySelector(".settings-view__note")?.after(card);
  section.append(panel);
}
