import assert from "node:assert/strict";
import test from "node:test";
import { apply } from "./apply.ts";
import {
  auraCells, buildView, compareSchemes, computePrices, computeStats,
  defaultState, findFormations, footprint, formatSnapshot, instanceCells, normalizeState,
} from "./rules.ts";
import { cellKey, round1, type State } from "./types.ts";

function bare(): State {
  return {
    version: 3,
    boards: [{ rows: 4, cols: 4, holes: [] }],
    buildings: [
      { id: "A", name: "甲", color: "#111", w: 1, h: 1, cost: 10 },
      { id: "B", name: "乙", color: "#222", w: 1, h: 1, cost: 5 },
      { id: "C", name: "丙", color: "#333", w: 2, h: 1, cost: 20 },
      { id: "D", name: "丁", color: "#444", w: 2, h: 2, cost: 30 },
      { id: "X", name: "桥", color: "#555", w: 1, h: 1, cost: 1 },
    ],
    streets: [{ id: "st", name: "试街", types: ["A", "A", "B"], pct: 20 }],
    instances: [],
    spent: 0,
    spendLog: [],
    priorities: ["total", "max", "repeat", "spend"],
  };
}

function put(state: State, typeId: string, r: number, c: number, id: string, board = 1): State {
  const b = state.buildings.find(x => x.id === typeId)!;
  return {
    ...state,
    instances: [...state.instances, { id, typeId, board, anchorR: r, anchorC: c, paid: b.cost }],
    spent: state.spent + b.cost,
    spendLog: [...state.spendLog, { instanceId: id, typeId, paid: b.cost, at: 0 }],
  };
}

function price(state: State, board: number, r: number, c: number) {
  return computePrices(state).prices[cellKey(board, r, c)];
}

test("一座 2×2 在需要两座甲的街里只算一座", () => {
  let s = bare();
  s.buildings = s.buildings.map(b => b.id === "A" ? { ...b, w: 2, h: 2 } : b);
  s = put(s, "A", 1, 1, "a1");
  s = put(s, "B", 1, 3, "b1");
  assert.equal(findFormations(s).length, 0);
  s = put(s, "A", 3, 3, "a2");
  assert.equal(findFormations(s).length, 1);
  assert.equal(findFormations(s)[0].instanceIds.length, 3);
});

test("同一条街对同一格只生效一次，自身占地也吃固有光环", () => {
  let s = bare();
  s.boards = [{ rows: 4, cols: 5, holes: [] }];
  s.streets = [{ id: "st", name: "试街", types: ["C", "A", "B"], pct: 20 }];
  s = put(s, "C", 2, 2, "c1");
  const aura = auraCells(s, s.instances[0]);
  assert.equal(aura.length, 12);
  s = put(s, "A", 2, 4, "a1");
  s = put(s, "B", 2, 5, "b1");
  const { prices, ledger } = computePrices(s);
  // C 是 2×1，固有 20%。自身 (2,2) 吃到自己的 20% 和街的 20%，吃不到甲的 10%
  assert.equal(round1(prices[cellKey(1, 2, 2)]), 144);
  // (2,3) 是 C 的另一格，又在甲的周围：20% × 10% × 街 20%
  assert.equal(round1(prices[cellKey(1, 2, 3)]), 158.4);
  assert.equal(ledger[cellKey(1, 2, 3)].filter(line => line.pct === 20 && line.label === "试街").length, 1);
  assert.equal(ledger[cellKey(1, 2, 2)].some(line => line.pct === 20 && line.label.includes("固有")), true);
});

test("自身占地吃到自己的固有光环，也吃到专业街", () => {
  let s = bare();
  s.streets = [];
  s = put(s, "A", 2, 2, "a1");
  let { prices, ledger } = computePrices(s);
  assert.equal(round1(prices[cellKey(1, 2, 2)]), 110);
  assert.equal(ledger[cellKey(1, 2, 2)].some(line => line.pct === 10), true);

  s.streets = [{ id: "st", name: "试街", types: ["A", "B", "X"], pct: 20 }];
  s = put(s, "B", 2, 3, "b1");
  s = put(s, "X", 2, 4, "x1");
  ({ prices, ledger } = computePrices(s));
  // 甲的自身格：自己 10%、乙的 10%、街 20%。桥在 (2,4)，够不着 (2,2)
  assert.equal(round1(prices[cellKey(1, 2, 2)]), 145.2);
  assert.equal(ledger[cellKey(1, 2, 2)].some(line => line.label === "试街"), true);
});

