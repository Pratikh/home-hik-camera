import "server-only";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { composeSprite } from "@/server/playback/thumbnail-extract";
import {
  spriteBucketMs,
  spriteStartFor,
  THUMBNAIL_TILE,
  THUMBNAIL_TILES_PER_SPRITE,
  thumbnailIntervalMs,
  type ThumbnailBucket,
  type ThumbnailIndex,
} from "@/lib/playback-thumbnail";

/**
 * On-disk store for generated previews.
 *
 * Layout, under the existing data volume (never anything the browser can list):
 *
 *   data/thumbnails/<camera>/<date>/index.json
 *   data/thumbnails/<camera>/<date>/sprite-<bucketStart>.jpg
 *   data/thumbnails/<camera>/<date>/tiles/<bucketStart>/<NNNN>.jpg
 *
 * Tiles are kept because a sprite is re-tiled after every new frame: keeping the
 * sources means a partially generated sheet is still correct, and a restart can
 * carry on instead of re-extracting what it already had. 24 tiles of ~6 KB is
 * ~120 KB per sheet either way.
 *
 * Every filename is built from validated numbers and dates, and the resolved
 * path is checked against the root, so nothing from a query string can name a
 * file.
 */

const INDEX_FILE = "index.json";

type CacheEntry = { index: ThumbnailIndex; loadedAt: number };
const cache = new Map<string, CacheEntry>();
/** Serialises writes per camera+date so two frames cannot rewrite the same index. */
const tails = new Map<string, Promise<unknown>>();

export function resetThumbnailStore(): void {
  cache.clear();
  tails.clear();
}

function rootDir(): string {
  return path.resolve(getConfig().dataDir, "thumbnails");
}

function safeDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid date");
  return date;
}

function safeCamera(camera: number): string {
  if (!Number.isInteger(camera) || camera < 1 || camera > 4) throw new Error("invalid camera");
  return String(camera);
}

function dateDir(camera: number, date: string): string {
  const dir = path.join(rootDir(), safeCamera(camera), safeDate(date));
  const root = rootDir();
  if (!dir.startsWith(root + path.sep)) throw new Error("path escape");
  return dir;
}

export function spriteFile(camera: number, date: string, bucketStart: number): string {
  if (!Number.isInteger(bucketStart) || bucketStart < 0) throw new Error("invalid bucket");
  const interval = getConfig().thumbnailIntervalSeconds;
  if (bucketStart % spriteBucketMs(interval) !== 0) throw new Error("unaligned bucket");
  return path.join(dateDir(camera, date), `sprite-${bucketStart}.jpg`);
}

function tilesDir(camera: number, date: string, bucketStart: number): string {
  return path.join(dateDir(camera, date), "tiles", String(bucketStart));
}

function keyOf(camera: number, date: string): string {
  return `${camera}|${date}`;
}

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function emptyIndex(camera: number, date: string, interval: number): ThumbnailIndex {
  return {
    camera,
    date,
    interval,
    tile: {
      width: THUMBNAIL_TILE.width,
      height: THUMBNAIL_TILE.height,
      cols: THUMBNAIL_TILE.cols,
      rows: THUMBNAIL_TILE.rows,
    },
    buckets: [],
    progress: { generated: 0, expected: 0, generating: false },
  };
}

/** Read (and cache) the index for one camera and day. Never throws for a missing file. */
export async function readIndex(camera: number, date: string): Promise<ThumbnailIndex> {
  const key = keyOf(camera, date);
  const cached = cache.get(key);
  if (cached) return cached.index;

  const interval = getConfig().thumbnailIntervalSeconds;
  const file = path.join(dateDir(camera, date), INDEX_FILE);
  let index = emptyIndex(camera, date, interval);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as ThumbnailIndex;
    if (parsed && Array.isArray(parsed.buckets) && parsed.interval === interval) {
      index = { ...parsed, camera, date, progress: index.progress };
      index.buckets.sort((left, right) => left.start - right.start);
    }
  } catch {
    // No index yet, or it was written by a different interval: start clean.
  }
  cache.set(key, { index, loadedAt: Date.now() });
  return index;
}

async function writeIndex(camera: number, date: string, index: ThumbnailIndex): Promise<void> {
  const dir = dateDir(camera, date);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, INDEX_FILE);
  const temp = `${file}.tmp`;
  const payload: ThumbnailIndex = {
    camera,
    date,
    interval: index.interval,
    tile: index.tile,
    buckets: index.buckets,
    progress: { generated: 0, expected: 0, generating: false },
  };
  await writeFile(temp, JSON.stringify(payload), "utf8");
  await rename(temp, file);
  cache.set(keyOf(camera, date), { index, loadedAt: Date.now() });
}

