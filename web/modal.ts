import { clear, el } from "./dom.ts";
import { fmtNum, MAX_BOARDS, MAX_EDGE, MIN_EDGE, OBJECTIVE_META, shapeLabel, type Objective, type SaveMeta, type UserCommand, type ViewModel } from "../shared/types.ts";

export class Modal {
  private tab = "board";
  private confirming: "clear" | "reset" | "resetBoard" | null = null;
  private view: ViewModel | null = null;
  private saves: SaveMeta[] = [];

  constructor(
    private dialog: HTMLDialogElement,
    private send: (command: UserCommand) => void,
    private toast: (message: string) => void,
  ) {}

  open() {
    if (!this.view) return;
    this.paint(true);
    if (!this.dialog.open) this.dialog.showModal();
  }

  sync(view: ViewModel, saves: SaveMeta[]) {
    this.view = view;
    this.saves = saves;
    if (!this.dialog.open) return;
    const ae = document.activeElement;
    if (ae && this.dialog.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "SELECT")) return;
    this.paint(false);
  }

  private paint(rebuildTabs: boolean) {
    const view = this.view;
    if (!view) return;
    if (!this.dialog.childElementCount || rebuildTabs) {
      clear(this.dialog);
      const head = el("div", "modal-head");
      head.append(el("h2", undefined, "配置"));
      const close = el("button", "icon-btn", "×");
      close.type = "button";
      close.setAttribute("aria-label", "关闭");
      close.addEventListener("click", () => this.dialog.close());
      head.append(close);
      const tabs = el("div", "tabs");
      for (const [id, label] of [["board", "棋盘"], ["priority", "优先级"], ["saves", "存档"]] as const) {
        const btn = el("button", "tab" + (this.tab === id ? " active" : ""), label);
        btn.type = "button";
        btn.addEventListener("click", () => { this.tab = id; this.paint(true); });
        tabs.append(btn);
      }
      const panel = el("div", "panel");
      panel.id = "config-panel";
      this.dialog.append(head, tabs, panel);
    } else {
      this.dialog.querySelectorAll(".tab").forEach((node, i) => {
        const ids = ["board", "priority", "saves"];
        node.classList.toggle("active", ids[i] === this.tab);
      });
    }
    const panel = this.dialog.querySelector("#config-panel") as HTMLElement;
    clear(panel);
    if (this.tab === "board") this.paintBoard(panel, view);
    else if (this.tab === "priority") this.paintPriority(panel, view);
    else this.paintSaves(panel);
  }

  private paintBoard(panel: HTMLElement, view: ViewModel) {
    panel.append(el("p", "hint", "最多 " + MAX_BOARDS + " 块。每块尺寸独立，记作 行×列。光环和专业街不跨棋盘。删除中间一块会把后面的编号前移。"));
    for (const board of view.boards) {
      const block = el("section", "board-block");
      const head = el("div", "row");
      head.append(el("strong", undefined, "棋盘 " + board.board + "  " + board.rows + "×" + board.cols));
      if (view.boards.length > 1) {
        const remove = el("button", "text-btn danger", "删除这块");
        remove.type = "button";
        remove.addEventListener("click", () => this.send({ type: "removeBoard", board: board.board }));
        head.append(remove);
      }
      const rows = el("input") as HTMLInputElement;
      rows.type = "number";
      rows.min = String(MIN_EDGE);
      rows.max = String(MAX_EDGE);
      rows.value = String(board.rows);
      const cols = el("input") as HTMLInputElement;
      cols.type = "number";
      cols.min = String(MIN_EDGE);
      cols.max = String(MAX_EDGE);
      cols.value = String(board.cols);
      const apply = el("button", "btn", "应用尺寸");
      apply.type = "button";
      apply.addEventListener("click", () => this.send({ type: "setSize", board: board.board, rows: Number(rows.value), cols: Number(cols.value) }));
      const size = el("div", "row");
      size.append(field("行", rows), field("列", cols), apply);
      block.append(head, size);
      const cells = view.cells.filter(cell => cell.board === board.board);
      const grid = el("div", "board-edit");
      grid.style.gridTemplateColumns = "repeat(" + board.cols + ", 28px)";
      for (const cell of cells) {
        const btn = el("button", "hole-cell" + (cell.enabled ? "" : " off"));
        btn.type = "button";
        btn.title = cell.enabled ? "禁用棋盘 " + board.board + " 第 " + cell.r + " 行第 " + cell.c + " 列" : "启用这一格";
        btn.addEventListener("click", () => this.send({ type: "setHole", board: board.board, r: cell.r, c: cell.c, disabled: cell.enabled }));
        grid.append(btn);
      }
      block.append(grid);
      panel.append(block);
    }
    if (view.boards.length < MAX_BOARDS) {
      const rows = el("input") as HTMLInputElement;
      rows.type = "number";
      rows.min = String(MIN_EDGE);
      rows.max = String(MAX_EDGE);
      rows.value = "4";
      const cols = el("input") as HTMLInputElement;
      cols.type = "number";
      cols.min = String(MIN_EDGE);
      cols.max = String(MAX_EDGE);
      cols.value = "4";
      const add = el("button", "btn", "添加棋盘");
      add.type = "button";
      add.addEventListener("click", () => this.send({ type: "addBoard", rows: Number(rows.value), cols: Number(cols.value) }));
      const row = el("div", "row");
      row.append(field("新棋盘行", rows), field("列", cols), add);
      panel.append(row);
    }
    const reset = el("button", "ghost", this.confirming === "resetBoard" ? "确认重置棋盘" : "重置棋盘");
    reset.type = "button";
    reset.addEventListener("click", () => {
      if (this.confirming !== "resetBoard") { this.confirming = "resetBoard"; this.paint(false); return; }
      this.confirming = null;
      this.send({ type: "resetBoard" });
    });
    panel.append(el("p", "hint", "重置棋盘会清空场上建筑和花费，并把棋盘恢复成默认的四块：3×3、4×4、3×4、5×5。建筑表、专业街和优先级不动。"));
    panel.append(reset);
  }

  private paintPriority(panel: HTMLElement, view: ViewModel) {
    panel.append(el("p", "hint", "先比上面的。持平再比下一项。"));
    view.priorities.forEach((key, index) => {
      const row = el("div", "row");
      row.append(el("span", undefined, "第 " + (index + 1)));
      const sel = el("select") as HTMLSelectElement;
      for (const obj of ["total", "max", "repeat", "spend"] as Objective[]) {
        sel.append(new Option(OBJECTIVE_META[obj].label, obj));
      }
      sel.value = key;
      sel.addEventListener("change", () => {
        const next = view.priorities.slice();
        const other = next.indexOf(sel.value as Objective);
        if (other !== -1 && other !== index) next[other] = next[index];
        next[index] = sel.value as Objective;
        this.send({ type: "setPriorities", priorities: next });
      });
      row.append(sel);
      panel.append(row);
    });
  }

  private paintSaves(panel: HTMLElement) {
    panel.append(el("p", "hint", "这里保存的是出题盘。开局会按当时的出题盘原样复制。已结束的对局在顶栏下拉里打开。"));
    const name = textInput("存档名称", 64);
    name.classList.add("save-name");
    const save = el("button", "btn", "保存存档");
    save.type = "button";
    save.addEventListener("click", () => {
      this.send({ type: "save", name: name.value });
      name.value = "";
    });
    const row = el("div", "row");
    row.append(name, save);
    panel.append(row);
    if (!this.saves.length) panel.append(el("p", "hint", "还没有存档。"));
    for (const sv of this.saves) {
      const item = el("div", "save-item");
      const grow = el("div", "grow");
      grow.append(el("div", undefined, sv.name));
      const d = new Date(sv.time);
      const mark = sv.endedBy === "model" ? "  · 模型结束" : sv.endedBy === "human" ? "  · 人工结束" : "";
      grow.append(el("small", undefined, stamp(d) + "  总地价 " + fmtNum(sv.snapshot.total) + "  花费 " + sv.snapshot.spent + mark));
      const load = el("button", "ghost", "加载");
      load.type = "button";
      load.addEventListener("click", () => this.send({ type: "load", id: sv.id }));
      const del = el("button", "text-btn danger", "删除");
      del.type = "button";
      del.addEventListener("click", () => this.send({ type: "deleteSave", id: sv.id }));
      item.append(grow, load, del);
      panel.append(item);
    }
    const exp = el("button", "ghost", "导出配置");
    exp.type = "button";
    exp.addEventListener("click", () => this.send({ type: "export" }));
    const imp = el("button", "ghost", "导入配置");
    imp.type = "button";
    const file = el("input") as HTMLInputElement;
    file.type = "file";
    file.accept = "application/json";
    file.hidden = true;
    imp.addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { this.send({ type: "import", data: JSON.parse(String(reader.result)) }); }
        catch { this.toast("导入失败：这不是一份有效的沙盘配置。"); }
      };
      reader.readAsText(f);
      file.value = "";
    });
    const clearBtn = el("button", "ghost", this.confirming === "clear" ? "确认清空" : "清空建筑");
    clearBtn.type = "button";
    clearBtn.addEventListener("click", () => {
      if (this.confirming !== "clear") { this.confirming = "clear"; this.paint(false); return; }
      this.confirming = null;
      this.send({ type: "clearBoard" });
    });
    const reset = el("button", "ghost", this.confirming === "reset" ? "确认重置" : "重置为示例");
    reset.type = "button";
    reset.addEventListener("click", () => {
      if (this.confirming !== "reset") { this.confirming = "reset"; this.paint(false); return; }
      this.confirming = null;
      this.send({ type: "reset" });
    });
    const tools = el("div", "danger-row");
    tools.append(exp, imp, file, clearBtn, reset);
    panel.append(tools);
  }
}

function field(label: string, input: HTMLElement) {
  const wrap = el("label", "field", label);
  wrap.append(input);
  return wrap;
}

export function textInput(placeholder: string, maxLength = 12) {
  const input = el("input") as HTMLInputElement;
  input.type = "text";
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  return input;
}

export function numInput(value: string) {
  const input = el("input") as HTMLInputElement;
  input.type = "number";
  input.min = "0";
  input.step = "1";
  input.value = value;
  return input;
}

export function buildingSelect(view: ViewModel, selected?: string) {
  const sel = el("select") as HTMLSelectElement;
  for (const b of view.buildings) sel.append(new Option(b.name + " " + shapeLabel(b.w, b.h), b.id));
  if (selected) sel.value = selected;
  return sel;
}

function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
