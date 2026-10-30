import "./map-screen.css";

import { icon } from "../icons.ts";
import { MapView } from "../mapview.ts";
import { simplify } from "../directions.ts";
import { placeLabel, placeSub, searchPlaces, type Place } from "../rooms.ts";
import type { Graph, Route } from "../routing.ts";
import type { MapData, Insets, RouteLeg } from "../map-types.ts";
import {
  getState,
  now,
  onRouteRequest,
  subscribe,
  takePendingRoute,
  visibleLessons,
  type RouteRequest,
} from "../store.ts";
import { pickNextLesson } from "../timetable.ts";
import { openFeedback } from "../feedback.ts";
import { track } from "../telemetry.ts";

const STARTS = [
  { id: "entrance", label: "Главный вход" },
  { id: "hall", label: "Центральный холл" },
  { id: "cafe", label: "Кафе" },
  { id: "1301", label: "Конференц-зал" },
  { id: "dean", label: "Деканат" },
] as const;

let instanceNumber = 0;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function button(className: string, label: string): HTMLButtonElement {
  const result = element("button", className);
  result.type = "button";
  result.setAttribute("aria-label", label);
  return result;
}

function addIcon(target: HTMLElement, name: Parameters<typeof icon>[0], size = 18): void {
  const holder = element("span", "map-screen__icon");
  holder.setAttribute("aria-hidden", "true");
  holder.innerHTML = icon(name, { size });
  target.append(holder);
}

function readStart(places: Map<string, Place>): string {
  try {
    const saved = localStorage.getItem("vsm:start");
    if (saved && STARTS.some((start) => start.id === saved) && places.has(saved)) return saved;
  } catch {
    // Хранилище может быть недоступно.
  }
  return places.has("entrance")
    ? "entrance"
    : STARTS.find((start) => places.has(start.id))?.id ?? "entrance";
}

