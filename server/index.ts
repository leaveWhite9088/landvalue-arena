import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { apply, applyBlueprintEvent } from "../shared/apply.ts";
import { errorOf } from "../shared/errors.ts";
import {
  buildView, buildingListOf, buildingOf, dictionaryOf,
  displayStats, fmtDelta, formatSnapshot, nid, objectivesOf, toMapSummary,
} from "../shared/rules.ts";
import type { EndedBy, KanbanEvent, RoundMeta, RoundRecord, SaveRecord, State, Stats, ToolName, UserCommand, ViewModel } from "../shared/types.ts";
import { modelOf, tallyCalls } from "../shared/types.ts";
import { loadEvents, loadRounds, loadSaves, loadState, saveEvents, saveMeta, saveRounds, saveSaves, saveState } from "./store.ts";

const PORT = 26101;
/** 查看事件编排坐标的密码。可用环境变量 LANDVALUE_EVENTS_PASSWORD 覆盖。 */
const EVENTS_PASSWORD = process.env.LANDVALUE_EVENTS_PASSWORD || "1234";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

let state: State = await loadState();
let events: KanbanEvent[] = await loadEvents();
let saves: SaveRecord[] = await loadSaves();
let rounds: RoundRecord[] = await loadRounds();
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
  send(ws, { type: "hello", view: viewOf(), events: [], saves: saveMeta(saves), rounds: rounds.map(metaOf) });
}

function elapsedOf(round: RoundRecord): number {
  const running = round.endedAt == null && round.clockStart != null ? Date.now() - round.clockStart : 0;
  return Math.max(0, Math.floor((round.accMs + running) / 1000));
}

/** 对局视图：未触发的事件坐标打码，触发后才公开 */
function roundView(round: RoundRecord): ViewModel {
  return buildView(round.state, elapsedOf(round), { firedIds: new Set(round.firedEvents) });
}

function metaOf(round: RoundRecord): RoundMeta {
  const shown = displayStats(roundView(round).stats);
  return {
    id: round.id,
    name: round.name,
    model: round.model,
    startedAt: round.startedAt,
    endedAt: round.endedAt,
    endedBy: round.endedBy,
    accMs: round.accMs,
    clockStart: round.clockStart,
    paused: round.paused,
    calls: tallyCalls(round.events),
    summary: { score: shown.score, total: shown.total, max: shown.max, repeat: shown.repeat, spent: shown.spent },
  };
}

async function persistRounds() {
  await saveRounds(rounds);
  broadcast({ type: "rounds", rounds: rounds.map(metaOf) });
}

