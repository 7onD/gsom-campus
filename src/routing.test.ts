import assert from "node:assert/strict";
import test from "node:test";
import { Graph, type PlanData } from "./routing.ts";

test("Г-образный коридор", () => {
  const graph = new Graph({
    corridors: [{ id: "c", floor: 1, points: [[0, 0], [10, 0], [10, 10]] }],
    anchors: [
      { id: "a", floor: 1, x: 0, y: 0 },
      { id: "b", floor: 1, x: 10, y: 10 },
    ],
    stairs: [],
  });

  assert.deepEqual(graph.route("a", "b"), {
    legs: [{ floor: 1, points: [[0, 0], [10, 0], [10, 10]] }],
    length: 20,
    stairsUsed: [],
  });
});

test("Т-пересечение с допуском 4 px", () => {
  const graph = new Graph({
    corridors: [
      { id: "main", floor: 1, points: [[0, 0], [20, 0]] },
      { id: "branch", floor: 1, points: [[10, 3], [10, 10]] },
    ],
    anchors: [
      { id: "a", floor: 1, x: 0, y: 0 },
      { id: "b", floor: 1, x: 10, y: 10 },
    ],
    stairs: [],
  });

  assert.deepEqual(graph.route("a", "b"), {
    legs: [{ floor: 1, points: [[0, 0], [10, 0], [10, 3], [10, 10]] }],
    length: 20,
    stairsUsed: [],
  });
});

test("via задаёт коридор привязки, даже если другой ближе", () => {
  const graph = new Graph({
    corridors: [
      { id: "upper", floor: 1, points: [[0, 0], [20, 0]] },
      { id: "lower", floor: 1, points: [[0, 10], [20, 10]] },
    ],
    anchors: [
      { id: "room", floor: 1, x: 5, y: 9, via: "upper" },
      { id: "exit", floor: 1, x: 15, y: 0 },
    ],
    stairs: [],
  });

  assert.deepEqual(graph.route("room", "exit"), {
    legs: [{ floor: 1, points: [[5, 9], [5, 0], [15, 0]] }],
    length: 19,
    stairsUsed: [],
  });
});

test("лестница соединяет два этажа и добавляет свою стоимость", () => {
  const data: PlanData = {
    corridors: [
      { id: "first", floor: 1, points: [[0, 0], [10, 0]] },
      { id: "second", floor: 2, points: [[0, 0], [10, 0]] },
    ],
    anchors: [
      { id: "start", floor: 1, x: 0, y: 0 },
      { id: "s1", floor: 1, x: 10, y: 0 },
      { id: "s2", floor: 2, x: 0, y: 0 },
      { id: "finish", floor: 2, x: 10, y: 0 },
    ],
    stairs: [{ id: "stairs", anchors: ["s1", "s2"], cost: 7 }],
  };

  assert.deepEqual(new Graph(data).route("start", "finish"), {
    legs: [
      { floor: 1, points: [[0, 0], [10, 0]] },
      { floor: 2, points: [[0, 0], [10, 0]] },
    ],
    length: 27,
    stairsUsed: ["stairs"],
  });
});

test("недостижимая точка и неизвестный id", () => {
  const graph = new Graph({
    corridors: [
      { id: "left", floor: 1, points: [[0, 0], [10, 0]] },
      { id: "right", floor: 1, points: [[100, 0], [110, 0]] },
    ],
    anchors: [
      { id: "a", floor: 1, x: 0, y: 0 },
      { id: "b", floor: 1, x: 100, y: 0 },
    ],
    stairs: [],
  });

  assert.equal(graph.route("a", "b"), null);
  assert.equal(graph.route("a", "missing"), null);
  assert.equal(graph.anchorPoint("missing"), undefined);
});

test("маршрут из якоря в него же", () => {
  const graph = new Graph({
    corridors: [],
    anchors: [{ id: "alone", floor: 3, x: 4, y: 8 }],
    stairs: [],
  });

  assert.deepEqual(graph.route("alone", "alone"), {
    legs: [{ floor: 3, points: [[4, 8]] }],
    length: 0,
    stairsUsed: [],
  });
});