/**
 * Add one extracted frame: copy its tile in, re-tile the sheet, then publish.
 *
 * The index is only updated after the sheet is on disk, so the browser can never
 * be told about a tile that is not in the image it fetches.
 */
export async function addFrame(
  camera: number,
  date: string,
  frameMs: number,
  tilePath: string,
): Promise<boolean> {
  const key = keyOf(camera, date);
  return serialize(key, async () => {
    const index = await readIndex(camera, date);
    const interval = index.interval;
    const bucketStart = spriteStartFor(frameMs, interval);

    let bucket = index.buckets.find((item) => item.start === bucketStart);
    if (!bucket) {
      bucket = { start: bucketStart, frames: [], version: 0 };
      index.buckets.push(bucket);
      index.buckets.sort((left, right) => left.start - right.start);
    }
    // A frame already in the sheet is not re-added; the DVR work was expensive.
    if (bucket.frames.includes(frameMs)) return true;
    if (bucket.frames.length >= THUMBNAIL_TILES_PER_SPRITE) return false;

    const slot = bucket.frames.length;
    const dir = tilesDir(camera, date, bucketStart);
    await mkdir(dir, { recursive: true });
    const tileFile = path.join(dir, `${String(slot).padStart(4, "0")}.jpg`);

    await copyFile(tilePath, tileFile);
    await unlink(tilePath).catch(() => undefined);

    const target = spriteFile(camera, date, bucketStart);
    // Keep a real .jpg extension on the staged file: FFmpeg picks its muxer by
    // extension, and a ".tmp" suffix makes it refuse the output.
    const staged = target.replace(/\.jpg$/, ".staged.jpg");
    if (!(await composeSprite(dir, staged))) {
      await rm(staged, { force: true });
      await rm(tileFile, { force: true });
      // Do not advertise a sheet that was never written.
      index.buckets = index.buckets.filter((item) => item.start !== bucketStart || item.frames.length > 0);
      return false;
    }
    await rename(staged, target);

    const updated: ThumbnailBucket = {
      start: bucketStart,
      frames: [...bucket.frames, frameMs].sort((left, right) => left - right),
      version: bucket.version + 1,
    };
    index.buckets = index.buckets.map((item) => (item.start === bucketStart ? updated : item));
    await writeIndex(camera, date, index);

    /*
     * A bucket holds exactly 24 cells, so once it is full it can never change
     * again. Its tiles are then dead weight: drop them and keep only the sheet,
     * which halves steady-state disk for finished days. A partly filled bucket
     * keeps its tiles so a restart can carry on instead of re-extracting.
     */
    if (updated.frames.length >= THUMBNAIL_TILES_PER_SPRITE) {
      await rm(dir, { recursive: true, force: true });
    }
    return true;
  });
}

/** True when every recorded slot for a bucket has been generated. */
export function bucketIsComplete(bucket: ThumbnailBucket, interval: number): boolean {
  return bucket.frames.length >= Math.min(THUMBNAIL_TILES_PER_SPRITE, Math.ceil(spriteBucketMs(interval) / thumbnailIntervalMs(interval)));
}

/** Delete generated data older than the retention window. Recordings are untouched. */
export async function pruneExpired(now = Date.now()): Promise<number> {
  const days = getConfig().thumbnailRetentionDays;
  if (!days) return 0;
  const root = rootDir();
  if (!existsSync(root)) return 0;
  const cutoff = new Date(now - days * 86_400_000).toISOString().slice(0, 10);

  let removed = 0;
  for (const camera of await readdir(root).catch(() => [] as string[])) {
    const cameraDir = path.join(root, camera);
    for (const date of await readdir(cameraDir).catch(() => [] as string[])) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (date >= cutoff) continue;
      await rm(path.join(cameraDir, date), { recursive: true, force: true });
      cache.delete(keyOf(Number(camera), date));
      removed += 1;
    }
  }
  return removed;
}

/** Total bytes on disk, for the settings/diagnostics surface. */
export async function thumbnailDiskUsage(): Promise<number> {
  const root = rootDir();
  if (!existsSync(root)) return 0;
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else total += (await stat(full).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(root);
  return total;
}
