import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sprite store, with FFmpeg substituted.
 *
 * What matters here is not the encoding but the bookkeeping: a tile is only
 * announced once the sheet containing it exists, tiles stay in packing order, and
 * nothing a query string can say becomes a filename.
 */

const mocks = vi.hoisted(() => ({ compose: vi.fn() }));

vi.mock("@/server/playback/thumbnail-extract", () => ({
  composeSprite: (tileDir: string, outPath: string) => mocks.compose(tileDir, outPath),
}));

const { addFrame, readIndex, resetThumbnailStore, spriteFile, pruneExpired } = await import(
  "@/server/playback/thumbnail-store"
);

const DATE = "2026-10-21";
const CAMERA = 1;
const INTERVAL = 30;
const CELL = INTERVAL * 1000;
/** An aligned bucket start (07:00 IST). */
const BASE = Math.floor(new Date("2026-10-21T07:00:00+05:30").getTime() / (24 * CELL)) * 24 * CELL;

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "cctv-thumbs-"));
  process.env.DATA_DIR = dataDir;
  process.env.PLAYBACK_THUMBNAIL_INTERVAL_SECONDS = String(INTERVAL);
  resetThumbnailStore();
  mocks.compose.mockReset();
  mocks.compose.mockImplementation(async (_tileDir: string, outPath: string) => {
    await writeFile(outPath, Buffer.from("sprite-bytes"));
    return true;
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete process.env.PLAYBACK_THUMBNAIL_INTERVAL_SECONDS;
});

/** A stand-in for an extracted tile. */
async function tile(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cctv-tile-"));
  const file = path.join(dir, "frame.jpg");
  await writeFile(file, Buffer.from("tile-bytes"));
  return file;
}

describe("thumbnail store", () => {
  it("publishes a frame only after the sheet it belongs to exists", async () => {
    const ok = await addFrame(CAMERA, DATE, BASE, await tile());
    expect(ok).toBe(true);

    const index = await readIndex(CAMERA, DATE);
    expect(index.buckets).toHaveLength(1);
    expect(index.buckets[0]!.frames).toEqual([BASE]);
    expect(index.buckets[0]!.version).toBe(1);

    const sprite = await stat(spriteFile(CAMERA, DATE, BASE));
    expect(sprite.size).toBeGreaterThan(0);
    // The tile is kept: a partly built sheet must survive a restart.
    expect(await stat(path.join(dataDir, "thumbnails", String(CAMERA), DATE, "tiles", String(BASE), "0000.jpg"))).toBeTruthy();
  });

  it("keeps tiles in packing order and bumps the version each time", async () => {
    await addFrame(CAMERA, DATE, BASE, await tile());
    await addFrame(CAMERA, DATE, BASE + 3 * CELL, await tile());
    await addFrame(CAMERA, DATE, BASE + CELL, await tile());

    const index = await readIndex(CAMERA, DATE);
    // Sorted by instant, so tile N really is the Nth frame.
    expect(index.buckets[0]!.frames).toEqual([BASE, BASE + CELL, BASE + 3 * CELL]);
    expect(index.buckets[0]!.version).toBe(3);
  });

  it("does not re-add a frame that is already generated", async () => {
    await addFrame(CAMERA, DATE, BASE, await tile());
    mocks.compose.mockClear();
    const again = await addFrame(CAMERA, DATE, BASE, await tile());
    expect(again).toBe(true);
    expect(mocks.compose).not.toHaveBeenCalled();
    expect((await readIndex(CAMERA, DATE)).buckets[0]!.frames).toEqual([BASE]);
  });

  it("rolls back when the sheet cannot be written", async () => {
    mocks.compose.mockImplementation(async () => false);
    const ok = await addFrame(CAMERA, DATE, BASE, await tile());
    expect(ok).toBe(false);

    const index = await readIndex(CAMERA, DATE);
    expect(index.buckets.every((bucket) => bucket.frames.length === 0)).toBe(true);
    // The half-written tile is removed so a retry starts clean.
    const tiles = await readdir(path.join(dataDir, "thumbnails", String(CAMERA), DATE, "tiles", String(BASE))).catch(() => []);
    expect(tiles).toEqual([]);
  });

  it("refuses unaligned or escaping sprite paths", () => {
    expect(() => spriteFile(CAMERA, DATE, BASE + 1000)).toThrow(/unaligned/);
    expect(() => spriteFile(CAMERA, "../../etc", BASE)).toThrow(/date/);
    expect(() => spriteFile(9, DATE, BASE)).toThrow(/camera/);
    expect(() => spriteFile(CAMERA, DATE, -24 * CELL)).toThrow(/bucket/);
  });

  it("survives a restart: the index is read back from disk", async () => {
    await addFrame(CAMERA, DATE, BASE, await tile());
    resetThumbnailStore(); // forget the in-process cache, as a restart would
    expect((await readIndex(CAMERA, DATE)).buckets[0]!.frames).toEqual([BASE]);
    expect((await readFile(spriteFile(CAMERA, DATE, BASE))).toString()).toBe("sprite-bytes");
  });

  it("prunes only days beyond the retention window", async () => {
    process.env.PLAYBACK_THUMBNAIL_RETENTION_DAYS = "2";
    const old = "2026-10-01";
    const recent = "2026-10-20";
    await addFrame(CAMERA, old, BASE, await tile());
    await addFrame(CAMERA, recent, BASE, await tile());

    const removed = await pruneExpired(new Date("2026-10-21T12:00:00+05:30").getTime());
    expect(removed).toBe(1);
    await expect(stat(path.join(dataDir, "thumbnails", String(CAMERA), old))).rejects.toThrow();
    await expect(stat(path.join(dataDir, "thumbnails", String(CAMERA), recent))).resolves.toBeTruthy();
    delete process.env.PLAYBACK_THUMBNAIL_RETENTION_DAYS;
  });
});
