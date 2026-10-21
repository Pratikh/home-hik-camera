import "server-only";
import { readFile, statfs } from "node:fs/promises";
import path from "node:path";
import type { HealthDvrState, SystemHealthBody } from "@/lib/api-types";
import type { AppConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { FaceProcessingSummary } from "@/lib/faces";
import { eventIngestionStatus } from "@/server/events/event-processor";
import { openEventStore, type EventStore } from "@/server/events/event-store";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { thumbnailDiskUsage } from "@/server/playback/thumbnail-store";
import { thumbnailWorkerState } from "@/server/playback/thumbnail-worker";
import { getMediaStatus, type MediaStatus } from "@/server/video/media-status";

/**
 * Admin-only operational health.
 *
 * The public `/api/health` endpoint keeps its small, stable shape. This module
 * adds the checks an operator needs at 03:00 — a face worker that silently
 * stopped, a backup that has not run, a storage volume filling up — without
 * exposing credentials, tokens, traffic URLs or file-system paths.
 *
 * Every unknown is reported as `unknown`, never as healthy. A missing backup
 * status file is not evidence that backups are working.
 */

const BACKUP_STALE_SECONDS = 36 * 60 * 60;
const STORAGE_WARN_PERCENT = 90;
const STORAGE_WARN_FREE_BYTES = 1024 * 1024 * 1024;

type FaceHeartbeat = {
  lastSeenAt: string;
  pollIntervalMs: number;
  pid: number | null;
  status: string;
  detail: string | null;
};

type BackupFile = {
  status: "success" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  lastSuccessAt: string | null;
  error: string | null;
};

type StorageUsage = {
  status: "ok" | "unknown" | "error";
  totalBytes: number | null;
  freeBytes: number | null;
  usedPercent: number | null;
};

export type SystemHealthInput = {
  config: Pick<
    AppConfig,
    "appConfigured" | "faceDetectionEnabled" | "thumbnailEnabled" | "eventRetentionDays" | "eventPollIntervalMs"
  >;
  now?: number;
  database: { status: "ok" | "error"; events: number | null; users: number | null };
  dvr: HealthDvrState;
  media: MediaStatus | null;
  ingestion: { running: boolean; lastPoll: string | null; lastError: string | null };
  face: { heartbeat: FaceHeartbeat | null; queue: FaceProcessingSummary | null };
  thumbnails: {
    enabled: boolean;
    worker: "running" | "idle" | "stopped" | "disabled" | "unknown";
    queued: number | null;
    concurrency: number | null;
    lastError: string | null;
    lastRunAt: string | null;
    diskBytes: number | null;
  };
  storage: StorageUsage;
  backups: BackupFile | null;
  retention: {
    lastRunAt: string | null;
    lastError: string | null;
    enabled: boolean;
    removed: SystemHealthBody["retention"]["removed"];
  };
  activeSessions: number | null;
};

function secondsSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((now - parsed) / 1000));
}

