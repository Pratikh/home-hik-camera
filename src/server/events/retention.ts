import "server-only";
import { unlink } from "node:fs/promises";
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
  /** Object-detection track metadata rows removed with the event window. */
  detectionTracks: number;
  /** Audit-log rows removed by the audit retention window (0 when disabled). */
  auditLogs: number;
  /** Old object-detection test-request rows removed. */
  testRequests: number;
  /** Stale viewer-presence rows removed. */
  presence: number;
};

/**
 * The hub's own retention.
 *
 * Order matters: snapshot paths are read *before* the event rows are deleted.
 * The files are then unlinked, and a final sweep catches anything the database
 * no longer references.
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
    detectionTracks,
    auditLogs,
    testRequests,
    presence,
  };
}
