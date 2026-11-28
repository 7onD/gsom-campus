// Экран «Сессия». Всё своё: разметка, стили и данные; из приложения берёт только общее состояние.
import { getState, requestRoute, setElective, setTeacher, subscribe, now } from "../store.ts";
import { fetchSession, readCache, reportFailure, type Cached } from "./data.ts";
import { buildPlan, isPast, nextDate, previousCards, seasonWindow, type Card, type SessionEvent, type SessionPlan } from "./model.ts";

const REFRESH_AFTER_MS = 30 * 60 * 1000;
const RETAKES_URL = "https://edu.spbu.ru/uchebnaya-deyatelnost/studentu-slushatelyu/462-gsom.html";
const officialUrl = (groupId: number): string => `https://timetable.spbu.ru/GSOM/StudentGroupEvents/Attestation/${groupId}`;

const dayFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "short" });
const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
const monthFormat = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" });
const savedFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(href: string, text: string): HTMLAnchorElement {
  const node = el("a", "session__link", text);
  node.href = href;
  node.target = "_blank";
  node.rel = "noopener noreferrer";
  return node;
}

function action(text: string, onClick: () => void, className = "session__button"): HTMLButtonElement {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

const timeRange = (e: SessionEvent): string => `${timeFormat.format(new Date(e.start))}–${timeFormat.format(new Date(e.end))}`;

export function createSessionView(root: HTMLElement, hasRoom: (room: string) => boolean, onClose: () => void): { show(): void } {
  const open = new Set<string>(); // раскрытые блоки переживают перерисовку
  let data: Cached | null = null;
  let loadedFor: number | null = null;
  let loading = false;
  let failed = false;
  let request = 0;

  function load(force = false): void {
    const groupId = getState().groupId;
    if (groupId === null) {
      data = null;
      loadedFor = null;
      return;
    }
    // Повторяем при открытии, если копия старая или прошлая попытка не удалась (целиком или только пересдачи).
    const outdated = failed || (data !== null && (data.previousState === "failed" || Date.now() - data.savedAt > REFRESH_AFTER_MS));
    if (!force && loadedFor === groupId && (loading || !outdated)) return;
    const { from, to } = seasonWindow(now());
    if (loadedFor !== groupId) data = readCache(groupId, from);
    loadedFor = groupId;
    loading = true;
    failed = false;
    const id = ++request;
    fetchSession(groupId, from, to, now(), data, (partial) => {
      if (id !== request) return;
      data = partial;
      render();
    })
      .then((fresh) => {
        if (id !== request) return;
        data = fresh;
      })
      .catch(() => {
        if (id !== request) return;
        failed = true;
        reportFailure("current", data !== null);
      })
      .finally(() => {
        if (id !== request) return;
        loading = false;
        render();
      });
  }

  function details(key: string, summary: string, className: string, content: HTMLElement[]): HTMLDetailsElement {
    const node = el("details", className);
    node.open = open.has(key);
    node.addEventListener("toggle", () => (node.open ? open.add(key) : open.delete(key)));
    node.append(el("summary", "session__summary", summary), ...content);
    return node;
  }

  function place(event: SessionEvent): HTMLElement {
    const line = el("div", "session__place");
    const routes = event.cancelled ? [] : event.rooms.filter(hasRoom);
    const text = el("span", "session__place-text", event.rooms.length ? `Ауд. ${event.rooms.join(", ")}` : event.location || "Место не указано");
    const route = (room: string, label: string, className: string): HTMLButtonElement => {
      const node = action(label, () => requestRoute(room, undefined, "session"), className);
      node.setAttribute("aria-label", `Показать на карте аудиторию ${room}`);
      return node;
    };
    if (routes.length < 2) {
      line.append(text, ...routes.map((room) => route(room, "На карте", "session__route")));
      return line;
    }
    // Несколько аудиторий: подпись и ровный ряд одинаковых кнопок с номерами.
    line.classList.add("session__place--several");
    const row = el("div", "session__rooms");
    row.append(...routes.map((room) => route(room, room, "session__route session__route--room")));
    line.append(text, el("span", "session__rooms-label", "Показать на карте:"), row);
    return line;
  }

  function slot(event: SessionEvent, showType: boolean): HTMLElement {
    const over = new Date(event.end).getTime() < now().getTime();
    const node = el("div", `session__slot${over ? " session__slot--over" : ""}`);
    const when = el("div", "session__when");
    when.append(el("strong", "", `${dayFormat.format(new Date(event.start))} · ${timeRange(event)}`));
    if (over) when.append(el("span", "session__flag session__flag--over", "Прошло"));
    if (event.cancelled) when.append(el("span", "session__flag session__flag--cancel", "Отменено"));
    for (const what of event.changed) when.append(el("span", "session__flag", `Изменено: ${what}`));
    // Когда на карточке разные виды (пересдача и комиссия), подписываем каждую дату.
    if (showType) node.append(el("div", "session__slot-type", event.type));
    node.append(when, place(event));
    if (event.educators) node.append(el("div", "session__educators", event.educators));
    return node;
  }

  function extra(event: SessionEvent): HTMLElement {
    const node = el("div", "session__extra");
    node.append(el("strong", "", `${dayFormat.format(new Date(event.start))} · ${timeRange(event)}${event.cancelled ? " · отменено" : ""}`));
    node.append(el("div", "", [event.rooms.length ? `Ауд. ${event.rooms.join(", ")}` : event.location, event.educators].filter(Boolean).join(" · ")));
    return node;
  }

  function card(item: Card): HTMLElement {
    const node = el("article", `session__card${item.retake ? " session__card--retake" : ""}`);
    const head = el("div", "session__card-head");
    for (const type of new Set(item.main.map((e) => e.type))) {
      const kind = item.retake ? "retake" : type.startsWith("экзамен") ? "exam" : "test";
      head.append(el("span", `session__type session__type--${kind}`, type));
    }
    if (item.optionalKind) head.append(el("span", "session__optional", item.optionalKind));
    node.append(head, el("h3", "session__title", item.title));
    if (item.severalDates) {
      node.append(el("p", "session__warning", "Несколько дат или площадок. По расписанию нельзя понять, какая ваша: уточните."));
    }
    const mixed = new Set(item.main.map((e) => e.type)).size > 1;
    for (const event of item.main) node.append(slot(event, mixed));
    if (item.consultations.length) {
      node.append(details(`${item.key}:c`, `Консультации: ${item.consultations.length}`, "session__more", item.consultations.map(extra)));
    }
    if (item.reviews.length) {
      node.append(details(`${item.key}:r`, `Показ работ и результаты: ${item.reviews.length}`, "session__more", item.reviews.map(extra)));
    }
    return node;
  }

  function byMonth(cards: Card[]): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    let month = "";
    const current = now();
    for (const item of [...cards].sort((a, b) => nextDate(a, current).localeCompare(nextDate(b, current)))) {
      const title = monthFormat.format(new Date(nextDate(item, current)));
      if (title !== month) nodes.push(el("h2", "session__month", (month = title)));
      nodes.push(card(item));
    }
    return nodes;
  }

  function disclaimer(groupId: number): HTMLElement {
    const node = el("aside", "session__disclaimer");
    node.append(
      el("p", "", "Вспомогательный инструмент, не официальный источник: возможны ошибки. Всегда проверяйте дату, время и аудиторию сами. Мы не отвечаем за пропущенную аттестацию."),
      link(officialUrl(groupId), "Официальное расписание аттестации ↗"),
    );
    return node;
  }

  function picker(plan: SessionPlan): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    for (const { course, teachers } of plan.needTeacher) {
      const rows = teachers.map((teacher) => action(teacher, () => setTeacher(course, teacher), "session__choice"));
      nodes.push(details(`teacher:${course}`, `${course}: выберите преподавателя, чтобы увидеть аттестацию`, "session__picker session__picker--need",
        rows.length ? rows : [el("p", "session__hint", "Преподаватели не найдены. Проверьте официальное расписание.")]));
    }
    if (plan.options.length) {
      const chosen = plan.options.filter((o) => o.selected).length;
      const rows = plan.options.map((option) => {
        const label = el("label", "session__check");
        const box = el("input");
        box.type = "checkbox";
        box.checked = option.selected;
        box.addEventListener("change", () => setElective(option.key, box.checked));
        label.append(box, el("span", "", `${option.title} · ${option.kind.toLowerCase()}`));
        return label;
      });
      nodes.push(details("options", `Мои элективы и факультативы: выбрано ${chosen} из ${plan.options.length}`, "session__picker",
        [el("p", "session__hint", "Выбор общий с расписанием и настройками. Невыбранные скрыты."), ...rows]));
    }
    return nodes;
  }

  /** Раздел «Пересдачи и комиссии»: нынешние из расписания группы и прошлогодние долги из расписания прошлого года. */
  function retakes(current: Card[], saved: Cached, at: Date): HTMLElement[] {
    const old = previousCards(saved.previous);
    // Прошлогоднюю карточку делим по датам: предстоящие встречи показываем сразу, прошедшие сворачиваем.
    const part = (card: Card, over: boolean): Card | null => {
      const main = card.main.filter((e) => (new Date(e.end).getTime() < at.getTime()) === over);
      return main.length ? { ...card, key: `${card.key}:${over}`, main } : null;
    };
    const pick = (over: boolean): Card[] => old.map((c) => part(c, over)).filter((c): c is Card => c !== null);
    const ahead = [...current, ...pick(false)];
    const behind = pick(true);

    const nodes: HTMLElement[] = [el("h2", "session__section", "Пересдачи и комиссии")];
    const pending = saved.previousState === "loading";
    if (pending) nodes.push(el("p", "session__hint", "Загружаем пересдачи и комиссии за прошлый год…"));
    if (ahead.length) nodes.push(...byMonth(ahead));
    else if (!pending) nodes.push(el("p", "session__empty", "Предстоящих пересдач и комиссий в расписании сейчас не видно. Это не значит, что их не будет: новые появляются позже."));
    if (behind.length) {
      const count = behind.reduce((sum, c) => sum + c.main.length, 0);
      nodes.push(details("previous", `Прошедшие пересдачи и комиссии: ${count}`, "session__past", [
        el("p", "session__hint", "Все пересдачи и комиссии вашей группы за прошлый год по всем предметам, а не только ваши."),
        ...behind.map(card),
      ]));
    }
    if (saved.previousState === "failed") nodes.push(el("p", "session__warning", saved.previous.length
      ? "Прошлогоднее расписание не обновилось: показана сохранённая копия пересдач."
      : "Прошлогоднее расписание не загрузилось, поэтому пересдачи за прошлый год не показаны."));
    if (saved.previousState === "outdated") nodes.push(el("p", "session__warning",
      "Пересдачи за прошлый учебный год пока не подключены: номера групп ещё обновляются. Проверьте официальный раздел ниже."));
    if (saved.previousState === "none") nodes.push(el("p", "session__hint",
      "Прошлогоднего расписания для вашей группы приложение не знает (у первого курса его нет)."));
    const note = el("div", "session__retakes-note");
    note.append(
      el("p", "session__hint", "Список может быть неполным. Кому именно нужно прийти на пересдачу или комиссию, из расписания не видно: проверяйте в личных уведомлениях и учебном отделе."),
      link(RETAKES_URL, "Раздел СПбГУ о пересдачах и комиссиях ↗"),
    );
    nodes.push(note);
    return nodes;
  }

  function header(): HTMLElement {
    const node = el("header", "session__header");
    node.append(action("‹ Настройки", onClose, "session__back"), el("h1", "session__heading", "Сессия"));
    return node;
  }

  function render(): void {
    if (root.hidden) return;
    const state = getState();
    const content = el("div", "session__content");
    content.append(header());
    if (state.groupId === null) {
      content.append(el("p", "session__empty", "Выберите группу, чтобы увидеть свою сессию."), action("Выбрать группу", onClose));
      root.replaceChildren(content);
      return;
    }
    content.append(disclaimer(state.groupId));
    if (!data) {
      content.append(el("p", "session__empty", loading
        ? "Загружаем расписание за семестр. Это может занять до 45 секунд."
        : "Не удалось загрузить сессию. Проверьте сеть."));
      if (!loading) content.append(action("Повторить", () => { load(true); render(); }));
      root.replaceChildren(content);
      return;
    }
    const status = el("div", "session__status");
    status.append(el("span", "", failed
      ? `Не обновилось. Показана копия от ${savedFormat.format(data.savedAt)}.`
      : loading && data.previousState !== "loading" ? `Обновляем… Копия от ${savedFormat.format(data.savedAt)}.` : `Обновлено ${savedFormat.format(data.savedAt)}`));
    if (!loading) status.append(action("Обновить", () => { load(true); render(); }, "session__refresh"));
    content.append(status);

    if (data.carried) content.append(el("p", "session__hint",
      "Новый семестр ещё опубликован не полностью, поэтому вместе с ним показана прошлая сессия."));
    const plan = buildPlan(data, new Set(state.selected));
    content.append(...picker(plan));
    const current = now();
    const upcoming = plan.cards.filter((c) => !isPast(c, current));
    const exams = upcoming.filter((c) => !c.retake);
    const currentRetakes = upcoming.filter((c) => c.retake);
    const past = plan.cards.filter((c) => isPast(c, current));

    if (exams.length) content.append(...byMonth(exams));
    else content.append(el("p", "session__empty", "Предстоящих экзаменов и зачётов не видно: возможно, они ещё не опубликованы или скрыты выбором выше."));
    if (past.length) content.append(details("past", `Прошедшие экзамены и зачёты семестра: ${past.length}`, "session__past", past.reverse().map(card)));
    content.append(...retakes(currentRetakes, data, current));
    root.replaceChildren(content);
  }

  let lastGroup = getState().groupId;
  subscribe(() => {
    if (getState().groupId !== lastGroup) {
      lastGroup = getState().groupId;
      if (!root.hidden) load();
    }
    render();
  });
  window.addEventListener("online", () => {
    if (!root.hidden && failed) { load(true); render(); }
  });

  return {
    show(): void {
      load();
      render();
    },
  };
}