test("对角相邻算连通，隔格和外来建筑都不连通", () => {
  let s = bare();
  s.streets = [{ id: "st", name: "试街", types: ["A", "B", "C"], pct: 20 }];
  s = put(s, "A", 1, 1, "a");
  s = put(s, "B", 2, 2, "b");
  s = put(s, "C", 2, 3, "c");
  assert.equal(findFormations(s).length, 1);

  let gap = bare();
  gap.streets = s.streets;
  gap = put(gap, "A", 1, 1, "a");
  gap = put(gap, "B", 1, 3, "b");
  gap = put(gap, "C", 2, 4, "c");
  assert.equal(findFormations(gap).length, 0);

  let bridge = bare();
  bridge.streets = s.streets;
  bridge = put(bridge, "A", 1, 1, "a");
  bridge = put(bridge, "X", 1, 2, "x");
  bridge = put(bridge, "B", 1, 3, "b");
  bridge = put(bridge, "C", 2, 3, "c");
  assert.equal(findFormations(bridge).length, 0);
});

test("放置失败不扣费，拆除不退钱，改造价不追溯", () => {
  const s = put(bare(), "A", 1, 1, "a");
  const rejected = apply(s, { type: "place", typeId: "A", board: 1, anchorR: 1, anchorC: 1, source: "mcp", reason: "再放" });
  assert.equal(rejected.ok, false);
  assert.equal(s.spent, 10);

  const removed = apply(s, { type: "demolish", board: 1, r: 1, c: 1, source: "mcp", reason: "拆" });
  assert.equal(removed.ok, true);
  if (removed.ok) assert.equal(removed.state.spent, 10);

  const repriced = apply(s, { type: "updateBuilding", id: "A", cost: 99 });
  assert.equal(repriced.ok, true);
  if (repriced.ok) {
    assert.equal(repriced.state.spent, 10);
    assert.equal(repriced.state.instances[0].paid, 10);
  }
});

test("场上还有该类型时不能改形状或删除", () => {
  const s = put(bare(), "A", 1, 1, "a");
  const shape = apply(s, { type: "updateBuilding", id: "A", w: 2, h: 1 });
  assert.equal(shape.ok, false);
  const del = apply(s, { type: "deleteBuilding", id: "A" });
  assert.equal(del.ok, false);
});

test("同一终盘，多拆过的方案在花费上更差；总地价高的仍胜", () => {
  const calm = put(bare(), "A", 1, 1, "a");
  const waste = { ...calm, spent: 40, spendLog: [...calm.spendLog, { instanceId: "gone", typeId: "A", paid: 30, at: 1 }] };
  const calmStats = computeStats(calm, computePrices(calm).prices);
  const wasteStats = computeStats(waste, computePrices(waste).prices);
  assert.equal(compareSchemes({ stats: calmStats }, { stats: wasteStats }, calm.priorities), 1);

  let richer = bare();
  richer.streets = [{ id: "st", name: "试街", types: ["A", "B", "C"], pct: 20 }];
  richer = put(richer, "A", 1, 1, "a");
  richer = put(richer, "B", 1, 2, "b");
  richer = put(richer, "C", 2, 1, "c");
  const richStats = computeStats(richer, computePrices(richer).prices);
  assert.ok(richStats.total > calmStats.total);
  assert.equal(compareSchemes({ stats: richStats }, { stats: calmStats }, richer.priorities), 1);
});

test("禁用格不吃光环，也不许被占用", () => {
  let s = bare();
  s.boards = [{ rows: 4, cols: 4, holes: [{ r: 1, c: 2 }] }];
  s.streets = [{ id: "st", name: "试街", types: ["A", "B", "C"], pct: 20 }];
  s = put(s, "A", 1, 1, "a");
  s = put(s, "B", 2, 1, "b");
  s = put(s, "C", 2, 2, "c");
  const { prices } = computePrices(s);
  assert.equal(prices[cellKey(1, 1, 2)], undefined);
  const blocked = apply(s, { type: "place", typeId: "X", board: 1, anchorR: 1, anchorC: 2 });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, "disabled_cell");
});

