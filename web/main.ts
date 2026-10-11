import { previewPlacement } from "../shared/rules.ts";
import type { Coord, KanbanEvent, RoundMeta, SaveMeta, UserCommand, ViewModel } from "../shared/types.ts";
import { Modal } from "./modal.ts";
import { Net } from "./net.ts";
import { Palette } from "./palette.ts";
import { Scene } from "./scene.ts";
import { UI } from "./ui.ts";

const net = new Net();
const scene = new Scene(document.querySelector("#board") as HTMLCanvasElement);
const ui = new UI();
const modal = new Modal(
  document.querySelector("#config") as HTMLDialogElement,
  command => { void send(command); },
  message => ui.toast(message),
);
const palette = new Palette(
  document.querySelector("#build") as HTMLDialogElement,
  command => { void send(command); },
);

let live: ViewModel | null = null;
let events: KanbanEvent[] = [];
let saves: SaveMeta[] = [];
let rounds: RoundMeta[] = [];
let watchId: string | null = null;
let watchView: ViewModel | null = null;
let watchEvents: KanbanEvent[] = [];
let preferTemplate = false;
let selectedType: string | null = null;
let rotated = false;
let demolishMode = false;
let selectedInstance: string | null = null;
let scrubId: string | null = null;
let railCollapsed = true;
let suppressAuto = false;
let formationsOpen = false;
let connected = false;
let lastCell: Coord | null = null;
let focusBoard: number | null = null;

const lenses = document.querySelector("#lenses") as HTMLElement;
const cameraBar = document.querySelector("#camera") as HTMLElement;

const LENS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M15.1 15.1 L20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function enterBoard(board: number) {
  focusBoard = board;
  selectedInstance = null;
  scene.clearGhost();
  paint();
}

function leaveBoard() {
  focusBoard = null;
  selectedInstance = null;
  scene.clearGhost();
  paint();
}

scene.onLenses = marks => {
  lenses.replaceChildren();
  if (focusBoard != null) return;
  for (const mark of marks) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lens-btn";
    btn.style.left = mark.x + "px";
    btn.style.top = mark.y + "px";
    btn.title = "放大棋盘 " + mark.board;
    btn.setAttribute("aria-label", "放大棋盘 " + mark.board);
    btn.innerHTML = LENS_SVG;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      enterBoard(mark.board);
    });
    lenses.append(btn);
  }
};

cameraBar.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("button");
  if (!btn || focusBoard == null) return;
  if (btn.id === "cam-back") leaveBoard();
  else if (btn.id === "cam-in") scene.zoomBy(1.18);
  else if (btn.id === "cam-out") scene.zoomBy(1 / 1.18);
  else if (btn.dataset.pan) {
    const [dx, dy] = btn.dataset.pan.split(",").map(Number);
    scene.panBy(dx, dy);
  }
});

// 旋转或切换武装后，按当前悬停格重算预览，避免幻影停留在旧朝向
function refreshGhost() {
  if (!scrubId && selectedType && lastCell && live) {
    const preview = previewPlacement(live, selectedType, lastCell.board, lastCell.r, lastCell.c, rotated);
    scene.setGhost(preview.cells, preview.ok);
  }
}

function enterWatch(id: string | null) {
  preferTemplate = id == null;
  watchId = id;
  scrubId = null;
  focusBoard = null;
  selectedInstance = null;
  selectedType = null;
  demolishMode = false;
  scene.clearGhost();
  if (!id) {
    watchView = null;
    watchEvents = [];
    paint();
    return;
  }
  void net.round("watch", { roundId: id }).then(result => {
    if (watchId !== id) return;
    if (!result.ok) {
      ui.toast(result.error?.message ?? "找不到这一局。");
      return;
    }
    watchView = result.view ?? null;
    watchEvents = result.events ?? [];
    paint();
  }).catch(() => ui.toast("没有连上沙盘服务。"));
}

function shown(): ViewModel | null {
  const source = watchId ? watchEvents : events;
  if (scrubId) {
    const event = source.find(e => e.id === scrubId);
    if (event?.snapshot) return event.snapshot;
  }
  if (watchId && watchView) return watchView;
  return live;
}

function paint() {
  const view = shown();
  if (!view) return;
  if (focusBoard != null && !view.boards.some(b => b.board === focusBoard)) focusBoard = null;
  cameraBar.hidden = focusBoard == null;
  scene.setFocus(focusBoard);
  scene.show(view);
  if (scrubId) scene.clearGhost();
  else refreshGhost();
  ui.render({
    view,
    events: watchId ? watchEvents : events,
    selectedType,
    rotated,
    demolishMode,
    selectedInstance,
    scrubId,
    railCollapsed,
    formationsOpen,
    rounds,
    watchId,
  });
  modal.sync(live ?? view, saves);
  palette.sync(live ?? view, selectedType, demolishMode, !!scrubId || !!watchId);
}

