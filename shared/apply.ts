import type { AppError, Building, State, UserCommand } from "./types.ts";
import { isShape } from "./types.ts";
import { errorOf } from "./errors.ts";
import {
  buildingOf, defaultState, footprint, instanceCells, isEnabled, isPermutation,
  nextColor, nid, normalizeState, occupantAt,
} from "./rules.ts";

export type ApplyResult =
  | { ok: true; state: State; placedId?: string; removedId?: string }
  | { ok: false; error: AppError };

function fail(code: string, message?: string, cells?: { r: number; c: number }[]): ApplyResult {
  return { ok: false, error: errorOf(code, message, cells) };
}

function clips(state: State, rows: number, cols: number, holes: { r: number; c: number }[]): boolean {
  const holeKeys = new Set(holes.map(h => h.r + "," + h.c));
  for (const inst of state.instances) {
    const b = buildingOf(state, inst.typeId);
    if (!b) return true;
    for (const cell of footprint(inst.anchorR, inst.anchorC, b.w, b.h)) {
      if (cell.r < 1 || cell.c < 1 || cell.r > rows || cell.c > cols) return true;
      if (holeKeys.has(cell.r + "," + cell.c)) return true;
    }
  }
  return false;
}

export function apply(state: State, command: UserCommand & { reason?: string; source?: "user" | "mcp" }): ApplyResult {
  switch (command.type) {
    case "place":
      return place(state, command);
    case "demolish":
      return demolish(state, command);
    case "setSize":
      return setSize(state, command.rows, command.cols);
    case "setHole":
      return setHole(state, command.r, command.c, command.disabled);
    case "addBuilding":
      return addBuilding(state, command);
    case "updateBuilding":
      return updateBuilding(state, command);
    case "deleteBuilding":
      return deleteBuilding(state, command.id);
    case "addStreet":
      return addStreet(state, command);
    case "updateStreet":
      return updateStreet(state, command);
    case "deleteStreet":
      return deleteStreet(state, command.id);
    case "setPriorities":
      if (!isPermutation(command.priorities)) return fail("bad_priorities");
      return { ok: true, state: { ...state, priorities: command.priorities } };
    case "clearBoard":
      return { ok: true, state: { ...state, instances: [], spent: 0, spendLog: [] } };
    case "reset":
      return { ok: true, state: defaultState() };
    case "import": {
      const next = normalizeState(command.data);
      if (!next) return fail("invalid_import");
      return { ok: true, state: next };
    }
    default:
      return fail("not_found", "这个操作不改盘面。");
  }
}

function place(state: State, command: { typeId: string; anchorR: number; anchorC: number; reason?: string; source?: "user" | "mcp" }): ApplyResult {
  if (command.source === "mcp" && !command.reason?.trim()) return fail("missing_reason");
  const b = buildingOf(state, command.typeId);
  if (!b) return fail("unknown_type");
  if (!Number.isInteger(command.anchorR) || !Number.isInteger(command.anchorC)) return fail("out_of_bounds");
  const cells = footprint(command.anchorR, command.anchorC, b.w, b.h);
  for (const cell of cells) {
    if (!Number.isInteger(cell.r) || cell.r < 1 || cell.c < 1 || cell.r > state.rows || cell.c > state.cols) {
      return fail("out_of_bounds", undefined, cells);
    }
    if (!isEnabled(state, cell.r, cell.c)) return fail("disabled_cell", undefined, cells);
    if (occupantAt(state, cell.r, cell.c)) return fail("occupied", undefined, cells);
  }
  const id = nid("i");
  const paid = b.cost;
  return {
    ok: true,
    placedId: id,
    state: {
      ...state,
      instances: [...state.instances, { id, typeId: b.id, anchorR: command.anchorR, anchorC: command.anchorC, paid }],
      spent: state.spent + paid,
      spendLog: [...state.spendLog, { instanceId: id, typeId: b.id, paid, at: Date.now() }],
    },
  };
}

function demolish(state: State, command: { r: number; c: number; reason?: string; source?: "user" | "mcp" }): ApplyResult {
  if (command.source === "mcp" && !command.reason?.trim()) return fail("missing_reason");
  const inst = occupantAt(state, command.r, command.c);
  if (!inst) return fail("empty_cell");
  return {
    ok: true,
    removedId: inst.id,
    state: { ...state, instances: state.instances.filter(i => i.id !== inst.id) },
  };
}

function setSize(state: State, rows: number, cols: number): ApplyResult {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || rows > 6 || cols < 2 || cols > 6) {
    return fail("bad_size");
  }
  const holes = state.holes.filter(h => h.r <= rows && h.c <= cols);
  if (clips(state, rows, cols, holes)) return fail("clipped", "缩小后会切到已经放好的建筑，先拆除再改。");
  return { ok: true, state: { ...state, rows, cols, holes } };
}

