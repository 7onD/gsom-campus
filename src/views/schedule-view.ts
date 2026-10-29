import "./schedule-view.css";

import { icon } from "../icons.ts";
import { lessonView } from "../lesson-kind.ts";
import {
  courseNeedsTeacher,
  getState,
  goTab,
  now,
  reload,
  requestRoute,
  subscribe,
  visibleLessons,
} from "../store.ts";
import { lessonsOfDay, mondayOf, type Lesson } from "../timetable.ts";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DAY_COUNT = 28;

const timeFormat = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});
const weekdayFormat = new Intl.DateTimeFormat("ru-RU", {
  weekday: "long",
});

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label: string): HTMLButtonElement {
  const node = element("button", className);
  node.type = "button";
  node.setAttribute("aria-label", label);
  return node;
}

function addIcon(parent: HTMLElement, name: Parameters<typeof icon>[0], size = 18): void {
  const graphic = element("span", "schedule-view__icon");
  graphic.setAttribute("aria-hidden", "true");
  graphic.innerHTML = icon(name, { size });
  parent.append(graphic);
}

function localDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dayOffset(day: Date, monday: Date): number {
  const a = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const b = Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate());
  return Math.round((a - b) / 86_400_000);
}

function dayTitle(day: Date, current: Date): string {
  if (sameDay(day, current)) return "Сегодня";
  if (sameDay(day, addDays(current, 1))) return "Завтра";
  if (sameDay(day, addDays(current, -1))) return "Вчера";
  const weekday = weekdayFormat.format(day);
  return weekday.charAt(0).toUpperCase() + weekday.slice(1);
}

function roomsOf(lesson: Lesson): string[] {
  const rooms = lesson.rooms.length ? lesson.rooms : lesson.room ? [lesson.room] : [];
  return [...new Set(rooms.filter(Boolean))];
}

function shortSubject(lesson: Lesson): string {
  return lessonView(lesson).title;
}

