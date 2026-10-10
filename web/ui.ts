import { clear, el } from "./dom.ts";
import type { KanbanEvent, ViewModel } from "../shared/types.ts";
import { fmtNum, shapeLabel } from "../shared/types.ts";

export type UiState = {
  view: ViewModel;
  events: KanbanEvent[];
  selectedType: string | null;
  demolishMode: boolean;
  selectedInstance: string | null;
  scrubId: string | null;
  railCollapsed: boolean;
  formationsOpen: boolean;
};

export class UI {
  onToggleDemolish: () => void = () => {};
  onDemolish: () => void = () => {};
  onOpenConfig: () => void = () => {};
  onOpenBuild: () => void = () => {};
  onCancelArm: () => void = () => {};
  onToggleRail: () => void = () => {};
  onToggleFormations: () => void = () => {};
  onEmphasis: (ids: string[] | null) => void = () => {};
  onScrub: (id: string | null) => void = () => {};

  private topbar = document.querySelector("#topbar") as HTMLElement;
  private rail = document.querySelector("#rail") as HTMLElement;
  private workspace = document.querySelector("#workspace") as HTMLElement;
  private hover = document.querySelector("#hover") as HTMLElement;
  private scrub = document.querySelector("#scrub") as HTMLElement;
  private popover = document.querySelector("#popover") as HTMLElement;
  private toastEl = document.querySelector("#toast") as HTMLElement;
  private boot = document.querySelector("#boot") as HTMLElement;
  private toastTimer = 0;

  render(state: UiState) {
    this.workspace.classList.toggle("rail-collapsed", state.railCollapsed);
    this.renderTop(state);
    this.renderRail(state);
    this.renderScrub(state);
    this.renderPopover(state);
    if (state.selectedInstance) this.renderPinned(state);
    else if (!this.hover.hidden && !this.hover.classList.contains("pinned")) {
      /* follow-cursor card is updated by placeHover */
    }
  }

  placeHover(view: ViewModel, cell: { r: number; c: number } | null, x: number, y: number, pinned: boolean) {
    if (pinned) return;
    if (!cell) {
      this.hover.hidden = true;
      return;
    }
    this.fillHover(view, cell, false);
    const stage = this.hover.parentElement as HTMLElement;
    const rect = stage.getBoundingClientRect();
    let left = x - rect.left + 14;
    let top = y - rect.top + 14;
    if (left + 250 > rect.width) left = x - rect.left - 254;
    if (top + 180 > rect.height) top = Math.max(8, y - rect.top - 160);
    this.hover.style.left = left + "px";
    this.hover.style.top = top + "px";
  }

