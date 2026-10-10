import {
  BASE_PRICE, OBJECTIVE_META, OBJECTIVES, PALETTE,
  type AppError, type Building, type Cell, type CellView, type FormationView,
  type Instance, type InstanceView, type LedgerLine, type MapSummary, type Objective,
  type State, type Stats, type Street, type ViewModel,
  cellKey, fmtNum, isShape, round1,
} from "./types.ts";
import { errorOf } from "./errors.ts";

export function footprint(anchorR: number, anchorC: number, w: number, h: number): Cell[] {
  const cells: Cell[] = [];
  for (let dr = 0; dr < h; dr++) {
    for (let dc = 0; dc < w; dc++) cells.push({ r: anchorR + dr, c: anchorC + dc });
  }
  return cells;
}

export function holeSet(state: State): Set<string> {
  return new Set(state.holes.map(h => cellKey(h.r, h.c)));
}

export function isEnabled(state: State, r: number, c: number, holes = holeSet(state)): boolean {
  return r >= 1 && c >= 1 && r <= state.rows && c <= state.cols && !holes.has(cellKey(r, c));
}

export function buildingOf(state: State, id: string): Building | undefined {
  return state.buildings.find(b => b.id === id);
}

// 两格建筑（1×2/2×1）可旋转：宽高互换；1×1 与 2×2 旋转无意义，忽略
export function instanceShape(b: Building, rotated: boolean | undefined): { w: number; h: number } {
  if (rotated && b.w * b.h === 2) return { w: b.h, h: b.w };
  return { w: b.w, h: b.h };
}

export function instanceCells(state: State, inst: Instance): Cell[] {
  const b = buildingOf(state, inst.typeId);
  if (!b) return [];
  const { w, h } = instanceShape(b, inst.rotated);
  return footprint(inst.anchorR, inst.anchorC, w, h);
}

export function occupantAt(state: State, r: number, c: number): Instance | undefined {
  for (const inst of state.instances) {
    if (instanceCells(state, inst).some(cell => cell.r === r && cell.c === c)) return inst;
  }
  return undefined;
}

// 固有光环按占地分档：1×1 → 10%，1×2/2×1 → 20%，2×2 → 30%
export function innatePctOf(w: number, h: number): number {
  const area = w * h;
  return area >= 4 ? 30 : area === 2 ? 20 : 10;
}

export function auraCells(state: State, inst: Instance): Cell[] {
  const owned = instanceCells(state, inst);
  const holes = holeSet(state);
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (const cell of owned) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = cell.r + dr;
        const c = cell.c + dc;
        const k = cellKey(r, c);
        if (seen.has(k) || !isEnabled(state, r, c, holes)) continue;
        seen.add(k);
        out.push({ r, c });
      }
    }
  }
  return out;
}

export function surroundCells(state: State, inst: Instance): Cell[] {
  const owned = new Set(instanceCells(state, inst).map(cell => cellKey(cell.r, cell.c)));
  return auraCells(state, inst).filter(cell => !owned.has(cellKey(cell.r, cell.c)));
}

function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
}

function instancesTouch(a: Cell[], b: Cell[]): boolean {
  for (const ca of a) for (const cb of b) if (chebyshev(ca, cb) === 1) return true;
  return false;
}

export type Formation = { streetId: string; instanceIds: string[] };

export function findFormations(state: State): Formation[] {
  const formations: Formation[] = [];
  const cellCache = new Map<string, Cell[]>();
  const cellsOf = (inst: Instance) => {
    let cells = cellCache.get(inst.id);
    if (!cells) {
      cells = instanceCells(state, inst);
      cellCache.set(inst.id, cells);
    }
    return cells;
  };

  for (const street of state.streets) {
    if (!streetValid(state, street)) continue;
    const need: Record<string, number> = {};
    for (const t of street.types) need[t] = (need[t] || 0) + 1;
    const typeSet = new Set(street.types);
    const cand = state.instances.filter(inst => typeSet.has(inst.typeId));
    const seen = new Set<string>();
    for (const start of cand) {
      if (seen.has(start.id)) continue;
      const comp: Instance[] = [];
      const queue = [start];
      seen.add(start.id);
      while (queue.length) {
        const cur = queue.pop()!;
        comp.push(cur);
        const curCells = cellsOf(cur);
        for (const other of cand) {
          if (seen.has(other.id)) continue;
          if (instancesTouch(curCells, cellsOf(other))) {
            seen.add(other.id);
            queue.push(other);
          }
        }
      }
      const count: Record<string, number> = {};
      for (const inst of comp) count[inst.typeId] = (count[inst.typeId] || 0) + 1;
      let ok = true;
      for (const t of Object.keys(need)) {
        if ((count[t] || 0) < need[t]) { ok = false; break; }
      }
      if (ok) {
        formations.push({
          streetId: street.id,
          instanceIds: comp.map(i => i.id).sort(),
        });
      }
    }
  }
  return formations;
}

