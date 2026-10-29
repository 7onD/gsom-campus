export interface Corridor {
  id: string;
  floor: number;
  points: [number, number][];
}

export interface Anchor {
  id: string;
  floor: number;
  x: number;
  y: number;
  via?: string;
}

export interface StairLink {
  id: string;
  anchors: string[];
  cost: number;
}

export interface PlanData {
  corridors: Corridor[];
  anchors: Anchor[];
  stairs: StairLink[];
}

export interface RouteLeg {
  floor: number;
  points: [number, number][];
}

export interface Route {
  legs: RouteLeg[];
  length: number;
  stairsUsed: string[];
}

type Point = [number, number];

interface Edge {
  to: number;
  cost: number;
  stair?: string;
}

interface Node {
  floor: number;
  x: number;
  y: number;
  edges: Edge[];
}

interface SegmentEvent {
  t: number;
  node: number;
}

interface Segment {
  corridor: Corridor;
  a: Point;
  b: Point;
  events: SegmentEvent[];
}

interface HeapItem {
  node: number;
  distance: number;
}

const EPS = 1e-7;
const CELL = 1e-6;

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function projection(p: Point, a: Point, b: Point): { point: Point; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const squared = dx * dx + dy * dy;
  const t = squared === 0
    ? 0
    : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / squared));
  return { point: [a[0] + t * dx, a[1] + t * dy], t };
}

function intersection(first: Segment, second: Segment): Point | null {
  const rx = first.b[0] - first.a[0];
  const ry = first.b[1] - first.a[1];
  const sx = second.b[0] - second.a[0];
  const sy = second.b[1] - second.a[1];
  const denominator = rx * sy - ry * sx;
  if (denominator === 0) return null;

  const qx = second.a[0] - first.a[0];
  const qy = second.a[1] - first.a[1];
  const t = (qx * sy - qy * sx) / denominator;
  const u = (qx * ry - qy * rx) / denominator;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;

  return [first.a[0] + t * rx, first.a[1] + t * ry];
}

class MinHeap {
  private readonly items: HeapItem[] = [];

  push(item: HeapItem): void {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (items[parent].distance <= item.distance) break;
      items[i] = items[parent];
      i = parent;
    }
    items[i] = item;
  }

  pop(): HeapItem | undefined {
    const items = this.items;
    const result = items[0];
    const last = items.pop();
    if (result === undefined || last === undefined) return undefined;

    if (items.length > 0) {
      let i = 0;
      while (2 * i + 1 < items.length) {
        let child = 2 * i + 1;
        if (
          child + 1 < items.length &&
          items[child + 1].distance < items[child].distance
        ) {
          child++;
        }
        if (last.distance <= items[child].distance) break;
        items[i] = items[child];
        i = child;
      }
      items[i] = last;
    }
    return result;
  }
}

export class Graph {
  private readonly nodes: Node[] = [];
  private readonly buckets = new Map<string, number[]>();
  private readonly anchorNodes = new Map<string, number>();
  private readonly anchors = new Map<string, Anchor>();

  constructor(data: PlanData) {
    const segments: Segment[] = [];

    for (const corridor of data.corridors) {
      for (const point of corridor.points) {
        this.getNode(corridor.floor, point);
      }
      for (let i = 1; i < corridor.points.length; i++) {
        const a = corridor.points[i - 1];
        const b = corridor.points[i];
        segments.push({
          corridor,
          a,
          b,
          events: [
            { t: 0, node: this.getNode(corridor.floor, a) },
            { t: 1, node: this.getNode(corridor.floor, b) },
          ],
        });
      }
    }

    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i];
        const b = segments[j];
        if (a.corridor.floor !== b.corridor.floor) continue;