async function send(command: UserCommand) {
  try {
    if (watchId && (command.type === "place" || command.type === "demolish")) {
      ui.toast("正在查看对局，不能直接改。要改题目，先回到出题盘。");
      return;
    }
    const result = await net.command(command);
    if (!result.ok && result.error) ui.toast(result.error.message);
    if (result.exportData) download(result.exportData);
    if (command.type === "place" || command.type === "demolish" || command.type === "resetBoard" || command.type === "clearBoard" || command.type === "reset") selectedInstance = null;
    return result;
  } catch {
    ui.toast("没有连上沙盘服务。");
  }
}

function download(data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "地价沙盘配置.json";
  a.click();
  URL.revokeObjectURL(a.href);
  ui.toast("配置已导出。");
}

net.onHello = msg => {
  connected = true;
  live = msg.view;
  saves = msg.saves;
  rounds = msg.rounds ?? [];
  if (watchId && !rounds.some(round => round.id === watchId)) {
    watchId = null;
    watchView = null;
    watchEvents = [];
  }
  ui.hideBoot();
  paint();
  if (watchId) void net.round("watch", { roundId: watchId });
  else if (!preferTemplate) {
    const open = [...rounds].reverse().find(round => !round.endedAt);
    if (open) enterWatch(open.id);
  }
};
net.onView = view => {
  live = view;
  paint();
};
net.onRounds = next => {
  rounds = next;
  paint();
};
net.onRound = msg => {
  rounds = rounds.map(round => round.id === msg.roundId ? msg.meta : round);
  if (!rounds.some(round => round.id === msg.roundId)) rounds = rounds.concat(msg.meta);
  if (watchId === msg.roundId) {
    watchView = msg.view;
    if (msg.event) watchEvents = watchEvents.concat(msg.event);
    if (!railCollapsed || !suppressAuto) railCollapsed = false;
    paint();
    ui.scrollRail();
  } else paint();
};
net.onEvents = next => {
  events = next;
  scrubId = null;
  paint();
};
net.onSaves = next => {
  saves = next;
  paint();
};
net.onDown = () => {
  if (!connected) ui.bootFail();
  else ui.toast("连接中断，正在重试。");
};

function demolishAt(cell: Coord) {
  if (!live || scrubId) return;
  const found = live.cells.find(item => item.board === cell.board && item.r === cell.r && item.c === cell.c);
  const inst = found?.instanceId ? live.instances.find(i => i.id === found.instanceId) : undefined;
  if (!inst) {
    ui.toast("这里没有建筑。");
    return;
  }
  void send({ type: "demolish", board: inst.board, r: inst.anchorR, c: inst.anchorC });
}

scene.onCell = (cell, kind, x, y) => {
  const view = shown();
  if (!view) return;
  if (kind === "move") {
    lastCell = cell;
    if (!scrubId && demolishMode && cell && live) {
      const view = shown();
    if (!view || !cell) return;
    const found = view.cells.find(c => c.board === cell.board && c.r === cell.r && c.c === cell.c);
      const inst = found?.instanceId ? live.instances.find(i => i.id === found.instanceId) : undefined;
      if (inst) scene.setGhost(inst.cells, false);
      else scene.clearGhost();
    } else if (!scrubId && selectedType && cell && live) {
      const preview = previewPlacement(live, selectedType, cell.board, cell.r, cell.c, rotated);
      scene.setGhost(preview.cells, preview.ok);
    } else scene.clearGhost();
    ui.placeHover(view, cell, x, y, !!selectedInstance && !scrubId && !demolishMode);
    return;
  }
  if (kind === "context") {
    if (cell) demolishAt(cell);
    return;
  }
  if (scrubId || !cell || !live) return;
  if (demolishMode) {
    demolishAt(cell);
    return;
  }
  if (selectedType) {
    void send({ type: "place", typeId: selectedType, board: cell.board, anchorR: cell.r, anchorC: cell.c, rotated });
    return;
  }
  const found = live.cells.find(c => c.board === cell.board && c.r === cell.r && c.c === cell.c);
  selectedInstance = found?.instanceId ?? null;
  paint();
};

