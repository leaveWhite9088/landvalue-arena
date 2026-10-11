import type { Coord, InstanceView, ViewModel } from "../shared/types.ts";

const HW = 58;
const HH = 29;

function rotatedImageSrc(src: string): string {
  return src.replace(/\.png$/, "-r.png");
}

type Pt = { x: number; y: number };
type Slot = { board: number; rows: number; cols: number; ox: number; oy: number };
type Box = { minX: number; maxX: number; minY: number; maxY: number; w: number; h: number };

export type LensMark = { board: number; x: number; y: number };

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private view: ViewModel | null = null;
  private ghost: Coord[] = [];
  private ghostOk = true;
  private emphasis = new Set<string>();
  private images = new Map<string, HTMLImageElement>();
  private slots: Slot[] = [];
  private scale = 1;
  private originX = 0;
  private originY = 0;
  private dpr = 1;
  private focus: number | null = null;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private panning = false;
  private panMoved = false;
  private lastPx = 0;
  private lastPy = 0;
  onCell: (cell: Coord | null, kind: "move" | "click" | "context", x: number, y: number) => void = () => {};
  onLenses: (marks: LensMark[]) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");
    this.ctx = ctx;
    this.bind();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.draw();
  }

  show(view: ViewModel) {
    this.view = view;
    for (const b of view.buildings) {
      if (!b.image) continue;
      this.load(b.image);
      if (b.w * b.h === 2) this.load(rotatedImageSrc(b.image));
    }
    this.draw();
  }

  setGhost(cells: Coord[], ok: boolean) {
    this.ghost = cells;
    this.ghostOk = ok;
    this.draw();
  }

  clearGhost() {
    if (!this.ghost.length) return;
    this.ghost = [];
    this.draw();
  }

  setEmphasis(ids: string[] | null) {
    this.emphasis = new Set(ids ?? []);
    this.draw();
  }

  setFocus(board: number | null) {
    const next = board != null && this.view?.boards.some(b => b.board === board) ? board : null;
    if (next === this.focus) return;
    this.focus = next;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.draw();
  }

  focused(): number | null {
    return this.focus;
  }

  panBy(dx: number, dy: number) {
    if (this.focus == null) return;
    this.panX += dx;
    this.panY += dy;
    this.draw();
  }

  zoomBy(factor: number) {
    if (this.focus == null) return;
    this.zoom = Math.min(4, Math.max(0.7, this.zoom * factor));
    this.draw();
  }

  private load(src: string) {
    if (this.images.has(src)) return;
    const img = new Image();
    img.onload = () => this.draw();
    img.src = src;
    this.images.set(src, img);
  }

  private raw(r: number, c: number): Pt {
    return { x: (c - r) * HW, y: (c + r) * HH };
  }

  private boardBox(rows: number, cols: number): Box {
    const corners = [
      this.raw(0.45, 0.45),
      this.raw(0.45, cols + 1.55),
      this.raw(rows + 1.55, cols + 1.55),
      this.raw(rows + 1.55, 0.45),
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of corners) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    minY -= this.focus == null ? HW * 1.15 : HW * 1.55;
    if (this.focus == null) maxY += 52;
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  }

  private arrange(view: ViewModel): Slot[] {
    const boards = this.focus == null ? view.boards : view.boards.filter(b => b.board === this.focus);
    const boxes = boards.map(b => this.boardBox(b.rows, b.cols));
    const cols = boards.length <= 1 ? 1 : 2;
    const gap = this.focus == null ? 18 : 48;
    const colW = Math.max(...boxes.map(b => b.w), 1);
    const rowH = Math.max(...boxes.map(b => b.h), 1);
    return boards.map((b, i) => {
      const box = boxes[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        board: b.board,
        rows: b.rows,
        cols: b.cols,
        ox: col * (colW + gap) - box.minX,
        oy: row * (rowH + gap) - box.minY,
      };
    });
  }

  private layout() {
    const view = this.view;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!view || w < 2 || h < 2 || !view.boards.length) {
      this.slots = [];
      this.scale = 1;
      this.originX = w / 2;
      this.originY = h / 2;
      return;
    }
    this.slots = this.arrange(view);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const slot of this.slots) {
      const box = this.boardBox(slot.rows, slot.cols);
      minX = Math.min(minX, box.minX + slot.ox);
      maxX = Math.max(maxX, box.maxX + slot.ox);
      minY = Math.min(minY, box.minY + slot.oy);
      maxY = Math.max(maxY, box.maxY + slot.oy);
    }
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const bottomPad = this.focus == null ? 8 : 72;
    const sidePad = this.focus == null ? 12 : 36;
    this.scale = Math.min((w - sidePad) / bw, (h - bottomPad) / bh);
    this.originX = w / 2 - ((minX + maxX) / 2) * this.scale;
    this.originY = h / 2 - ((minY + maxY) / 2) * this.scale + (this.focus == null ? 0 : -16);
  }

  private toScreen(p: Pt, slot: Slot): Pt {
    const fitted = {
      x: this.originX + (p.x + slot.ox) * this.scale,
      y: this.originY + (p.y + slot.oy) * this.scale,
    };
    if (this.focus == null) return fitted;
    const cx = this.canvas.clientWidth / 2;
    const cy = this.canvas.clientHeight / 2;
    return {
      x: cx + (fitted.x - cx) * this.zoom + this.panX,
      y: cy + (fitted.y - cy) * this.zoom + this.panY,
    };
  }

  private unproject(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    let sx = clientX - rect.left;
    let sy = clientY - rect.top;
    if (this.focus != null) {
      const cx = this.canvas.clientWidth / 2;
      const cy = this.canvas.clientHeight / 2;
      sx = cx + (sx - this.panX - cx) / this.zoom;
      sy = cy + (sy - this.panY - cy) / this.zoom;
    }
    return {
      x: (sx - this.originX) / this.scale,
      y: (sy - this.originY) / this.scale,
    };
  }

  private slotOf(board: number): Slot | undefined {
    return this.slots.find(slot => slot.board === board);
  }

  private pick(clientX: number, clientY: number): Coord | null {
    const view = this.view;
    if (!view) return null;
    const world = this.unproject(clientX, clientY);
    if (!world) return null;
    for (const slot of this.slots) {
      const x = world.x - slot.ox;
      const y = world.y - slot.oy;
      const c = (x / HW + y / HH) / 2;
      const r = (y / HH - x / HW) / 2;
      const cell = { board: slot.board, r: Math.floor(r), c: Math.floor(c) };
      if (cell.r < 1 || cell.c < 1 || cell.r > slot.rows || cell.c > slot.cols) continue;
      const found = view.cells.find(item => item.board === cell.board && item.r === cell.r && item.c === cell.c);
      if (!found?.enabled) continue;
      return cell;
    }
    return null;
  }

  private draw() {
    const ctx = this.ctx;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#f5f5f2";
    ctx.fillRect(0, 0, w, h);
    const view = this.view;
    if (!view) return;
    this.layout();
    for (const slot of this.slots) {
      this.drawTable(slot);
      const cells = view.cells.filter(c => c.board === slot.board && c.enabled).sort((a, b) => a.r + a.c - (b.r + b.c));
      for (const cell of cells) this.drawTile(slot, cell.r, cell.c, tileColor(cell.priceExact, view.stats.max));
    }
    if (this.ghost.length) {
      const fill = this.ghostOk ? "rgba(63, 94, 120, 0.28)" : "rgba(154, 64, 56, 0.32)";
      for (const cell of this.ghost) {
        const slot = this.slotOf(cell.board);
        if (slot) this.drawTile(slot, cell.r, cell.c, fill);
      }
    }
    const instances = view.instances.slice().sort((a, b) =>
      (a.anchorR + a.h + a.anchorC + a.w) - (b.anchorR + b.h + b.anchorC + b.w));
    for (const inst of instances) this.drawBuilding(inst, view);
    if (this.emphasis.size) {
      for (const inst of instances) if (this.emphasis.has(inst.id)) this.strokeFootprint(inst, "#3f5e78");
    }
    for (const slot of this.slots) this.drawLabel(slot);
    this.drawLegend(view);
    if (this.focus == null) {
      this.onLenses(this.slots.map(slot => {
        const bottom = this.toScreen(this.raw(slot.rows + 1.45, slot.cols + 1.45), slot);
        return { board: slot.board, x: bottom.x, y: bottom.y + 8 };
      }));
    } else {
      this.onLenses([]);
    }
  }

  private drawLabel(slot: Slot) {
    const ctx = this.ctx;
    const top = this.toScreen(this.raw(0.15, (slot.cols + 1) / 2), slot);
    ctx.fillStyle = "#7a746c";
    ctx.font = "12px \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("棋盘 " + slot.board + "  " + slot.rows + "×" + slot.cols, top.x, top.y - 4);
  }

  private drawTable(slot: Slot) {
    const ctx = this.ctx;
    const top = this.toScreen(this.raw(0.55, 0.55), slot);
    const right = this.toScreen(this.raw(0.55, slot.cols + 1.45), slot);
    const bottom = this.toScreen(this.raw(slot.rows + 1.45, slot.cols + 1.45), slot);
    const left = this.toScreen(this.raw(slot.rows + 1.45, 0.55), slot);
    ctx.save();
    ctx.shadowColor = "rgba(38, 41, 45, 0.14)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    poly(ctx, [top, right, bottom, left]);
    ctx.fillStyle = "#ebe7de";
    ctx.fill();
    ctx.restore();
  }

  private drawTile(slot: Slot, r: number, c: number, color: string) {
    const ctx = this.ctx;
    const top = this.toScreen(this.raw(r, c), slot);
    const right = this.toScreen(this.raw(r, c + 1), slot);
    const bottom = this.toScreen(this.raw(r + 1, c + 1), slot);
    const left = this.toScreen(this.raw(r + 1, c), slot);
    const face = inset([top, right, bottom, left], 0.05);
    poly(ctx, face);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "rgba(38, 41, 45, 0.08)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private strokeFootprint(inst: InstanceView, color: string) {
    const slot = this.slotOf(inst.board);
    if (!slot) return;
    const ctx = this.ctx;
    const pts = [
      this.toScreen(this.raw(inst.anchorR, inst.anchorC), slot),
      this.toScreen(this.raw(inst.anchorR, inst.anchorC + inst.w), slot),
      this.toScreen(this.raw(inst.anchorR + inst.h, inst.anchorC + inst.w), slot),
      this.toScreen(this.raw(inst.anchorR + inst.h, inst.anchorC), slot),
    ];
    poly(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawBuilding(inst: InstanceView, view: ViewModel) {
    const building = view.buildings.find(b => b.id === inst.typeId);
    let img = building?.image ? this.images.get(building.image) : undefined;
    if (inst.rotated && building?.image) {
      const variant = this.images.get(rotatedImageSrc(building.image));
      if (variant && variant.complete && variant.naturalWidth) img = variant;
    }
    if (img && img.complete && img.naturalWidth) {
      this.drawSprite(inst, img);
      return;
    }
    this.drawToken(inst, building?.color ?? "#8a8078", building?.name ?? "");
  }

  private drawSprite(inst: InstanceView, img: HTMLImageElement) {
    const slot = this.slotOf(inst.board);
    if (!slot) return;
    const cx = this.toScreen(this.raw(inst.anchorR + inst.h / 2, inst.anchorC + inst.w / 2), slot);
    const dw = (inst.w + inst.h) * HW * this.scale * 0.62;
    const dh = dw * (img.naturalHeight / img.naturalWidth);
    this.ctx.drawImage(img, cx.x - dw / 2, cx.y - dh * 0.85, dw, dh);
  }

  private drawToken(inst: InstanceView, color: string, name: string) {
    const slot = this.slotOf(inst.board);
    if (!slot) return;
    const ctx = this.ctx;
    const box = this.footprint(slot, inst.anchorR + 0.28, inst.anchorC + 0.28, Math.max(0.4, inst.w - 0.56), Math.max(0.4, inst.h - 0.56));
    const lift = 16 * this.scale;
    const top = box.map(p => ({ x: p.x, y: p.y - lift }));
    ctx.beginPath();
    ctx.moveTo(top[1].x, top[1].y);
    ctx.lineTo(top[2].x, top[2].y);
    ctx.lineTo(box[2].x, box[2].y);
    ctx.lineTo(box[1].x, box[1].y);
    ctx.closePath();
    ctx.fillStyle = shade(color, -0.18);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(top[3].x, top[3].y);
    ctx.lineTo(top[2].x, top[2].y);
    ctx.lineTo(box[2].x, box[2].y);
    ctx.lineTo(box[3].x, box[3].y);
    ctx.closePath();
    ctx.fillStyle = shade(color, -0.3);
    ctx.fill();
    poly(ctx, top);
    ctx.fillStyle = color;
    ctx.fill();
    if (name) {
      ctx.fillStyle = "#26292d";
      ctx.font = Math.max(11, 12 * this.scale) + "px \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(name.slice(0, 3), (top[0].x + top[2].x) / 2, (top[0].y + top[2].y) / 2);
    }
  }

  private footprint(slot: Slot, r: number, c: number, w: number, h: number): Pt[] {
    return [
      this.toScreen(this.raw(r, c), slot),
      this.toScreen(this.raw(r, c + w), slot),
      this.toScreen(this.raw(r + h, c + w), slot),
      this.toScreen(this.raw(r + h, c), slot),
    ];
  }

  private drawLegend(view: ViewModel) {
    const ctx = this.ctx;
    const x = 16;
    const y = this.canvas.clientHeight - 46;
    const width = 120;
    ctx.fillStyle = "#eceae3";
    ctx.fillRect(x, y, width, 8);
    const hot = Math.max(view.stats.max, 100);
    const grad = ctx.createLinearGradient(x, y, x + width, y);
    grad.addColorStop(0, "#eceae3");
    grad.addColorStop(1, hot <= 100 ? "#eceae3" : tileColor(hot, hot));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, width, 8);
    ctx.fillStyle = "#7a746c";
    ctx.font = "11px \"PingFang SC\", \"Microsoft YaHei\", sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("100", x, y - 2);
    ctx.textAlign = "right";
    ctx.fillText(String(Math.round(view.stats.max)), x + width, y - 2);
  }

  private bind() {
    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.focus == null || e.button !== 0) return;
      this.panning = true;
      this.panMoved = false;
      this.lastPx = e.clientX;
      this.lastPy = e.clientY;
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (this.panning) {
        const dx = e.clientX - this.lastPx;
        const dy = e.clientY - this.lastPy;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.panMoved = true;
        this.lastPx = e.clientX;
        this.lastPy = e.clientY;
        if (this.panMoved) this.panBy(dx, dy);
        return;
      }
      this.onCell(this.pick(e.clientX, e.clientY), "move", e.clientX, e.clientY);
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.panning = false;
      this.onCell(null, "move", 0, 0);
    });
    this.canvas.addEventListener("pointerup", (e) => {
      if (e.button !== 0) return;
      const dragged = this.panMoved;
      this.panning = false;
      this.panMoved = false;
      if (dragged) return;
      this.onCell(this.pick(e.clientX, e.clientY), "click", e.clientX, e.clientY);
    });
    this.canvas.addEventListener("wheel", (e) => {
      if (this.focus == null) return;
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.onCell(this.pick(e.clientX, e.clientY), "context", e.clientX, e.clientY);
    });
  }
}

