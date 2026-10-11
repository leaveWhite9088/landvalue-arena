import { clear, el } from "./dom.ts";
import type { Coord, KanbanEvent, RoundMeta, ViewModel } from "../shared/types.ts";
import { fmtNum, modelOf, MODELS, shapeLabel, tallyCalls } from "../shared/types.ts";

export type UiState = {
  view: ViewModel;
  events: KanbanEvent[];
  selectedType: string | null;
  rotated: boolean;
  demolishMode: boolean;
  selectedInstance: string | null;
  scrubId: string | null;
  railCollapsed: boolean;
  formationsOpen: boolean;
  rounds: RoundMeta[];
  watchId: string | null;
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
  onStartRound: (version: string, model: string) => void = () => {};
  onEndRound: () => void = () => {};
  onResumeRound: (id: string) => void = () => {};
  onRenameRound: (id: string, name: string) => void = () => {};
  onPauseRound: (id: string) => void = () => {};
  onWatchRound: (id: string | null) => void = () => {};
  onDeleteRound: (id: string) => void = () => {};
  onCopyRound: (id: string) => void = () => {};
  private menuOpen = false;
  private confirmDelete = "";

  private topbar = document.querySelector("#topbar") as HTMLElement;
  private rail = document.querySelector("#rail") as HTMLElement;
  private workspace = document.querySelector("#workspace") as HTMLElement;
  private hover = document.querySelector("#hover") as HTMLElement;
  private scrub = document.querySelector("#scrub") as HTMLElement;
  private popover = document.querySelector("#popover") as HTMLElement;
  private rank = document.querySelector("#rank") as HTMLDialogElement;
  private toastEl = document.querySelector("#toast") as HTMLElement;
  private boot = document.querySelector("#boot") as HTMLElement;
  private confirmEnd = false;
  private confirmWatch: string | null = null;
  private toastTimer = 0;

  setClock(text: string) {
    const node = document.querySelector(".round-clock");
    if (node) node.textContent = text;
  }

  render(state: UiState) {
    if (state.watchId !== this.confirmWatch) {
      this.confirmEnd = false;
      this.confirmWatch = state.watchId;
    }
    this.lastTop = state;
    this.workspace.classList.toggle("rail-collapsed", state.railCollapsed);
    this.renderTop(state);
    this.renderRail(state);
    this.renderScrub(state);
    this.renderPopover(state);
    this.renderRank(state);
    if (state.selectedInstance) this.renderPinned(state);
    else if (!this.hover.hidden && !this.hover.classList.contains("pinned")) {
      /* follow-cursor card is updated by placeHover */
    }
  }

  placeHover(view: ViewModel, cell: Coord | null, x: number, y: number, pinned: boolean) {
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
    hideStatTip();
    clear(this.topbar);
    const brand = el("div", "brand");
    brand.append(el("span", "seal"));
    const titles = el("div", "brand-titles");
    titles.append(el("h1", undefined, "地价沙盘"));
    brand.append(titles);
    const stats = el("div", "stats");
    const s = state.view.stats;
    const watching = state.rounds.find(round => round.id === state.watchId);
    const elapsed = watching ? elapsedSecOf(watching) : 0;
    const scoreStat = stat(fmtNum(s.score), "得分", () => scoreTip(s, elapsed));
    if (watching && !watching.endedAt) {
      const b = scoreStat.querySelector("b");
      if (b) {
        b.classList.add("round-score");
        b.dataset.base = String(s.total + s.max * 2 - s.repeat * 100 - s.spent);
      }
    }
    stats.append(
      scoreStat,
      stat(fmtNum(s.total), "总地价", () => totalTip(state.view)),
      stat(fmtNum(s.max), "最高", () => maxTip(state.view)),
      stat(String(s.repeat), "重复", () => repeatTip(state.view)),
      stat(s.covered + "/" + s.cells, "占地"),
      stat(String(s.spent), "花费"),
    );
    if (watching) {
      const calls = tallyCalls(state.events);
      const clock = clockStat(fmtElapsed(watching), "用时");
      if (!watching.endedAt) {
        const idle = !watching.paused && watching.clockStart == null && watching.accMs === 0;
        clock.classList.add("clock-toggle");
        if (watching.paused) clock.classList.add("paused");
        clock.title = idle ? "模型第一次调用工具后开始计时"
          : watching.paused ? "已暂停，点击继续计时" : "点击暂停计时";
        clock.addEventListener("click", () => this.onPauseRound(watching.id));
      }
      stats.append(clock);
      stats.append(stat(String(calls.total), "调用"));
    }
    const actions = el("div", "top-actions");
    if (state.demolishMode || state.selectedType) {
      let armed = "拆除模式";
      if (!state.demolishMode) {
        const b = state.view.buildings.find(x => x.id === state.selectedType);
        const shape = b ? (state.rotated && b.w * b.h === 2 ? shapeLabel(b.h, b.w) : shapeLabel(b.w, b.h)) : "";
        armed = "放置：" + (b?.name ?? "") + (b && b.w * b.h === 2 ? " " + shape + "（R 旋转）" : "");
      }
      const tag = el("button", "armed-tag" + (state.demolishMode ? " danger" : ""), armed + " ×");
      tag.type = "button";
      tag.title = "点击取消，回到查看模式";
      tag.addEventListener("click", () => this.onCancelArm());
      actions.append(tag);
    }
    const menu = this.roundMenu(state, watching);
    const build = el("button", "btn", "建造");
    build.type = "button";
    build.addEventListener("click", () => this.onOpenBuild());
    const streets = el("button", "ghost", "街区 " + state.view.formations.length);
    streets.type = "button";
    streets.addEventListener("click", () => this.onToggleFormations());
    const config = el("button", "ghost", "配置");
    config.type = "button";
    config.addEventListener("click", () => this.onOpenConfig());
    const rank = el("button", "ghost", "排行");
    rank.type = "button";
    rank.addEventListener("click", () => {
      this.rank.showModal();
      this.renderRank(state);
    });
    const startLabel = !watching ? "开始" : watching.endedAt ? "继续" : this.confirmEnd ? "确认结束" : "结束";
    const start = el("button", "btn", startLabel);
    start.type = "button";
    start.addEventListener("click", () => {
      if (watching?.endedAt) {
        this.onResumeRound(watching.id);
        return;
      }
      if (!watching) {
        this.askRoundName();
        return;
      }
      if (!this.confirmEnd) {
        this.confirmEnd = true;
        this.renderTop(state);
        return;
      }
      this.confirmEnd = false;
      this.onEndRound();
    });
    actions.append(menu, build, streets, config, rank, start);
    this.topbar.append(brand, stats, actions);
  }

  private renderRank(state: UiState) {
    if (!this.rank.open) return;
    clear(this.rank);
    const panel = el("div", "rank-panel");
    const title = el("div", "rank-title");
    title.append(el("h2", undefined, "排行榜"));
    const close = el("button", "ghost", "关闭");
    close.type = "button";
    close.addEventListener("click", () => this.rank.close());
    title.append(close);
    panel.append(title);
    if (!state.rounds.length) {
      panel.append(el("p", "hint", "还没有对局。开始一局之后，这里按综合得分排名。"));
      this.rank.append(panel);
      return;
    }
    const table = el("table", "rank-table");
    const head = el("tr");
    for (const t of ["#", "对局", "得分", "总地价", "最高", "重复", "花费", "用时", "调用", "状态"]) {
      head.append(el("th", undefined, t));
    }
    table.append(head);
    const rows = [...state.rounds].sort((a, b) => b.summary.score - a.summary.score);
    rows.forEach((round, i) => {
      const tr = el("tr", state.watchId === round.id ? "current" : undefined);
      tr.append(el("td", "num", String(i + 1)));
      const nameCell = el("td", "rank-name");
      const who = modelOf(round.model);
      if (who) nameCell.append(face(who.avatar));
      nameCell.append(el("span", undefined, round.name));
      tr.append(nameCell);
      tr.append(el("td", "num rank-score", fmtNum(round.summary.score)));
      tr.append(el("td", "num", fmtNum(round.summary.total)));
      tr.append(el("td", "num", fmtNum(round.summary.max)));
      tr.append(el("td", "num", String(round.summary.repeat)));
      tr.append(el("td", "num", String(round.summary.spent)));
      tr.append(el("td", "num", fmtElapsed(round)));
      tr.append(el("td", "num", String(round.calls.total)));
      tr.append(el("td", undefined, roundMark(round)));
      tr.title = "点开看这一局";
      tr.addEventListener("click", () => {
        this.rank.close();
        this.onWatchRound(round.id);
      });
      table.append(tr);
    });
    panel.append(table);
    this.rank.append(panel);
  }

  private renderRail(state: UiState) {
    // 重渲染会重建列表，先记住滚动位置；贴底时保持贴底，否则留在原处
    const oldList = this.rail.querySelector(".rail-list");
    const oldTop = oldList ? oldList.scrollTop : null;
    const wasAtBottom = oldList
      ? oldList.scrollHeight - oldList.scrollTop - oldList.clientHeight < 24
      : true;
    clear(this.rail);
    const watching = state.rounds.find(round => round.id === state.watchId);
    const who = modelOf(watching?.model);
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
    if (!state.watchId) list.append(el("p", "rail-empty", "这是出题盘。开始一局之后，模型的每次调用会发到那一局的步骤里。"));
    else if (!state.events.length) {
      const name = who?.name ?? "模型";
      list.append(el("p", "rail-empty", "这一局还没有调用。把编号给" + name + "，它带上 roundId 之后，每次调用会发到这里。"));
    }
    let stepNo = 0;
    for (const event of state.events) {
      if (event.canScrub) stepNo++;
      list.append(this.chatMessage(state, event, who, stepNo));
    }
    body.append(head, list);
    this.rail.append(tab, body);
    if (oldTop != null && !state.railCollapsed) {
      if (wasAtBottom) list.scrollTop = list.scrollHeight;
      else list.scrollTop = oldTop;
    }
  }

  private chatMessage(state: UiState, event: KanbanEvent, who: ReturnType<typeof modelOf>, stepNo: number) {
    const msg = el("article", "msg" + (event.ok ? "" : " fail") + (state.scrubId === event.id ? " active" : ""));
    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.alt = "";
    if (who) avatar.src = who.avatar;
    else avatar.hidden = true;
    const main = el("div", "msg-main");
    const name = el("div", "msg-name");
    name.append(el("b", undefined, who?.name ?? "这一局"));
    name.append(el("time", undefined, clockOf(event.at)));
    const bubble = el("button", "msg-bubble" + (event.canScrub ? " scrubbable" : ""));
    bubble.type = "button";
    if (event.accent) bubble.style.borderLeftColor = event.accent;
    bubble.append(el("strong", undefined, event.canScrub ? stepNo + "  " + event.headline : event.headline));
    if (event.reason) bubble.append(el("p", "reason", event.reason));
    if (event.detail) bubble.append(el("p", "detail", event.detail));
    if (event.payload) {
      const pre = el("pre", undefined, JSON.stringify(event.payload, null, 2));
      bubble.append(pre);
    }
    bubble.addEventListener("click", () => {
      if (event.canScrub) this.onScrub(event.id);
      else if (event.payload) bubble.classList.toggle("open");
    });
    main.append(name, bubble);
    // 盘面快照不进气泡，作为气泡之间的分隔行，样式另立
    if (event.statsLine) {
      const snap = el("div", "msg-snap");
      snap.append(el("span", undefined, event.statsLine));
      main.append(snap);
    }
    msg.append(avatar, main);
    return msg;
  }

  private roundMenu(state: UiState, watching: RoundMeta | undefined) {
    const wrap = el("div", "round-menu" + (this.menuOpen ? " open" : ""));
    const who = modelOf(watching?.model);
    const label = watching ? watching.name + " · " + roundMark(watching) : "出题盘";
    const current = el("button", "ghost round-current");
    current.type = "button";
    current.title = who ? label + " · " + who.name : label;
    if (who) current.append(face(who.avatar));
    current.append(document.createTextNode(label));
    current.addEventListener("click", (e) => {
      e.stopPropagation();
      this.menuOpen = !this.menuOpen;
      this.renderTop(state);
    });
    wrap.append(current);
    if (!this.menuOpen) return wrap;
    const list = el("div", "round-list");
    list.append(this.roundChoice(state, "出题盘", null, !state.watchId));
    // 同一厂家排在一起（按 MODELS 顺序），组内按开局时间从早到晚
    const modelOrder = new Map(MODELS.map((m, i) => [m.id, i]));
    const sorted = [...state.rounds].sort((a, b) =>
      (modelOrder.get(a.model as never) ?? 99) - (modelOrder.get(b.model as never) ?? 99)
      || a.startedAt - b.startedAt);
    for (const round of sorted) {
      const who = modelOf(round.model);
      const row = el("div", "round-row" + (state.watchId === round.id ? " current" : ""));
      const name = el("button", "round-name", round.name + (who ? " · " + who.name : "") + " · " + roundMark(round));
      name.type = "button";
      name.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeMenu();
        this.onWatchRound(round.id);
      });
      const code = el("span", "round-code", round.id.slice(0, 8));
      code.title = round.id;
      code.addEventListener("click", (e) => {
        e.stopPropagation();
        this.onCopyRound(round.id);
      });
      const edit = el("span", "round-edit", "改名");
      edit.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = window.prompt("新的对局名称", round.name);
        if (next == null) return;
        this.closeMenu();
        this.onRenameRound(round.id, next);
        this.renderTop(state);
      });
      const resume = round.endedAt ? el("span", "round-resume", "继续") : null;
      resume?.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeMenu();
        this.onResumeRound(round.id);
        this.renderTop(state);
      });
      const del = el("span", "round-del", this.confirmDelete === round.id ? "确认" : "删除");
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.confirmDelete !== round.id) {
          this.confirmDelete = round.id;
          this.renderTop(state);
          return;
        }
        this.confirmDelete = "";
        this.closeMenu();
        this.onDeleteRound(round.id);
      });
      if (who) row.append(face(who.avatar), name, code, ...(resume ? [resume] : []), edit, del);
      else row.append(name, code, ...(resume ? [resume] : []), edit, del);
      list.append(row);
    }
    wrap.append(list);
    this.armMenuCloser();
    return wrap;
  }

  private closeMenu() {
    this.menuOpen = false;
    this.confirmDelete = "";
  }

  private armMenuCloser() {
    if (this.menuCloser) return;
    this.menuCloser = (e: MouseEvent) => {
      if (!this.menuOpen) return;
      const menu = this.topbar.querySelector(".round-menu");
      if (menu?.contains(e.target as Node)) return;
      this.closeMenu();
      if (!this.lastTop) return;
      this.renderTop(this.lastTop);
    };
    document.addEventListener("click", this.menuCloser);
  }

  private lastTop: UiState | null = null;
  private menuCloser: ((e: MouseEvent) => void) | null = null;

  private roundChoice(state: UiState, label: string, id: string | null, current: boolean) {
    const row = el("button", "round-row" + (current ? " current" : ""), label);
    row.type = "button";
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.closeMenu();
      this.onWatchRound(id);
    });
    return row;
  }

  private askRoundName() {
    const dialog = document.querySelector("#round-name") as HTMLDialogElement | null;
    if (!dialog) return;
    const input = dialog.querySelector("input[name=version]") as HTMLInputElement;
    input.value = "";
    const pick = dialog.querySelector("#model-pick") as HTMLElement;
    if (!pick.childElementCount) {
      for (const model of MODELS) {
        const label = el("label", "model-opt");
        const radio = el("input") as HTMLInputElement;
        radio.type = "radio";
        radio.name = "model";
        radio.value = model.id;
        radio.required = true;
        label.append(radio, face(model.avatar), el("span", undefined, model.name));
        pick.append(label);
      }
    }
    pick.querySelectorAll("input").forEach(node => { (node as HTMLInputElement).checked = false; });
    dialog.showModal();
    input.focus();
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
      btn.append(el("b", undefined, f.name + "  +" + f.pct + "%  · 棋盘 " + f.board));
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
    this.fillHover(state.view, { board: inst.board, r: inst.anchorR, c: inst.anchorC }, true);
    this.hover.style.left = "14px";
    this.hover.style.top = "14px";
  }

  private fillHover(view: ViewModel, cell: Coord, pinned: boolean) {
    const found = view.cells.find(c => c.board === cell.board && c.r === cell.r && c.c === cell.c);
    if (!found || !found.enabled) {
      this.hover.hidden = true;
      return;
    }
    clear(this.hover);
    this.hover.hidden = false;
    this.hover.classList.toggle("pinned", pinned);
    const inst = found.instanceId ? view.instances.find(i => i.id === found.instanceId) : undefined;
    this.hover.append(el("h3", undefined, inst ? inst.name : "空地"));
    this.hover.append(el("p", "meta", "棋盘 " + cell.board + "，第 " + cell.r + " 行，第 " + cell.c + " 列"));
    this.hover.append(el("div", "price num", fmtNum(found.price)));
    if (inst) {
      this.hover.append(el("p", "meta", shapeLabel(inst.w, inst.h) + "  锚点 (" + inst.anchorR + "," + inst.anchorC + ")  造价 " + inst.paid));
    }
    const lines = view.ledger.find(l => l.board === cell.board && l.r === cell.r && l.c === cell.c)?.lines ?? [];
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

function face(src: string) {
  const img = document.createElement("img");
  img.className = "face";
  img.src = src;
  img.alt = "";
  return img;
}

function clockOf(at: number) {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes());
}