test("固有光环按占地分档：1×1 → 10%，1×2 → 20%，2×2 → 30%", () => {
  let s = bare();
  s.boards = [{ rows: 6, cols: 6, holes: [] }];
  s.streets = [];
  s = put(s, "C", 3, 3, "c1"); // 2×1 @ (3,3)-(3,4)
  let { prices } = computePrices(s);
  assert.equal(round1(prices[cellKey(1, 2, 3)]), 120); // 1×2 档 → 20%
  assert.equal(round1(prices[cellKey(1, 4, 2)]), 120);

  s = put(s, "D", 5, 1, "d1"); // 2×2 @ (5,1)-(6,2)
  ({ prices } = computePrices(s));
  assert.equal(round1(prices[cellKey(1, 4, 1)]), 130); // 2×2 档 → 30%

  s = put(s, "A", 1, 1, "a1"); // 1×1
  ({ prices } = computePrices(s));
  assert.equal(round1(prices[cellKey(1, 1, 2)]), 110);
  assert.equal(round1(prices[cellKey(1, 2, 2)]), 132); // A 的 10% 与 C 的 20% 复利叠加
});

test("默认配置：45 个建筑、20 条街、四块空棋盘，街的类型都有效且大建筑的街加成更大", () => {
  const view = buildView(defaultState());
  assert.equal(view.buildings.length, 45);
  assert.equal(view.streets.length, 20);
  assert.deepEqual(view.boards.map(b => [b.rows, b.cols]), [[3, 3], [4, 4], [3, 4], [5, 5]]);
  assert.equal(view.spent, 0);
  assert.equal(view.stats.placed, 0);
  assert.equal(view.stats.cells, 9 + 16 + 12 + 25);
  const ids = new Set(view.buildings.map(b => b.id));
  assert.equal(ids.size, 45);
  for (const street of view.streets) {
    for (const t of street.types) assert.ok(ids.has(t), street.name + " 引用未知类型 " + t);
  }
  const areaOf = (id: string) => {
    const b = view.buildings.find(x => x.id === id)!;
    return b.w * b.h;
  };
  const hasBig = (types: string[]) => types.some(t => areaOf(t) >= 2);
  const smallStreets = view.streets.filter(st => !hasBig(st.types));
  const bigStreets = view.streets.filter(st => hasBig(st.types));
  assert.ok(smallStreets.length > 0 && bigStreets.length > 0);
  assert.ok(Math.max(...smallStreets.map(s => s.pct)) < Math.min(...bigStreets.map(s => s.pct)));
  // 2×2 旗舰街的加成不低于任何街
  const flagship = view.streets.find(s => s.id === "s_flagship")!;
  assert.ok(flagship.types.every(t => areaOf(t) === 4));
  assert.ok(flagship.pct >= Math.max(...view.streets.map(s => s.pct)));
  const tesla = view.buildings.find(b => b.id === "b_tesla");
  assert.equal(tesla?.w, 1);
  assert.equal(tesla?.h, 1);
  // 每个建筑至少属于一条街
  for (const b of view.buildings) {
    assert.ok(view.streets.some(st => st.types.includes(b.id)), b.name + " 不属于任何街");
  }
});

test("两格建筑可旋转：宽高互换，1×1 与 2×2 忽略", () => {
  let s = bare(); // C 是 2×1
  const placed = apply(s, { type: "place", typeId: "C", board: 1, anchorR: 1, anchorC: 1, rotated: true });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  const inst = placed.state.instances[0];
  assert.equal(inst.rotated, true);
  assert.deepEqual(instanceCells(placed.state, inst), [{ board: 1, r: 1, c: 1 }, { board: 1, r: 2, c: 1 }]);
  // 旋转后 (1,2) 空出，可以再放
  const again = apply(placed.state, { type: "place", typeId: "A", board: 1, anchorR: 1, anchorC: 2 });
  assert.equal(again.ok, true);
  // 不旋转则 (1,2) 被占
  const flat = apply(s, { type: "place", typeId: "C", board: 1, anchorR: 1, anchorC: 1 });
  assert.equal(flat.ok, true);
  if (flat.ok) {
    const blocked = apply(flat.state, { type: "place", typeId: "A", board: 1, anchorR: 1, anchorC: 2 });
    assert.equal(blocked.ok, false);
  }
  // 1×1 旋转被忽略
  const noop = apply(s, { type: "place", typeId: "A", board: 1, anchorR: 3, anchorC: 3, rotated: true });
  assert.equal(noop.ok, true);
  if (noop.ok) assert.equal(noop.state.instances[0].rotated, undefined);
  // 存档往返保留朝向
  const round = normalizeState(JSON.parse(JSON.stringify(placed.state)));
  assert.equal(round?.instances[0].rotated, true);
});