function broadcastRound(round: RoundRecord, event?: KanbanEvent) {
  broadcast({
    type: "round",
    roundId: round.id,
    meta: metaOf(round),
    view: roundView(round),
    event,
  });
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
  if (trimmed.length > 64) return { ok: false, error: errorOf("bad_name", "存档名称最多 64 个字。") };
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

function roundOf(id: string): RoundRecord | undefined {
  return rounds.find(round => round.id === id);
}

function tagRound(round: RoundRecord, payload: Record<string, unknown>) {
  return {
    roundId: round.id,
    roundName: round.name,
    open: round.endedAt == null,
    endedBy: round.endedBy,
    ...payload,
  };
}

async function pushRoundEvent(round: RoundRecord, event: KanbanEvent) {
  round.events.push(event);
  let snaps = 0;
  for (let i = round.events.length - 1; i >= 0; i--) {
    if (!round.events[i].snapshot) continue;
    snaps++;
    if (snaps > 200) round.events[i] = { ...round.events[i], snapshot: undefined, canScrub: false };
  }
  await persistRounds();
  broadcastRound(round, event);
}

async function runTool(name: string, args: Record<string, unknown>) {
  const known = ["get_objectives", "get_street_dictionary", "list_buildings", "get_map", "place_building", "demolish_building", "finish_round"];
  if (!known.includes(name)) return { ok: false, error: errorOf("not_found", "没有这个工具。") };
  const roundId = typeof args.roundId === "string" ? args.roundId.trim() : "";
  if (!roundId) return { ok: false, error: errorOf("missing_round") };
  const round = roundOf(roundId);
  if (!round) return { ok: false, error: errorOf("unknown_round") };
  // 计时从第一次工具调用开始；暂停中调用不动时钟
  if (round.endedAt == null && round.clockStart == null && !round.paused && round.accMs === 0) round.clockStart = Date.now();
  if (name === "finish_round") return finishRound(round, args);
  if (name === "place_building" || name === "demolish_building") {
    if (round.endedAt != null) {
      const error = errorOf("round_closed");
      await pushRoundEvent(round, {
        id: nid("e"),
        at: Date.now(),
        tool: name,
        ok: false,
        reason: typeof args.reason === "string" ? args.reason : "",
        error,
        headline: name === "place_building" ? "没能放置" : "没能拆除",
        detail: error.message,
        statsLine: formatSnapshot(round.state, elapsedOf(round)),
        canScrub: false,
      });
      return { ok: false, error };
    }
    return mutate(round, name === "place_building" ? "place" : "demolish", args);
  }
  const statsLine = formatSnapshot(round.state, elapsedOf(round));
  const payload = name === "get_objectives"
    ? objectivesOf(round.state, new Set(round.firedEvents))
    : name === "get_street_dictionary"
      ? dictionaryOf(round.state)
      : name === "list_buildings"
        ? buildingListOf(round.state)
        : toMapSummary(roundView(round));
  const headline = name === "get_objectives" ? "查看了优化目标"
    : name === "get_street_dictionary" ? "查看了词典"
      : name === "list_buildings" ? "查看了可放置建筑"
        : "查看了地图";
  await pushRoundEvent(round, {
    id: nid("e"),
    at: Date.now(),
    tool: name as ToolName,
    ok: true,
    headline,
    statsLine,
    canScrub: false,
    payload,
  });
  return tagRound(round, payload as Record<string, unknown>);
}

async function mutate(round: RoundRecord, kind: "place" | "demolish", args: Record<string, unknown>) {
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  const tool: ToolName = kind === "place" ? "place_building" : "demolish_building";
  if (reason.length < 8) {
    const error = errorOf("missing_reason", kind === "place"
      ? "写一小段放置理由，说明为什么放在这块棋盘的这个位置。不要只写一两个字。"
      : "写一小段拆除理由，说明为什么拆。不要只写一两个字。");
    await pushRoundEvent(round, {
      id: nid("e"), at: Date.now(), tool, ok: false, reason, error,
      headline: kind === "place" ? "没能放置" : "没能拆除",
      detail: error.message, statsLine: formatSnapshot(round.state, elapsedOf(round)), canScrub: false,
    });
    return { ok: false, error };
  }
  const board = Number(args.board);
  const row = Number(args.row);
  const col = Number(args.col);
  const beforeView = roundView(round);
  const before = beforeView.stats;
  const typeId = String(args.buildingTypeId ?? "");
  const named = kind === "place" ? buildingOf(round.state, typeId)?.name : undefined;
  const applied = kind === "place"
    ? apply(round.state, { type: "place", typeId, board, anchorR: row, anchorC: col, rotated: args.rotated === true, reason, source: "mcp" })
    : apply(round.state, { type: "demolish", board, r: row, c: col, reason, source: "mcp" });
  if (!applied.ok) {
    await pushRoundEvent(round, {
      id: nid("e"), at: Date.now(), tool, ok: false, reason, error: applied.error,
      headline: kind === "place" ? (named ? "没能放下" + named : "没能放置") : "没能拆除",
      detail: applied.error.message, statsLine: formatSnapshot(round.state, elapsedOf(round)), canScrub: false,
    });
    return { ok: false, error: applied.error };
  }
  round.state = applied.state;
  const view = roundView(round);
  const after = view.stats;
  const inst = kind === "place"
    ? view.instances.find(i => i.id === applied.placedId)
    : beforeView.instances.find(i => i.id === applied.removedId);
  await pushRoundEvent(round, {
    id: nid("e"),
    at: Date.now(),
    tool,
    ok: true,
    reason,
    headline: kind === "place" ? "放下" + (inst?.name ?? "建筑") : "拆掉" + (inst?.name ?? "建筑"),
    detail: detailOf(kind, board, row, col, before, after),
    statsLine: formatSnapshot(round.state, elapsedOf(round)),
    accent: inst?.color,
    canScrub: true,
    snapshot: view,
  });
  const summary = toMapSummary(view);
  const delta = deltaOf(before, after);
  if (kind === "place" && inst) {
    return tagRound(round, {
      ok: true,
      ...summary,
      placed: {
        instanceId: inst.id, typeId: inst.typeId, name: inst.name, board: inst.board,
        anchor: { r: inst.anchorR, c: inst.anchorC },
        cells: inst.cells.map(cell => ({ r: cell.r, c: cell.c })),
        paid: inst.paid,
      },
      delta,
    });
  }
  return tagRound(round, {
    ok: true,
    ...summary,
    removed: inst ? {
      instanceId: inst.id, typeId: inst.typeId, name: inst.name, board: inst.board,
      cells: inst.cells.map(cell => ({ r: cell.r, c: cell.c })),
    } : undefined,
    delta,
  });
}

async function finishRound(round: RoundRecord, args: Record<string, unknown>) {
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (round.endedAt != null) return { ok: false, error: errorOf("round_closed", "这一局已经交过卷。") };
  if (reason.length < 8) {
    const error = errorOf("missing_reason", "写一小段交卷理由，说明为什么现在结束。");
    await pushRoundEvent(round, {
      id: nid("e"), at: Date.now(), tool: "finish_round", ok: false, reason, error,
      headline: "没能交卷", detail: error.message, statsLine: formatSnapshot(round.state, elapsedOf(round)), canScrub: false,
    });
    return { ok: false, error };
  }
  const view = roundView(round);
  await pushRoundEvent(round, {
    id: nid("e"), at: Date.now(), tool: "finish_round", ok: true, reason,
    headline: "模型交卷", detail: "终局已冻结", statsLine: formatSnapshot(round.state, elapsedOf(round)),
    canScrub: true, snapshot: view,
  });
  await closeRound(round, "model");
  return tagRound(round, { ok: true, endedBy: "model", ...toMapSummary(roundView(round)) });
}

async function closeRound(round: RoundRecord, endedBy: EndedBy) {
  if (round.endedAt == null) {
    round.endedAt = Date.now();
    round.endedBy = endedBy;
    round.accMs += round.clockStart != null ? Math.max(0, round.endedAt - round.clockStart) : 0;
    round.clockStart = null;
  }
  await persistRounds();
  broadcastRound(round);
}

// 蓝图事件：对局时钟（从首次工具调用起走字，人工暂停不计）走到 atSec 就触发。
// 触发前模型只能从 get_objectives 看到时间和种类，位置保密；触发后写进步骤轨并广播。
async function fireDueEvents() {
  for (const round of rounds) {
    if (round.endedAt != null) continue;
    const due = round.state.events
      .filter(e => !round.firedEvents.includes(e.id) && e.atSec <= elapsedOf(round))
      .sort((a, b) => a.atSec - b.atSec);
    for (const ev of due) {
      round.firedEvents.push(ev.id);
      const result = applyBlueprintEvent(round.state, ev.op);
      round.state = result.state;
      const where = "棋盘 " + ev.op.board + " 第 " + ev.op.r + " 行第 " + ev.op.c + " 列";
      const lose = ev.op.type === "disable_cell";
      let detail = result.changed ? where + (lose ? " 已禁用" : " 已可用") : where + " 已不存在，变动落空";
      if (result.grew) {
        const grown = round.state.boards[ev.op.board - 1];
        if (grown) detail = where + " 已可用，棋盘扩到 " + grown.rows + "×" + grown.cols + "，其余新格禁用";
      }
      if (result.destroyed) {
        detail += "，" + (buildingOf(result.state, result.destroyed.typeId)?.name ?? "建筑") + " 一并销毁，不退钱";
      }
      await pushRoundEvent(round, {
        id: nid("e"),
        at: Date.now(),
        tool: "event",
        ok: true,
        headline: lose ? "失去地块" : "得到地块",
        detail,
        statsLine: formatSnapshot(round.state, elapsedOf(round)),
        canScrub: true,
        snapshot: roundView(round),
      });
    }
  }
}

setInterval(() => { void enqueue(fireDueEvents); }, 1000);

function dayStamp(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate());
}