        const crossing = intersection(a, b);
        if (crossing !== null) {
          const node = this.getNode(a.corridor.floor, crossing);
          this.addEvent(a, crossing, node);
          this.addEvent(b, crossing, node);
        } else {
          // Для совпадающих участков соединяем лежащие на них вершины.
          for (const point of [a.a, a.b]) {
            const projected = projection(point, b.a, b.b);
            if (distance(point, projected.point) <= EPS) {
              const node = this.getNode(a.corridor.floor, point);
              this.addEvent(b, projected.point, node);
            }
          }
          for (const point of [b.a, b.b]) {
            const projected = projection(point, a.a, a.b);
            if (distance(point, projected.point) <= EPS) {
              const node = this.getNode(b.corridor.floor, point);
              this.addEvent(a, projected.point, node);
            }
          }
        }
      }
    }

    // Конец коридора в пределах 4 px от другого коридора соединяем с его осью.
    for (const corridor of data.corridors) {
      const points = corridor.points;
      if (points.length === 0) continue;
      const ends = points.length === 1 ? [points[0]] : [points[0], points[points.length - 1]];
      for (const end of ends) {
        const endNode = this.getNode(corridor.floor, end);
        for (const segment of segments) {
          if (segment.corridor === corridor || segment.corridor.floor !== corridor.floor) {
            continue;
          }
          const projected = projection(end, segment.a, segment.b);
          if (distance(end, projected.point) <= 4) {
            const node = this.getNode(corridor.floor, projected.point);
            this.addEvent(segment, projected.point, node);
            this.addEdge(endNode, node, distance(end, projected.point));
          }
        }
      }
    }

    for (const anchor of data.anchors) {
      this.anchors.set(anchor.id, anchor);
      const anchorPoint: Point = [anchor.x, anchor.y];
      const anchorNode = this.getNode(anchor.floor, anchorPoint);
      this.anchorNodes.set(anchor.id, anchorNode);

      let nearest:
        | { segment: Segment; point: Point; distance: number }
        | undefined;
      for (const segment of segments) {
        if (
          segment.corridor.floor !== anchor.floor ||
          (anchor.via !== undefined && segment.corridor.id !== anchor.via)
        ) {
          continue;
        }
        const point = projection(anchorPoint, segment.a, segment.b).point;
        const gap = distance(anchorPoint, point);
        if (nearest === undefined || gap < nearest.distance) {
          nearest = { segment, point, distance: gap };
        }
      }

      if (nearest !== undefined) {
        const node = this.getNode(anchor.floor, nearest.point);
        this.addEvent(nearest.segment, nearest.point, node);
        this.addEdge(anchorNode, node, nearest.distance);
      } else {
        // Коридор может состоять из одной точки.
        for (const corridor of data.corridors) {
          if (
            corridor.floor !== anchor.floor ||
            corridor.points.length !== 1 ||
            (anchor.via !== undefined && corridor.id !== anchor.via)
          ) {
            continue;
          }
          const point = corridor.points[0];
          const gap = distance(anchorPoint, point);
          if (nearest === undefined || gap < nearest.distance) {
            nearest = {
              segment: {
                corridor,
                a: point,
                b: point,
                events: [],
              },
              point,
              distance: gap,
            };
          }
        }
        if (nearest !== undefined) {
          const node = this.getNode(anchor.floor, nearest.point);
          this.addEdge(anchorNode, node, nearest.distance);
        }
      }
    }

    for (const segment of segments) {
      segment.events.sort((a, b) => a.t - b.t);
      for (let i = 1; i < segment.events.length; i++) {
        const from = segment.events[i - 1].node;
        const to = segment.events[i].node;
        const a = this.nodes[from];
        const b = this.nodes[to];
        this.addEdge(from, to, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }

    for (const stair of data.stairs) {
      for (let i = 0; i < stair.anchors.length; i++) {
        for (let j = i + 1; j < stair.anchors.length; j++) {
          const from = this.anchorNodes.get(stair.anchors[i]);
          const to = this.anchorNodes.get(stair.anchors[j]);
          if (
            from !== undefined &&
            to !== undefined &&
            this.nodes[from].floor !== this.nodes[to].floor
          ) {
            this.addEdge(from, to, stair.cost, stair.id);
          }
        }
      }
    }
  }

  anchorPoint(id: string): { floor: number; x: number; y: number } | undefined {
    const anchor = this.anchors.get(id);
    return anchor === undefined
      ? undefined
      : { floor: anchor.floor, x: anchor.x, y: anchor.y };
  }

  route(fromId: string, toId: string): Route | null {
    const start = this.anchorNodes.get(fromId);
    const finish = this.anchorNodes.get(toId);
    if (start === undefined || finish === undefined) return null;

    const distances = new Array<number>(this.nodes.length).fill(Infinity);
    const previous: ({ node: number; stair?: string } | undefined)[] =
      new Array(this.nodes.length);
    const heap = new MinHeap();
    distances[start] = 0;
    heap.push({ node: start, distance: 0 });

    let current: HeapItem | undefined;
    while ((current = heap.pop()) !== undefined) {
      if (current.distance !== distances[current.node]) continue;
      if (current.node === finish) break;

      for (const edge of this.nodes[current.node].edges) {
        const nextDistance = current.distance + edge.cost;
        if (nextDistance < distances[edge.to]) {
          distances[edge.to] = nextDistance;
          previous[edge.to] = { node: current.node, stair: edge.stair };
          heap.push({ node: edge.to, distance: nextDistance });
        }
      }
    }

    if (!Number.isFinite(distances[finish])) return null;

    const path = [finish];
    const stairs: (string | undefined)[] = [];
    while (path[path.length - 1] !== start) {
      const step = previous[path[path.length - 1]];
      if (step === undefined) return null;
      stairs.push(step.stair);
      path.push(step.node);
    }
    path.reverse();
    stairs.reverse();

    const first = this.nodes[path[0]];
    const legs: RouteLeg[] = [
      { floor: first.floor, points: [[first.x, first.y]] },
    ];
    const stairsUsed: string[] = [];

    for (let i = 1; i < path.length; i++) {
      const node = this.nodes[path[i]];
      const stair = stairs[i - 1];
      if (stair !== undefined) {
        stairsUsed.push(stair);
        legs.push({ floor: node.floor, points: [[node.x, node.y]] });
      } else {
        const points = legs[legs.length - 1].points;
        const last = points[points.length - 1];
        if (last[0] !== node.x || last[1] !== node.y) {
          points.push([node.x, node.y]);
        }
      }
    }

    return { legs, length: distances[finish], stairsUsed };
  }

  private getNode(floor: number, point: Point): number {
    const gx = Math.floor(point[0] / CELL);
    const gy = Math.floor(point[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.buckets.get(`${floor}:${gx + dx}:${gy + dy}`);
        if (bucket === undefined) continue;
        for (const index of bucket) {
          const node = this.nodes[index];
          if (Math.abs(node.x - point[0]) <= EPS && Math.abs(node.y - point[1]) <= EPS) {
            return index;
          }
        }
      }
    }

    const index = this.nodes.length;
    this.nodes.push({ floor, x: point[0], y: point[1], edges: [] });
    const key = `${floor}:${gx}:${gy}`;
    const bucket = this.buckets.get(key);
    if (bucket === undefined) this.buckets.set(key, [index]);
    else bucket.push(index);
    return index;
  }

  private addEvent(segment: Segment, point: Point, node: number): void {
    segment.events.push({ t: projection(point, segment.a, segment.b).t, node });
  }

  private addEdge(from: number, to: number, cost: number, stair?: string): void {
    if (from === to) return;
    this.nodes[from].edges.push({ to, cost, stair });
    this.nodes[to].edges.push({ to: from, cost, stair });
  }
}
