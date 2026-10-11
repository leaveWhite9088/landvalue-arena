export const BASE_PRICE = 100;
export const MAX_BOARDS = 4;
export const MIN_EDGE = 2;
export const MAX_EDGE = 6;

export const DEFAULT_BOARDS: { rows: number; cols: number }[] = [
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 },
  { rows: 3, cols: 4 },
  { rows: 5, cols: 5 },
];

export const OBJECTIVES = ["total", "max", "repeat", "spend"] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const OBJECTIVE_META: Record<Objective, { label: string; better: "higher" | "lower" }> = {
  total: { label: "总地价最高", better: "higher" },
  max: { label: "最高地价最高", better: "higher" },
  repeat: { label: "总重复次数最少", better: "lower" },
  spend: { label: "累计花费最少", better: "lower" },
};

export const SHAPES = [
  { w: 1, h: 1, label: "1×1" },
  { w: 2, h: 1, label: "2×1" },
  { w: 1, h: 2, label: "1×2" },
  { w: 2, h: 2, label: "2×2" },
] as const;

export const PALETTE = [
  "#c9842a", "#d85a3a", "#3f8f86", "#6d8f62", "#a85b93",
  "#4d78c4", "#c44b4b", "#7a6cc0", "#b39a3e", "#3a9bb8",
  "#8aa04a", "#c47a45",
];

export type Cell = { r: number; c: number };
export type Coord = { board: number; r: number; c: number };

export type Board = {
  rows: number;
  cols: number;
  holes: Cell[];
};

export type Building = {
  id: string;
  name: string;
  color: string;
  w: number;
  h: number;
  cost: number;
  image?: string;
};

export type Street = {
  id: string;
  name: string;
  types: [string, string, string];
  pct: number;
};

export type Instance = {
  id: string;
  typeId: string;
  /** 棋盘编号，从 1 计 */
  board: number;
  anchorR: number;
  anchorC: number;
  paid: number;
  /** 仅两格建筑（1×2/2×1）可旋转：true 时宽高互换 */
  rotated?: boolean;
};

export type SpendEntry = {
  instanceId: string;
  typeId: string;
  paid: number;
  at: number;
};

export type State = {
  version: 3;
  boards: Board[];
  buildings: Building[];
  streets: Street[];
  instances: Instance[];
  spent: number;
  spendLog: SpendEntry[];
  priorities: Objective[];
};

export type Stats = {
  total: number;
  max: number;
  repeat: number;
  placed: number;
  cells: number;
  covered: number;
  spent: number;
};

export type LedgerLine = { label: string; pct: number };

export type CellView = {
  board: number;
  r: number;
  c: number;
  enabled: boolean;
  price: number;
  priceExact: number;
  instanceId: string | null;
};

export type InstanceView = {
  id: string;
  typeId: string;
  name: string;
  color: string;
  w: number;
  h: number;
  board: number;
  anchorR: number;
  anchorC: number;
  cells: Coord[];
  paid: number;
  rotated: boolean;
};

export type FormationView = {
  streetId: string;
  name: string;
  pct: number;
  board: number;
  instanceIds: string[];
};

export type BoardView = {
  board: number;
  rows: number;
  cols: number;
};

export type ViewModel = {
  boards: BoardView[];
  cells: CellView[];
  instances: InstanceView[];
  formations: FormationView[];
  ledger: { board: number; r: number; c: number; lines: LedgerLine[] }[];
  stats: Stats;
  buildings: Building[];
  streets: Street[];
  priorities: Objective[];
  spent: number;
};

export type MapInstance = {
  instanceId: string;
  typeId: string;
  name: string;
  w: number;
  h: number;
  rotated: boolean;
  anchor: Cell;
  cells: Cell[];
};

export type MapBoard = {
  board: number;
  rows: number;
  cols: number;
  disabled: Cell[];
  instances: MapInstance[];
  prices: { r: number; c: number; price: number }[];
};

