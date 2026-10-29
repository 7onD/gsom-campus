import "./mapview.css";
import type { Insets, MapData, MapIcon, MapRoom, RouteLeg } from "./map-types.ts";

const NS = "http://www.w3.org/2000/svg";

type PointerPosition = {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  x: number;
  y: number;
  moved: boolean;
};
type Pinch = { x: number; y: number; distance: number };
type Rect = { x: number; y: number; w: number; h: number };
type TextEntry = {
  element: SVGTextElement;
  px: number;
  room?: MapRoom;
  width?: number;
  threshold?: number;
};
type IconEntry = { element: SVGGElement; icon: MapIcon };

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function safeKind(value: string): string {
  return /^[a-z0-9-]+$/.test(value) ? value : "room";
}

function validPoint(point: [number, number]): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function simplify(points: [number, number][]): [number, number][] {
  const result: [number, number][] = [];
  for (const point of points) {
    if (!validPoint(point)) continue;
    const last = result[result.length - 1];
    if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.001) continue;
    result.push(point);

    while (result.length >= 3) {
      const c = result[result.length - 1];
      const b = result[result.length - 2];
      const a = result[result.length - 3];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const bcx = c[0] - b[0];
      const bcy = c[1] - b[1];
      const cross = Math.abs(abx * bcy - aby * bcx);
      const tolerance = 0.0001 * Math.hypot(abx, aby) * Math.hypot(bcx, bcy);
      if (cross > tolerance || abx * bcx + aby * bcy < 0) break;
      result.splice(result.length - 2, 1);
    }
  }
  return result;
}

function glyph(type: MapIcon["t"]): SVGGElement {
  const group = svgElement("g", { class: "mv-glyph", transform: "translate(-12 -12)" });
  const path = (d: string): void => {
    group.append(svgElement("path", { d }));
  };
  const circle = (cx: number, cy: number, r: number): void => {
    group.append(svgElement("circle", { cx, cy, r }));
  };

  switch (type) {
    case "stairs":
      path("M3 19h5v-4h5v-4h5V7h3M3 21h7v-4h5v-4h6");
      break;
    case "wc":
      circle(7, 5, 2);
      circle(17, 5, 2);
      path("M7 9v7m-3-4 3-3 3 3m-3 4-2 5m2-5 2 5M17 9l-4 9h8l-4-9Zm0 9v3");
      break;
    case "hanger":
      path("M10 7a2 2 0 1 1 3 1.7L12 11 3 18a1.5 1.5 0 0 0 1 2h16a1.5 1.5 0 0 0 1-2l-9-7");
      break;
    case "cafe":
      path("M5 10h12v5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5v-5Zm12 1h2a2 2 0 0 1 0 4h-2M8 3c-2 2 2 3 0 5m5-5c-2 2 2 3 0 5");
      break;
    case "atm":
      group.append(svgElement("rect", { x: 4, y: 2, width: 16, height: 20, rx: 2 }));
      group.append(svgElement("rect", { x: 7, y: 5, width: 10, height: 7, rx: 1 }));
      path("M8 16h8m-7 3h6");
      break;
    case "entrance":
      path("M12 20V5m-5 5 5-5 5 5M4 15v6h16v-6");
      break;
  }
  return group;
}

export class MapView {
  onFloorChange?: (id: number) => void;
  onRoomTap?: (roomId: string | null, planX: number, planY: number) => void;

  private readonly container: HTMLElement;
  private readonly floors: Record<number, MapData>;
  private readonly floorIds: number[];
  private readonly svg: SVGSVGElement;
  private readonly content: SVGGElement;
  private readonly observer: ResizeObserver;
  private readonly originalTouchAction: string;
  private readonly pointers = new Map<number, PointerPosition>();
  private readonly roomPaths = new Map<string, SVGPathElement[]>();
  private readonly texts: TextEntry[] = [];
  private readonly icons: IconEntry[] = [];

  private currentFloor: number;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private scale = 1;
  private translateX = 0;
  private translateY = 0;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private userMoved = false;
  private gestureBlocked = false;
  private pinch: Pinch | null = null;
  private lastTap: { x: number; y: number; time: number; type: string } | null = null;
  private tapTimer: ReturnType<typeof setTimeout> | null = null;
  private animationFrame = 0;
  private textFrame = 0;
  private destroyed = false;

  private route: RouteLeg[] | null = null;
  private destination: string | null = null;
  private start: { floor: number; x: number; y: number } | null = null;
  private routeLayer!: SVGGElement;
  private markerLayer!: SVGGElement;

