import { mkdtempSync } from "node:fs";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sweepOrphanSnapshots } from "@/server/events/orphan-snapshots";

const KEP = "2026/10/09/1-evt_aaaaaaaaaaaaaaaaaaaaaaaa.jpg";
const ORPHAN = "2026/10/09/2-evt_bbbbbbbbbbbbbbbbbbbbbbbb.jpg";
const WRONG_CAMERA = "2026/10/09/9-evt_cccccccccccccccccccccccc.jpg";

async function dataDir(): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "orphan-snapshots-"));
  await mkdir(path.join(dir, "events", "2026", "10", "09"), { recursive: true });
  await writeFile(path.join(dir, "events", KEP), "keep");
  await writeFile(path.join(dir, "events", ORPHAN), "orphan");
  await writeFile(path.join(dir, "events", WRONG_CAMERA), "not ours");
  await writeFile(path.join(dir, "events", "2026", "10", "09", "notes.txt"), "written by hand");
  return dir;
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

describe("orphan snapshot sweep", () => {
  it("dry-run reports an orphan without deleting it", async () => {
    const dir = await dataDir();
    const before = await sweepOrphanSnapshots(dir, new Set([KEP]), { dryRun: true });
    expect(before.dryRun).toBe(true);
    expect(before.inspected).toBe(2);
    expect(before.kept).toBe(1);
    expect(before.deleted).toBe(1);
    expect(await exists(path.join(dir, "events", ORPHAN))).toBe(true);
  });

  it("deletes only generated files that the database does not reference", async () => {
    const dir = await dataDir();
    const result = await sweepOrphanSnapshots(dir, new Set([KEP]));
    expect(result.inspected).toBe(2);
    expect(result.deleted).toBe(1);
    expect(await exists(path.join(dir, "events", KEP))).toBe(true);
    expect(await exists(path.join(dir, "events", ORPHAN))).toBe(false);
    // A non-generated name and an out-of-range camera are left alone.
    expect(await exists(path.join(dir, "events", WRONG_CAMERA))).toBe(true);
    expect(await exists(path.join(dir, "events", "2026/10/09/notes.txt"))).toBe(true);
  });

  it("is safe to run repeatedly", async () => {
    const dir = await dataDir();
    await sweepOrphanSnapshots(dir, new Set([KEP]));
    const second = await sweepOrphanSnapshots(dir, new Set([KEP]));
    expect(second.inspected).toBe(1);
    expect(second.deleted).toBe(0);
    expect(second.kept).toBe(1);
  });

  it("never follows a symlink out of the data directory", async () => {
    const dir = await dataDir();
    const outside = path.join(dir, "outside.jpg");
    await writeFile(outside, "secret");
    await symlink(outside, path.join(dir, "events", "2026", "10", "09", "3-evt_dddddddddddddddddddddddd.jpg"));

    const result = await sweepOrphanSnapshots(dir, new Set([KEP]));
    expect(result.inspected).toBe(2);
    expect(result.deleted).toBe(1);
    expect(await exists(outside)).toBe(true);
  });

  it("tolerates a missing events directory", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "orphan-missing-"));
    const result = await sweepOrphanSnapshots(dir, new Set());
    expect(result).toEqual({ inspected: 0, deleted: 0, kept: 0, failed: 0, dryRun: false });
  });

  it("refuses a symlinked events root instead of following it", async () => {
    const outside = mkdtempSync(path.join(os.tmpdir(), "orphan-outside-"));
    await mkdir(path.join(outside, "2026", "10", "09"), { recursive: true });
    await writeFile(path.join(outside, ORPHAN), "orphan");
    const dir = mkdtempSync(path.join(os.tmpdir(), "orphan-symlink-"));
    await symlink(outside, path.join(dir, "events"));

    const result = await sweepOrphanSnapshots(dir, new Set());
    expect(result.inspected).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(1);
    expect(await exists(path.join(outside, ORPHAN))).toBe(true);
  });
});