test("占地由锚点向右向下展开", () => {
  assert.deepEqual(footprint(2, 2, 2, 1), [{ r: 2, c: 2 }, { r: 2, c: 3 }]);
  assert.deepEqual(footprint(2, 2, 1, 2), [{ r: 2, c: 2 }, { r: 3, c: 2 }]);
});

test("光环和成街不跨棋盘，统计是合计", () => {
  let s = bare();
  s.boards = [
    { rows: 3, cols: 3, holes: [] },
    { rows: 3, cols: 3, holes: [] },
  ];
  s.streets = [{ id: "st", name: "试街", types: ["A", "B", "C"], pct: 20 }];
  s = put(s, "A", 2, 2, "a", 1);
  s = put(s, "B", 2, 2, "b", 2);
  s = put(s, "C", 2, 3, "c", 2);
  assert.equal(findFormations(s).length, 0);
  assert.equal(round1(price(s, 2, 2, 2)), 132); // 乙自己 10% × 丙的 20%，甲在另一块棋盘够不着
  assert.equal(round1(price(s, 1, 2, 2)), 110);
  assert.equal(round1(price(s, 1, 1, 1)), 110); // 只吃到本盘甲的 10%，吃不到另一盘的乙和丙
  const added = apply(s, { type: "addBoard", rows: 4, cols: 4 });
  assert.equal(added.ok, true);
  const full = apply(added.ok ? added.state : s, { type: "addBoard", rows: 4, cols: 4 });
  assert.equal(full.ok, true);
  const overflow = apply(full.ok ? full.state : s, { type: "addBoard", rows: 3, cols: 3 });
  assert.equal(overflow.ok, false);
  if (!overflow.ok) assert.equal(overflow.error.code, "too_many_boards");
  const missing = apply(s, { type: "place", typeId: "X", board: 9, anchorR: 1, anchorC: 1, source: "mcp", reason: "错盘" });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, "unknown_board");
});

test("重置棋盘恢复四块默认尺寸，并清空建筑和花费，配置保留", () => {
  let s = put(bare(), "A", 1, 1, "a");
  s.streets = [{ id: "keep", name: "留着", types: ["A", "B", "C"], pct: 12 }];
  s.boards = [{ rows: 6, cols: 6, holes: [{ r: 1, c: 1 }] }];
  const reset = apply(s, { type: "resetBoard" });
  assert.equal(reset.ok, true);
  if (!reset.ok) return;
  assert.equal(reset.state.instances.length, 0);
  assert.equal(reset.state.spent, 0);
  assert.deepEqual(reset.state.boards.map(b => [b.rows, b.cols]), [[3, 3], [4, 4], [3, 4], [5, 5]]);
  assert.equal(reset.state.streets[0].id, "keep");
  assert.ok(formatSnapshot(reset.state).includes("总地价"));
  assert.ok(formatSnapshot(reset.state).includes("重复建筑 0"));
});

test("旧的单棋盘存档能迁成一块棋盘", () => {
  const legacy = {
    version: 2,
    rows: 4,
    cols: 4,
    holes: [],
    buildings: bare().buildings,
    streets: bare().streets,
    instances: [{ id: "a", typeId: "A", anchorR: 1, anchorC: 1, paid: 10 }],
    spent: 10,
    spendLog: [{ instanceId: "a", typeId: "A", paid: 10, at: 0 }],
    priorities: ["total", "max", "repeat", "spend"],
  };
  const next = normalizeState(legacy);
  assert.equal(next?.boards.length, 1);
  assert.equal(next?.instances[0].board, 1);
});