  constructor(container: HTMLElement, floors: Record<number, MapData>) {
    this.floorIds = Object.keys(floors).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (this.floorIds.length === 0) throw new Error("MapView requires at least one floor.");

    this.container = container;
    this.floors = floors;
    this.currentFloor = this.floorIds[0];
    this.originalTouchAction = container.style.touchAction;

    this.svg = svgElement("svg", {
      class: "mv-svg",
      role: "img",
      "aria-label": "Интерактивный план здания. Перетаскивайте для перемещения, сведите пальцы для изменения масштаба.",
    });
    this.content = svgElement("g", { class: "mv-content" });
    this.svg.append(this.content);
    container.classList.add("mapview");
    container.style.touchAction = "none";
    container.append(this.svg);

    this.buildFloor();
    this.svg.addEventListener("pointerdown", this.handlePointerDown);
    this.svg.addEventListener("pointermove", this.handlePointerMove);
    this.svg.addEventListener("pointerup", this.handlePointerUp);
    this.svg.addEventListener("pointercancel", this.handlePointerCancel);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerCancel);
    this.svg.addEventListener("lostpointercapture", this.handlePointerCancel);
    this.svg.addEventListener("wheel", this.handleWheel, { passive: false });

    this.observer = new ResizeObserver(() => this.handleResize());
    this.observer.observe(container);
    this.handleResize();
  }

  get floorId(): number {
    return this.currentFloor;
  }

  setFloor(id: number): void {
    if (!Object.prototype.hasOwnProperty.call(this.floors, id)) {
      throw new RangeError(`Unknown floor: ${id}`);
    }
    if (id === this.currentFloor) return;

    this.cancelAnimation();
    this.cancelTap();
    this.lastTap = null;
    this.currentFloor = id;
    this.buildFloor();
    this.fit();
    this.onFloorChange?.(id);
  }

  setInsets(insets: Insets): void {
    const old = this.freeRect();
    const centerX = (old.x + old.w / 2 - this.translateX) / this.scale;
    const centerY = (old.y + old.h / 2 - this.translateY) / this.scale;
    const clean = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
    this.insets = {
      top: clean(insets.top),
      right: clean(insets.right),
      bottom: clean(insets.bottom),
      left: clean(insets.left),
    };
    this.cancelAnimation();
    if (!this.userMoved) {
      this.fit();
    } else {
      const next = this.freeRect();
      this.scale = this.limitScale(this.scale);
      this.translateX = next.x + next.w / 2 - centerX * this.scale;
      this.translateY = next.y + next.h / 2 - centerY * this.scale;
      this.render();
    }
  }

  fit(): void {
    this.cancelAnimation();
    this.userMoved = false;
    if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return;

    const focus = this.data().focus;
    if (focus.w <= 0 || focus.h <= 0) return;
    const free = this.freeRect();
    this.scale = Math.min(6, this.fitScale());
    this.translateX = free.x + (free.w - focus.w * this.scale) / 2 - focus.x * this.scale;
    this.translateY = free.y + (free.h - focus.h * this.scale) / 2 - focus.y * this.scale;
    this.render();
  }

  fitBounds(
    bounds: Rect,
    opts: { maxScale?: number; minScale?: number; paddingPx?: number; animate?: boolean } = {},
  ): void {
    if (
      this.viewportWidth <= 0 || this.viewportHeight <= 0 ||
      ![bounds.x, bounds.y, bounds.w, bounds.h].every(Number.isFinite) ||
      bounds.w <= 0 || bounds.h <= 0
    ) return;

    const free = this.freeRect();
    const padding = Math.max(0, Number.isFinite(opts.paddingPx) ? opts.paddingPx! : 28);
    const availableW = Math.max(1, free.w - padding * 2);
    const availableH = Math.max(1, free.h - padding * 2);
    const minimum = Math.min(6, Math.max(this.minimumScale(), opts.minScale ?? 0));
    const maximum = Math.max(minimum, Math.min(6, opts.maxScale ?? 1.6));
    const targetScale = Math.max(
      minimum,
      Math.min(maximum, availableW / bounds.w, availableH / bounds.h),
    );
    const targetX = free.x + free.w / 2 - (bounds.x + bounds.w / 2) * targetScale;
    const targetY = free.y + free.h / 2 - (bounds.y + bounds.h / 2) * targetScale;

    this.cancelAnimation();
    this.userMoved = true;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (opts.animate === false || reducedMotion) {
      this.scale = targetScale;
      this.translateX = targetX;
      this.translateY = targetY;
      this.render();
      return;
    }

    const fromScale = this.scale;
    const fromX = this.translateX;
    const fromY = this.translateY;
    const startTime = performance.now();
    const tick = (time: number): void => {
      const t = Math.min(1, (time - startTime) / 420);
      const eased = 1 - Math.pow(1 - t, 3);
      this.scale = fromScale + (targetScale - fromScale) * eased;
      this.translateX = fromX + (targetX - fromX) * eased;
      this.translateY = fromY + (targetY - fromY) * eased;
      this.render();
      this.animationFrame = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  setRoute(legs: RouteLeg[] | null): void {
    this.route = legs;
    this.renderRoute();
  }

  setDestination(roomId: string | null): void {
    this.destination = roomId;
    this.updateDestination();
    this.renderMarkers();
  }

  setStart(point: { floor: number; x: number; y: number } | null): void {
    this.start = point;
    this.renderMarkers();
  }

  roomCenter(id: string): { floor: number; x: number; y: number } | null {
    for (const floor of this.floorIds) {
      const room = this.floors[floor].rooms.find((item) => item.id === id);
      if (room) {
        return { floor, x: room.x + room.w / 2, y: room.y + room.h / 2 };
      }
    }
    return null;
  }

  roomFloor(id: string): number | null {
    return this.roomCenter(id)?.floor ?? null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelAnimation();
    this.cancelTap();
    if (this.textFrame) cancelAnimationFrame(this.textFrame);
    this.observer.disconnect();
    this.svg.removeEventListener("pointerdown", this.handlePointerDown);
    this.svg.removeEventListener("pointermove", this.handlePointerMove);
    this.svg.removeEventListener("pointerup", this.handlePointerUp);
    this.svg.removeEventListener("pointercancel", this.handlePointerCancel);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerCancel);
    this.svg.removeEventListener("lostpointercapture", this.handlePointerCancel);
    this.svg.removeEventListener("wheel", this.handleWheel);
    for (const id of this.pointers.keys()) {
      if (this.svg.hasPointerCapture(id)) this.svg.releasePointerCapture(id);
    }
    this.pointers.clear();
    this.svg.remove();
    this.container.style.touchAction = this.originalTouchAction;
    this.container.classList.remove("mapview");
  }

  private data(): MapData {
    return this.floors[this.currentFloor];
  }

  private freeRect(): Rect {
    const x = Math.min(this.insets.left, Math.max(0, this.viewportWidth - 1));
    const y = Math.min(this.insets.top, Math.max(0, this.viewportHeight - 1));
    return {
      x,
      y,
      w: Math.max(1, this.viewportWidth - x - this.insets.right),
      h: Math.max(1, this.viewportHeight - y - this.insets.bottom),
    };
  }

  private fitScale(): number {
    const focus = this.data().focus;
    const free = this.freeRect();
    return Math.min(free.w / Math.max(1, focus.w), free.h / Math.max(1, focus.h)) * 0.96;
  }

  private minimumScale(): number {
    return Math.min(6, this.fitScale() * 0.9);
  }

  private limitScale(value: number): number {
    return Math.max(this.minimumScale(), Math.min(6, value));
  }

  private buildFloor(): void {
    const data = this.data();
    this.content.replaceChildren();
    this.roomPaths.clear();
    this.texts.length = 0;
    this.icons.length = 0;

    this.content.append(svgElement("path", {
      class: "mv-footprint",
      d: data.footprint,
      "fill-rule": "evenodd",
    }));

    const areas = svgElement("g", { class: "mv-areas" });
    for (const area of data.areas) {
      areas.append(svgElement("path", {
        class: `mv-area mv-area--${safeKind(area.k)}`,
        d: area.d,
      }));
    }
    this.content.append(areas);

    const rooms = svgElement("g", { class: "mv-rooms" });
    for (const room of data.rooms) {
      const path = svgElement("path", {
        class: `mv-room mv-room--${safeKind(room.k)}`,
        d: room.d,
        "data-room": room.id,
      });
      rooms.append(path);
      const matches = this.roomPaths.get(room.id) ?? [];
      matches.push(path);
      this.roomPaths.set(room.id, matches);
    }
    this.content.append(rooms);

    const iconLayer = svgElement("g", { class: "mv-icons" });
    for (const icon of data.icons) {
      const group = svgElement("g", { class: `mv-icon mv-icon--${icon.t}` });
      group.append(glyph(icon.t));
      iconLayer.append(group);
      this.icons.push({ element: group, icon });
    }
    this.content.append(iconLayer);

    const labelLayer = svgElement("g", { class: "mv-labels" });
    for (const label of data.labels) {
      const wing = label.k === "wing-b" || label.k === "wing-g";
      const text = svgElement("text", {
        class: `mv-label mv-label--${safeKind(label.k)}`,
        x: label.x,
        y: label.y,
        "text-anchor": label.a ?? "middle",
      });
      text.textContent = label.t;
      if (label.b) text.setAttribute("font-weight", String(label.b));
      if (wing) {
        text.setAttribute("font-size", String(label.s ?? 42));
      } else {
        this.texts.push({ element: text, px: 11.5, threshold: 0.26 });
      }
      labelLayer.append(text);
    }

    const measure = document.createElement("canvas").getContext("2d");
    if (measure) measure.font = `600 11px ${getComputedStyle(this.container).fontFamily || "sans-serif"}`;
    for (const room of data.rooms) {
      if (!room.n) continue;
      const text = svgElement("text", {
        class: `mv-num mv-num--${safeKind(room.k)}`,
        x: room.lx,
        y: room.ly,
        "text-anchor": "middle",
      });
      text.textContent = room.n;
      labelLayer.append(text);
      this.texts.push({
        element: text,
        px: 11,
        room,
        width: measure?.measureText(room.n).width ?? room.n.length * 6.5,
      });
    }
    this.content.append(labelLayer);
    this.content.append(this.makeCompass(data.compass.x, data.compass.y));

    this.routeLayer = svgElement("g", { class: "mv-route-layer" });
    this.markerLayer = svgElement("g", { class: "mv-marker-layer" });
    this.content.append(this.routeLayer, this.markerLayer);
    this.updateDestination();
    this.renderRoute();
    this.scheduleTextUpdate();
  }

  private makeCompass(x: number, y: number): SVGGElement {
    const group = svgElement("g", {
      class: "mv-compass",
      transform: `translate(${x} ${y})`,
    });
    group.append(svgElement("path", {
      class: "mv-compass-star",
      d: "M0 -58 9 -9 58 0 9 9 0 58 -9 9 -58 0 -9 -9Z",
    }));
    for (const [letter, tx, ty] of [
      ["С", 0, -67], ["Ю", 0, 84], ["В", -74, 6], ["З", 74, 6],
    ] as const) {
      const text = svgElement("text", {
        x: tx,
        y: ty,
        "text-anchor": "middle",
        class: "mv-compass-letter",
      });
      text.textContent = letter;
      group.append(text);
    }
    return group;
  }

  private updateDestination(): void {
    for (const [id, paths] of this.roomPaths) {
      for (const path of paths) path.classList.toggle("is-dest", id === this.destination);
    }
    for (const entry of this.texts) {
      if (entry.room) {
        entry.element.classList.toggle("is-dest", entry.room.id === this.destination);
      }
    }
  }

  private renderRoute(): void {
    if (this.destroyed || !this.routeLayer) return;
    this.routeLayer.replaceChildren();
    for (const leg of this.route ?? []) {
      if (leg.floor !== this.currentFloor) continue;
      const points = simplify(leg.points);
      if (points.length < 2) continue;
      const d = points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");
      for (const className of ["mv-route-under", "mv-route-main", "mv-route-dashes"]) {
        this.routeLayer.append(svgElement("path", { class: className, d }));
      }
    }
    this.renderMarkers();
  }

  private addMarker(
    x: number,
    y: number,
    kind: "start" | "dest" | "stairs",
  ): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const group = svgElement("g", { class: `mv-marker mv-marker--${kind}` });
    if (kind === "start") {
      group.append(svgElement("circle", { class: "mv-marker-pulse", r: 11 }));
    }
    group.append(svgElement("circle", { class: "mv-marker-dot", r: kind === "stairs" ? 11 : 9 }));
    if (kind === "stairs") {
      const symbol = glyph("stairs");
      symbol.setAttribute("transform", "scale(.65) translate(-12 -12)");
      group.append(symbol);
    } else if (kind === "dest") {
      group.append(svgElement("circle", { class: "mv-marker-center", r: 2.5 }));
    }
    this.markerLayer.append(group);
    group.setAttribute("data-x", String(x));
    group.setAttribute("data-y", String(y));
    group.setAttribute("transform", `translate(${x} ${y}) scale(${1 / this.scale})`);
  }

  private renderMarkers(): void {
    if (this.destroyed || !this.markerLayer) return;
    this.markerLayer.replaceChildren();
    const legs = this.route ?? [];
    for (let index = 0; index < legs.length; index++) {
      const leg = legs[index];
      if (leg.floor !== this.currentFloor) continue;
      const points = simplify(leg.points);
      if (points.length === 0) continue;
      if (index > 0 && legs[index - 1].floor !== leg.floor) {
        this.addMarker(points[0][0], points[0][1], "stairs");
      }
      if (index < legs.length - 1 && legs[index + 1].floor !== leg.floor) {
        const end = points[points.length - 1];
        this.addMarker(end[0], end[1], "stairs");
      }
    }

    if (this.start?.floor === this.currentFloor) {
      this.addMarker(this.start.x, this.start.y, "start");
    }
    if (this.destination) {
      const room = this.data().rooms.find((item) => item.id === this.destination);
      if (room) this.addMarker(room.x + room.w / 2, room.y + room.h / 2, "dest");
    }
  }

  private scheduleTextUpdate(): void {
    if (this.textFrame || this.destroyed) return;
    this.textFrame = requestAnimationFrame(() => {
      this.textFrame = 0;
      const scale = this.scale;
      for (const entry of this.texts) {
        entry.element.setAttribute("font-size", String(entry.px / scale));
        const room = entry.room;
        const visible = room
          ? room.w * scale >= (entry.width ?? 0) + 12 && room.h * scale >= 14
          : scale >= (entry.threshold ?? 0);
        entry.element.style.display = visible ? "" : "none";
      }
      for (const { element, icon } of this.icons) {
        element.style.display = scale >= 0.18 ? "" : "none";
        const size = icon.t === "wc" && icon.s
          ? Math.min(22, Math.max(14, icon.s * scale))
          : 18;
        element.setAttribute(
          "transform",
          `translate(${icon.x} ${icon.y}) scale(${size / (24 * scale)})`,
        );
      }
      for (const marker of this.markerLayer.children) {
        if (!(marker instanceof SVGGElement)) continue;
        marker.setAttribute(
          "transform",
          `translate(${marker.getAttribute("data-x")} ${marker.getAttribute("data-y")}) scale(${1 / scale})`,
        );
      }
    });
  }

  private render(): void {
    const data = this.data();
    const free = this.freeRect();
    // Не даём плану полностью уйти из свободной части экрана.
    const visibleX = Math.min(80, data.w, free.w / this.scale);
    const visibleY = Math.min(80, data.h, free.h / this.scale);
    this.translateX = Math.max(
      free.x + (visibleX - data.w) * this.scale,
      Math.min(free.x + free.w - visibleX * this.scale, this.translateX),
    );
    this.translateY = Math.max(
      free.y + (visibleY - data.h) * this.scale,
      Math.min(free.y + free.h - visibleY * this.scale, this.translateY),
    );
    this.content.setAttribute(
      "transform",
      `translate(${this.translateX} ${this.translateY}) scale(${this.scale})`,
    );
    this.scheduleTextUpdate();
  }

  private handleResize(): void {
    const width = this.svg.clientWidth;
    const height = this.svg.clientHeight;
    if (width <= 0 || height <= 0) return;
    if (width === this.viewportWidth && height === this.viewportHeight) return;

    if (!this.userMoved || this.viewportWidth === 0 || this.viewportHeight === 0) {
      this.viewportWidth = width;
      this.viewportHeight = height;
      this.fit();
      return;
    }

    this.cancelAnimation();
    const old = this.freeRect();
    const centerX = (old.x + old.w / 2 - this.translateX) / this.scale;
    const centerY = (old.y + old.h / 2 - this.translateY) / this.scale;
    this.viewportWidth = width;
    this.viewportHeight = height;
    const next = this.freeRect();
    this.scale = this.limitScale(this.scale);
    this.translateX = next.x + next.w / 2 - centerX * this.scale;
    this.translateY = next.y + next.h / 2 - centerY * this.scale;
    this.render();
  }

  private position(event: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) * this.svg.clientWidth) / rect.width,
      y: ((event.clientY - rect.top) * this.svg.clientHeight) / rect.height,
    };
  }

  private zoomAround(x: number, y: number, requestedScale: number): void {
    const planX = (x - this.translateX) / this.scale;
    const planY = (y - this.translateY) / this.scale;
    this.scale = this.limitScale(requestedScale);
    this.translateX = x - planX * this.scale;
    this.translateY = y - planY * this.scale;
    this.userMoved = true;
    this.render();
  }

  private currentPinch(): Pinch | null {
    if (this.pointers.size !== 2) return null;
    const [a, b] = [...this.pointers.values()];
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return;

    event.preventDefault();
    this.cancelAnimation();
    const { x, y } = this.position(event);
    if (this.pointers.size === 0) this.gestureBlocked = false;
    this.pointers.set(event.pointerId, {
      startX: x, startY: y, lastX: x, lastY: y, x, y, moved: false,
    });
    this.svg.setPointerCapture(event.pointerId);

    if (this.pointers.size > 1) {
      this.gestureBlocked = true;
      this.lastTap = null;
      this.cancelTap();
    }
    this.pinch = this.currentPinch();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;

    event.preventDefault();
    const { x, y } = this.position(event);
    pointer.x = x;
    pointer.y = y;

    if (this.pointers.size === 2) {
      const next = this.currentPinch();
      if (next && this.pinch) {
        const planX = (this.pinch.x - this.translateX) / this.scale;
        const planY = (this.pinch.y - this.translateY) / this.scale;
        const ratio = this.pinch.distance > 0 ? next.distance / this.pinch.distance : 1;
        this.scale = this.limitScale(this.scale * ratio);
        this.translateX = next.x - planX * this.scale;
        this.translateY = next.y - planY * this.scale;
        this.userMoved = true;
        this.render();
      }
      this.pinch = next;
      return;
    }

    if (this.pointers.size !== 1) return;
    if (!pointer.moved && Math.hypot(x - pointer.startX, y - pointer.startY) <= 6) return;

    pointer.moved = true;
    this.translateX += x - pointer.lastX;
    this.translateY += y - pointer.lastY;
    pointer.lastX = x;
    pointer.lastY = y;
    this.userMoved = true;
    this.lastTap = null;
    this.render();
  };

  private finishPointer(event: PointerEvent, cancelled: boolean): void {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;

    const position = cancelled ? null : this.position(event);
    const isTap = position !== null &&
      this.pointers.size === 1 &&
      !this.gestureBlocked &&
      !pointer.moved &&
      Math.hypot(position.x - pointer.startX, position.y - pointer.startY) <= 6;

    this.pointers.delete(event.pointerId);
    if (this.svg.hasPointerCapture(event.pointerId)) {
      this.svg.releasePointerCapture(event.pointerId);
    }
    this.pinch = this.currentPinch();
    if (this.pointers.size === 1) {
      const remaining = [...this.pointers.values()][0];
      remaining.startX = remaining.lastX = remaining.x;
      remaining.startY = remaining.lastY = remaining.y;
      remaining.moved = false;
    }

    if (cancelled) this.lastTap = null;
    if (!isTap || !position) return;

    const time = performance.now();
    const previous = this.lastTap;
    if (
      previous &&
      previous.type === event.pointerType &&
      time - previous.time <= 320 &&
      Math.hypot(position.x - previous.x, position.y - previous.y) <= 24
    ) {
      this.lastTap = null;
      this.cancelTap();
      this.zoomAround(position.x, position.y, this.scale * 2);
      return;
    }

    this.lastTap = { x: position.x, y: position.y, time, type: event.pointerType };
    const planX = (position.x - this.translateX) / this.scale;
    const planY = (position.y - this.translateY) / this.scale;
    const room = document.elementsFromPoint(event.clientX, event.clientY)
      .find((element) => this.svg.contains(element) && element.hasAttribute("data-room"));
    const roomId = room?.getAttribute("data-room") ?? null;
    this.cancelTap();
    // Ждём окончания окна двойного тапа, прежде чем сообщить о выборе комнаты.
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      if (!this.destroyed) this.onRoomTap?.(roomId, planX, planY);
    }, 325);
  }

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.pointers.has(event.pointerId)) event.preventDefault();
    this.finishPointer(event, false);
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    this.finishPointer(event, true);
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return;
    event.preventDefault();
    this.cancelAnimation();
    this.cancelTap();
    this.lastTap = null;
    const { x, y } = this.position(event);
    const unit = event.deltaMode === 1 ? 16
      : event.deltaMode === 2 ? this.viewportHeight : 1;
    this.zoomAround(x, y, this.scale * Math.exp(-event.deltaY * unit * 0.0015));
  };

  private cancelTap(): void {
    if (this.tapTimer !== null) clearTimeout(this.tapTimer);
    this.tapTimer = null;
  }

  private cancelAnimation(): void {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }
}