function streetValid(state: State, street: Street): boolean {
  return street.types.length === 3 && street.types.every(t => state.buildings.some(b => b.id === t)) && street.pct > 0;
}

export function computePrices(state: State, formations = findFormations(state)): {
  prices: Record<string, number>;
  ledger: Record<string, LedgerLine[]>;
} {
  const prices: Record<string, number> = {};
  const ledger: Record<string, LedgerLine[]> = {};
  const holes = holeSet(state);
  for (let r = 1; r <= state.rows; r++) {
    for (let c = 1; c <= state.cols; c++) {
      if (!isEnabled(state, r, c, holes)) continue;
      const k = cellKey(r, c);
      prices[k] = BASE_PRICE;
      ledger[k] = [];
    }
  }
  const byId = new Map(state.instances.map(i => [i.id, i]));
  for (const inst of state.instances) {
    const b = buildingOf(state, inst.typeId);
    const pct = innatePctOf(b?.w ?? 1, b?.h ?? 1);
    const label = (b ? b.name : "建筑") + " @ (" + inst.anchorR + "," + inst.anchorC + ")  周围";
    for (const cell of surroundCells(state, inst)) {
      const k = cellKey(cell.r, cell.c);
      if (prices[k] === undefined) continue;
      prices[k] *= 1 + pct / 100;
      ledger[k].push({ label, pct });
    }
  }

  const streetById = new Map(state.streets.map(s => [s.id, s]));
  for (const f of formations) {
    const street = streetById.get(f.streetId);
    if (!street) continue;
    const covered = new Set<string>();
    for (const id of f.instanceIds) {
      const inst = byId.get(id);
      if (!inst) continue;
      for (const cell of auraCells(state, inst)) covered.add(cellKey(cell.r, cell.c));
    }
    const mult = 1 + street.pct / 100;
    const label = street.name;
    for (const k of covered) {
      if (prices[k] === undefined) continue;
      prices[k] *= mult;
      ledger[k].push({ label, pct: street.pct });
    }
  }
  return { prices, ledger };
}

export function computeStats(state: State, prices: Record<string, number>): Stats {
  let total = 0;
  let max = 0;
  let cells = 0;
  for (const value of Object.values(prices)) {
    cells++;
    total += value;
    if (value > max) max = value;
  }
  const used = new Set(state.instances.map(i => i.typeId));
  const covered = state.instances.reduce((n, inst) => n + instanceCells(state, inst).length, 0);
  return {
    total,
    max: cells ? max : 0,
    repeat: state.instances.length - used.size,
    placed: state.instances.length,
    cells,
    covered,
    spent: state.spent,
  };
}

export function displayStats(stats: Stats): Stats {
  return {
    ...stats,
    total: round1(stats.total),
    max: round1(stats.max),
  };
}

