import { icon } from "./icons.ts";
import { getState, goTab, subscribe, type Tab } from "./store.ts";
import "./tabbar.css";

const ITEMS: { tab: Tab; label: string; iconName: "calendar" | "map" | "sliders" }[] = [
  { tab: "schedule", label: "Расписание", iconName: "calendar" },
  { tab: "map", label: "Карта", iconName: "map" },
  { tab: "settings", label: "Настройки", iconName: "sliders" },
];

export function mountTabBar(container: HTMLElement): { destroy(): void } {
  const panel = document.createElement("nav");
  panel.className = "campus-tabbar";
  panel.setAttribute("role", "tablist");
  panel.setAttribute("aria-label", "Разделы приложения");

  const lens = document.createElement("span");
  lens.className = "campus-tabbar__lens";
  lens.setAttribute("aria-hidden", "true");
  panel.append(lens);

  const buttons = ITEMS.map(({ tab, label, iconName }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "campus-tabbar__tab";
    button.setAttribute("role", "tab");
    button.dataset.tab = tab;

    const image = document.createElement("span");
    image.className = "campus-tabbar__icon";
    image.setAttribute("aria-hidden", "true");
    image.innerHTML = icon(iconName, { size: 24 });

    const caption = document.createElement("span");
    caption.className = "campus-tabbar__label";
    caption.textContent = label;

    button.append(image, caption);
    panel.append(button);
    return button;
  });

  let pointerId: number | null = null;
  let pointerX = 0;
  let squeezeTimer: number | null = null;

  function selectedIndex(): number {
    return Math.max(0, ITEMS.findIndex((item) => item.tab === getState().tab));
  }

  function centers(): number[] {
    return buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return rect.left + rect.width / 2;
    });
  }

  function positionAt(clientX: number, scale = false): void {
    const positions = centers();
    const offset = Math.max(0, Math.min(positions[2] - positions[0], clientX - positions[0]));
    lens.style.transform = `translate3d(${offset}px, 0, 0) scale(${scale ? 1.06 : 1}, ${scale ? 1.04 : 1})`;
  }

  function positionAtIndex(index: number): void {
    positionAt(centers()[index]);
  }

  function nearestIndex(clientX: number): number {
    const positions = centers();
    return positions.reduce(
      (best, center, index) =>
        Math.abs(center - clientX) < Math.abs(positions[best] - clientX) ? index : best,
      0,
    );
  }

  function sync(): void {
    const active = selectedIndex();
    buttons.forEach((button, index) => {
      const selected = index === active;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    if (pointerId === null) positionAtIndex(active);
  }

  function snap(index: number): void {
    panel.classList.remove("is-dragging");
    if (squeezeTimer !== null) window.clearTimeout(squeezeTimer);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.classList.toggle("is-moving", !reducedMotion);
    positionAtIndex(index);

    if (!reducedMotion) {
      squeezeTimer = window.setTimeout(() => {
        panel.classList.remove("is-moving");
        positionAtIndex(selectedIndex());
        squeezeTimer = null;
      }, 170);
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || pointerId !== null) return;
    pointerId = event.pointerId;
    pointerX = event.clientX;
    if (squeezeTimer !== null) window.clearTimeout(squeezeTimer);
    squeezeTimer = null;
    panel.classList.remove("is-moving");
    panel.classList.add("is-dragging");
    panel.setPointerCapture(event.pointerId);
    positionAt(pointerX, true);
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    pointerX = event.clientX;
    positionAt(pointerX, true);
  }

  function onPointerUp(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    pointerX = event.clientX;
    pointerId = null;
    if (panel.hasPointerCapture(event.pointerId)) panel.releasePointerCapture(event.pointerId);

    const index = nearestIndex(pointerX);
    snap(index);
    buttons[index].focus();
    goTab(ITEMS[index].tab);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    snap(selectedIndex());
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!(event.target instanceof HTMLElement)) return;
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;

    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % buttons.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + buttons.length) % buttons.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = buttons.length - 1;
        break;
      case "Enter":
      case " ":
        next = index;
        break;
      default:
        return;
    }

    event.preventDefault();
    buttons[next].focus();
    goTab(ITEMS[next].tab);
  }

  function onClick(event: MouseEvent): void {
    // Указатель обрабатывается на pointerup; click без detail — клавиатура или API.
    if (event.detail !== 0) return;
    const target = event.target;
    const button = target instanceof Element ? target.closest<HTMLButtonElement>(".campus-tabbar__tab") : null;
    if (button && panel.contains(button)) goTab(button.dataset.tab as Tab);
  }

  function onResize(): void {
    if (pointerId === null) positionAtIndex(selectedIndex());
    else positionAt(pointerX, true);
  }

  panel.addEventListener("pointerdown", onPointerDown);
  panel.addEventListener("pointermove", onPointerMove);
  panel.addEventListener("pointerup", onPointerUp);
  panel.addEventListener("pointercancel", onPointerCancel);
  panel.addEventListener("keydown", onKeyDown);
  panel.addEventListener("click", onClick);
  window.addEventListener("resize", onResize);

  container.append(panel);
  const unsubscribe = subscribe(sync);
  sync();
  // размеры вкладок могут измениться после загрузки стилей и шрифтов — перекладываем линзу под активную вкладку
  const observer = new ResizeObserver(() => onResize());
  observer.observe(panel);
  // при первом показе линза встаёт на место без анимации
  panel.classList.add("is-initial");
  const settle = requestAnimationFrame(() => {
    sync();
    requestAnimationFrame(() => panel.classList.remove("is-initial"));
  });

  return {
    destroy(): void {
      unsubscribe();
      observer.disconnect();
      cancelAnimationFrame(settle);
      window.removeEventListener("resize", onResize);
      if (squeezeTimer !== null) window.clearTimeout(squeezeTimer);
      panel.remove();
    },
  };
}
