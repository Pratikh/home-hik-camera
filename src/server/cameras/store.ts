import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAMERA_COUNT, defaultCameraName, normalizeCameraName } from "@/server/cameras/channels";

export class CameraNameError extends Error {
  constructor() {
    super("Invalid camera name");
    this.name = "CameraNameError";
  }
}

type NameFile = { names?: Record<string, string> };

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  queues.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function filePath(dataDir: string): string {
  return path.join(dataDir, "cameras.json");
}

async function readRaw(dataDir: string): Promise<Record<string, string>> {
  try {
    const text = await readFile(filePath(dataDir), "utf8");
    const parsed = JSON.parse(text) as NameFile;
    const names = parsed.names ?? {};
    const clean: Record<string, string> = {};
    for (let id = 1; id <= CAMERA_COUNT; id += 1) {
      const value = names[String(id)];
      if (typeof value !== "string") continue;
      const normalized = normalizeCameraName(value);
      if (normalized) clean[String(id)] = normalized;
    }
    return clean;
  } catch {
    return {};
  }
}

export async function readCameraNames(dataDir: string): Promise<Record<number, string>> {
  const stored = await readRaw(dataDir);
  const names: Record<number, string> = {};
  for (let id = 1; id <= CAMERA_COUNT; id += 1) {
    names[id] = stored[String(id)] ?? defaultCameraName(id);
  }
  return names;
}

export async function writeCameraName(dataDir: string, id: number, name: string): Promise<string> {
  if (!Number.isInteger(id) || id < 1 || id > CAMERA_COUNT) {
    throw new CameraNameError();
  }
  const normalized = normalizeCameraName(name);
  if (!normalized) throw new CameraNameError();
  return enqueue(dataDir, async () => {
    const stored = await readRaw(dataDir);
    stored[String(id)] = normalized;
    await mkdir(dataDir, { recursive: true });
    const target = filePath(dataDir);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify({ names: stored }, null, 2), "utf8");
    await rename(temporary, target);
    return normalized;
  });
}
