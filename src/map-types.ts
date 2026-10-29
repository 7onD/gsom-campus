// Формат векторных данных карты (tools/build_map.py -> src/data/map1.json, map2.json).
// Все координаты — в пикселях исходных планов, как у якорей и коридоров маршрутизатора.

/** Помещение с номером: отдельная кликабельная фигура. */
export interface MapRoom {
  /** id якоря плана (совпадает с Place.id), например "1219" или "1129-2". */
  id: string;
  /** Номер для показа на карте. */
  n: string;
  /** Тип заливки: room | wing-b | wing-g | office | ring | wc. */
  k: string;
  /** SVG-путь контура (абсолютные M/L/Z). */
  d: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Куда ставить номер. */
  lx: number;
  ly: number;
}

/** Область без номера (туалеты, офисы, коридоры крыльев). */
export interface MapArea {
  /** room | office | wc | wing-b | wing-g | wing-b-corr | wing-g-corr | ring */
  k: string;
  d: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapLabel {
  t: string;
  /** Центр текста (или начало/конец, если задан a). */
  x: number;
  y: number;
  /** poi | office | note | wing-b | wing-g */
  k: string;
  a?: "start" | "end";
  /** Размер в пикселях плана (для заголовков крыльев). */
  s?: number;
  /** Жирный шрифт. */
  b?: number;
}

export interface MapIcon {
  t: "stairs" | "wc" | "hanger" | "cafe" | "atm" | "entrance";
  x: number;
  y: number;
  /** Ширина области в пикселях плана (для wc). */
  s?: number;
}

export interface MapData {
  w: number;
  h: number;
  /** Область здания с запасом — по ней карта вписывается в экран. */
  focus: { x: number; y: number; w: number; h: number };
  /** Контур здания (fill-rule evenodd): коридоры и всё внутри. */
  footprint: string;
  rooms: MapRoom[];
  areas: MapArea[];
  labels: MapLabel[];
  icons: MapIcon[];
  compass: { x: number; y: number };
}

/** Области экрана, закрытые плавающими элементами интерфейса (в пикселях). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface RouteLeg {
  floor: number;
  points: [number, number][];
}