function inset(pts: Pt[], amount: number): Pt[] {
  const cx = pts.reduce((n, p) => n + p.x, 0) / pts.length;
  const cy = pts.reduce((n, p) => n + p.y, 0) / pts.length;
  return pts.map(p => ({
    x: cx + (p.x - cx) * (1 - amount),
    y: cy + (p.y - cy) * (1 - amount),
  }));
}

function poly(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}

function tileColor(price: number, max: number): string {
  if (price <= 100 || max <= 100) return "#eceae3";
  const t = Math.min(1, (price - 100) / (max - 100));
  const h = 36 - 20 * t;
  const s = 24 + 36 * t;
  const l = 90 - 42 * t;
  return "hsl(" + h.toFixed(0) + " " + s.toFixed(0) + "% " + l.toFixed(0) + "%)";
}

function shade(color: string, amount: number): string {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return color;
  ctx.fillStyle = color;
  const computed = ctx.fillStyle;
  const hex = computed.startsWith("#") ? computed : color;
  if (!hex.startsWith("#") || hex.length < 7) return color;
  const n = parseInt(hex.slice(1, 7), 16);
  const f = amount < 0 ? 1 + amount : 1;
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) * f));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) * f));
  const b = Math.max(0, Math.min(255, (n & 255) * f));
  return "rgb(" + r.toFixed(0) + "," + g.toFixed(0) + "," + b.toFixed(0) + ")";
}
