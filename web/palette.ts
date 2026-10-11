import { clear, el } from "./dom.ts";
import { SHAPES, shapeLabel, type UserCommand, type ViewModel } from "../shared/types.ts";
import { buildingSelect, numInput, textInput } from "./modal.ts";

// 建造弹窗：三页。放置 = 选店后点沙盘；建筑 = 增删改门店；专业街 = 组街与加成。
export class Palette {
  onSelectType: (id: string) => void = () => {};
  onToggleDemolish: () => void = () => {};

  private tab: "place" | "buildings" | "streets" = "place";
  private view: ViewModel | null = null;
  private selectedType: string | null = null;
  private demolishMode = false;
  private locked = false;

  constructor(
    private dialog: HTMLDialogElement,
    private send: (command: UserCommand) => void,
  ) {}

  open() {
    if (!this.view) return;
    this.paint();
    if (!this.dialog.open) this.dialog.showModal();
  }

  sync(view: ViewModel, selectedType: string | null, demolishMode: boolean, locked: boolean) {
    this.view = view;
    this.selectedType = selectedType;
    this.demolishMode = demolishMode;
    this.locked = locked;
    if (!this.dialog.open) return;
    const ae = document.activeElement;
    if (ae && this.dialog.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "SELECT")) return;
    this.paint();
  }

  private paint() {
    const view = this.view;
    if (!view) return;
    clear(this.dialog);
    const head = el("div", "modal-head");
    head.append(el("h2", undefined, "建造"));
    const close = el("button", "icon-btn", "×");
    close.type = "button";
    close.setAttribute("aria-label", "关闭");
    close.addEventListener("click", () => this.dialog.close());
    head.append(close);
    const tabs = el("div", "tabs");
    for (const [id, label] of [["place", "放置"], ["buildings", "建筑"], ["streets", "专业街"]] as const) {
      const btn = el("button", "tab" + (this.tab === id ? " active" : ""), label);
      btn.type = "button";
      btn.addEventListener("click", () => { this.tab = id; this.paint(); });
      tabs.append(btn);
    }
    const panel = el("div", "panel");
    this.dialog.append(head, tabs, panel);

    if (this.tab === "place") this.paintPlace(panel, view);
    else if (this.tab === "buildings") this.paintBuildings(panel, view);
    else this.paintStreets(panel, view);
  }

  private paintPlace(panel: HTMLElement, view: ViewModel) {
    const tools = el("div", "row");
    const remove = el("button", "chip demolish" + (this.demolishMode ? " selected" : ""), "拆除模式");
    remove.type = "button";
    remove.disabled = this.locked;
    remove.title = "选中后，再点沙盘上的建筑。拆的是整座，不退钱。";
    remove.setAttribute("aria-pressed", this.demolishMode ? "true" : "false");
    remove.addEventListener("click", () => {
      this.onToggleDemolish();
      this.dialog.close();
    });
    tools.append(remove);
    tools.append(el("p", "hint", "点一家店，再点沙盘上的格子放下。两格建筑按 R 旋转。Esc 取消。"));
    panel.append(tools);

    if (!view.buildings.length) {
      panel.append(el("p", "hint", "还没有建筑。先到「建筑」页添加。"));
    }
    const grid = el("div", "palette-grid");
    for (const b of view.buildings) {
      const btn = el("button", "chip palette-card" + (this.selectedType === b.id ? " selected" : ""));
      btn.type = "button";
      btn.disabled = this.locked;
      btn.setAttribute("aria-pressed", this.selectedType === b.id ? "true" : "false");
      if (b.image) {
        const thumb = document.createElement("img");
        thumb.src = b.image;
        thumb.alt = "";
        thumb.className = "palette-thumb";
        btn.append(thumb);
      } else {
        const sw = el("span", "swatch");
        sw.style.background = b.color;
        btn.append(sw);
      }
      const text = el("span");
      text.append(el("b", undefined, b.name));
      text.append(el("small", undefined, shapeLabel(b.w, b.h) + "  造价 " + b.cost));
      btn.append(text);
      btn.addEventListener("click", () => {
        const wasArmed = this.selectedType === b.id;
        this.onSelectType(b.id);
        if (!wasArmed) this.dialog.close(); // 新选中：收起弹窗去点格子；再点同一家是取消，留在弹窗
      });
      grid.append(btn);
    }
    panel.append(grid);
  }

  private paintBuildings(panel: HTMLElement, view: ViewModel) {
    const name = textInput("建筑名称");
    const shape = el("select") as HTMLSelectElement;
    for (const s of SHAPES) shape.append(new Option(s.label, s.w + "," + s.h));
    const cost = numInput("0");
    const add = el("button", "btn", "添加建筑");
    add.type = "button";
    add.addEventListener("click", () => {
      const [w, h] = shape.value.split(",").map(Number);
      this.send({ type: "addBuilding", name: name.value, w, h, cost: Number(cost.value) });
      name.value = "";
    });
    const row = el("div", "row");
    row.append(name, shape, cost, add);
    panel.append(row);
    panel.append(el("p", "count-line", "共 " + view.buildings.length + " 个建筑"));
    if (!view.buildings.length) panel.append(el("p", "hint", "还没有建筑。"));
    for (const b of view.buildings) {
      const item = el("div", "item catalog-item");
      item.append(thumb(b.image, b.name, b.color));
      const fields = el("div", "item-fields");
      const nm = textInput(b.name);
      nm.value = b.name;
      nm.addEventListener("change", () => this.send({ type: "updateBuilding", id: b.id, name: nm.value }));
      const sh = el("select") as HTMLSelectElement;
      for (const s of SHAPES) sh.append(new Option(s.label, s.w + "," + s.h));
      sh.value = b.w + "," + b.h;
      sh.addEventListener("change", () => {
        const [w, h] = sh.value.split(",").map(Number);
        this.send({ type: "updateBuilding", id: b.id, w, h });
      });
      const co = numInput(String(b.cost));
      co.value = String(b.cost);
      co.addEventListener("change", () => this.send({ type: "updateBuilding", id: b.id, cost: Number(co.value) }));
      const color = el("input") as HTMLInputElement;
      color.type = "color";
      color.value = b.color;
      color.addEventListener("change", () => this.send({ type: "updateBuilding", id: b.id, color: color.value }));
      fields.append(nm, sh, co, color);
      const art = el("button", "text-btn", b.image ? "换贴图" : "贴图");
      art.type = "button";
      const file = el("input") as HTMLInputElement;
      file.type = "file";
      file.accept = "image/png,image/jpeg,image/webp";
      file.hidden = true;
      art.addEventListener("click", () => file.click());
      file.addEventListener("change", () => {
        const f = file.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => this.send({ type: "updateBuilding", id: b.id, image: String(reader.result) });
        reader.readAsDataURL(f);
        file.value = "";
      });
      fields.append(art, file);
      if (b.image) {
        const clearArt = el("button", "text-btn", "去掉贴图");
        clearArt.type = "button";
        clearArt.addEventListener("click", () => this.send({ type: "updateBuilding", id: b.id, image: null }));
        fields.append(clearArt);
      }
      const del = el("button", "text-btn danger", "删除");
      del.type = "button";
      del.addEventListener("click", () => this.send({ type: "deleteBuilding", id: b.id }));
      item.append(fields, del);
      panel.append(item);
    }
  }

  private paintStreets(panel: HTMLElement, view: ViewModel) {
    if (view.buildings.length < 1) {
      panel.append(el("p", "hint", "先添加建筑，再组专业街。"));
      return;
    }
    const name = textInput("街道名称");
    const slots = [0, 1, 2].map(() => buildingSelect(view));
    const pct = numInput("20");
    const add = el("button", "btn", "添加街道");
    add.type = "button";
    add.addEventListener("click", () => {
      this.send({
        type: "addStreet",
        name: name.value,
        types: [slots[0].value, slots[1].value, slots[2].value],
        pct: Number(pct.value),
      });
      name.value = "";
    });
    const draft = el("div", "street-item");
    const line1 = el("div", "street-line");
    line1.append(name, el("span", "pct-label", "周围地价"), pct, el("span", "pct-label", "%"), add);
    const line2 = el("div", "street-line");
    line2.append(...slots);
    draft.append(line1, line2);
    panel.append(draft);
    panel.append(el("p", "count-line", "共 " + view.streets.length + " 条专业街"));
    if (!view.streets.length) panel.append(el("p", "hint", "一条街是三种建筑加一个周围地价加成。"));
    for (const st of view.streets) {
      const item = el("div", "street-item");
      const faces = el("div", "street-faces");
      for (const id of st.types) {
        const b = view.buildings.find(item => item.id === id);
        faces.append(thumb(b?.image, b?.name ?? "", b?.color));
      }
      item.append(faces);
      const nm = textInput(st.name);
      nm.value = st.name;
      nm.addEventListener("change", () => this.send({ type: "updateStreet", id: st.id, name: nm.value }));
      const p = numInput(String(st.pct));
      p.value = String(st.pct);
      p.addEventListener("change", () => this.send({ type: "updateStreet", id: st.id, pct: Number(p.value) }));
      const del = el("button", "text-btn danger", "删除");
      del.type = "button";
      del.addEventListener("click", () => this.send({ type: "deleteStreet", id: st.id }));
      const top = el("div", "street-line");
      top.append(nm, el("span", "pct-label", "周围地价"), p, el("span", "pct-label", "%"), del);
      const selects = st.types.map(id => buildingSelect(view, id));
      const commit = () => this.send({
        type: "updateStreet",
        id: st.id,
        types: [selects[0].value, selects[1].value, selects[2].value],
      });
      selects.forEach(sel => sel.addEventListener("change", commit));
      const bottom = el("div", "street-line");
      bottom.append(...selects);
      item.append(top, bottom);
      panel.append(item);
    }
  }
}

function thumb(src: string | undefined, name: string, color?: string) {
  const wrap = el("span", "catalog-thumb");
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = name;
    wrap.append(img);
  } else {
    wrap.style.background = color || "#e7dccb";
  }
  return wrap;
}
