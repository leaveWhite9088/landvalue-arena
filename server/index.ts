import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { apply } from "../shared/apply.ts";
import { errorOf } from "../shared/errors.ts";
import {
  buildView, buildingListOf, buildingOf, dictionaryOf,
  displayStats, fmtDelta, formatSnapshot, nid, toMapSummary,
} from "../shared/rules.ts";
import type { KanbanEvent, SaveRecord, State, Stats, ToolName, UserCommand, ViewModel } from "../shared/types.ts";
import { loadEvents, loadSaves, loadState, saveEvents, saveMeta, saveSaves, saveState } from "./store.ts";

const PORT = 26101;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

let state: State = await loadState();
let events: KanbanEvent[] = await loadEvents();
let saves: SaveRecord[] = await loadSaves();
await saveState(state);

const clients = new Set<WebSocket>();
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function send(ws: WebSocket, msg: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: unknown) {
  for (const ws of clients) send(ws, msg);
}

function viewOf(): ViewModel {
  return buildView(state);
}

function hello(ws: WebSocket) {
  send(ws, { type: "hello", view: viewOf(), events, saves: saveMeta(saves) });
}

async function pushEvent(event: KanbanEvent) {
  events.push(event);
  let snaps = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (!events[i].snapshot) continue;
    snaps++;
    if (snaps > 200) events[i] = { ...events[i], snapshot: undefined, canScrub: false };
  }
  await saveEvents(events);
  broadcast({ type: "event", event });
}

async function clearEvents() {
  events = [];
  await saveEvents(events);
  broadcast({ type: "events", events });
}

async function publishView() {
  await saveState(state);
  broadcast({ type: "view", view: viewOf() });
}

function publishSaves() {
  void saveSaves(saves);
  broadcast({ type: "saves", saves: saveMeta(saves) });
}

const CLEARS = new Set(["clearBoard", "reset", "resetBoard", "import", "load"]);

async function runUserCommand(command: UserCommand): Promise<{ ok: boolean; error?: { code: string; message: string }; exportData?: State }> {
  if (command.type === "export") return { ok: true, exportData: state };
  if (command.type === "save") return saveNamed(command.name);
  if (command.type === "deleteSave") {
    saves = saves.filter(s => s.id !== command.id);
    publishSaves();
    return { ok: true };
  }
  if (command.type === "load") {
    const found = saves.find(s => s.id === command.id);
    if (!found) return { ok: false, error: errorOf("not_found", "找不到这个存档。") };
    state = found.data;
    await publishView();
    await clearEvents();
    return { ok: true };
  }

  const applied = apply(state, { ...command, source: "user" });
  if (!applied.ok) return applied;
  state = applied.state;
  await publishView();
  if (CLEARS.has(command.type)) await clearEvents();
  return { ok: true };
}

function saveNamed(name: string): { ok: boolean; error?: { code: string; message: string } } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: errorOf("empty_name") };
  if (saves.some(s => s.name === trimmed)) return { ok: false, error: errorOf("duplicate_save_name") };
  const view = viewOf();
  const shown = displayStats(view.stats);
  saves.push({
    id: nid("save"),
    name: trimmed,
    time: Date.now(),
    snapshot: {
      total: shown.total,
      max: shown.max,
      repeat: shown.repeat,
      spent: view.spent,
      placed: shown.placed,
      cells: shown.cells,
    },
    data: state,
  });
  publishSaves();
  return { ok: true };
}

function deltaOf(before: Stats, after: Stats) {
  return {
    total: roundShown(after.total - before.total),
    max: roundShown(after.max - before.max),
    repeat: after.repeat - before.repeat,
    spent: after.spent - before.spent,
  };
}

function detailOf(kind: "place" | "demolish", board: number, r: number, c: number, before: Stats, after: Stats): string {
  const where = "棋盘 " + board + " 第 " + r + " 行第 " + c + " 列";
  const parts = [where];
  const dt = roundShown(after.total - before.total);
  if (dt !== 0) parts.push("总地价 " + fmtDelta(after.total - before.total));
  if (kind === "demolish") parts.push("花费不变");
  else parts.push("花费 " + fmtDelta(after.spent - before.spent));
  return parts.join("，");
}

function roundShown(n: number): number {
  return Math.round(n * 10) / 10;
}