function roundMark(round: RoundMeta) {
  if (round.endedBy === "model") return "模型结束";
  if (round.endedBy === "human") return "人工结束";
  return "进行中";
}

function clockStat(value: string, label: string) {
  const node = stat(value, label);
  node.querySelector("b")?.classList.add("round-clock");
  return node;
}

function stat(value: string, label: string, tip?: () => string[]) {
  const node = el("div", "stat" + (tip ? " has-tip" : ""));
  node.append(el("b", "num", value), el("span", undefined, label));
  if (tip) {
    node.addEventListener("mouseenter", () => showStatTip(node, tip()));
    node.addEventListener("mouseleave", hideStatTip);
  }
  return node;
}

let statTip: HTMLElement | null = null;

function showStatTip(anchor: HTMLElement, lines: string[]) {
  if (!statTip) {
    statTip = el("div", "stat-tip");
    document.body.append(statTip);
  }
  clear(statTip);
  for (const line of lines) statTip.append(el("p", undefined, line));
  statTip.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, window.innerWidth - 16);
  statTip.style.maxWidth = width + "px";
  statTip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + "px";
  statTip.style.top = rect.bottom + 6 + "px";
}

function hideStatTip() {
  if (statTip) statTip.hidden = true;
}

type ViewStats = ViewModel["stats"];
type ViewCell = ViewModel["cells"][number];

