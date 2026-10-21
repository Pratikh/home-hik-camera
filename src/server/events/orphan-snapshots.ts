import "server-only";
import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { snapshotFile } from "@/lib/snapshot-path";

/**
 * Remove generated event snapshots that no `events.snapshot_path` references.
 *
 * Only files this project wrote are considered:
 *   DATA_DIR/events/<yyyy>/<mm>/<dd>/<camera>-evt_<24 hex>.jpg
 *
 * The database is the source of truth. A hand-copied file, a different format,
 * a symlink or anything outside `DATA_DIR/events` is never touched. The sweep is
 * idempotent, so it is safe to run from retention and from an operator script.
 */
const SNAPSHOT_FILE = /^\d{4}\/\d{2}\/\d{2}\/[1-4]-evt_[a-f0-9]{24}\.jpg$/;

export type OrphanSnapshotSweep = {
  /** Generated snapshot files found under DATA_DIR/events. */
  inspected: number;
  /** Files removed (or, in dry-run mode, that would be removed). */
  deleted: number;
  /** Files that were still referenced by an event row. */
  kept: number;
  /** Removal failures. Never fatal. */
  failed: number;
  dryRun: boolean;
};

export async function sweepOrphanSnapshots(
  dataDir: string,
  known: Set<string>,
  options: { dryRun?: boolean } = {},
): Promise<OrphanSnapshotSweep> {
  const dryRun = options.dryRun === true;
  const root = path.resolve(dataDir, "events");
  const result: OrphanSnapshotSweep = { inspected: 0, deleted: 0, kept: 0, failed: 0, dryRun };

  // Refuse to start through a symlinked events directory: the sweep must never
  // be redirected outside the configured DATA_DIR.
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      result.failed += 1;
      return result;
    }
  } catch {
    return result;
  }

  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // Dirent.isDirectory()/isFile() are false for symlinks, so a symlinked
      // directory or file is skipped rather than followed.
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relative, depth + 1);
        continue;
      }
      if (!entry.isFile() || !SNAPSHOT_FILE.test(relative)) continue;
      result.inspected += 1;
      if (known.has(relative)) {
        result.kept += 1;
        continue;
      }
      // Resolve through the shared guard a second time: the relative name came
      // from the filesystem, but the delete target must still be inside the
      // snapshots directory.
      const target = snapshotFile(dataDir, relative);
      if (!target || path.dirname(target) === root) {
        result.failed += 1;
        continue;
      }
      if (dryRun) {
        result.deleted += 1;
        continue;
      }
      try {
        await unlink(target);
        result.deleted += 1;
      } catch {
        result.failed += 1;
      }
    }
  };

  await walk(root, "", 0);
  return result;
}
