import "./styles/tokens.css";
import "./styles/base.css";
import floor1 from "./data/floor1.json";
import floor2 from "./data/floor2.json";
import stairLinks from "./data/stairs.json";
import groupsSnapshot from "./data/groups.json";
import map1 from "./data/map1.json";
import map2 from "./data/map2.json";
import { Graph, type PlanData } from "./routing.ts";
import type { Place } from "./rooms.ts";
import type { MapData } from "./map-types.ts";
import { APP_VERSION, EVENTS_HOST, EVENTS_KEY } from "./config.ts";
import { getState, reload, subscribe, TABS, type Tab } from "./store.ts";
import { initTelemetry, setContext, track } from "./telemetry.ts";
import { mountTabBar } from "./tabbar.ts";
import { mountScheduleView } from "./views/schedule-view.ts";
import { mountMapScreen } from "./views/map-screen.ts";
import { mountSettingsView } from "./views/settings-view.ts";

// ---- служебные события: запуск до остального, чтобы поймать и ошибки инициализации
initTelemetry({ key: EVENTS_KEY, host: EVENTS_HOST, appVersion: APP_VERSION });
setContext("tab", getState().tab);
track("app_open", { has_group: getState().groupId !== null, tab: getState().tab });

// ---- данные здания: якоря и коридоры для маршрутизации + векторные планы этажей
type FloorData = { corridors: PlanData["corridors"]; anchors: Place[] };
const floors = [floor1, floor2] as unknown as FloorData[];
const places = floors.flatMap((f) => f.anchors);
const graph = new Graph({
  corridors: floors.flatMap((f) => f.corridors),
  anchors: places,
  stairs: stairLinks,
});
const roomIds = new Set(places.map((p) => p.id));
const mapData: Record<number, MapData> = {
  1: map1 as unknown as MapData,
  2: map2 as unknown as MapData,
};

// ---- экраны вкладок
const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const views: Record<Tab, HTMLElement> = {
  schedule: el("view-schedule"),
  map: el("view-map"),
  settings: el("view-settings"),
};

function syncViews(): void {
  const active = getState().tab;
  for (const tab of TABS) {
    const on = tab === active;
    views[tab].dataset.active = String(on);
    views[tab].setAttribute("aria-hidden", String(!on));
  }
}
subscribe(syncViews);
syncViews();

mountScheduleView(views.schedule, { hasRoom: (room) => roomIds.has(room) });
mountMapScreen(views.map, { places, graph, mapData });
mountSettingsView(views.settings, { groups: groupsSnapshot });
mountTabBar(el("tabbar"));

// загрузка расписания сохранённой группы
reload();
