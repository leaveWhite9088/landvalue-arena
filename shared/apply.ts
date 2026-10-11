import type { AppError, Board, Building, State, UserCommand } from "./types.ts";
import { isShape, MAX_BOARDS } from "./types.ts";
import { errorOf } from "./errors.ts";
import {
  boardOf, buildingOf, defaultState, emptyBoards, footprint, instanceCells, instanceShape, isEnabled, isPermutation,
  nextColor, nid, normalizeState, occupantAt, validEdge,
} from "./rules.ts";

export type ApplyResult =
  | { ok: true; state: State; placedId?: string; removedId?: string }
  | { ok: false; error: AppError };

function fail(code: string, message?: string, cells?: { board?: number; r: number; c: number }[]): ApplyResult {
  return { ok: false, error: errorOf(code, message, cells) };
}

function boardClipped(state: State, board: number, rows: number, cols: number, holes: { r: number; c: number }[]): boolean {
  const holeKeys = new Set(holes.map(h => h.r + "," + h.c));
  for (const inst of state.instances) {
    if (inst.board !== board) continue;
    const b = buildingOf(state, inst.typeId);
    if (!b) return true;
    const shape = instanceShape(b, inst.rotated);
    for (const cell of footprint(inst.anchorR, inst.anchorC, shape.w, shape.h)) {
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
      return setSize(state, command.board, command.rows, command.cols);
    case "setHole":
      return setHole(state, command.board, command.r, command.c, command.disabled);
    case "addBoard":
      return addBoard(state, command.rows, command.cols);
    case "removeBoard":
      return removeBoard(state, command.board);
    case "resetBoard":
      return resetBoard(state);
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
      // 落子花的钱不退：清空只移除建筑，累计花费保留
      return { ok: true, state: { ...state, instances: [] } };
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

function place(state: State, command: { typeId: string; board: number; anchorR: number; anchorC: number; rotated?: boolean; reason?: string; source?: "user" | "mcp" }): ApplyResult {
  if (command.source === "mcp" && !command.reason?.trim()) return fail("missing_reason");
  const b = buildingOf(state, command.typeId);
  if (!b) return fail("unknown_type");
  if (!boardOf(state, command.board)) return fail("unknown_board");
  if (!Number.isInteger(command.anchorR) || !Number.isInteger(command.anchorC)) return fail("out_of_bounds");
  const rotated = command.rotated === true && b.w * b.h === 2;
  const shape = instanceShape(b, rotated);
  const cells = footprint(command.anchorR, command.anchorC, shape.w, shape.h).map(cell => ({ board: command.board, ...cell }));
  for (const cell of cells) {
    if (!isEnabled(state, command.board, cell.r, cell.c) && !inRect(state, command.board, cell.r, cell.c)) {
      return fail("out_of_bounds", undefined, cells);
    }
    if (!inRect(state, command.board, cell.r, cell.c)) return fail("out_of_bounds", undefined, cells);
    if (!isEnabled(state, command.board, cell.r, cell.c)) return fail("disabled_cell", undefined, cells);
    if (occupantAt(state, command.board, cell.r, cell.c)) return fail("occupied", undefined, cells);
  }
  const id = nid("i");
  const paid = b.cost;
  return {
    ok: true,
    placedId: id,
    state: {
      ...state,
      instances: [...state.instances, {
        id,
        typeId: b.id,
        board: command.board,
        anchorR: command.anchorR,
        anchorC: command.anchorC,
        paid,
        ...(rotated ? { rotated: true } : {}),
      }],
      spent: state.spent + paid,
      spendLog: [...state.spendLog, { instanceId: id, typeId: b.id, paid, at: Date.now() }],
    },
  };
}

function inRect(state: State, board: number, r: number, c: number): boolean {
  const found = boardOf(state, board);
  if (!found) return false;
  return Number.isInteger(r) && Number.isInteger(c) && r >= 1 && c >= 1 && r <= found.rows && c <= found.cols;
}

function demolish(state: State, command: { board: number; r: number; c: number; reason?: string; source?: "user" | "mcp" }): ApplyResult {
  if (command.source === "mcp" && !command.reason?.trim()) return fail("missing_reason");
  if (!boardOf(state, command.board)) return fail("unknown_board");
  const inst = occupantAt(state, command.board, command.r, command.c);
  if (!inst) return fail("empty_cell");
  return {
    ok: true,
    removedId: inst.id,
    state: { ...state, instances: state.instances.filter(i => i.id !== inst.id) },
  };
}

function setSize(state: State, board: number, rows: number, cols: number): ApplyResult {
  const found = boardOf(state, board);
  if (!found) return fail("unknown_board");
  if (!validEdge(rows) || !validEdge(cols)) return fail("bad_size");
  const holes = found.holes.filter(h => h.r <= rows && h.c <= cols);
  if (boardClipped(state, board, rows, cols, holes)) return fail("clipped", "缩小后会切到已经放好的建筑，先拆除再改。");
  const boards = state.boards.map((item, index) => index + 1 === board ? { rows, cols, holes } : item);
  return { ok: true, state: { ...state, boards } };
}

function setHole(state: State, board: number, r: number, c: number, disabled: boolean): ApplyResult {
  const found = boardOf(state, board);
  if (!found) return fail("unknown_board");
  if (r < 1 || c < 1 || r > found.rows || c > found.cols) return fail("out_of_bounds");
  const holes = found.holes.filter(h => !(h.r === r && h.c === c));
  if (disabled) holes.push({ r, c });
  if (boardClipped(state, board, found.rows, found.cols, holes)) {
    return fail("clipped", "这个格子上有建筑，先拆除再禁用。");
  }
  const boards = state.boards.map((item, index) => index + 1 === board ? { ...item, holes } : item);
  return { ok: true, state: { ...state, boards } };
}

function addBoard(state: State, rows: number, cols: number): ApplyResult {
  if (state.boards.length >= MAX_BOARDS) return fail("too_many_boards");
  if (!validEdge(rows) || !validEdge(cols)) return fail("bad_size");
  const board: Board = { rows, cols, holes: [] };
  return { ok: true, state: { ...state, boards: [...state.boards, board] } };
}

function removeBoard(state: State, board: number): ApplyResult {
  if (!boardOf(state, board)) return fail("unknown_board");
  if (state.boards.length <= 1) return fail("last_board");
  if (state.instances.some(inst => inst.board === board)) {
    return fail("clipped", "这块棋盘上还有建筑，先拆除再删除。");
  }
  const boards = state.boards.filter((_, index) => index + 1 !== board);
  const instances = state.instances.map(inst => inst.board > board ? { ...inst, board: inst.board - 1 } : inst);
  return { ok: true, state: { ...state, boards, instances } };
}

function resetBoard(state: State): ApplyResult {
  return {
    ok: true,
    state: {
      ...state,
      boards: emptyBoards(),
      instances: [],
      spent: 0,
      spendLog: [],
    },
  };
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

export function placementBlocked(state: State, board: number, r: number, c: number): AppError | null {
  const inst = occupantAt(state, board, r, c);
  if (!inst) return null;
  const b = buildingOf(state, inst.typeId);
  return errorOf("occupied", (b ? b.name : "建筑") + " 占着这块地。", instanceCells(state, inst));
}
