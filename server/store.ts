import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultState, normalizeState } from "../shared/rules.ts";
import type { KanbanEvent, SaveMeta, SaveRecord, State } from "../shared/types.ts";

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
  const tmp = path + ".tmp";
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

export async function loadEvents(): Promise<KanbanEvent[]> {
  return (await readJson<KanbanEvent[]>("events.json")) ?? [];
}

export async function saveEvents(events: KanbanEvent[]) {
  await writeJson("events.json", events);
}

export async function loadSaves(): Promise<SaveRecord[]> {
  return (await readJson<SaveRecord[]>("saves.json")) ?? [];
}

export async function saveSaves(saves: SaveRecord[]) {
  await writeJson("saves.json", saves);
}

export function saveMeta(saves: SaveRecord[]): SaveMeta[] {
  return saves.map(({ data: _data, ...meta }) => meta);
}