export function buildView(state: State): ViewModel {
  const formations = findFormations(state);
  const { prices, ledger } = computePrices(state, formations);
  const stats = computeStats(state, prices);
  const holes = holeSet(state);
  const occ = new Map<string, string>();
  for (const inst of state.instances) {
    for (const cell of instanceCells(state, inst)) occ.set(cellKey(cell.r, cell.c), inst.id);
  }
  const cells: CellView[] = [];
  const ledgerView: ViewModel["ledger"] = [];
  for (let r = 1; r <= state.rows; r++) {
    for (let c = 1; c <= state.cols; c++) {
      const enabled = isEnabled(state, r, c, holes);
      const k = cellKey(r, c);
      const exact = enabled ? prices[k] : 0;
      cells.push({
        r, c, enabled,
        price: enabled ? round1(exact) : 0,
        priceExact: exact,
        instanceId: occ.get(k) ?? null,
      });
      if (enabled) ledgerView.push({ r, c, lines: ledger[k] ?? [] });
    }
  }
  const instances: InstanceView[] = state.instances.map(inst => {
    const b = buildingOf(state, inst.typeId);
    const shape = b ? instanceShape(b, inst.rotated) : { w: 1, h: 1 };
    return {
      id: inst.id,
      typeId: inst.typeId,
      name: b?.name ?? "已删除",
      color: b?.color ?? "#888888",
      w: shape.w,
      h: shape.h,
      anchorR: inst.anchorR,
      anchorC: inst.anchorC,
      cells: instanceCells(state, inst),
      paid: inst.paid,
      rotated: inst.rotated ?? false,
    };
  });
  const formationViews: FormationView[] = formations.map(f => {
    const street = state.streets.find(s => s.id === f.streetId);
    return {
      streetId: f.streetId,
      name: street?.name ?? "专业街",
      pct: street?.pct ?? 0,
      instanceIds: f.instanceIds,
    };
  });
  return {
    rows: state.rows,
    cols: state.cols,
    cells,
    instances,
    formations: formationViews,
    ledger: ledgerView,
    stats,
    buildings: state.buildings,
    streets: state.streets,
    priorities: state.priorities,
    spent: state.spent,
  };
}

export function toMapSummary(view: ViewModel): MapSummary {
  const shown = displayStats(view.stats);
  return {
    rows: view.rows,
    cols: view.cols,
    disabled: view.cells.filter(c => !c.enabled).map(c => ({ r: c.r, c: c.c })),
    instances: view.instances.map(inst => ({
      instanceId: inst.id,
      typeId: inst.typeId,
      name: inst.name,
      w: inst.w,
      h: inst.h,
      anchor: { r: inst.anchorR, c: inst.anchorC },
      cells: inst.cells,
    })),
    prices: view.cells.filter(c => c.enabled).map(c => ({ r: c.r, c: c.c, price: c.price })),
    formations: view.formations,
    spent: view.spent,
    stats: {
      total: shown.total,
      max: shown.max,
      repeat: shown.repeat,
      placed: shown.placed,
      cells: shown.cells,
    },
  };
}

export function fmtDelta(n: number): string {
  const r = round1(n);
  const text = fmtNum(Math.abs(r));
  if (r > 0) return "+" + text;
  if (r < 0) return "-" + text;
  return "0";
}

let _seq = 1;
export function nid(prefix: string): string {
  return prefix + "_" + (_seq++).toString(36) + Date.now().toString(36).slice(-4);
}

export function nextColor(buildings: Building[]): string {
  const used = new Set(buildings.map(b => b.color));
  return PALETTE.find(c => !used.has(c)) ?? PALETTE[buildings.length % PALETTE.length];
}

type ShopDef = [id: string, name: string, size: "1x1" | "1x2" | "2x2", cost: number];

function shop([id, name, size, cost]: ShopDef, index: number): Building {
  const [w, h] = size === "2x2" ? [2, 2] : size === "1x2" ? [1, 2] : [1, 1];
  return { id, name, color: PALETTE[index % PALETTE.length], w, h, cost, image: "/sprites/" + size + "-" + name + ".png" };
}

