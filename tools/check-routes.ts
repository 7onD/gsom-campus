// Проверка графа на реальных данных: npm run check-routes
import { readFileSync } from "node:fs";
import { Graph, type PlanData } from "../src/routing.ts";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const f1 = read("src/data/floor1.json");
const f2 = read("src/data/floor2.json");
const stairs = read("src/data/stairs.json");
const g = new Graph({
  corridors: [...f1.corridors, ...f2.corridors],
  anchors: [...f1.anchors, ...f2.anchors],
  stairs,
} as PlanData);

const all = [...f1.anchors, ...f2.anchors];
const unreachable = all.filter((a: { id: string }) => !g.route("entrance", a.id)).map((a: { id: string }) => a.id);
console.log("недостижимы от входа:", unreachable.length ? unreachable.join(", ") : "нет");

const show = (from: string, to: string) => {
  const r = g.route(from, to);
  if (!r) return console.log(from, "→", to, "нет маршрута");
  console.log(from, "→", to, "длина", Math.round(r.length), "лестницы", r.stairsUsed.join(",") || "-",
    r.legs.map((l) => `э${l.floor}:${l.points.length}т`).join(" "));
};
for (const id of ["1219", "1301", "2223", "2228", "2130", "2168", "2250", "2101", "dean"]) show("entrance", id);
show("dean", "1219");
show("dean", "2130");
show("hall", "2247-2");