export function mountMapScreen(
  root: HTMLElement,
  deps: { places: Place[]; graph: Graph; mapData: Record<number, MapData> },
): { destroy(): void } {
  const byId = new Map(deps.places.map((place) => [place.id, place]));
  const uniqueId = `map-screen-${++instanceNumber}`;
  let fromId = readStart(byId);
  let toId: string | null = null;
  let route: Route | null = null;
  let routeSource = "search";
  let helpedKey: string | null = null;
  let destroyed = false;
  let fitFrame = 0;
  let fitFrame2 = 0;
  let blurTimer = 0;

  root.classList.add("map-screen");
  const stage = element("div", "map-screen__stage");
  root.replaceChildren(stage);
  const mapView = new MapView(stage, deps.mapData);

  const top = element("div", "map-screen__top");
  const searchWrap = element("div", "map-screen__search-wrap");
  const searchField = element("div", "map-screen__search");
  addIcon(searchField, "search", 20);
  const input = element("input", "map-screen__input");
  input.type = "search";
  input.placeholder = "Найти аудиторию";
  input.autocomplete = "off";
  input.setAttribute("enterkeyhint", "search");
  input.setAttribute("aria-label", "Найти аудиторию");
  input.setAttribute("aria-controls", `${uniqueId}-suggestions`);
  input.setAttribute("aria-expanded", "false");
  const clear = button("map-screen__clear", "Очистить поиск");
  addIcon(clear, "close", 18);
  clear.hidden = true;
  searchField.append(input, clear);

  const suggestions = element("div", "map-screen__suggestions");
  suggestions.id = `${uniqueId}-suggestions`;
  suggestions.setAttribute("role", "listbox");
  suggestions.setAttribute("aria-label", "Результаты поиска");
  suggestions.hidden = true;
  searchWrap.append(searchField, suggestions);

  const chips = element("div", "map-screen__chips");
  const startChip = button("map-screen__chip", "Выбрать точку старта");
  addIcon(startChip, "pin", 16);
  const startText = element("span");
  startChip.append(startText);
  startChip.setAttribute("aria-expanded", "false");
  startChip.setAttribute("aria-controls", `${uniqueId}-starts`);

  const nextChip = button("map-screen__chip map-screen__chip--next", "Маршрут до ближайшей пары");
  addIcon(nextChip, "cap", 17);
  const nextText = element("span");
  nextChip.append(nextText);
  nextChip.hidden = true;
  chips.append(startChip, nextChip);

  const startMenu = element("div", "map-screen__start-menu");
  startMenu.id = `${uniqueId}-starts`;
  startMenu.setAttribute("role", "group");
  startMenu.setAttribute("aria-label", "Точка старта");
  startMenu.hidden = true;
  top.append(searchWrap, chips, startMenu);

  const controls = element("div", "map-screen__controls");
  const floorPicker = element("div", "map-screen__floors");
  floorPicker.setAttribute("role", "group");
  floorPicker.setAttribute("aria-label", "Этаж карты");
  const floorButtons = [1, 2].map((floor) => {
    const control = button("map-screen__floor", `${floor} этаж`);
    control.textContent = String(floor);
    control.addEventListener("click", () => {
      closeOverlays();
      if (mapView.floorId === floor) fitCurrentLeg();
      else mapView.setFloor(floor);
    });
    floorPicker.append(control);
    return { floor, control };
  });
  floorPicker.append(element("span", "map-screen__floor-caption", "этаж"));

  const fitButton = button("map-screen__fit", "Вписать карту или текущий участок маршрута");
  addIcon(fitButton, "fit", 21);
  fitButton.addEventListener("click", () => {
    closeOverlays();
    if (route?.legs.some((leg) => leg.floor === mapView.floorId)) fitCurrentLeg();
    else {
      updateInsets();
      mapView.fit();
    }
  });
  controls.append(floorPicker, fitButton);

  const card = element("section", "map-screen__route");
  card.setAttribute("aria-label", "Маршрут");
  card.hidden = true;
  root.append(top, controls, card);

  function startLabel(id: string): string {
    return STARTS.find((start) => start.id === id)?.label ?? (byId.get(id) ? placeLabel(byId.get(id)!) : id);
  }

  function destinationLabel(id: string): string {
    const place = byId.get(id);
    return place ? placeLabel(place) : `Аудитория ${id}`;
  }

  function closeOverlays(): void {
    suggestions.hidden = true;
    input.setAttribute("aria-expanded", "false");
    startMenu.hidden = true;
    startChip.setAttribute("aria-expanded", "false");
  }

  function renderStart(): void {
    startText.textContent = `Откуда: ${startLabel(fromId)}`;
    startMenu.replaceChildren();
    for (const start of STARTS) {
      if (!byId.has(start.id)) continue;
      const item = button("map-screen__start-option", start.label);
      item.setAttribute("aria-pressed", String(fromId === start.id));
      const labels = element("span", "map-screen__start-labels");
      labels.append(element("span", "", start.label), element("small", "", `${byId.get(start.id)!.floor} этаж`));
      item.append(labels);
      if (fromId === start.id) addIcon(item, "check", 18);
      item.addEventListener("click", () => {
        fromId = start.id;
        try {
          localStorage.setItem("vsm:start", fromId);
        } catch {
          // Сохранять выбор необязательно для работы маршрута.
        }
        closeOverlays();
        renderStart();
        if (toId) buildRoute();
      });
      startMenu.append(item);
    }
  }

  function renderNext(): void {
    const state = getState();
    const lesson = state.groupId === null ? null : pickNextLesson(visibleLessons(), now());
    const room = lesson?.room;
    const available = room !== null && room !== undefined && byId.has(room);
    nextChip.hidden = !available;
    if (available) {
      nextText.textContent = `Ближайшая пара · ${room}`;
      nextChip.setAttribute("aria-label", `Построить маршрут к ближайшей паре, аудитория ${room}`);
    }
  }

  function renderSuggestions(): void {
    clear.hidden = input.value.length === 0;
    const found = searchPlaces(deps.places, input.value, 7);
    suggestions.replaceChildren();
    for (const place of found) {
      const option = button("map-screen__suggestion", placeLabel(place));
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.append(
        element("span", "map-screen__suggestion-name", placeLabel(place)),
        element("span", "map-screen__suggestion-sub", placeSub(place)),
      );
      option.addEventListener("pointerdown", (event) => event.preventDefault());
      option.addEventListener("click", () => choose(place.id, "search"));
      suggestions.append(option);
    }
    suggestions.hidden = found.length === 0;
    input.setAttribute("aria-expanded", String(found.length > 0));
    if (found.length) {
      startMenu.hidden = true;
      startChip.setAttribute("aria-expanded", "false");
    }
  }

  function updateInsets(): void {
    if (destroyed) return;
    const bounds = root.getBoundingClientRect();
    const topBounds = top.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    const insets: Insets = {
      top: Math.max(0, topBounds.bottom - bounds.top + 8),
      right: card.hidden ? 8 : 64, // без маршрута план вписывается на всю ширину
      bottom: card.hidden
        ? Math.max(0, parseFloat(getComputedStyle(root).getPropertyValue("--content-bottom")) || 100)
        : Math.max(0, bounds.bottom - cardBounds.top + 8),
      left: 8,
    };
    mapView.setInsets(insets);
  }

  function fitCurrentLeg(): void {
    cancelAnimationFrame(fitFrame);
    cancelAnimationFrame(fitFrame2);
    fitFrame = requestAnimationFrame(() => {
      fitFrame2 = requestAnimationFrame(() => {
        if (destroyed) return;
        updateInsets();
        const points = route?.legs
          .filter((leg) => leg.floor === mapView.floorId)
          .flatMap((leg) => leg.points);
        if (!points?.length) return;
        const xs = points.map((point) => point[0]);
        const ys = points.map((point) => point[1]);
        const left = Math.min(...xs);
        const topEdge = Math.min(...ys);
        mapView.fitBounds(
          {
            x: left - 40,
            y: topEdge - 40,
            w: Math.max(...xs) - left + 80,
            h: Math.max(...ys) - topEdge + 80,
          },
          { maxScale: 1.0, paddingPx: 24 },
        );
      });
    });
  }

  function syncFloors(): void {
    for (const { floor, control } of floorButtons) {
      control.setAttribute("aria-pressed", String(floor === mapView.floorId));
    }
    for (const control of card.querySelectorAll<HTMLButtonElement>(".map-screen__leg")) {
      control.setAttribute("aria-pressed", String(Number(control.dataset.floor) === mapView.floorId));
    }
  }

  function renderCard(): void {
    card.replaceChildren();
    card.hidden = toId === null;
    if (toId === null) {
      updateInsets();
      return;
    }

    const head = element("div", "map-screen__route-head");
    const title = element("h2", "map-screen__route-title", `${startLabel(fromId)} → ${destinationLabel(toId)}`);
    const dismiss = button("map-screen__dismiss", "Сбросить маршрут");
    addIcon(dismiss, "close", 19);
    dismiss.addEventListener("click", resetRoute);
    head.append(title, dismiss);
    card.append(head);

    if (!route?.legs.length) {
      card.append(element("p", "map-screen__route-error", fromId === toId ? "Вы уже здесь" : "Маршрут не найден"));
      updateInsets();
      return;
    }

    const legs = route.legs;
    const floors = legs.map((leg) => leg.floor);
    const floorText =
      floors.length > 1
        ? `${floors.join(" → ")} этаж · по лестнице`
        : `${floors[0]} этаж`;
    card.append(element("p", "map-screen__route-meta", floorText));

    if (legs.length > 1) {
      const legPicker = element("div", "map-screen__legs");
      legPicker.setAttribute("role", "group");
      legPicker.setAttribute("aria-label", "Участок маршрута");
      for (const floor of [...new Set(floors)]) {
        const control = button("map-screen__leg", `${floor} этаж маршрута`);
        control.textContent = `${floor} этаж`;
        control.dataset.floor = String(floor);
        control.addEventListener("click", () => {
          if (mapView.floorId === floor) fitCurrentLeg();
          else mapView.setFloor(floor);
        });
        legPicker.append(control);
      }
      card.append(legPicker);
    }

    const report = button("map-screen__report", "Сообщить об ошибке маршрута");
    addIcon(report, "flag", 18);
    report.addEventListener("click", () => {
      track("route_report_open", { from: fromId, to: toId });
      openFeedback({ kind: "map", title: "Сообщить об ошибке маршрута", context: routeContext(floors) });
    });
    head.insertBefore(report, dismiss);
    card.append(buildFeedbackRow(floors));

    const destination = byId.get(toId);
    if (destination?.duplicate) {
      card.append(
        element(
          "p",
          "map-screen__note",
          `На плане этот номер встречается дважды${destination.where ? ` (${destination.where})` : ""}. Показан выбранный вариант.`,
        ),
      );
    }
    if (destination?.approx) {
      card.append(element("p", "map-screen__note", "Положение этой точки определено приблизительно."));
    }
    syncFloors();
    updateInsets();
  }

  function routeContext(floors: number[]): Record<string, string | number | number[]> {
    const path = (route?.legs ?? [])
      .map((leg) => `${leg.floor}:${simplify(leg.points).map((p) => `${Math.round(p[0])},${Math.round(p[1])}`).join(" ")}`)
      .join(" | ")
      .slice(0, 400);
    return { from: fromId, to: toId ?? "", floors, length_px: Math.round(route?.length ?? 0), path };
  }

  function buildFeedbackRow(floors: number[]): HTMLElement {
    const key = `${fromId}>${toId}`;
    const row = element("div", "map-screen__route-feedback");
    if (helpedKey === key) {
      row.append(element("span", "map-screen__route-feedback-text", "Спасибо за ответ!"));
    } else {
      row.append(element("span", "map-screen__route-feedback-text", "Маршрут помог?"));
      const yes = button("map-screen__vote", "Да, маршрут помог");
      yes.textContent = "Да";
      yes.addEventListener("click", () => {
        helpedKey = key;
        track("route_helpful_yes", { from: fromId, to: toId });
        renderCard();
      });
      const no = button("map-screen__vote", "Нет, маршрут не помог");
      no.textContent = "Нет";
      no.addEventListener("click", () => {
        helpedKey = key;
        track("route_helpful_no", { from: fromId, to: toId });
        renderCard();
        openFeedback({ kind: "map", title: "Что не так с маршрутом?", context: routeContext(floors) });
      });
      row.append(yes, no);
    }
    return row;
  }

  function buildRoute(): void {
    if (!toId) return;
    route = deps.graph.route(fromId, toId);
    const source = routeSource;
    routeSource = "restart"; // следующая пересборка (смена старта) — не новый выбор цели
    if (route?.legs.length) {
      track("route_built", {
        source,
        from: fromId,
        to: toId,
        floors: new Set(route.legs.map((leg) => leg.floor)).size,
        length_px: Math.round(route.length),
        stairs: route.stairsUsed.length,
      });
    } else if (fromId !== toId) {
      track("route_failed", { source, from: fromId, to: toId });
    }
    const legs: RouteLeg[] | null = route?.legs.length
      ? route.legs.map((leg) => ({ floor: leg.floor, points: simplify(leg.points) }))
      : null;
    mapView.setRoute(legs);
    mapView.setDestination(byId.has(toId) ? toId : null);
    mapView.setStart(deps.graph.anchorPoint(fromId) ?? null);
    renderCard();
    if (legs?.length) {
      mapView.setFloor(legs[0].floor);
      fitCurrentLeg();
    }
  }

  function choose(id: string, source = "search"): void {
    routeSource = source;
    toId = id;
    input.value = byId.get(id)?.number ?? byId.get(id)?.name ?? id;
    clear.hidden = false;
    closeOverlays();
    input.blur();
    buildRoute();
  }

  function resetRoute(): void {
    toId = null;
    route = null;
    input.value = "";
    clear.hidden = true;
    closeOverlays();
    mapView.setRoute(null);
    mapView.setDestination(null);
    mapView.setStart(null);
    renderCard();
    mapView.fit();
  }

  function handleRequest(request: RouteRequest): void {
    if (request.from && byId.has(request.from)) {
      fromId = request.from;
      renderStart();
    }
    choose(request.room, request.source ?? "schedule");
  }

  function handleRouteEvent(request: RouteRequest): void {
    takePendingRoute();
    handleRequest(request);
  }

  input.addEventListener("input", renderSuggestions);
  input.addEventListener("focus", renderSuggestions);
  input.addEventListener("blur", () => {
    blurTimer = window.setTimeout(() => {
      suggestions.hidden = true;
      input.setAttribute("aria-expanded", "false");
    }, 0);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeOverlays();
      input.blur();
    } else if (event.key === "Enter") {
      const first = searchPlaces(deps.places, input.value, 7)[0];
      if (first) {
        event.preventDefault();
        choose(first.id, "search");
      }
    }
  });
  clear.addEventListener("click", () => {
    input.value = "";
    renderSuggestions();
    input.focus();
  });
  startChip.addEventListener("click", () => {
    const opening = startMenu.hidden;
    closeOverlays();
    if (opening) {
      startMenu.hidden = false;
      startChip.setAttribute("aria-expanded", "true");
    }
  });
  nextChip.addEventListener("click", () => {
    const lesson = pickNextLesson(visibleLessons(), now());
    if (lesson?.room && byId.has(lesson.room)) choose(lesson.room, "nearest_chip");
  });

  mapView.onRoomTap = (roomId) => {
    if (roomId && byId.has(roomId)) choose(roomId, "map_tap");
    else closeOverlays();
  };
  mapView.onFloorChange = () => {
    syncFloors();
    if (route?.legs.some((leg) => leg.floor === mapView.floorId)) fitCurrentLeg();
  };

  const observer = new ResizeObserver(() => updateInsets());
  observer.observe(card);
  observer.observe(top);
  const unsubscribe = subscribe(renderNext);
  const unsubscribeRoutes = onRouteRequest(handleRouteEvent);

  renderStart();
  renderNext();
  syncFloors();
  updateInsets();
  const pending = takePendingRoute();
  if (pending) handleRequest(pending);

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      unsubscribeRoutes();
      observer.disconnect();
      clearTimeout(blurTimer);
      cancelAnimationFrame(fitFrame);
      cancelAnimationFrame(fitFrame2);
      mapView.onFloorChange = undefined;
      mapView.onRoomTap = undefined;
      mapView.destroy();
      root.replaceChildren();
      root.classList.remove("map-screen");
    },
  };
}