// 45 个品牌门店：造价随占地与品牌定位递增
const SHOP_DEFS: ShopDef[] = [
  // —— 1×1 便利店 ——
  ["b_7eleven", "7-Eleven", "1x1", 12],
  ["b_lawson", "罗森", "1x1", 10],
  ["b_familymart", "全家", "1x1", 10],
  ["b_bianlitu", "便利兔", "1x1", 6],
  // —— 1×1 咖啡茶饮 ——
  ["b_starbucks", "星巴克", "1x1", 18],
  ["b_luckin", "瑞幸咖啡", "1x1", 10],
  ["b_mxbc", "蜜雪冰城", "1x1", 6],
  ["b_heytea", "喜茶", "1x1", 12],
  ["b_bwcj", "霸王茶姬", "1x1", 12],
  // —— 1×1 餐饮 ——
  ["b_mcdonalds", "麦当劳", "1x1", 16],
  ["b_kfc", "肯德基", "1x1", 16],
  ["b_burgerking", "汉堡王", "1x1", 14],
  ["b_pizzahut", "必胜客", "1x1", 14],
  ["b_haidilao", "海底捞", "1x1", 30],
  // —— 1×1 服饰零售 ——
  ["b_uniqlo", "优衣库", "1x1", 20],
  ["b_muji", "无印良品", "1x1", 18],
  ["b_miniso", "名创优品", "1x1", 8],
  ["b_adidas", "阿迪达斯", "1x1", 18],
  ["b_nike", "耐克", "1x1", 20],
  // —— 1×1 数码 ——
  ["b_apple", "苹果", "1x1", 30],
  ["b_huawei", "华为", "1x1", 24],
  ["b_xiaomi", "小米", "1x1", 14],
  ["b_dji", "大疆", "1x1", 20],
  // —— 1×1 其他零售/服务 ——
  ["b_nio", "蔚来", "1x1", 26],
  ["b_samsclub", "山姆会员店", "1x1", 28],
  ["b_ikea", "宜家", "1x1", 30],
  ["b_meituan", "美团外卖", "1x1", 8],
  ["b_popmart", "泡泡玛特", "1x1", 12],
  ["b_decathlon", "迪卡侬", "1x1", 22],
  // —— 1×2（贴图卡片 1×2 或 2×1，统一按 1×2）——
  ["b_manner", "MANNER咖啡", "1x2", 22],
  ["b_naixue", "奈雪的茶", "1x2", 26],
  ["b_sisyphe", "西西弗书店", "1x2", 28],
  ["b_tongrentang", "同仁堂", "1x2", 30],
  ["b_lining", "李宁", "1x2", 32],
  ["b_lego", "乐高", "1x2", 36],
  ["b_hema", "盒马鲜生", "1x2", 40],
  ["b_sfexpress", "顺丰速运", "1x2", 24],
  ["b_byd", "比亚迪", "1x2", 54],
  ["b_chowtaifook", "周大福", "1x2", 56],
  ["b_tesla", "特斯拉", "1x2", 60],
  // —— 2×2 旗舰店 ——
  ["b_zhongshuge", "钟书阁", "2x2", 64],
  ["b_jiajuguan", "家居馆", "2x2", 70],
  ["b_toysrus", "玩具反斗城", "2x2", 80],
  ["b_zara", "ZARA", "2x2", 90],
  ["b_benz", "奔驰", "2x2", 150],
];

// 20 条专业街：有大建筑（1×2/2×2）参与的街加成更大
// 档位：纯 1×1 → 14%~18%；含 1×2 → 22%~28%；含 2×2 → 32%~55%
const STREET_DEFS: [id: string, name: string, types: [string, string, string], pct: number][] = [
  ["s_tea", "茶饮街", ["b_mxbc", "b_heytea", "b_bwcj"], 14],
  ["s_lifestyle", "品质生活街", ["b_muji", "b_miniso", "b_ikea"], 14],
  ["s_conv", "便利街", ["b_7eleven", "b_lawson", "b_familymart"], 15],
  ["s_fastfood", "快餐街", ["b_mcdonalds", "b_kfc", "b_burgerking"], 16],
  ["s_outdoor", "户外生活街", ["b_decathlon", "b_ikea", "b_muji"], 16],
  ["s_digital", "数码街", ["b_apple", "b_huawei", "b_xiaomi"], 18],
  ["s_smart", "智能生活街", ["b_xiaomi", "b_dji", "b_nio"], 18],
  ["s_delivery", "配送生活街", ["b_bianlitu", "b_meituan", "b_sfexpress"], 22],
  ["s_afternoon", "下午茶街", ["b_naixue", "b_pizzahut", "b_heytea"], 22],
  ["s_coffee", "咖啡街", ["b_starbucks", "b_luckin", "b_manner"], 24],
  ["s_sport", "运动街", ["b_adidas", "b_nike", "b_lining"], 24],
  ["s_food", "美食街", ["b_haidilao", "b_pizzahut", "b_hema"], 26],
  ["s_shopping", "生活采购街", ["b_hema", "b_samsclub", "b_ikea"], 28],
  ["s_oldbrand", "老字号街", ["b_tongrentang", "b_chowtaifook", "b_haidilao"], 28],
  ["s_fashion", "快时尚街", ["b_uniqlo", "b_zara", "b_miniso"], 32],
  ["s_culture", "文化街", ["b_sisyphe", "b_zhongshuge", "b_popmart"], 34],
  ["s_toy", "玩具街", ["b_lego", "b_toysrus", "b_popmart"], 36],
  ["s_ev", "新能源街", ["b_tesla", "b_byd", "b_nio"], 38],
  ["s_auto", "名车街", ["b_benz", "b_tesla", "b_byd"], 48],
  ["s_flagship", "旗舰大街", ["b_benz", "b_zara", "b_jiajuguan"], 55],
];

