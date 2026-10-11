import type { KanbanEvent, RoundMeta, SaveMeta, UserCommand, ViewModel } from "../shared/types.ts";

export type Hello = { type: "hello"; view: ViewModel; events: KanbanEvent[]; saves: SaveMeta[]; rounds?: RoundMeta[] };
export type ServerMsg =
  | Hello
  | { type: "view"; view: ViewModel }
  | { type: "event"; event: KanbanEvent }
  | { type: "events"; events: KanbanEvent[] }
  | { type: "saves"; saves: SaveMeta[] }
  | { type: "rounds"; rounds: RoundMeta[] }
  | { type: "round"; roundId: string; meta: RoundMeta; view: ViewModel; event?: KanbanEvent }
  | { type: "result"; id: string; ok: boolean; error?: { code: string; message: string }; exportData?: unknown; roundId?: string; name?: string; view?: ViewModel; events?: KanbanEvent[]; endedBy?: "human" | "model"; timing?: "idle" | "running" | "paused" };

export class Net {
  private ws: WebSocket | null = null;
  private pending = new Map<string, (msg: Extract<ServerMsg, { type: "result" }>) => void>();
  onHello: (msg: Hello) => void = () => {};
  onView: (view: ViewModel) => void = () => {};
  onEvent: (event: KanbanEvent) => void = () => {};
  onEvents: (events: KanbanEvent[]) => void = () => {};
  onSaves: (saves: SaveMeta[]) => void = () => {};
  onRounds: (rounds: RoundMeta[]) => void = () => {};
  onRound: (msg: Extract<ServerMsg, { type: "round" }>) => void = () => {};
  onDown: () => void = () => {};

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(proto + "://" + location.host + "/ws");
    this.ws = ws;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as ServerMsg;
      if (msg.type === "hello") this.onHello(msg);
      else if (msg.type === "view") this.onView(msg.view);
      else if (msg.type === "event") this.onEvent(msg.event);
      else if (msg.type === "events") this.onEvents(msg.events);
      else if (msg.type === "saves") this.onSaves(msg.saves);
      else if (msg.type === "rounds") this.onRounds(msg.rounds);
      else if (msg.type === "round") this.onRound(msg);
      else if (msg.type === "result") this.pending.get(msg.id)?.(msg);
    };
    ws.onclose = () => {
      this.onDown();
      setTimeout(() => this.connect(), 1500);
    };
  }

  command(command: UserCommand): Promise<Extract<ServerMsg, { type: "result" }>> {
    return this.request({ type: "command", command });
  }

  round(action: "start" | "end" | "watch" | "delete" | "resume" | "rename" | "pause", extra: { name?: string; version?: string; model?: string; roundId?: string } = {}) {
    return this.request({ type: "round", action, ...extra });
  }

  private request(body: Record<string, unknown>): Promise<Extract<ServerMsg, { type: "result" }>> {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("offline"));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("timeout"));
      }, 8000);
      this.pending.set(id, msg => {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve(msg);
      });
      this.ws.send(JSON.stringify({ ...body, id }));
    });
  }
}