async function startRound(version: string, model: string) {
  const v = version.trim().replace(/\s+/g, "");
  const picked = modelOf(model);
  if (!picked) return { ok: false as const, error: errorOf("unknown_model") };
  if (!v) return { ok: false as const, error: errorOf("empty_name", "填一下模型版本。") };
  if (v.length > 12) return { ok: false as const, error: errorOf("bad_name", "模型版本最多 12 个字符。") };
  const day = dayStamp(Date.now());
  const seq = rounds.filter(r => r.model === picked.id && dayStamp(r.startedAt) === day).length + 1;
  const name = v + "-" + day + "-" + String(seq).padStart(2, "0");
  const now = Date.now();
  const round: RoundRecord = {
    id: crypto.randomUUID(),
    name,
    model: picked.id,
    startedAt: now,
    endedAt: null,
    endedBy: null,
    accMs: 0,
    clockStart: null,
    paused: false,
    firedEvents: [],
    state: structuredClone(state),
    events: [],
  };
  rounds.push(round);
  await persistRounds();
  broadcastRound(round);
  return { ok: true as const, roundId: round.id, name: round.name, view: roundView(round), events: round.events };
}

async function deleteRound(roundId: string) {
  const round = roundOf(roundId);
  if (!round) return { ok: false as const, error: errorOf("unknown_round") };
  rounds = rounds.filter(item => item.id !== roundId);
  await persistRounds();
  return { ok: true as const, roundId };
}

async function endRoundByHuman(roundId: string) {
  const round = roundOf(roundId);
  if (!round) return { ok: false as const, error: errorOf("unknown_round") };
  if (round.endedAt != null) return { ok: false as const, error: errorOf("round_closed", "这一局已经结束。") };
  await closeRound(round, "human");
  return { ok: true as const, roundId: round.id, endedBy: "human" as const };
}

