import { describe, expect, it } from "vitest";
import { OBJECT_DETECTION_DEFAULTS } from "@/lib/object-detection";
import { memoryEventStore } from "@/server/events/event-store";
import {
  readObjectDetectionConfig,
  readObjectWorkerHeartbeat,
  saveObjectDetectionConfig,
} from "@/server/detection/settings-store";

/**
 * The settings live in SQLite so they survive restarts and are visible to the
 * worker. The migration seeds one row per camera and never overwrites an
 * existing value.
 */

describe("object detection settings store", () => {
  it("seeds the safe defaults for the four cameras", () => {
    const store = memoryEventStore();
    const config = readObjectDetectionConfig(store.db);

    expect(config.settings).toEqual(OBJECT_DETECTION_DEFAULTS);
    expect(config.cameras.map((camera) => camera.cameraId)).toEqual([1, 2, 3, 4]);
    for (const camera of config.cameras) {
      expect(camera.enabled).toBe(false);
      expect(camera.personConfidence).toBeNull();
      expect(camera.vehicleConfidence).toBeNull();
    }
  });

  it("round-trips global settings and per-camera overrides", () => {
    const store = memoryEventStore();
    const current = readObjectDetectionConfig(store.db);

    saveObjectDetectionConfig(store.db, {
      settings: {
        ...current.settings,
        enabled: true,
        personConfidence: 0.73,
        vehicleConfidence: 0.81,
        baseFps: 2,
        activeFps: 3,
        maxFps: 5,
        detectionSource: "ai_both",
        queueSize: 4,
      },
      cameras: current.cameras.map((camera) =>
        camera.cameraId === 2
          ? { ...camera, enabled: true, personConfidence: 0.85, vehicleEnabled: false }
          : camera,
      ),
    });

    const next = readObjectDetectionConfig(store.db);
    expect(next.settings.enabled).toBe(true);
    expect(next.settings.personConfidence).toBe(0.73);
    expect(next.settings.vehicleConfidence).toBe(0.81);
    expect(next.settings.detectionSource).toBe("ai_both");
    expect(next.settings.queueSize).toBe(4);
    expect(next.cameras.find((camera) => camera.cameraId === 2)).toMatchObject({
      enabled: true,
      personConfidence: 0.85,
      vehicleEnabled: false,
      vehicleConfidence: null,
    });
    // Untouched cameras keep their defaults.
    expect(next.cameras.find((camera) => camera.cameraId === 1)).toMatchObject({ enabled: false });
  });

  it("keeps a second save from resurrecting defaults", () => {
    const store = memoryEventStore();
    const first = readObjectDetectionConfig(store.db);
    saveObjectDetectionConfig(store.db, {
      settings: { ...first.settings, enabled: true, personConfidence: 0.9 },
      cameras: first.cameras,
    });
    saveObjectDetectionConfig(store.db, {
      settings: { ...readObjectDetectionConfig(store.db).settings, vehicleConfidence: 0.88 },
      cameras: readObjectDetectionConfig(store.db).cameras,
    });

    const final = readObjectDetectionConfig(store.db);
    expect(final.settings.enabled).toBe(true);
    expect(final.settings.personConfidence).toBe(0.9);
    expect(final.settings.vehicleConfidence).toBe(0.88);
  });

  it("reports no heartbeat until the worker has written one", () => {
    const store = memoryEventStore();
    expect(readObjectWorkerHeartbeat(store.db)).toBeNull();
  });

  it("reads the worker heartbeat and its metrics safely", () => {
    const store = memoryEventStore();
    store.db
      .prepare("INSERT INTO object_worker_heartbeat (id, status, detail, metrics, updated_at) VALUES (1, ?, ?, ?, ?)")
      .run(
        "running",
        null,
        JSON.stringify({ model: "yolox-nano", cameras: 4, inferenceFps: 0.9, averageInferenceMs: 120 }),
        "2026-10-23T16:00:00+05:30",
      );

    const heartbeat = readObjectWorkerHeartbeat(store.db);
    expect(heartbeat?.status).toBe("running");
    expect(heartbeat?.metrics?.model).toBe("yolox-nano");
    expect(heartbeat?.metrics?.averageInferenceMs).toBe(120);
  });

  it("never lets a corrupt metrics blob break the status endpoint", () => {
    const store = memoryEventStore();
    store.db
      .prepare("INSERT INTO object_worker_heartbeat (id, status, detail, metrics, updated_at) VALUES (1, 'error', 'boom', ?, ?)")
      .run("{not json", "2026-10-23T16:00:00+05:30");

    const heartbeat = readObjectWorkerHeartbeat(store.db);
    expect(heartbeat?.status).toBe("error");
    expect(heartbeat?.detail).toBe("boom");
    expect(heartbeat?.metrics).toBeNull();
  });

  it("falls back to a safe status for an unknown value", () => {
    const store = memoryEventStore();
    store.db
      .prepare("INSERT INTO object_worker_heartbeat (id, status, detail, metrics, updated_at) VALUES (1, 'exploded', NULL, NULL, ?)")
      .run("2026-10-23T16:00:00+05:30");
    expect(readObjectWorkerHeartbeat(store.db)?.status).toBe("error");
  });
});
