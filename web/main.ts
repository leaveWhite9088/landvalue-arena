import { previewPlacement } from "../shared/rules.ts";
import type { KanbanEvent, SaveMeta, UserCommand, ViewModel } from "../shared/types.ts";
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
let selectedType: string | null = null;
let demolishMode = false;
let selectedInstance: string | null = null;
let scrubId: string | null = null;
let railCollapsed = true;
let suppressAuto = false;
let formationsOpen = false;
let connected = false;

function shown(): ViewModel | null {
  if (scrubId) {
    const event = events.find(e => e.id === scrubId);
    if (event?.snapshot) return event.snapshot;
  }
  return live;
}

function paint() {
  const view = shown();
  if (!view) return;
  scene.show(view);
  if (scrubId) scene.clearGhost();
  ui.render({
    view,
    events,
    selectedType,
    demolishMode,
    selectedInstance,
    scrubId,
    railCollapsed,
    formationsOpen,
  });
  modal.sync(view, saves);
  palette.sync(view, selectedType, demolishMode, !!scrubId);
}

async function send(command: UserCommand) {
  try {
    const result = await net.command(command);
    if (!result.ok && result.error) ui.toast(result.error.message);
    if (result.exportData) download(result.exportData);
    if (command.type === "place" || command.type === "demolish") selectedInstance = null;
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
  events = msg.events;
  saves = msg.saves;
  ui.hideBoot();
  paint();
};
net.onView = view => {
  live = view;
  paint();
};
net.onEvent = event => {
  events = events.concat(event);
  if (!suppressAuto && railCollapsed) railCollapsed = false;
  paint();
  ui.scrollRail();
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

function demolishAt(r: number, c: number) {
  if (!live || scrubId) return;
  const found = live.cells.find(cell => cell.r === r && cell.c === c);
  const inst = found?.instanceId ? live.instances.find(i => i.id === found.instanceId) : undefined;
  if (!inst) {
    ui.toast("这里没有建筑。");
    return;
  }
  void send({ type: "demolish", r: inst.anchorR, c: inst.anchorC });
}

scene.onCell = (cell, kind, x, y) => {
  const view = shown();
  if (!view) return;
  if (kind === "move") {
    if (!scrubId && demolishMode && cell && live) {
      const found = live.cells.find(c => c.r === cell.r && c.c === cell.c);
      const inst = found?.instanceId ? live.instances.find(i => i.id === found.instanceId) : undefined;
      if (inst) scene.setGhost(inst.cells, false);
      else scene.clearGhost();
    } else if (!scrubId && selectedType && cell && live) {
      const preview = previewPlacement(live, selectedType, cell.r, cell.c);
      scene.setGhost(preview.cells, preview.ok);
    } else scene.clearGhost();
    ui.placeHover(view, cell, x, y, !!selectedInstance && !scrubId && !demolishMode);
    return;
  }
  if (kind === "context") {
    if (cell) demolishAt(cell.r, cell.c);
    return;
  }
  if (scrubId || !cell || !live) return;
  if (demolishMode) {
    demolishAt(cell.r, cell.c);
    return;
  }
  if (selectedType) {
    void send({ type: "place", typeId: selectedType, anchorR: cell.r, anchorC: cell.c });
    return;
  }
  const found = live.cells.find(c => c.r === cell.r && c.c === cell.c);
  selectedInstance = found?.instanceId ?? null;
  paint();
};

palette.onSelectType = id => {
  selectedType = selectedType === id ? null : id;
  demolishMode = false;
  selectedInstance = null;
  scene.clearGhost();
  paint();
};
palette.onToggleDemolish = () => {
  demolishMode = !demolishMode;
  selectedType = null;
  selectedInstance = null;
  scene.clearGhost();
  paint();
};
ui.onCancelArm = () => {
  selectedType = null;
  demolishMode = false;
  scene.clearGhost();
  paint();
};
ui.onDemolish = () => {
  if (!selectedInstance || !live || scrubId) return;
  const inst = live.instances.find(i => i.id === selectedInstance);
  if (!inst) return;
  void send({ type: "demolish", r: inst.anchorR, c: inst.anchorC });
};
ui.onOpenConfig = () => modal.open();
ui.onOpenBuild = () => palette.open();
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
  demolishMode = false;
  selectedInstance = null;
  scene.clearGhost();
  paint();
};

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    selectedType = null;
    demolishMode = false;
    selectedInstance = null;
    formationsOpen = false;
    scene.clearGhost();
    paint();
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

window.addEventListener("resize", () => scene.resize());
scene.resize();
net.connect();