export function defaultState(): State {
  return {
    version: 2,
    rows: 6,
    cols: 6,
    holes: [],
    buildings: SHOP_DEFS.map((def, i) => shop(def, i)),
    streets: STREET_DEFS.map(([id, name, types, pct]) => ({ id, name, types, pct })),
    instances: [],
    spent: 0,
    spendLog: [],
    priorities: ["total", "max", "repeat", "spend"],
  };
}

function isCell(v: unknown): v is Cell {
  if (!v || typeof v !== "object") return false;
  const c = v as Cell;
  return Number.isInteger(c.r) && Number.isInteger(c.c);
}

export function normalizeState(raw: unknown): State | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<State>;
  if (!Number.isInteger(s.rows) || !Number.isInteger(s.cols)) return null;
  if ((s.rows as number) < 2 || (s.rows as number) > 6 || (s.cols as number) < 2 || (s.cols as number) > 6) return null;
  if (!Array.isArray(s.buildings) || !Array.isArray(s.streets) || !Array.isArray(s.instances)) return null;

  const buildings: Building[] = [];
  for (const b of s.buildings) {
    if (!b || typeof b.id !== "string" || typeof b.name !== "string") return null;
    if (!isShape(b.w, b.h)) return null;
    if (!Number.isInteger(b.cost) || b.cost < 0) return null;
    buildings.push({
      id: b.id,
      name: b.name.trim(),
      color: typeof b.color === "string" ? b.color : nextColor(buildings),
      image: typeof b.image === "string" && b.image ? b.image : undefined,
      w: b.w,
      h: b.h,
      cost: b.cost,
    });
  }
  const ids = new Set(buildings.map(b => b.id));
  if (ids.size !== buildings.length) return null;

  const streets: Street[] = [];
  for (const st of s.streets) {
    if (!st || typeof st.id !== "string" || typeof st.name !== "string") return null;
    if (!Array.isArray(st.types) || st.types.length !== 3) return null;
    if (!st.types.every(t => typeof t === "string")) return null;
    if (typeof st.pct !== "number" || !(st.pct > 0)) return null;
    streets.push({ id: st.id, name: st.name.trim(), types: [st.types[0], st.types[1], st.types[2]], pct: st.pct });
  }

  const holes = Array.isArray(s.holes) ? s.holes.filter(isCell) : [];
  const state: State = {
    version: 2,
    rows: s.rows as number,
    cols: s.cols as number,
    holes: holes.filter(h => h.r >= 1 && h.c >= 1 && h.r <= (s.rows as number) && h.c <= (s.cols as number)),
    buildings,
    streets,
    instances: [],
    spent: 0,
    spendLog: [],
    priorities: ["total", "max", "repeat", "spend"],
  };

  const occupied = new Set<string>();
  for (const inst of s.instances) {
    if (!inst || typeof inst.id !== "string" || typeof inst.typeId !== "string") return null;
    if (!ids.has(inst.typeId)) return null;
    if (!Number.isInteger(inst.anchorR) || !Number.isInteger(inst.anchorC)) return null;
    if (!Number.isInteger(inst.paid) || inst.paid < 0) return null;
    const b = buildings.find(x => x.id === inst.typeId)!;
    const rotated = inst.rotated === true && b.w * b.h === 2;
    const shape = instanceShape(b, rotated);
    const cells = footprint(inst.anchorR, inst.anchorC, shape.w, shape.h);
    for (const cell of cells) {
      if (!isEnabled(state, cell.r, cell.c)) return null;
      const k = cellKey(cell.r, cell.c);
      if (occupied.has(k)) return null;
      occupied.add(k);
    }
    state.instances.push({
      id: inst.id,
      typeId: inst.typeId,
      anchorR: inst.anchorR,
      anchorC: inst.anchorC,
      paid: inst.paid,
      ...(rotated ? { rotated: true } : {}),
    });
  }

  if (Array.isArray(s.spendLog)) {
    for (const entry of s.spendLog) {
      if (!entry || typeof entry.instanceId !== "string") return null;
      if (!Number.isInteger(entry.paid) || entry.paid < 0) return null;
      state.spendLog.push({
        instanceId: entry.instanceId,
        typeId: typeof entry.typeId === "string" ? entry.typeId : "",
        paid: entry.paid,
        at: typeof entry.at === "number" ? entry.at : 0,
      });
    }
    state.spent = state.spendLog.reduce((n, e) => n + e.paid, 0);
  } else if (Number.isInteger(s.spent) && (s.spent as number) >= 0) {
    state.spent = s.spent as number;
  } else {
    return null;
  }

  if (Array.isArray(s.priorities) && isPermutation(s.priorities)) state.priorities = s.priorities;
  return state;
}