  toast(message: string) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 2400);
  }

  hideBoot() {
    this.boot.hidden = true;
  }

  bootFail() {
    const msg = document.querySelector("#boot-msg");
    if (msg) msg.textContent = "没有连上沙盘服务。在项目目录运行 npm run dev，然后再打开这个页面。";
  }

  scrollRail() {
    const list = this.rail.querySelector(".rail-list");
    if (list) list.scrollTop = list.scrollHeight;
  }

  private renderTop(state: UiState) {
    clear(this.topbar);
    const brand = el("div", "brand");
    brand.append(el("span", "seal"));
    brand.append(el("h1", undefined, "地价沙盘"));
    const stats = el("div", "stats");
    const s = state.view.stats;
    stats.append(
      stat(fmtNum(s.total), "总地价"),
      stat(fmtNum(s.max), "最高"),
      stat(String(s.repeat), "重复"),
      stat(s.covered + "/" + s.cells, "占地"),
      stat(String(s.spent), "花费"),
    );
    const actions = el("div", "top-actions");
    if (state.demolishMode || state.selectedType) {
      const armed = state.demolishMode
        ? "拆除模式"
        : "放置：" + (state.view.buildings.find(b => b.id === state.selectedType)?.name ?? "");
      const tag = el("button", "armed-tag" + (state.demolishMode ? " danger" : ""), armed + " ×");
      tag.type = "button";
      tag.title = "点击取消，回到查看模式";
      tag.addEventListener("click", () => this.onCancelArm());
      actions.append(tag);
    }
    const build = el("button", "btn", "建造");
    build.type = "button";
    build.addEventListener("click", () => this.onOpenBuild());
    const streets = el("button", "ghost", "街区 " + state.view.formations.length);
    streets.type = "button";
    streets.addEventListener("click", () => this.onToggleFormations());
    const config = el("button", "ghost", "配置");
    config.type = "button";
    config.addEventListener("click", () => this.onOpenConfig());
    actions.append(build, streets, config);
    this.topbar.append(brand, stats, actions);
  }

  private renderRail(state: UiState) {
    clear(this.rail);
    const tab = el("button", "rail-tab", "步骤" + (countSteps(state.events) ? " " + countSteps(state.events) : ""));
    tab.type = "button";
    tab.addEventListener("click", () => this.onToggleRail());
    const body = el("div", "rail-body");
    const head = el("div", "rail-head");
    head.append(el("h2", undefined, "步骤"));
    const collapse = el("button", "text-btn", "收起");
    collapse.type = "button";
    collapse.addEventListener("click", () => this.onToggleRail());
    head.append(collapse);
    const list = el("div", "rail-list");
    if (!state.events.length) list.append(el("p", "rail-empty", "还没有操作。MCP 连上之后，每一步会出现在这里。"));
    let stepNo = 0;
    for (const event of state.events) {
      if (event.canScrub) stepNo++;
      if (event.tool === "place_building" || event.tool === "demolish_building") {
        const card = el("button", "step" + (event.ok ? "" : " fail") + (event.canScrub ? " scrubbable" : "") + (state.scrubId === event.id ? " active" : ""));
        card.type = "button";
        if (event.accent) card.style.borderLeftColor = event.accent;
        card.append(el("strong", undefined, event.canScrub ? stepNo + "  " + event.headline : event.headline));
        if (event.reason) card.append(el("p", "reason", event.reason));
        if (event.detail) card.append(el("p", "detail", event.detail));
        if (event.canScrub) card.addEventListener("click", () => this.onScrub(event.id));
        list.append(card);
      } else {
        const line = el("button", "read-line", event.headline);
        line.type = "button";
        if (event.payload) {
          const pre = el("pre", undefined, JSON.stringify(event.payload, null, 2));
          line.addEventListener("click", () => line.classList.toggle("open"));
          line.append(pre);
        }
        list.append(line);
      }
    }
    body.append(head, list);
    this.rail.append(tab, body);
  }

  private renderScrub(state: UiState) {
    if (!state.scrubId) {
      this.scrub.hidden = true;
      return;
    }
    const n = stepIndex(state.events, state.scrubId);
    clear(this.scrub);
    this.scrub.hidden = false;
    this.scrub.append(el("span", undefined, "正在查看第 " + n + " 步"));
    const back = el("button", "btn", "回到当前");
    back.type = "button";
    back.addEventListener("click", () => this.onScrub(null));
    this.scrub.append(back);
  }

  private renderPopover(state: UiState) {
    if (!state.formationsOpen) {
      this.popover.hidden = true;
      return;
    }
    clear(this.popover);
    this.popover.hidden = false;
    if (!state.view.formations.length) {
      this.popover.append(el("p", "hint", "还没有形成专业街。"));
      return;
    }
    for (const f of state.view.formations) {
      const btn = el("button", "form-line");
      btn.type = "button";
      const names = f.instanceIds.map(id => state.view.instances.find(i => i.id === id)?.name ?? "建筑").join("、");
      btn.append(el("b", undefined, f.name + "  +" + f.pct + "%"));
      btn.append(el("span", undefined, names));
      btn.addEventListener("mouseenter", () => this.onEmphasis(f.instanceIds));
      btn.addEventListener("mouseleave", () => this.onEmphasis(null));
      btn.addEventListener("focus", () => this.onEmphasis(f.instanceIds));
      btn.addEventListener("blur", () => this.onEmphasis(null));
      this.popover.append(btn);
    }
  }

  private renderPinned(state: UiState) {
    const inst = state.view.instances.find(i => i.id === state.selectedInstance);
    if (!inst) {
      this.hover.hidden = true;
      return;
    }
    this.fillHover(state.view, { r: inst.anchorR, c: inst.anchorC }, true);
    this.hover.style.left = "14px";
    this.hover.style.top = "14px";
  }

  private fillHover(view: ViewModel, cell: { r: number; c: number }, pinned: boolean) {
    const found = view.cells.find(c => c.r === cell.r && c.c === cell.c);
    if (!found || !found.enabled) {
      this.hover.hidden = true;
      return;
    }
    clear(this.hover);
    this.hover.hidden = false;
    this.hover.classList.toggle("pinned", pinned);
    const inst = found.instanceId ? view.instances.find(i => i.id === found.instanceId) : undefined;
    this.hover.append(el("h3", undefined, inst ? inst.name : "空地"));
    this.hover.append(el("p", "meta", "第 " + cell.r + " 行，第 " + cell.c + " 列"));
    this.hover.append(el("div", "price num", fmtNum(found.price)));
    if (inst) {
      this.hover.append(el("p", "meta", shapeLabel(inst.w, inst.h) + "  锚点 (" + inst.anchorR + "," + inst.anchorC + ")  造价 " + inst.paid));
    }
    const lines = view.ledger.find(l => l.r === cell.r && l.c === cell.c)?.lines ?? [];
    if (!lines.length) this.hover.append(el("p", "meta", "没有加成。"));
    else {
      const ul = el("ul");
      for (const line of lines) ul.append(el("li", undefined, line.label + "  +" + line.pct + "%"));
      this.hover.append(ul);
    }
    if (pinned && inst) {
      const btn = el("button", "text-btn danger", "拆除这座");
      btn.type = "button";
      btn.addEventListener("click", () => this.onDemolish());
      this.hover.append(btn);
    }
  }
}

function stat(value: string, label: string) {
  const node = el("div", "stat");
  node.append(el("b", "num", value), el("span", undefined, label));
  return node;
}

function countSteps(events: KanbanEvent[]) {
  return events.filter(e => e.canScrub).length;
}

function stepIndex(events: KanbanEvent[], id: string) {
  let n = 0;
  for (const event of events) {
    if (!event.canScrub) continue;
    n++;
    if (event.id === id) return n;
  }
  return n;
}
