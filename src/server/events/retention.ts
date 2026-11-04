import "server-only";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { faceCropFile, faceCropsDir } from "@/lib/face-path";
import { snapshotFile } from "@/lib/snapshot-path";
import type { EventStore } from "@/server/events/event-store";
import { sweepOrphanSnapshots } from "@/server/events/orphan-snapshots";

export type RetentionResult = {
  /** Event rows deleted. */
  events: number;
  notifications: number;
  /** Snapshot files removed from DATA_DIR/events. */
  snapshots: number;
  /** Snapshot files that no event row referenced any more, removed defensively. */
  orphanedSnapshots: number;
  /** Face crop files removed because their event was deleted. */
  crops: number;
  /** Crop files that no face row referenced any more, removed defensively. */
  orphanedCrops: number;
  /** Object-detection track metadata rows removed with the event window. */
  detectionTracks: number;
  /** Audit-log rows removed by the audit retention window (0 when disabled). */
  auditLogs: number;
  /** Old object-detection test-request rows removed. */
  testRequests: number;
  /** Stale viewer-presence rows removed. */
  presence: number;
};

/** Only files this project wrote are ever swept. */
const CROP_FILE = /^[0-9]{4}\/[0-9]{2}\/evt_[a-f0-9]{24}-face-[0-9]+\.jpg$/;

/**
 * Remove crop files that no `event_faces` row references.
 *
 * Retention deletes the database rows and the files it knows about, but a crash
 * between the two — or a re-processed snapshot that produced fewer faces — can
 * leave a file behind. The crops directory is exclusively this feature's, and
 * only filenames matching the generated pattern are considered, so a file that
 * was placed there by hand is never touched.
 */
export async function sweepOrphanFaceCrops(dataDir: string, known: Set<string>): Promise<number> {
  const root = faceCropsDir(dataDir);
  let removed = 0;

  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relative, depth + 1);
        continue;
      }
      if (!entry.isFile() || !CROP_FILE.test(relative)) continue;
      if (known.has(relative)) continue;
      const target = faceCropFile(dataDir, relative);
      if (!target) continue;
      try {
        await unlink(target);
        removed += 1;
      } catch {
        // Already gone, or not removable. Never fatal.
      }
    }
  };

  await walk(root, "", 0);
  return removed;
}

/**
 * The hub's own retention, including face data.
 *
 * Order matters: the crop paths are read *before* the event rows are deleted,
 * because deleting an event cascades its `event_faces` and `face_processing`
 * rows away. The files are then unlinked, and a final sweep catches anything
 * the database no longer references.
 *
 * This never touches DVR recordings, MediaMTX paths or user accounts.
 */
export async function runRetention(input: {
  store: EventStore;
  dataDir: string;
  /** Event/media cutoff, or null when event retention is disabled (0 days). */
  cutoffIso: string | null;
  /** Audit-log cutoff, or null when audit retention is disabled. */
  auditCutoffIso?: string | null;
  /** Cutoff for completed detection-test requests (defaults to the event cutoff). */
  testRequestCutoffIso?: string;
  /** Epoch-ms cutoff for stale viewer-presence rows. */
  presenceBeforeMs?: number;
}): Promise<RetentionResult> {
  const { store, dataDir, cutoffIso } = input;

  const snapshotPaths = cutoffIso ? store.snapshotPathsBefore(cutoffIso) : [];
  const cropPaths = cutoffIso ? store.faceCropPathsBefore(cutoffIso) : [];

  const events = cutoffIso ? store.deleteOlderThan(cutoffIso) : 0;
  const notifications = cutoffIso ? store.deleteNotificationsOlderThan(cutoffIso) : 0;
  const detectionTracks = cutoffIso ? store.pruneObjectDetectionTracks(cutoffIso) : 0;
  const auditLogs = input.auditCutoffIso ? store.pruneAuditLogs(input.auditCutoffIso) : 0;
  const testRequestCutoff = input.testRequestCutoffIso ?? cutoffIso;
  const testRequests = testRequestCutoff ? store.pruneObjectDetectionTestRequests(testRequestCutoff) : 0;
  const presence = typeof input.presenceBeforeMs === "number" ? store.pruneViewerPresence(input.presenceBeforeMs) : 0;

  let snapshots = 0;
  for (const relative of snapshotPaths) {
    const target = snapshotFile(dataDir, relative);
    if (!target) continue;
    try {
      await unlink(target);
      snapshots += 1;
    } catch {
      // Already gone. Never fatal.
    }
  }

  let crops = 0;
  for (const relative of cropPaths) {
    const target = faceCropFile(dataDir, relative);
    if (!target) continue;
    try {
      await unlink(target);
      crops += 1;
    } catch {
      // Already gone. Never fatal.
    }
  }

  const known = new Set(store.allFaceCropPaths());
  const orphanedCrops = await sweepOrphanFaceCrops(dataDir, known);

  // A snapshot can be orphaned by a crash between the file write and
  // `setSnapshotPath`, or by a manually removed event row. Sweep what the
  // database no longer references, using the same generated-filename guard.
  const knownSnapshots = new Set(store.allSnapshotPaths());
  const snapshotSweep = await sweepOrphanSnapshots(dataDir, knownSnapshots);

  return {
    events,
    notifications,
    snapshots,
    orphanedSnapshots: snapshotSweep.deleted,
    crops,
    orphanedCrops,
    detectionTracks,
    auditLogs,
    testRequests,
    presence,
  };
}