function scoreTip(s: ViewStats, elapsedSec: number): string[] {
  return [
    "得分 = 总地价 + 最高地价×2 − 重复×100 − 花费 − 用时秒数",
    "= " + fmtNum(s.total) + " + " + fmtNum(s.max) + "×2 − " + s.repeat + "×100 − " + s.spent + " − " + elapsedSec,
    "= " + fmtNum(s.total) + " + " + fmtNum(s.max * 2) + " − " + (s.repeat * 100) + " − " + s.spent + " − " + elapsedSec,
    "= " + fmtNum(s.score),
  ];
}

function cellLabel(view: ViewModel, cell: ViewCell): string {
  const inst = cell.instanceId ? view.instances.find(i => i.id === cell.instanceId) : undefined;
  return "棋盘" + cell.board + " (" + cell.r + "," + cell.c + ")" + (inst ? " " + inst.name : "");
}

function totalTip(view: ViewModel): string[] {
  const top = view.cells.filter(c => c.enabled).sort((a, b) => b.priceExact - a.priceExact).slice(0, 10);
  if (!top.length) return ["没有启用格。"];
  return ["地价最高的 " + top.length + " 格：",
    ...top.map((c, i) => (i + 1) + ". " + cellLabel(view, c) + "　" + fmtNum(c.price))];
}

