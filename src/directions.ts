// Упрощение ломаной маршрута и текстовые шаги («поверните направо»).
// Плоскость плана: y вниз, поэтому положительное векторное произведение — поворот направо.

type Pt = [number, number];

export function simplify(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
      if (Math.abs(cross) < 1e-6 * Math.abs(dot) + 1 && dot > 0) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}

function turn(a: Pt, b: Pt, c: Pt): "straight" | "left" | "right" | "back" {
  const v1: Pt = [b[0] - a[0], b[1] - a[1]];
  const v2: Pt = [c[0] - b[0], c[1] - b[1]];
  const angle = Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]) * (180 / Math.PI);
  if (Math.abs(angle) < 25) return "straight";
  if (Math.abs(angle) > 155) return "back";
  return angle > 0 ? "right" : "left";
}

const TURN_TEXT = { left: "Поверните налево", right: "Поверните направо", straight: "Идите прямо", back: "Развернитесь" };

/** Шаги по упрощённой ломаной; destination — как назвать цель в последней строке. */
/** Убирает промежуточные точки, после которых идёт короче minLen px (микро-сдвиги осевых линий). */
function dropJogs(points: Pt[], minLen: number): Pt[] {
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    if (Math.hypot(points[i][0] - prev[0], points[i][1] - prev[1]) >= minLen) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function describe(points: Pt[], fromName: string, destination: string): string[] {
  const p = simplify(dropJogs(simplify(points), 45));
  if (p.length < 2) return [`Вы уже у точки «${fromName}»`];
  const steps = [`От точки «${fromName}» идите вперёд`];
  for (let i = 1; i < p.length - 1; i++) {
    const t = turn(p[i - 1], p[i], p[i + 1]);
    if (t !== "straight") steps.push(`${TURN_TEXT[t]} и идите дальше`);
  }
  if (p.length >= 3) {
    const t = turn(p[p.length - 3], p[p.length - 2], p[p.length - 1]);
    const side = t === "left" ? "слева" : t === "right" ? "справа" : "впереди";
    steps[steps.length - 1] = steps.length === 1 ? steps[0] : steps[steps.length - 1];
    steps.push(`${destination} — ${side}`);
  } else {
    steps.push(`${destination} — впереди`);
  }
  return steps;
}
