import type { Cell, InstanceView, ViewModel } from "../shared/types.ts";

const HW = 58;
const HH = 29;
const DEPTH = 8;

type Pt = { x: number; y: number };

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private view: ViewModel | null = null;
  private ghost: Cell[] = [];
  private ghostOk = true;
  private emphasis = new Set<string>();
  private images = new Map<string, HTMLImageElement>();
  private scale = 1;
  private originX = 0;
  private originY = 0;
  private dpr = 1;
  onCell: (cell: Cell | null, kind: "move" | "click" | "context", x: number, y: number) => void = () => {};

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
    for (const b of view.buildings) if (b.image) this.load(b.image);
    this.draw();
  }

  setGhost(cells: Cell[], ok: boolean) {
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

  private layout() {
    const view = this.view;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!view || w < 2 || h < 2) {
      this.scale = 1;
      this.originX = w / 2;
      this.originY = h / 2;
      return;
    }
    const corners = [
      this.raw(1, 1),
      this.raw(1, view.cols + 1),
      this.raw(view.rows + 1, view.cols + 1),
      this.raw(view.rows + 1, 1),
    ];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of corners) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    minY -= HW * 1.7;
    maxY += DEPTH + 18;
    const bw = maxX - minX;
    const bh = maxY - minY;
    this.scale = Math.min((w - 36) / bw, (h - 28) / bh);
    this.originX = w / 2 - ((minX + maxX) / 2) * this.scale;
    this.originY = h / 2 - ((minY + maxY) / 2) * this.scale + 8;
  }

  private toScreen(p: Pt): Pt {
    return { x: this.originX + p.x * this.scale, y: this.originY + p.y * this.scale };
  }

  private pick(clientX: number, clientY: number): Cell | null {
    const view = this.view;
    if (!view) return null;
    const rect = this.canvas.getBoundingClientRect();
    const sx = (clientX - rect.left - this.originX) / this.scale;
    const sy = (clientY - rect.top - this.originY) / this.scale;
    const c = (sx / HW + sy / HH) / 2;
    const r = (sy / HH - sx / HW) / 2;
    const cell = { r: Math.floor(r), c: Math.floor(c) };
    if (cell.r < 1 || cell.c < 1 || cell.r > view.rows || cell.c > view.cols) return null;
    const found = view.cells.find(item => item.r === cell.r && item.c === cell.c);
    if (!found?.enabled) return null;
    return cell;
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
    this.drawTable(view);
    const cells = view.cells.filter(c => c.enabled).sort((a, b) => a.r + a.c - (b.r + b.c));
    for (const cell of cells) this.drawTile(cell.r, cell.c, tileColor(cell.priceExact, view.stats.max));
    if (this.ghost.length) {
      const fill = this.ghostOk ? "rgba(63, 94, 120, 0.28)" : "rgba(154, 64, 56, 0.32)";
      for (const cell of this.ghost) this.drawTile(cell.r, cell.c, fill, true);
    }
    const instances = view.instances.slice().sort((a, b) =>
      (a.anchorR + a.h + a.anchorC + a.w) - (b.anchorR + b.h + b.anchorC + b.w));
    for (const inst of instances) this.drawBuilding(inst, view);
    if (this.emphasis.size) {
      for (const inst of instances) if (this.emphasis.has(inst.id)) this.strokeFootprint(inst, "#3f5e78");
    }
    this.drawLegend(view);
  }

  private drawTable(view: ViewModel) {
    const ctx = this.ctx;
    const top = this.toScreen(this.raw(0.35, 0.35));
    const right = this.toScreen(this.raw(0.35, view.cols + 1.65));
    const bottom = this.toScreen(this.raw(view.rows + 1.65, view.cols + 1.65));
    const left = this.toScreen(this.raw(view.rows + 1.65, 0.35));
    const drop = 14;
    ctx.beginPath();
    ctx.moveTo(right.x, right.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(bottom.x, bottom.y + drop);
    ctx.lineTo(right.x, right.y + drop);
    ctx.closePath();
    ctx.fillStyle = "#cbbba4";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(bottom.x, bottom.y + drop);
    ctx.lineTo(left.x, left.y + drop);
    ctx.closePath();
    ctx.fillStyle = "#b7a790";
    ctx.fill();
    poly(ctx, [top, right, bottom, left]);
    ctx.fillStyle = "#e7dccb";
    ctx.fill();
  }

  private drawTile(r: number, c: number, color: string, flat = false) {
    const ctx = this.ctx;
    const top = this.toScreen(this.raw(r, c));
    const right = this.toScreen(this.raw(r, c + 1));
    const bottom = this.toScreen(this.raw(r + 1, c + 1));
    const left = this.toScreen(this.raw(r + 1, c));
    const face = inset([top, right, bottom, left], 0.07);
    const d = flat ? 0 : DEPTH * this.scale;
    if (d) {
      ctx.beginPath();
      ctx.moveTo(face[1].x, face[1].y);
      ctx.lineTo(face[2].x, face[2].y);
      ctx.lineTo(face[2].x, face[2].y + d);
      ctx.lineTo(face[1].x, face[1].y + d);
      ctx.closePath();
      ctx.fillStyle = shade(color, -0.16);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(face[3].x, face[3].y);
      ctx.lineTo(face[2].x, face[2].y);
      ctx.lineTo(face[2].x, face[2].y + d);
      ctx.lineTo(face[3].x, face[3].y + d);
      ctx.closePath();
      ctx.fillStyle = shade(color, -0.28);
      ctx.fill();
    }
    poly(ctx, face);
    ctx.fillStyle = color;
    ctx.fill();
  }

  private strokeFootprint(inst: InstanceView, color: string) {
    const ctx = this.ctx;
    const r = inst.anchorR;
    const c = inst.anchorC;
    const pts = [
      this.toScreen(this.raw(r, c)),
      this.toScreen(this.raw(r, c + inst.w)),
      this.toScreen(this.raw(r + inst.h, c + inst.w)),
      this.toScreen(this.raw(r + inst.h, c)),
    ];
    poly(ctx, pts);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  private drawBuilding(inst: InstanceView, view: ViewModel) {
    const building = view.buildings.find(b => b.id === inst.typeId);
    const img = building?.image ? this.images.get(building.image) : undefined;
    if (img && img.complete && img.naturalWidth) {
      this.drawSprite(inst, img);
      return;
    }
    this.drawToken(inst, building?.color ?? "#8a8078", building?.name ?? "");
  }

  private drawSprite(inst: InstanceView, img: HTMLImageElement) {
    const box = this.footprint(inst.anchorR, inst.anchorC, inst.w, inst.h);
    const cx = (box[0].x + box[2].x) / 2;
    const cy = (box[0].y + box[2].y) / 2;
    const span = Math.hypot(box[1].x - box[3].x, box[1].y - box[3].y);
    const dw = span * 0.5;
    const dh = dw * (img.naturalHeight / img.naturalWidth);
    this.ctx.drawImage(img, cx - dw / 2, cy - dh * 0.58, dw, dh);
  }

  private drawToken(inst: InstanceView, color: string, name: string) {
    const ctx = this.ctx;
    const box = this.footprint(inst.anchorR + 0.28, inst.anchorC + 0.28, Math.max(0.4, inst.w - 0.56), Math.max(0.4, inst.h - 0.56));
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

  private footprint(r: number, c: number, w: number, h: number): Pt[] {
    return [
      this.toScreen(this.raw(r, c)),
      this.toScreen(this.raw(r, c + w)),
      this.toScreen(this.raw(r + h, c + w)),
      this.toScreen(this.raw(r + h, c)),
    ];
  }

  private drawLegend(view: ViewModel) {
    const ctx = this.ctx;
    const x = 16;
    const y = this.canvas.clientHeight - 46;
    const width = 120;
    ctx.fillStyle = "#e6e1d6";
    ctx.fillRect(x, y, width, 8);
    const hot = Math.max(view.stats.max, 100);
    const grad = ctx.createLinearGradient(x, y, x + width, y);
    grad.addColorStop(0, "#e6e1d6");
    grad.addColorStop(1, hot <= 100 ? "#e6e1d6" : tileColor(hot, hot));
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
    this.canvas.addEventListener("pointermove", (e) => {
      this.onCell(this.pick(e.clientX, e.clientY), "move", e.clientX, e.clientY);
    });
    this.canvas.addEventListener("pointerleave", () => this.onCell(null, "move", 0, 0));
    this.canvas.addEventListener("pointerup", (e) => {
      if (e.button !== 0) return;
      this.onCell(this.pick(e.clientX, e.clientY), "click", e.clientX, e.clientY);
    });
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
  if (price <= 100 || max <= 100) return "#e6e1d6";
  const t = Math.min(1, (price - 100) / (max - 100));
  const h = 40 - 28 * t;
  const s = 42 + 30 * t;
  const l = 74 - 26 * t;
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