function maxTip(view: ViewModel): string[] {
  const sorted = view.cells.filter(c => c.enabled).sort((a, b) => b.priceExact - a.priceExact);
  const best = sorted[0];
  if (!best) return ["没有启用格。"];
  const ties = sorted.filter(c => c.priceExact === best.priceExact).length;
  const lines = [cellLabel(view, best) + "，地价 " + fmtNum(best.price)
    + (ties > 1 ? "（另有 " + (ties - 1) + " 格并列最高）" : "")];
  const ledger = view.ledger.find(l => l.board === best.board && l.r === best.r && l.c === best.c)?.lines ?? [];
  if (!ledger.length) lines.push("没有吃到任何加成。");
  else for (const line of ledger) lines.push(line.label + "  +" + line.pct + "%");
  return lines;
}

function repeatTip(view: ViewModel): string[] {
  const counts = new Map<string, number>();
  for (const inst of view.instances) counts.set(inst.typeId, (counts.get(inst.typeId) ?? 0) + 1);
  const rows = [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return ["没有重复建筑。每种类型都只有一座。"];
  const lines = ["总重复 " + view.stats.repeat + "："];
  for (const [id, n] of rows) {
    const name = view.instances.find(i => i.typeId === id)?.name ?? id;
    lines.push(name + " ×" + n + "，重复 " + (n - 1));
  }
  return lines;
}

function toolLabel(tool: string) {
  if (tool === "get_objectives") return "目标";
  if (tool === "get_street_dictionary") return "词典";
  if (tool === "list_buildings") return "建筑";
  if (tool === "get_map") return "地图";
  if (tool === "place_building") return "放置";
  if (tool === "demolish_building") return "拆除";
  if (tool === "finish_round") return "交卷";
  return tool;
}

function elapsedSecOf(round: RoundMeta): number {
  const running = round.endedAt == null && round.clockStart != null ? Date.now() - round.clockStart : 0;
  return Math.max(0, Math.floor((round.accMs + running) / 1000));
}

// 用时固定 时:分:秒，宽度不变，不跳格式
function fmtElapsed(round: RoundMeta) {
  const s = elapsedSecOf(round);
  const p = (n: number) => String(n).padStart(2, "0");
  return p(Math.floor(s / 3600)) + ":" + p(Math.floor((s % 3600) / 60)) + ":" + p(s % 60);
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