palette.onSelectType = id => {
  selectedType = selectedType === id ? null : id;
  rotated = false;
  demolishMode = false;
  selectedInstance = null;
  scene.clearGhost();
  paint();
};
palette.onToggleDemolish = () => {
  demolishMode = !demolishMode;
  selectedType = null;
  rotated = false;
  selectedInstance = null;
  scene.clearGhost();
  paint();
};
ui.onCancelArm = () => {
  selectedType = null;
  rotated = false;
  demolishMode = false;
  scene.clearGhost();
  paint();
};
ui.onDemolish = () => {
  if (!selectedInstance || !live || scrubId) return;
  const inst = live.instances.find(i => i.id === selectedInstance);
  if (!inst) return;
  void send({ type: "demolish", board: inst.board, r: inst.anchorR, c: inst.anchorC });
};
ui.onOpenConfig = () => modal.open();
ui.onOpenBuild = () => palette.open();
const roundDialog = document.querySelector("#round-name") as HTMLDialogElement;
const roundCancel = roundDialog.querySelector("button[value='cancel']") as HTMLButtonElement;
roundCancel.addEventListener("click", () => roundDialog.close("cancel"));
roundDialog.addEventListener("close", () => {
  if (roundDialog.returnValue !== "ok") return;
  const input = roundDialog.querySelector("input") as HTMLInputElement;
  ui.onStartRound(input.value);
});
ui.onDeleteRound = id => {
  void net.round("delete", { roundId: id }).then(result => {
    if (!result.ok) {
      ui.toast(result.error?.message ?? "没有删除。");
      return;
    }
    if (watchId === id) enterWatch(null);
    else paint();
  }).catch(() => ui.toast("没有连上沙盘服务。"));
};
ui.onCopyRound = id => {
  void navigator.clipboard.writeText(id).then(() => ui.toast("编号已复制。")).catch(() => ui.toast(id));
};
ui.onStartRound = name => {
  void net.round("start", { name }).then(async result => {
    if (!result.ok) {
      ui.toast(result.error?.message ?? "没有开始。");
      return;
    }
    if (result.roundId) {
      preferTemplate = false;
      watchId = result.roundId;
      watchView = result.view ?? null;
      watchEvents = result.events ?? [];
      scrubId = null;
      focusBoard = null;
      selectedInstance = null;
      railCollapsed = false;
      try { await navigator.clipboard.writeText(result.roundId); ui.toast("对局已开始，编号已复制。主画面已切到这一局。"); }
      catch { ui.toast("对局已开始：" + result.roundId); }
    }
    paint();
  }).catch(() => ui.toast("没有连上沙盘服务。"));
};
ui.onEndRound = () => {
  if (!watchId) return;
  void net.round("end", { roundId: watchId }).then(result => {
    if (!result.ok) ui.toast(result.error?.message ?? "没有结束。");
    else ui.toast("已人工结束，并按对局名称存档。");
    paint();
  }).catch(() => ui.toast("没有连上沙盘服务。"));
};
ui.onWatchRound = id => enterWatch(id);
ui.onToggleRail = () => {
  railCollapsed = !railCollapsed;
  if (railCollapsed) suppressAuto = true;
  paint();
  requestAnimationFrame(() => scene.resize());
};
ui.onToggleFormations = () => {
  formationsOpen = !formationsOpen;
  paint();
};
ui.onEmphasis = ids => scene.setEmphasis(ids);
ui.onScrub = id => {
  scrubId = id;
  selectedType = null;
  rotated = false;
  demolishMode = false;
  selectedInstance = null;
  scene.clearGhost();
  paint();
};

document.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (!selectedType || !live || scrubId) return;
    const b = live.buildings.find(x => x.id === selectedType);
    if (!b || b.w * b.h !== 2) return;
    rotated = !rotated;
    refreshGhost();
    paint();
    return;
  }
  if (e.key === "Escape") {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (selectedType || demolishMode || selectedInstance || formationsOpen) {
      selectedType = null;
      rotated = false;
      demolishMode = false;
      selectedInstance = null;
      formationsOpen = false;
      scene.clearGhost();
      paint();
      return;
    }
    if (focusBoard != null) leaveBoard();
    return;
  }
  if (focusBoard != null && !scrubId) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
      const key = e.key.toLowerCase();
      if (e.key === "ArrowUp" || key === "w") { scene.panBy(0, 80); e.preventDefault(); return; }
      if (e.key === "ArrowDown" || key === "s") { scene.panBy(0, -80); e.preventDefault(); return; }
      if (e.key === "ArrowLeft" || key === "a") { scene.panBy(80, 0); e.preventDefault(); return; }
      if (e.key === "ArrowRight" || key === "d") { scene.panBy(-80, 0); e.preventDefault(); return; }
      if (e.key === "+" || e.key === "=") { scene.zoomBy(1.18); return; }
      if (e.key === "-" || e.key === "_") { scene.zoomBy(1 / 1.18); return; }
    }
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    ui.onDemolish();
  }
});

document.addEventListener("click", (e) => {
  const pop = document.querySelector("#popover");
  const target = e.target as Node;
  if (formationsOpen && pop && !pop.contains(target) && !(target as HTMLElement).closest?.(".top-actions")) {
    formationsOpen = false;
    scene.setEmphasis(null);
    paint();
  }
});

window.setInterval(() => {
  const round = rounds.find(item => item.id === watchId);
  if (!round || round.endedAt) return;
  const ms = Date.now() - round.startedAt;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  ui.setClock(p(m) + ":" + p(s % 60));
}, 1000);

window.addEventListener("resize", () => scene.resize());
scene.resize();
net.connect();