export function isPermutation(list: unknown): list is Objective[] {
  if (!Array.isArray(list) || list.length !== 4) return false;
  const set = new Set(list);
  return OBJECTIVES.every(k => set.has(k));
}

export type Scheme = { stats: Stats };

export function compareSchemes(a: Scheme, b: Scheme, priorities: Objective[]): number {
  for (const key of priorities) {
    const better = OBJECTIVE_META[key].better;
    const av = key === "spend" ? a.stats.spent : a.stats[key];
    const bv = key === "spend" ? b.stats.spent : b.stats[key];
    if (av === bv) continue;
    if (better === "higher") return av > bv ? 1 : -1;
    return av < bv ? 1 : -1;
  }
  return 0;
}

export function previewPlacement(view: ViewModel, typeId: string, anchorR: number, anchorC: number, rotated = false): {
  ok: boolean;
  cells: Cell[];
  error?: AppError;
} {
  const b = view.buildings.find(x => x.id === typeId);
  if (!b) return { ok: false, cells: [], error: errorOf("unknown_type") };
  const { w, h } = instanceShape(b, rotated);
  const cells = footprint(anchorR, anchorC, w, h);
  const byKey = new Map(view.cells.map(c => [cellKey(c.r, c.c), c]));
  for (const cell of cells) {
    const found = byKey.get(cellKey(cell.r, cell.c));
    if (!found) return { ok: false, cells, error: errorOf("out_of_bounds", undefined, cells) };
    if (!found.enabled) return { ok: false, cells, error: errorOf("disabled_cell", undefined, cells) };
    if (found.instanceId) return { ok: false, cells, error: errorOf("occupied", undefined, cells) };
  }
  return { ok: true, cells };
}

export function dictionaryOf(state: State) {
  return {
    streets: state.streets.map(st => ({
      id: st.id,
      name: st.name,
      pct: st.pct,
      buildings: st.types.map(id => {
        const b = buildingOf(state, id);
        return { id, name: b?.name ?? "已删除" };
      }),
    })),
    priorities: state.priorities.map(key => ({
      key,
      label: OBJECTIVE_META[key].label,
      better: OBJECTIVE_META[key].better,
    })),
  };
}

export function buildingListOf(state: State) {
  return {
    buildings: state.buildings.map(b => ({
      id: b.id,
      name: b.name,
      w: b.w,
      h: b.h,
      cost: b.cost,
    })),
  };
}