export type MapSummary = {
  notes: string[];
  boards: MapBoard[];
  formations: FormationView[];
  spent: number;
  stats: {
    total: number;
    max: number;
    repeat: number;
    placed: number;
    cells: number;
    covered: number;
  };
};

export type AppError = { code: string; message: string; cells?: { board?: number; r: number; c: number }[] };

export type EndedBy = "human" | "model";

export type CallTally = {
  total: number;
  failed: number;
  tools: { tool: string; ok: number; fail: number }[];
};

export type RoundMeta = {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  endedBy: EndedBy | null;
  calls: CallTally;
};

export type RoundRecord = {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number | null;
  endedBy: EndedBy | null;
  state: State;
  events: KanbanEvent[];
};

export type ToolName =
  | "get_objectives"
  | "get_street_dictionary"
  | "list_buildings"
  | "get_map"
  | "place_building"
  | "demolish_building"
  | "finish_round";

export type KanbanEvent = {
  id: string;
  at: number;
  tool: ToolName;
  ok: boolean;
  reason?: string;
  error?: AppError;
  headline: string;
  detail?: string;
  /** 该次调用当时的盘面快照：总地价、最高地价、重复建筑、花费、占地 */
  statsLine?: string;
  accent?: string;
  canScrub: boolean;
  snapshot?: ViewModel;
  payload?: unknown;
};

export type SaveMeta = {
  id: string;
  name: string;
  time: number;
  snapshot: {
    total: number;
    max: number;
    repeat: number;
    spent: number;
    placed: number;
    cells: number;
  };
  endedBy?: EndedBy;
  roundId?: string;
};

export type SaveRecord = SaveMeta & { data: State };

export type UserCommand =
  | { type: "place"; typeId: string; board: number; anchorR: number; anchorC: number; rotated?: boolean }
  | { type: "demolish"; board: number; r: number; c: number }
  | { type: "setSize"; board: number; rows: number; cols: number }
  | { type: "setHole"; board: number; r: number; c: number; disabled: boolean }
  | { type: "addBoard"; rows: number; cols: number }
  | { type: "removeBoard"; board: number }
  | { type: "resetBoard" }
  | { type: "addBuilding"; name: string; w: number; h: number; cost: number; color?: string }
  | { type: "updateBuilding"; id: string; name?: string; w?: number; h?: number; cost?: number; color?: string; image?: string | null }
  | { type: "deleteBuilding"; id: string }
  | { type: "addStreet"; name: string; types: [string, string, string]; pct: number }
  | { type: "updateStreet"; id: string; name?: string; types?: [string, string, string]; pct?: number }
  | { type: "deleteStreet"; id: string }
  | { type: "setPriorities"; priorities: Objective[] }
  | { type: "clearBoard" }
  | { type: "reset" }
  | { type: "save"; name: string }
  | { type: "load"; id: string }
  | { type: "deleteSave"; id: string }
  | { type: "import"; data: unknown }
  | { type: "export" };

export const MAP_NOTES = [
  "每次调用都要带 roundId。那是这一局的编号，由开局的人给你，不要猜，不要省略。",
  "最多 4 块棋盘，每块行数和列数独立，以本次返回的 boards 为准。不要假设只有一块，也不要假设尺寸。",
  "占用、禁用、固有光环、专业街成街与光环都不跨棋盘。同一条街可以在不同棋盘上各自成街一次。",
  "总地价、最高地价、重复次数、累计花费、占地是全部棋盘合计。重复按类型在全部棋盘上的座数计算，不按棋盘分开。",
  "建筑自身占的格子也吃到该建筑的固有加成，以及盖到它的专业街。同一条街在同一簇里对同一格只乘一次。",
  "地价已由服务端算好。不要自己复利，用返回的 price 和 stats。",
  "比较两个方案时调用 get_objectives。第 1 项最重要，持平再比下一项。不要假设总地价一定排第一。",
];

