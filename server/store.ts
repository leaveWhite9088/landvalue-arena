import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultState, normalizeState } from "../shared/rules.ts";
import type { KanbanEvent, RoundRecord, SaveMeta, SaveRecord, State } from "../shared/types.ts";
import { modelOf } from "../shared/types.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

async function ensure() {
  await mkdir(root, { recursive: true });
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(root, name), "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(name: string, data: unknown) {
  await ensure();
  const path = join(root, name);
  const tmp = path + "." + process.pid + "." + Date.now().toString(36) + ".tmp";
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}

export async function loadState(): Promise<State> {
  const raw = await readJson<unknown>("state.json");
  return normalizeState(raw) ?? defaultState();
}

export async function saveState(state: State) {
  await writeJson("state.json", state);
}

export async function loadSaves(): Promise<SaveRecord[]> {
  return (await readJson<SaveRecord[]>("saves.json")) ?? [];
}

export async function saveSaves(saves: SaveRecord[]) {
  await writeJson("saves.json", saves);
}

export async function loadRounds(): Promise<RoundRecord[]> {
  const raw = await readJson<unknown>("rounds.json");
  if (!Array.isArray(raw)) return [];
  const out: RoundRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<RoundRecord>;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    const next = normalizeState(row.state);
    if (!next) continue;
    const startedAt = typeof row.startedAt === "number" ? row.startedAt : Date.now();
    const endedAt = typeof row.endedAt === "number" ? row.endedAt : null;
    out.push({
      id: row.id,
      name: row.name,
      model: modelOf(typeof row.model === "string" ? row.model : "")?.id ?? "",
      startedAt,
      endedAt,
      endedBy: row.endedBy === "human" || row.endedBy === "model" ? row.endedBy : null,
      // 旧档没有分段计时：已结束的按整段时长补记，进行中的从头计
      accMs: typeof row.accMs === "number" ? row.accMs : endedAt != null ? endedAt - startedAt : 0,
      // 旧档没有 null 时钟和暂停：已结束的停表，进行中的从开局接着走
      clockStart: row.clockStart === null || typeof row.clockStart === "number" ? row.clockStart : endedAt != null ? null : startedAt,
      paused: row.paused === true,
      firedEvents: Array.isArray(row.firedEvents) ? row.firedEvents.filter((id): id is string => typeof id === "string") : [],
      state: next,
      events: Array.isArray(row.events) ? row.events as KanbanEvent[] : [],
    });
  }
  return out;
}

export async function saveRounds(rounds: RoundRecord[]) {
  await writeJson("rounds.json", rounds);
}

export function saveMeta(saves: SaveRecord[]): SaveMeta[] {
  return saves.map(({ data: _data, ...meta }) => meta);
}