export function mountScheduleView(
  root: HTMLElement,
  deps: { hasRoom(room: string): boolean },
): { destroy(): void } {
  const view = element("div", "schedule-view");
  root.append(view);

  let selectedDay = localDay(now());
  let previousListKey = "";
  let touchStart: { x: number; y: number } | null = null;
  let destroyed = false;

  function changeDay(day: Date): void {
    const start = localDay(mondayOf(now()));
    if (dayOffset(day, start) < 0 || dayOffset(day, start) >= DAY_COUNT) return;
    selectedDay = localDay(day);
    render();
    root.scrollTop = 0;
  }

  function lessonCard(lesson: Lesson, current: Date, animate: boolean, index: number): HTMLElement {
    const details = lessonView(lesson);
    const ongoing = !lesson.cancelled
      && lesson.start.getTime() <= current.getTime()
      && current.getTime() < lesson.end.getTime();
    const past = !lesson.cancelled && !ongoing
      && sameDay(selectedDay, current)
      && lesson.end.getTime() <= current.getTime();
    const rooms = roomsOf(lesson);
    // Несколько аудиторий у одной пары: показываем списком, без кнопки маршрута (ищут на карте сами).
    const available = lesson.cancelled || rooms.length !== 1 ? [] : rooms.filter(deps.hasRoom);

    const card = element("article", `schedule-view__card kind-${details.kind}`);
    if (ongoing) card.classList.add("schedule-view__card--ongoing");
    if (past) card.classList.add("schedule-view__card--past");
    if (lesson.cancelled) card.classList.add("schedule-view__card--cancelled");
    if (animate) {
      card.classList.add("schedule-view__card--entering");
      card.style.setProperty("--sv-card-index", String(Math.min(index, 12)));
    }

    if (available.length === 1) {
      const overlay = button(
        "schedule-view__card-overlay",
        `Открыть маршрут до аудитории ${available[0]}: ${details.title}`,
      );
      overlay.dataset.svFocus = `card:${lesson.id}`;
      overlay.addEventListener("click", () => requestRoute(available[0]));
      card.append(overlay);
    }

    const body = element("div", "schedule-view__card-body");
    const top = element("div", "schedule-view__card-top");
    top.append(element(
      "span",
      "schedule-view__time",
      `${timeFormat.format(lesson.start)}–${timeFormat.format(lesson.end)}`,
    ));

    if (ongoing) {
      const badge = element("span", "schedule-view__badge schedule-view__badge--ongoing");
      badge.append(element("span", "schedule-view__pulse-dot"), document.createTextNode("Идёт сейчас"));
      top.append(badge);
    } else if (lesson.cancelled) {
      top.append(element("span", "schedule-view__badge schedule-view__badge--cancelled", "Отменена"));
    }

    body.append(top, element("h2", "schedule-view__subject", details.title));

    const meta = element("div", "schedule-view__meta");
    if (details.optionalKind) {
      meta.append(element("span", "schedule-view__kind", details.optionalKind));
    }
    if (details.type) {
      meta.append(element("span", "schedule-view__kind", details.type));
    }
    if (lesson.educators) {
      meta.append(element("span", "schedule-view__educators", lesson.educators));
    }
    if (meta.childNodes.length) body.append(meta);

    const bottom = element("div", "schedule-view__card-bottom");
    const location = element("div", "schedule-view__location");
    if (rooms.length) {
      const roomLine = element("span", "schedule-view__room-line");
      addIcon(roomLine, "pin", 17);
      roomLine.append(element("span", "", `Ауд. ${rooms.join(", ")}`));
      location.append(roomLine);
    } else if (lesson.locationText) {
      location.append(element("span", "schedule-view__location-detail", lesson.locationText));
    }
    if (location.childNodes.length) bottom.append(location);

    if (!lesson.cancelled) {
      if (available.length) {
        const actions = element("div", "schedule-view__routes");
        for (const room of available) {
          const route = button(
            `schedule-view__route${ongoing ? " schedule-view__route--ongoing" : ""}`,
            `Показать на карте маршрут до аудитории ${room}`,
          );
          route.dataset.svFocus = `route:${lesson.id}:${room}`;
          addIcon(route, "navigate", 16);
          route.append(element("span", "", "На карте"));
          route.addEventListener("click", (event) => {
            event.stopPropagation();
            requestRoute(room);
          });
          actions.append(route);
        }
        bottom.append(actions);
      }
      if (!rooms.length) {
        bottom.append(element("span", "schedule-view__route-note", "Онлайн или другой адрес"));
      } else if (rooms.length === 1 && available.length === 0) {
        bottom.append(element("span", "schedule-view__route-note", "Аудитории нет на плане"));
      }
    }

    if (bottom.childNodes.length) body.append(bottom);

    if (ongoing) {
      const elapsed = current.getTime() - lesson.start.getTime();
      const duration = lesson.end.getTime() - lesson.start.getTime();
      const fraction = duration > 0 ? Math.max(0, Math.min(100, elapsed / duration * 100)) : 0;
      const remaining = Math.max(1, Math.ceil((lesson.end.getTime() - current.getTime()) / 60_000));

      const progress = element("div", "schedule-view__progress");
      progress.append(element("span", "schedule-view__remaining", `осталось ${remaining} мин`));
      const track = element("span", "schedule-view__progress-track");
      const fill = element("span", "schedule-view__progress-fill");
      fill.style.width = `${fraction}%`;
      track.append(fill);
      progress.append(track);
      body.append(progress);
    }

    card.append(body);
    return card;
  }

  function statusCard(
    title: string,
    description: string,
    actionLabel: string,
    action: () => void,
    actionIcon?: Parameters<typeof icon>[0],
  ): HTMLElement {
    const card = element("section", "schedule-view__status-card");
    card.append(
      element("h2", "schedule-view__status-title", title),
      element("p", "schedule-view__status-description", description),
    );
    const actionButton = button("schedule-view__primary-action", actionLabel);
    actionButton.dataset.svFocus = `action:${actionLabel}`;
    if (actionIcon) addIcon(actionButton, actionIcon);
    actionButton.append(element("span", "", actionLabel));
    actionButton.addEventListener("click", action);
    card.append(actionButton);
    return card;
  }

  function render(): void {
    if (destroyed) return;

    const state = getState();
    const current = now();
    const windowStart = localDay(mondayOf(current));
    const offset = dayOffset(selectedDay, windowStart);
    if (offset < 0 || offset >= DAY_COUNT) selectedDay = localDay(current);

    const visible = visibleLessons();
    const dayLessons = lessonsOfDay(visible, selectedDay)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    const listKey = `${state.groupId}:${selectedDay.getTime()}:${dayLessons.map(
      (lesson) => `${lesson.id}:${lesson.cancelled}`,
    ).join("|")}`;
    const animate = listKey !== previousListKey;
    previousListKey = listKey;

    const active = document.activeElement;
    const focusedKey = active instanceof HTMLElement && view.contains(active)
      ? active.dataset.svFocus
      : undefined;

    const content = element("div", "schedule-view__content");
    const header = element("header", "schedule-view__header");
    header.append(element("span", "schedule-view__brand", "ВШМ.Кампус"));

    const headingRow = element("div", "schedule-view__heading-row");
    const headingText = element("div", "schedule-view__heading-text");
    headingText.append(
      element("h1", "schedule-view__heading", dayTitle(selectedDay, current)),
      element("p", "schedule-view__date", dateFormat.format(selectedDay)),
    );
    headingRow.append(headingText);
    if (!sameDay(selectedDay, current)) {
      const today = button("schedule-view__today-button", "К сегодняшнему дню");
      today.dataset.svFocus = "today";
      today.title = "К сегодняшнему дню";
      addIcon(today, "calendar", 21);
      today.addEventListener("click", () => changeDay(current));
      headingRow.append(today);
    }
    header.append(headingRow);

    if (state.groupId !== null && state.lessons && state.loading) {
      header.append(element("span", "schedule-view__update", "Обновляем…"));
    } else if (state.groupId !== null && state.lessons && state.error) {
      const retry = button("schedule-view__update schedule-view__update--button", "Повторить обновление расписания");
      retry.dataset.svFocus = "update";
      retry.textContent = "Не удалось обновить · Повторить";
      retry.addEventListener("click", reload);
      header.append(retry);
    }
    content.append(header);

    const calendar = element("nav", "schedule-view__calendar");
    calendar.setAttribute("aria-label", "Выбор дня расписания");

    const previous = button("schedule-view__week-arrow", "Предыдущая неделя");
    previous.dataset.svFocus = "previous-week";
    previous.disabled = dayOffset(selectedDay, windowStart) < 7;
    addIcon(previous, "chevronLeft", 20);
    previous.addEventListener("click", () => changeDay(addDays(selectedDay, -7)));
    calendar.append(previous);

    const weekTrack = element("div", "schedule-view__week-track");
    const week = element("div", "schedule-view__week");
    const weekStart = localDay(mondayOf(selectedDay));
    const selectedIndex = dayOffset(selectedDay, weekStart);
    const daysWithLessons = new Set(
      visible.map((lesson) => dayOffset(lesson.start, windowStart)),
    );

    for (let index = 0; index < 7; index++) {
      const day = addDays(weekStart, index);
      const selected = sameDay(day, selectedDay);
      const today = sameDay(day, current);
      const pill = button(
        `schedule-view__day${selected ? " schedule-view__day--selected" : ""}${today ? " schedule-view__day--today" : ""}`,
        `${weekdayFormat.format(day)}, ${dateFormat.format(day)}${today ? ", сегодня" : ""}`,
      );
      pill.dataset.svFocus = `day:${index}`;
      pill.setAttribute("aria-current", selected ? "date" : "false");
      pill.append(
        element("span", "schedule-view__day-name", WEEKDAYS[index]),
        element("span", "schedule-view__day-number", String(day.getDate())),
      );
      if (daysWithLessons.has(dayOffset(day, windowStart))) {
        pill.append(element("span", "schedule-view__day-dot"));
      }
      pill.addEventListener("click", () => changeDay(day));
      week.append(pill);
    }
    weekTrack.append(week);
    calendar.append(weekTrack);

    const next = button("schedule-view__week-arrow", "Следующая неделя");
    next.dataset.svFocus = "next-week";
    next.disabled = dayOffset(selectedDay, windowStart) >= DAY_COUNT - 7;
    addIcon(next, "chevronRight", 20);
    next.addEventListener("click", () => changeDay(addDays(selectedDay, 7)));
    calendar.append(next);
    content.append(calendar);

    if (state.groupId !== null && sameDay(selectedDay, current)) {
      const todayLessons = lessonsOfDay(visible, current).filter((lesson) => !lesson.cancelled);
      const ongoing = todayLessons.find(
        (lesson) => lesson.start.getTime() <= current.getTime()
          && current.getTime() < lesson.end.getTime(),
      );
      const upcoming = todayLessons.find(
        (lesson) => lesson.start.getTime() > current.getTime(),
      );
      let hint = "На сегодня всё";
      if (ongoing) {
        hint = `Идёт: ${shortSubject(ongoing)}`;
      } else if (upcoming) {
        const rooms = roomsOf(upcoming).join(", ");
        hint = `Следующая пара в ${timeFormat.format(upcoming.start)}${rooms ? ` · Ауд. ${rooms}` : ""}`;
      }
      content.append(element("p", "schedule-view__hint", hint));
    }

    if (state.groupId !== null && state.lessons !== null) {
      const needTeacher = courseNeedsTeacher();
      if (needTeacher.length) {
        content.append(statusCard(
          `Выберите преподавателя: ${needTeacher.map((course) => course.name.toLocaleLowerCase("ru")).join(", ")}`,
          "Предмет обязателен, но потоки ведут разные преподаватели. Пока выбора нет, его пары скрыты.",
          "Выбрать преподавателя",
          () => goTab("settings"),
        ));
      }
    }

    if (state.groupId === null) {
      content.append(statusCard(
        "Выберите группу",
        "Покажем расписание и ближайшую пару.",
        "Выбрать группу",
        () => goTab("settings"),
      ));
    } else if (state.lessons === null && state.error) {
      content.append(statusCard(
        "Расписание сейчас недоступно",
        "Поиск по номеру аудитории на карте работает.",
        "Повторить",
        reload,
        "refresh",
      ));
    } else if (state.lessons === null) {
      const loading = element("div", "schedule-view__skeletons");
      loading.setAttribute("role", "status");
      loading.setAttribute("aria-label", "Загрузка расписания");
      loading.setAttribute("aria-busy", "true");
      for (let index = 0; index < 3; index++) {
        const skeleton = element("div", "schedule-view__skeleton");
        skeleton.setAttribute("aria-hidden", "true");
        skeleton.append(
          element("span", "schedule-view__skeleton-line schedule-view__skeleton-line--time"),
          element("span", "schedule-view__skeleton-line schedule-view__skeleton-line--title"),
          element("span", "schedule-view__skeleton-line schedule-view__skeleton-line--meta"),
          element("span", "schedule-view__skeleton-line schedule-view__skeleton-line--room"),
        );
        loading.append(skeleton);
      }
      content.append(loading);
    } else {
      const list = element("section", "schedule-view__list");
      list.setAttribute("aria-label", `Пары на ${dateFormat.format(selectedDay)}`);

      if (dayLessons.length) {
        dayLessons.forEach((lesson, index) => list.append(lessonCard(lesson, current, animate, index)));
      } else {
        const empty = element("div", "schedule-view__empty");
        const circle = element("span", "schedule-view__empty-icon");
        addIcon(circle, "calendarX", 26);
        empty.append(circle, element("h2", "schedule-view__empty-title", "В этот день пар нет"));

        const shown = new Set(visible);
        const hiddenCount = lessonsOfDay(state.lessons, selectedDay)
          .filter((lesson) => lesson.optional !== null && !shown.has(lesson)).length;
        if (hiddenCount > 0) {
          const configure = button(
            "schedule-view__empty-link",
            `Скрыто пар по выбору: ${hiddenCount} — настроить`,
          );
          configure.dataset.svFocus = "configure-optionals";
          configure.textContent = `Скрыто пар по выбору: ${hiddenCount} — настроить`;
          addIcon(configure, "chevronRight", 17);
          configure.addEventListener("click", () => goTab("settings"));
          empty.append(configure);
        }
        list.append(empty);
      }
      content.append(list);
    }

    view.replaceChildren(content);

    if (focusedKey) {
      const replacement = [...view.querySelectorAll<HTMLElement>("[data-sv-focus]")]
        .find((node) => node.dataset.svFocus === focusedKey);
      replacement?.focus({ preventScroll: true });
    }
    const selectedPill = week.children.item(selectedIndex);
    if (selectedPill instanceof HTMLElement) {
      weekTrack.scrollLeft = selectedPill.offsetLeft
        - weekTrack.offsetLeft
        - (weekTrack.clientWidth - selectedPill.offsetWidth) / 2;
    }
  }

  function onTouchStart(event: TouchEvent): void {
    if (!(event.target instanceof Element) || !event.target.closest(".schedule-view__list")) return;
    const touch = event.touches[0];
    if (event.touches.length !== 1 || !touch) return;
    touchStart = { x: touch.clientX, y: touch.clientY };
  }

  function onTouchEnd(event: TouchEvent): void {
    const start = touchStart;
    touchStart = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
    changeDay(addDays(selectedDay, dx < 0 ? 1 : -1));
  }

  view.addEventListener("touchstart", onTouchStart, { passive: true });
  view.addEventListener("touchend", onTouchEnd, { passive: true });
  view.addEventListener("touchcancel", () => { touchStart = null; }, { passive: true });

  const unsubscribe = subscribe(render);
  const timer = window.setInterval(render, 60_000);
  render();

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      window.clearInterval(timer);
      view.remove();
    },
  };
}