async function runTool(name: string, args: Record<string, unknown>) {
  const statsLine = formatSnapshot(state);
  if (name === "get_street_dictionary") {
    const payload = dictionaryOf(state);
    await pushEvent({ id: nid("e"), at: Date.now(), tool: name, ok: true, headline: "查看了词典", statsLine, canScrub: false, payload });
    return payload;
  }
  if (name === "list_buildings") {
    const payload = buildingListOf(state);
    await pushEvent({ id: nid("e"), at: Date.now(), tool: name, ok: true, headline: "查看了可放置建筑", statsLine, canScrub: false, payload });
    return payload;
  }
  if (name === "get_map") {
    const payload = toMapSummary(viewOf());
    await pushEvent({ id: nid("e"), at: Date.now(), tool: name, ok: true, headline: "查看了地图", statsLine, canScrub: false, payload });
    return payload;
  }
  if (name === "place_building") return mutate("place", args);
  if (name === "demolish_building") return mutate("demolish", args);
  return { ok: false, error: errorOf("not_found", "没有这个工具。") };
}

async function mutate(kind: "place" | "demolish", args: Record<string, unknown>) {
  const reason = typeof args.reason === "string" ? args.reason : "";
  const board = Number(args.board);
  const row = Number(args.row);
  const col = Number(args.col);
  const beforeView = viewOf();
  const before = beforeView.stats;
  const typeId = String(args.buildingTypeId ?? "");
  const named = kind === "place" ? buildingOf(state, typeId)?.name : undefined;

  const applied = kind === "place"
    ? apply(state, { type: "place", typeId, board, anchorR: row, anchorC: col, rotated: args.rotated === true, reason, source: "mcp" })
    : apply(state, { type: "demolish", board, r: row, c: col, reason, source: "mcp" });

  if (!applied.ok) {
    await pushEvent({
      id: nid("e"),
      at: Date.now(),
      tool: kind === "place" ? "place_building" : "demolish_building",
      ok: false,
      reason,
      error: applied.error,
      headline: kind === "place" ? (named ? "没能放下" + named : "没能放置") : "没能拆除",
      detail: applied.error.message,
      statsLine: formatSnapshot(state),
      canScrub: false,
    });
    return { ok: false, error: applied.error };
  }

  state = applied.state;
  const view = viewOf();
  const after = view.stats;
  const inst = kind === "place"
    ? view.instances.find(i => i.id === applied.placedId)
    : beforeView.instances.find(i => i.id === applied.removedId);
  const accent = inst?.color;
  const headline = kind === "place"
    ? "放下" + (inst?.name ?? "建筑")
    : "拆掉" + (inst?.name ?? "建筑");
  await pushEvent({
    id: nid("e"),
    at: Date.now(),
    tool: kind === "place" ? "place_building" : "demolish_building",
    ok: true,
    reason,
    headline,
    detail: detailOf(kind, board, row, col, before, after),
    statsLine: formatSnapshot(state),
    accent,
    canScrub: true,
    snapshot: view,
  });
  await publishView();

  const summary = toMapSummary(view);
  const delta = deltaOf(before, after);
  if (kind === "place" && inst) {
    return {
      ok: true,
      ...summary,
      placed: {
        instanceId: inst.id,
        typeId: inst.typeId,
        name: inst.name,
        board: inst.board,
        anchor: { r: inst.anchorR, c: inst.anchorC },
        cells: inst.cells.map(cell => ({ r: cell.r, c: cell.c })),
        paid: inst.paid,
      },
      delta,
    };
  }
  return {
    ok: true,
    ...summary,
    removed: inst ? {
      instanceId: inst.id,
      typeId: inst.typeId,
      name: inst.name,
      board: inst.board,
      cells: inst.cells.map(cell => ({ r: cell.r, c: cell.c })),
    } : undefined,
    delta,
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  if (!existsSync(dist)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("沙盘服务在运行。开发时打开 http://127.0.0.1:5173");
    return;
  }
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const path = join(dist, rel);
  if (!path.startsWith(dist) || !existsSync(path)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
  createReadStream(path).pipe(res);
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.method === "POST" && url.pathname === "/internal/tool") {
    try {
      const body = JSON.parse(await readBody(req) || "{}") as { name?: string; args?: Record<string, unknown> };
      const result = await enqueue(() => runTool(String(body.name), body.args ?? {}));
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: errorOf("invalid_import", "请求无法解析。") }));
    }
    return;
  }
  if (req.method === "GET") serveStatic(req, res);
  else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", ws => {
  clients.add(ws);
  hello(ws);
  ws.on("close", () => clients.delete(ws));
  ws.on("message", raw => {
    void enqueue(async () => {
      let msg: { type?: string; id?: string; command?: UserCommand };
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.type !== "command" || !msg.id || !msg.command) return;
      const result = await runUserCommand(msg.command);
      send(ws, { type: "result", id: msg.id, ...result });
    });
  });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log("地价沙盘  http://127.0.0.1:" + PORT);
});