function setHole(state: State, r: number, c: number, disabled: boolean): ApplyResult {
  if (r < 1 || c < 1 || r > state.rows || c > state.cols) return fail("out_of_bounds");
  const holes = state.holes.filter(h => !(h.r === r && h.c === c));
  if (disabled) holes.push({ r, c });
  if (clips(state, state.rows, state.cols, holes)) {
    return fail("clipped", "这个格子上有建筑，先拆除再禁用。");
  }
  return { ok: true, state: { ...state, holes } };
}

function cleanName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 12) return null;
  return trimmed;
}

function addBuilding(state: State, command: { name: string; w: number; h: number; cost: number; color?: string }): ApplyResult {
  const name = cleanName(command.name);
  if (!name) return fail("bad_name");
  if (!isShape(command.w, command.h)) return fail("bad_shape");
  if (!Number.isInteger(command.cost) || command.cost < 0) return fail("bad_cost");
  const building: Building = {
    id: nid("b"),
    name,
    color: command.color || nextColor(state.buildings),
    w: command.w,
    h: command.h,
    cost: command.cost,
  };
  return { ok: true, state: { ...state, buildings: [...state.buildings, building] } };
}

function updateBuilding(state: State, command: { id: string; name?: string; w?: number; h?: number; cost?: number; color?: string; image?: string | null }): ApplyResult {
  const current = buildingOf(state, command.id);
  if (!current) return fail("unknown_type");
  const next: Building = { ...current };
  if (command.name !== undefined) {
    const name = cleanName(command.name);
    if (!name) return fail("bad_name");
    next.name = name;
  }
  if (command.color) next.color = command.color;
  if (command.image !== undefined) next.image = command.image || undefined;
  if (command.cost !== undefined) {
    if (!Number.isInteger(command.cost) || command.cost < 0) return fail("bad_cost");
    next.cost = command.cost;
  }
  const shapeChanges = (command.w !== undefined && command.w !== current.w) || (command.h !== undefined && command.h !== current.h);
  if (shapeChanges) {
    if (!isShape(command.w ?? current.w, command.h ?? current.h)) return fail("bad_shape");
    if (state.instances.some(i => i.typeId === current.id)) {
      return fail("clipped", "场上还有这个建筑，先拆除再改形状。");
    }
    next.w = command.w ?? current.w;
    next.h = command.h ?? current.h;
  }
  return { ok: true, state: { ...state, buildings: state.buildings.map(b => b.id === current.id ? next : b) } };
}

function deleteBuilding(state: State, id: string): ApplyResult {
  if (!buildingOf(state, id)) return fail("unknown_type");
  if (state.instances.some(i => i.typeId === id)) {
    return fail("clipped", "场上还有这个建筑，先拆除再删除。");
  }
  return { ok: true, state: { ...state, buildings: state.buildings.filter(b => b.id !== id) } };
}

function addStreet(state: State, command: { name: string; types: [string, string, string]; pct: number }): ApplyResult {
  const name = cleanName(command.name);
  if (!name) return fail("bad_name");
  if (!streetTypesOk(state, command.types)) return fail("unknown_type", "街里有不存在的建筑。");
  if (!(command.pct > 0)) return fail("bad_pct");
  return {
    ok: true,
    state: {
      ...state,
      streets: [...state.streets, { id: nid("s"), name, types: command.types, pct: command.pct }],
    },
  };
}

function updateStreet(state: State, command: { id: string; name?: string; types?: [string, string, string]; pct?: number }): ApplyResult {
  const current = state.streets.find(s => s.id === command.id);
  if (!current) return fail("not_found");
  const next = { ...current, types: [...current.types] as [string, string, string] };
  if (command.name !== undefined) {
    const name = cleanName(command.name);
    if (!name) return fail("bad_name");
    next.name = name;
  }
  if (command.types) {
    if (!streetTypesOk(state, command.types)) return fail("unknown_type", "街里有不存在的建筑。");
    next.types = command.types;
  }
  if (command.pct !== undefined) {
    if (!(command.pct > 0)) return fail("bad_pct");
    next.pct = command.pct;
  }
  return { ok: true, state: { ...state, streets: state.streets.map(s => s.id === current.id ? next : s) } };
}

function deleteStreet(state: State, id: string): ApplyResult {
  if (!state.streets.some(s => s.id === id)) return fail("not_found");
  return { ok: true, state: { ...state, streets: state.streets.filter(s => s.id !== id) } };
}

function streetTypesOk(state: State, types: string[]): boolean {
  return types.length === 3 && types.every(t => state.buildings.some(b => b.id === t));
}

export function placementBlocked(state: State, r: number, c: number): AppError | null {
  const inst = occupantAt(state, r, c);
  if (!inst) return null;
  const b = buildingOf(state, inst.typeId);
  return errorOf("occupied", (b ? b.name : "建筑") + " 占着这块地。", instanceCells(state, inst));
}