function cleanDetail(value: string | null): string | null {
  if (!value) return null;
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 197)}...` : oneLine;
}

export function buildSystemHealth(input: SystemHealthInput): SystemHealthBody {
  const now = input.now ?? Date.now();
  const warnings: string[] = [];

  if (!input.config.appConfigured) warnings.push("The application environment is not fully configured.");
  if (input.database.status === "error") warnings.push("The SQLite database is not readable.");
  if (input.dvr === "disconnected") warnings.push("The DVR is unreachable or rejected the configured user.");

  const media = input.media;
  const mediaReachable = media ? media.reachable : null;
  if (mediaReachable === false) warnings.push("MediaMTX is unreachable.");
  if (mediaReachable === null) warnings.push("MediaMTX status is unknown.");
  if (media?.drift) warnings.push("MediaMTX is using a different DVR address than this hub.");

  // ---- face worker -------------------------------------------------------
  let faceWorker: SystemHealthBody["faceDetection"]["worker"] = "disabled";
  let faceWarning: string | null = null;
  let heartbeatAge: number | null = null;
  let faceStale = false;

  if (input.config.faceDetectionEnabled) {
    if (!input.face.heartbeat) {
      faceWorker = "stopped";
      faceWarning =
        "Face detection is enabled, but the local face worker has never checked in. Start face-worker or the home-cctv-face-worker service.";
    } else {
      heartbeatAge = secondsSince(input.face.heartbeat.lastSeenAt, now);
      const pollMs = Number.isFinite(input.face.heartbeat.pollIntervalMs)
        ? Math.max(1000, input.face.heartbeat.pollIntervalMs)
        : 5000;
      const threshold = Math.max(30, (pollMs / 1000) * 4);
      faceStale = heartbeatAge === null || heartbeatAge > threshold;
      if (input.face.heartbeat.status === "error") {
        faceWorker = "stopped";
        faceWarning = "The face worker reported a failed cycle. Check its container logs.";
      } else if (faceStale) {
        faceWorker = "stopped";
        faceWarning = `The face worker has not checked in for ${heartbeatAge ?? "an unknown number of"} seconds.`;
      } else {
        faceWorker = "running";
      }
    }
    const pending = input.face.queue?.pending ?? 0;
    if (faceWorker !== "running" && pending > 0) {
      faceWarning = `${faceWarning ?? "The face worker is not running."} ${pending} job(s) are waiting.`;
    }
    if (faceWarning) warnings.push(faceWarning);
  }

  // ---- thumbnails --------------------------------------------------------
  let thumbnailWorker: SystemHealthBody["thumbnails"]["worker"] = "disabled";
  if (input.thumbnails.enabled) {
    thumbnailWorker = input.thumbnails.worker;
    // `dvr_busy` is the DVR's single playback slot being held by the player: the
    // worker deliberately stands down and retries. It is not an operational
    // failure and must not turn the whole system page amber.
    if (input.thumbnails.lastError && input.thumbnails.lastError !== "dvr_busy") {
      warnings.push("The thumbnail worker reported an error.");
    }
  }

  // ---- backups -----------------------------------------------------------
  let backupStatus: SystemHealthBody["backups"]["status"] = "unknown";
  let backupAge: number | null = null;
  if (input.backups) {
    backupAge = secondsSince(input.backups.lastSuccessAt, now);
    if (input.backups.status === "failed") backupStatus = "failed";
    else if (backupAge === null || backupAge > BACKUP_STALE_SECONDS) backupStatus = "stale";
    else backupStatus = "ok";
    if (backupStatus === "failed") warnings.push("The most recent backup attempt failed.");
    if (backupStatus === "stale") warnings.push("No successful backup has been recorded recently.");
  }

  // ---- retention ---------------------------------------------------------
  let retentionStatus: SystemHealthBody["retention"]["status"] = "unknown";
  if (!input.retention.enabled) retentionStatus = "disabled";
  else if (input.retention.lastError) retentionStatus = "error";
  else if (input.retention.lastRunAt) retentionStatus = "ok";
  if (retentionStatus === "error") warnings.push("The last retention pass reported an error.");

  // ---- storage -----------------------------------------------------------
  if (input.storage.status === "ok" && input.storage.usedPercent !== null) {
    if (input.storage.usedPercent >= STORAGE_WARN_PERCENT) warnings.push("Data storage is almost full.");
    if (input.storage.freeBytes !== null && input.storage.freeBytes < STORAGE_WARN_FREE_BYTES) {
      warnings.push("Less than 1 GB of free space remains on the data volume.");
    }
  }

  const status: SystemHealthBody["status"] =
    !input.config.appConfigured || input.database.status === "error"
      ? "unhealthy"
      : warnings.length > 0
        ? "degraded"
        : "healthy";

  return {
    checkedAt: new Date(now).toISOString(),
    status,
    application: input.config.appConfigured ? "ok" : "misconfigured",
    database: input.database,
    dvr: input.dvr,
    mediamtx: {
      status: mediaReachable === null ? "unknown" : mediaReachable ? "ok" : "offline",
      reachable: mediaReachable,
      drift: media ? media.drift : null,
      message: media?.message ?? null,
      paths: (media?.paths ?? []).map((item) => ({
        path: item.path,
        ready: item.ready,
        tracks: item.tracks.length,
        bytesReceived: item.bytesReceived,
      })),
    },
    events: {
      ingestion: input.ingestion.running ? "running" : input.ingestion.lastPoll ? "stopped" : "unknown",
      lastPoll: input.ingestion.lastPoll,
      lastError: cleanDetail(input.ingestion.lastError),
    },
    faceDetection: {
      enabled: input.config.faceDetectionEnabled,
      worker: faceWorker,
      lastHeartbeat: input.face.heartbeat?.lastSeenAt ?? null,
      heartbeatAgeSeconds: heartbeatAge,
      stale: faceStale,
      queue: input.face.queue,
      detail: cleanDetail(input.face.heartbeat?.detail ?? null),
      warning: faceWarning,
    },
    thumbnails: {
      enabled: input.thumbnails.enabled,
      worker: thumbnailWorker,
      queued: input.thumbnails.queued,
      concurrency: input.thumbnails.concurrency,
      lastError: cleanDetail(input.thumbnails.lastError),
      lastRunAt: input.thumbnails.lastRunAt,
      diskBytes: input.thumbnails.diskBytes,
    },
    storage: input.storage,
    backups: {
      status: backupStatus,
      lastSuccessAt: input.backups?.lastSuccessAt ?? null,
      lastAttemptAt: input.backups?.finishedAt ?? input.backups?.startedAt ?? null,
      ageSeconds: backupAge,
      detail: cleanDetail(input.backups?.error ?? null),
    },
    retention: {
      status: retentionStatus,
      lastRunAt: input.retention.lastRunAt,
      lastError: cleanDetail(input.retention.lastError),
      removed: input.retention.removed,
    },
    sessions: { active: input.activeSessions },
    warnings,
  };
}

function healthDvr(state: string): HealthDvrState {
  if (state === "connected" || state === "not_configured") return state;
  return "disconnected";
}

async function readStorage(dataDir: string): Promise<StorageUsage> {
  try {
    const stats = await statfs(dataDir);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes) || totalBytes <= 0) {
      return { status: "unknown", totalBytes: null, freeBytes: null, usedPercent: null };
    }
    return {
      status: "ok",
      totalBytes,
      freeBytes,
      usedPercent: Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10,
    };
  } catch {
    return { status: "unknown", totalBytes: null, freeBytes: null, usedPercent: null };
  }
}

/**
 * Read the status file written by `scripts/backup.sh`.
 *
 * It lives inside DATA_DIR so the web container can read it without mounting
 * the backup directory. Failure to parse is `unknown`, never "ok".
 */
async function readBackupStatus(dataDir: string): Promise<BackupFile | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(dataDir, "backup-status.json"), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const text = (key: string): string | null => (typeof parsed[key] === "string" ? (parsed[key] as string) : null);
    const status = parsed.status === "success" || parsed.status === "failed" ? parsed.status : null;
    if (!status) return null;
    return {
      status,
      startedAt: text("started_at"),
      finishedAt: text("finished_at"),
      lastSuccessAt: text("last_success_at") ?? (status === "success" ? text("finished_at") : null),
      error: text("error"),
    };
  } catch {
    return null;
  }
}

/** Gather every dependency, keeping each failure local. */
export async function collectSystemHealth(): Promise<SystemHealthBody> {
  const config = getConfig();
  const now = Date.now();

  let store: EventStore | null = null;
  try {
    store = openEventStore(config.dataDir);
  } catch (error) {
    console.error("[system-health] database", error instanceof Error ? error.name : "error");
  }

  const database = store
    ? { status: "ok" as const, events: store.count(), users: null as number | null }
    : { status: "error" as const, events: null, users: null };
  if (store) {
    try {
      const row = store.db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
      database.users = row.count;
    } catch {
      database.users = null;
    }
  }

  const [dvrOverview, media, thumbDisk] = await Promise.all([
    getDvrOverview().catch(() => null),
    getMediaStatus().catch(() => null),
    config.thumbnailEnabled ? thumbnailDiskUsage().catch(() => null) : Promise.resolve(null),
  ]);

  const ingestion = eventIngestionStatus();
  let lastPoll: string | null = null;
  let lastError: string | null = null;
  if (store) {
    try {
      lastPoll = store.setting("events_last_poll");
      lastError = store.setting("events_last_error") || null;
    } catch {
      lastPoll = null;
    }
  }

  const thumbState = thumbnailWorkerState();
  let persistedThumb:
    | { lastRunAt: string | null; queued: number; status: string | null; lastError: string | null }
    | null = null;
  if (store) {
    try {
      persistedThumb = store.thumbnailWorkerStatus();
    } catch {
      persistedThumb = null;
    }
  }
  // Prefer the database copy: the worker and this route can be separate module
  // instances, and an in-memory "never ran" is not proof that it is stopped.
  const thumbLastRun = persistedThumb?.lastRunAt ?? thumbState.lastRunAt;
  const thumbQueued = persistedThumb?.lastRunAt ? persistedThumb.queued : thumbState.queued;
  const thumbError = persistedThumb?.lastError ?? thumbState.lastError;
  const thumbAge = secondsSince(thumbLastRun, now);
  let thumbWorker: SystemHealthBody["thumbnails"]["worker"] = "disabled";
  if (config.thumbnailEnabled) {
    if (!thumbLastRun) thumbWorker = thumbState.running ? "running" : "unknown";
    else if (thumbQueued > 0) thumbWorker = thumbAge !== null && thumbAge <= 120 ? "running" : "stopped";
    else thumbWorker = "idle";
  }
  const thumbnails = {
    enabled: config.thumbnailEnabled,
    worker: thumbWorker,
    queued: thumbQueued,
    concurrency: thumbState.concurrency,
    lastError: thumbError,
    lastRunAt: thumbLastRun,
    diskBytes: thumbDisk,
  };

  let heartbeat: FaceHeartbeat | null = null;
  let queue: FaceProcessingSummary | null = null;
  if (store && config.faceDetectionEnabled) {
    try {
      heartbeat = store.faceWorkerHeartbeat();
      queue = store.faceProcessingSummary();
    } catch {
      heartbeat = null;
      queue = null;
    }
  }

  const [storage, backups] = await Promise.all([
    readStorage(config.dataDir),
    readBackupStatus(config.dataDir),
  ]);

  const retention = {
    lastRunAt: null as string | null,
    lastError: null as string | null,
    enabled: config.eventRetentionDays > 0,
    removed: null as SystemHealthBody["retention"]["removed"],
  };
  let activeSessions: number | null = null;
  if (store) {
    try {
      // The UI can override EVENT_RETENTION_DAYS; report the effective value.
      const override = store.setting("retention_days");
      if (override && /^\d+$/.test(override)) retention.enabled = Number(override) > 0;
      const status = store.retentionStatus();
      retention.lastRunAt = status.lastRunAt;
      retention.lastError = status.lastError;
      retention.removed = {
        events: status.events,
        notifications: status.notifications,
        snapshots: status.snapshots,
        orphanedSnapshots: status.orphanedSnapshots,
        crops: status.crops,
        orphanedCrops: status.orphanedCrops,
      };
      const row = store.db.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE expires_at > ?").get(now) as {
        count: number;
      };
      activeSessions = row.count;
    } catch {
      // Leave the individual fields at their unknown values.
    }
  }

  // The in-memory flag is not shared across module instances; a recent DVR poll
  // recorded in SQLite is proof that ingestion is alive in this process.
  const polledAt = lastPoll ? Date.parse(lastPoll) : Number.NaN;
  const pollFresh = Number.isFinite(polledAt) && now - polledAt < config.eventPollIntervalMs * 6;

  return buildSystemHealth({
    config,
    now,
    database,
    dvr: healthDvr(dvrOverview?.state ?? "disconnected"),
    media: media ?? null,
    ingestion: { running: ingestion.running || pollFresh, lastPoll, lastError },
    face: { heartbeat, queue },
    thumbnails,
    storage,
    backups,
    retention,
    activeSessions,
  });
}