async function resumeRound(roundId: string) {
  const round = roundOf(roundId);
  if (!round) return { ok: false as const, error: errorOf("unknown_round") };
  if (round.endedAt == null) return { ok: true as const, roundId: round.id };
  round.endedAt = null;
  round.endedBy = null;
  // 续玩：暂停过的保持暂停，还没开始过计时的保持 00:00:00 等首次调用，其余接着走
  round.clockStart = round.paused || round.accMs === 0 ? null : Date.now();
  await persistRounds();
  broadcastRound(round);
  return { ok: true as const, roundId: round.id };
}

async function pauseRound(roundId: string) {
  const round = roundOf(roundId);
  if (!round) return { ok: false as const, error: errorOf("unknown_round") };
  if (round.endedAt != null) return { ok: false as const, error: errorOf("round_closed", "这一局已经结束。") };
  if (round.clockStart != null) {
    round.accMs += Math.max(0, Date.now() - round.clockStart);
    round.clockStart = null;
    round.paused = true;
  } else if (round.paused) {
    round.clockStart = Date.now();
    round.paused = false;
  } else {
    // 模型还没调用过：允许人手动开始计时（用于演练和测试事件）
    round.clockStart = Date.now();
  }
  await persistRounds();
  broadcastRound(round);
  return { ok: true as const, roundId: round.id, timing: round.paused ? "paused" as const : "running" as const };
}

async function renameRound(roundId: string, name: string) {
  const round = roundOf(roundId);
  if (!round) return { ok: false as const, error: errorOf("unknown_round") };
  const trimmed = name.trim();
  if (!trimmed) return { ok: false as const, error: errorOf("empty_name") };
  if (trimmed.length > 64) return { ok: false as const, error: errorOf("bad_name", "对局名称最多 64 个字。") };
  round.name = trimmed;
  await persistRounds();
  return { ok: true as const, roundId: round.id, name: round.name };
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
      if (msg.type === "round" && msg.id) {
        const action = (msg as { action?: string; name?: string; roundId?: string }).action;
        const asked = (msg as { roundId?: string }).roundId;
        if (action === "start") {
          const asked = msg as { version?: string; model?: string };
          const result = await startRound(String(asked.version ?? ""), String(asked.model ?? ""));
          send(ws, { type: "result", id: msg.id, ...result });
          return;
        }
        if (action === "end") {
          const result = await endRoundByHuman(String(asked ?? ""));
          send(ws, { type: "result", id: msg.id, ...result });
          return;
        }
        if (action === "resume") {
          const result = await resumeRound(String(asked ?? ""));
          send(ws, { type: "result", id: msg.id, ...result });
          return;
        }
        if (action === "pause") {
          const result = await pauseRound(String(asked ?? ""));
          send(ws, { type: "result", id: msg.id, ...result });
          return;
        }
        if (action === "rename") {
          const named = msg as { name?: string };
          const result = await renameRound(String(asked ?? ""), String(named.name ?? ""));
          send(ws, { type: "result", id: msg.id, ...result });
          return;
        }
        if (action === "delete") {
          const result = await deleteRound(String(asked ?? ""));
          send(ws, { type: "result", id: msg.id, ...result });
          return;
        }
        if (action === "events") {
          // 查看完整编排要密码。不带 roundId 时返回出题盘的编排。结果只发给请求的客户端，不广播。
          const pass = String((msg as { password?: string }).password ?? "");
          if (pass !== EVENTS_PASSWORD) {
            send(ws, { type: "result", id: msg.id, ok: false, error: errorOf("bad_password") });
            return;
          }
          const round = asked ? roundOf(String(asked)) : undefined;
          if (asked && !round) {
            send(ws, { type: "result", id: msg.id, ok: false, error: errorOf("unknown_round") });
            return;
          }
          const source = round ? round.state.events : state.events;
          const fired = new Set(round?.firedEvents ?? []);
          send(ws, { type: "result", id: msg.id, ok: true, schedule: source.map(e => ({ ...e, fired: fired.has(e.id) })) });
          return;
        }
        if (action === "watch") {
          const round = roundOf(String(asked ?? ""));
          if (!round) {
            send(ws, { type: "result", id: msg.id, ok: false, error: errorOf("unknown_round") });
            return;
          }
          send(ws, {
            type: "result",
            id: msg.id,
            ok: true,
            roundId: round.id,
            view: roundView(round),
            events: round.events,
          });
          return;
        }
      }
      if (msg.type !== "command" || !msg.id || !msg.command) return;
      const result = await runUserCommand(msg.command);
      send(ws, { type: "result", id: msg.id, ...result });
    });
  });
});

httpServer.listen(PORT, "127.0.0.1", () => {
  console.log("地价沙盘  http://127.0.0.1:" + PORT);
});