export const TOOLS: { name: ToolName; description: string }[] = [
  {
    name: "get_objectives",
    description: "读取当前优化目标，按重要性从高到低排列。必须带 roundId，这一局的编号。第 1 项最重要。比较方案时按这个顺序做字典序比较：先比第 1 项，持平再比下一项。better 为 higher 表示越大越好，lower 表示越小越好。不要假设总地价一定排第一，顺序可以由人改，以本次返回为准。模型不能改这个顺序。",
  },
  {
    name: "get_street_dictionary",
    description: "读取这一局的专业街词典。必须带 roundId。每条街恰好 3 个建筑类型，加成是百分比。成街按座、按同一块棋盘上的八邻接连通簇判定，不跨棋盘，不按格，光环重叠不算相邻。优化目标调用 get_objectives。不要自己计算地价。",
  },
  {
    name: "list_buildings",
    description: "读取这一局可放置的建筑类型。必须带 roundId。返回标识、名称、宽×高和造价。放置时用这里的类型标识，不是场上某一座的标识。宽是列数，高是行数。两格建筑（1×2/2×1）放置时可旋转，1×1 和 2×2 不能。预算没有上限。",
  },
  {
    name: "get_map",
    description: "读取这一局的全部棋盘。必须带 roundId。坐标是三元组 (board, row, col)，都从 1 计。最多 4 块，编号是 boards 的顺序，尺寸各自独立，以返回值为准。占用、光环、成街都不跨棋盘。返回每块的尺寸、禁用格、建筑和每格地价，以及这一局合计的总地价、最高地价、重复次数、累计花费、占地。地价已含建筑自身占地，不要自行复利。哪个指标最重要调用 get_objectives。不能用这个工具改配置。",
  },
  {
    name: "place_building",
    description: "在这一局指定棋盘的锚点放置一座建筑。必须带 roundId，不要猜。board、row、col 都从 1 计。锚点是该棋盘上占地左上角。占地任一格越出这块棋盘、踩到禁用格或已有建筑，整步拒绝且不扣费。buildingTypeId 来自 list_buildings。两格建筑可设 rotated 为 true 使宽高互换。reason 必填，不参与计算，会原样出现在这一局的步骤栏。写一小段放置理由。成功时返回更新后的这一局地图。不能增删棋盘或改尺寸。对局结束后不能再放。",
  },
  {
    name: "demolish_building",
    description: "拆除这一局里、指定棋盘上该坐标所在的整座建筑。必须带 roundId。board、row、col 都从 1 计。不退钱。该格没有建筑则拒绝。reason 必填，会原样出现在步骤栏。写一小段拆除理由。成功时返回更新后的这一局地图。对局结束后不能再拆。",
  },
  {
    name: "finish_round",
    description: "把这一局作为终局提交。必须带 roundId。不移动棋子，不退钱，只是交卷。提交后不能再放置或拆除。reason 写一小段，说明为什么现在交卷。人也可以强制截止，那会另作标记，和模型交卷不是同一种结束。",
  },
];

export function tallyCalls(events: { tool: string; ok: boolean }[]): CallTally {
  const by = new Map(TOOLS.map(tool => [tool.name, { tool: tool.name, ok: 0, fail: 0 }]));
  let failed = 0;
  for (const event of events) {
    const row = by.get(event.tool as ToolName);
    if (!row) continue;
    if (event.ok) row.ok++;
    else {
      row.fail++;
      failed++;
    }
  }
  return {
    total: events.length,
    failed,
    tools: [...by.values()].filter(row => row.ok + row.fail > 0),
  };
}

export function cellKey(board: number, r: number, c: number): string {
  return board + "," + r + "," + c;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function fmtNum(n: number): string {
  const r = round1(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export function shapeLabel(w: number, h: number): string {
  return w + "×" + h;
}

export function isShape(w: number, h: number): boolean {
  return SHAPES.some(s => s.w === w && s.h === h);
}
