export const BASE_PRICE = 100;

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
  anchorR: number;
  anchorC: number;
  paid: number;
};

export type SpendEntry = {
  instanceId: string;
  typeId: string;
  paid: number;
  at: number;
};

export type State = {
  version: 2;
  rows: number;
  cols: number;
  holes: Cell[];
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
  anchorR: number;
  anchorC: number;
  cells: Cell[];
  paid: number;
};

export type FormationView = {
  streetId: string;
  name: string;
  pct: number;
  instanceIds: string[];
};

export type ViewModel = {
  rows: number;
  cols: number;
  cells: CellView[];
  instances: InstanceView[];
  formations: FormationView[];
  ledger: { r: number; c: number; lines: LedgerLine[] }[];
  stats: Stats;
  buildings: Building[];
  streets: Street[];
  priorities: Objective[];
  spent: number;
};

export type MapSummary = {
  rows: number;
  cols: number;
  disabled: Cell[];
  instances: {
    instanceId: string;
    typeId: string;
    name: string;
    w: number;
    h: number;
    anchor: Cell;
    cells: Cell[];
  }[];
  prices: { r: number; c: number; price: number }[];
  formations: FormationView[];
  spent: number;
  stats: {
    total: number;
    max: number;
    repeat: number;
    placed: number;
    cells: number;
  };
};

export type AppError = { code: string; message: string; cells?: Cell[] };

export type ToolName =
  | "get_street_dictionary"
  | "list_buildings"
  | "get_map"
  | "place_building"
  | "demolish_building";

export type KanbanEvent = {
  id: string;
  at: number;
  tool: ToolName;
  ok: boolean;
  reason?: string;
  error?: AppError;
  headline: string;
  detail?: string;
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
};

export type SaveRecord = SaveMeta & { data: State };

export type UserCommand =
  | { type: "place"; typeId: string; anchorR: number; anchorC: number }
  | { type: "demolish"; r: number; c: number }
  | { type: "setSize"; rows: number; cols: number }
  | { type: "setHole"; r: number; c: number; disabled: boolean }
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

export const TOOLS: { name: ToolName; description: string }[] = [
  {
    name: "get_street_dictionary",
    description: "读取专业街词典和当前优化优先级。街按座计，不按格。不要自己计算地价。",
  },
  {
    name: "list_buildings",
    description: "读取可放置的建筑类型。返回标识、名称、宽×高和造价。放置时使用这里的类型标识，不是场上某一座的标识。形状不可旋转。宽是列数，高是行数。预算没有上限。",
  },
  {
    name: "get_map",
    description: "读取当前棋盘：尺寸、禁用格、每一座建筑的占地、每格地价、已形成的街、累计花费和统计。地价已由服务端算好，不要自行复利。坐标从 1 计。",
  },
  {
    name: "place_building",
    description: "在锚点放置一座建筑。锚点是占地左上角（行号、列号最小的格），坐标从 1 计，不可旋转。占地任一格越界、禁用或已占用则整步拒绝且不扣费。buildingTypeId 来自 list_buildings。理由必填，不参与计算。成功时返回更新后的地图摘要。",
  },
  {
    name: "demolish_building",
    description: "拆除坐标所在的整座建筑。不退钱。该格没有建筑则拒绝。理由必填，不参与计算。成功时返回更新后的地图摘要。",
  },
];

export function cellKey(r: number, c: number): string {
  return r + "," + c;
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
