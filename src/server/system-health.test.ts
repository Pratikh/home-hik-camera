import { describe, expect, it } from "vitest";
import { memoryEventStore } from "@/server/events/event-store";
import { buildSystemHealth, type SystemHealthInput } from "@/server/system-health";

const NOW = Date.parse("2026-10-21T10:00:00Z");

function input(overrides: Partial<SystemHealthInput> = {}): SystemHealthInput {
  return {
    config: {
      appConfigured: true,
      faceDetectionEnabled: true,
      thumbnailEnabled: true,
      eventRetentionDays: 30,
      eventPollIntervalMs: 5000,
    },
    now: NOW,
    database: { status: "ok", events: 12, users: 2 },
    dvr: "connected",
    media: { reachable: true, paths: [], drift: false, message: null },
    ingestion: { running: true, lastPoll: "2026-10-21T09:59:00Z", lastError: null },
    face: {
      heartbeat: {
        lastSeenAt: "2026-10-21T09:59:55Z",
        pollIntervalMs: 5000,
        pid: 12,
        status: "running",
        detail: null,
      },
      queue: { pending: 1, processing: 0, completed: 20, failed: 1 },
    },
    thumbnails: {
      enabled: true,
      worker: "idle",
      queued: 0,
      concurrency: 1,
      lastError: null,
      lastRunAt: "2026-10-21T09:00:00Z",
      diskBytes: 1024,
    },
    storage: { status: "ok", totalBytes: 100_000_000_000, freeBytes: 50_000_000_000, usedPercent: 50 },
    backups: {
      status: "success",
      startedAt: "2026-10-21T03:30:00Z",
      finishedAt: "2026-10-21T03:31:00Z",
      lastSuccessAt: "2026-10-21T03:31:00Z",
      error: null,
    },
    retention: {
      lastRunAt: "2026-10-21T09:00:00Z",
      lastError: null,
      enabled: true,
      removed: { events: 1, notifications: 1, snapshots: 1, orphanedSnapshots: 0, crops: 0, orphanedCrops: 0 },
    },
    activeSessions: 2,
    ...overrides,
  };
}

describe("system health", () => {
  it("reports healthy only when every check is known and good", () => {
    const report = buildSystemHealth(input());
    expect(report.status).toBe("healthy");
    expect(report.faceDetection.worker).toBe("running");
    expect(report.warnings).toEqual([]);
    expect(report.mediamtx.status).toBe("ok");
  });

  it("reports a face worker that never checked in as stopped, with a warning", () => {
    const report = buildSystemHealth(input({ face: { heartbeat: null, queue: { pending: 4, processing: 0, completed: 0, failed: 0 } } }));
    expect(report.faceDetection.worker).toBe("stopped");
    expect(report.faceDetection.warning).toMatch(/never checked in/i);
    expect(report.status).toBe("degraded");
    expect(report.warnings.join(" ")).toMatch(/4 job/i);
  });

  it("reports a stale heartbeat as stopped rather than healthy", () => {
    const report = buildSystemHealth(
      input({
        face: {
          heartbeat: {
            lastSeenAt: "2026-10-21T09:50:00Z",
            pollIntervalMs: 5000,
            pid: null,
            status: "running",
            detail: null,
          },
          queue: null,
        },
      }),
    );
    expect(report.faceDetection.worker).toBe("stopped");
    expect(report.faceDetection.stale).toBe(true);
    expect(report.faceDetection.heartbeatAgeSeconds).toBe(600);
  });

  it("does not report an error when face detection is disabled", () => {
    const report = buildSystemHealth(
      input({
        config: {
          appConfigured: true,
          faceDetectionEnabled: false,
          thumbnailEnabled: true,
          eventRetentionDays: 30,
          eventPollIntervalMs: 5000,
        },
        face: { heartbeat: null, queue: null },
      }),
    );
    expect(report.faceDetection.worker).toBe("disabled");
    expect(report.faceDetection.warning).toBeNull();
    expect(report.warnings).toEqual([]);
    expect(report.status).toBe("healthy");
  });

  it("treats a busy DVR during thumbnail extraction as expected, not as an error", () => {
    const report = buildSystemHealth(
      input({
        thumbnails: {
          enabled: true,
          worker: "idle",
          queued: 1,
          concurrency: 1,
          lastError: "dvr_busy",
          lastRunAt: "2026-10-21T09:59:00Z",
          diskBytes: 1024,
        },
      }),
    );
    expect(report.warnings).toEqual([]);
    expect(report.status).toBe("healthy");
  });

  it("reports unknown services as unknown, never as healthy", () => {
    const report = buildSystemHealth(input({ media: null, backups: null }));
    expect(report.mediamtx.status).toBe("unknown");
    expect(report.mediamtx.reachable).toBeNull();
    expect(report.backups.status).toBe("unknown");
    expect(report.status).toBe("degraded");
  });

  it("marks an unreadable database as unhealthy and a stale backup as degraded", () => {
    const broken = buildSystemHealth(input({ database: { status: "error", events: null, users: null } }));
    expect(broken.status).toBe("unhealthy");
    expect(broken.warnings.join(" ")).toMatch(/database/i);

    const stale = buildSystemHealth(
      input({
        backups: {
          status: "success",
          startedAt: "2026-10-10T03:30:00Z",
          finishedAt: "2026-10-10T03:31:00Z",
          lastSuccessAt: "2026-10-10T03:31:00Z",
          error: null,
        },
      }),
    );
    expect(stale.backups.status).toBe("stale");
    expect(stale.status).toBe("degraded");
  });

  it("surfaces a failed backup and a retention error", () => {
    const report = buildSystemHealth(
      input({
        backups: {
          status: "failed",
          startedAt: "2026-10-21T03:30:00Z",
          finishedAt: "2026-10-21T03:31:00Z",
          lastSuccessAt: "2026-10-20T03:31:00Z",
          error: "disk full",
        },
        retention: { lastRunAt: null, lastError: "Error", enabled: true, removed: null },
      }),
    );
    expect(report.backups.status).toBe("failed");
    expect(report.retention.status).toBe("error");
    expect(report.status).toBe("degraded");
  });

  it("reads the thumbnail worker diagnostics persisted across module instances", () => {
    const store = memoryEventStore();
    store.setSetting("thumbnail_worker_last_run", "2026-10-21T09:59:00.000Z");
    store.setSetting("thumbnail_worker_queued", "0");
    store.setSetting("thumbnail_worker_status", "idle");
    store.setSetting("thumbnail_worker_last_error", "");
    expect(store.thumbnailWorkerStatus()).toEqual({
      lastRunAt: "2026-10-21T09:59:00.000Z",
      queued: 0,
      status: "idle",
      lastError: null,
    });
  });

  it("never includes credentials or session-like material", () => {
    const report = buildSystemHealth(input());
    const encoded = JSON.stringify(report);
    for (const forbidden of ["password", "secret", "token", "rtsp://", "cctv_session"]) {
      expect(encoded.toLowerCase()).not.toContain(forbidden);
    }
  });
});
