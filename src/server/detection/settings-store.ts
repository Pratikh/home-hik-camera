import "server-only";
import type { DatabaseSync } from "node:sqlite";
import { getConfig } from "@/lib/config";
import {
  CAMERA_DETECTION_DEFAULTS,
  OBJECT_DETECTION_DEFAULTS,
  OBJECT_WORKER_STATUSES,
  type CameraDetectionSettings,
  type ObjectDetectionSettings,
  type ObjectWorkerHeartbeat,
  type ObjectWorkerMetrics,
  type ObjectWorkerStatus,
} from "@/lib/object-detection";
import { CAMERA_IDS } from "@/lib/cameras";
import { openEventStore } from "@/server/events/event-store";

/**
 * Persistence for the object-detection configuration.
 *
 * The Admin UI is the only writer. The Python worker reads the same rows from
 * the shared SQLite file every few seconds, so a saved change applies without
 * restarting a container. Everything here is a plain upsert: existing events,
 * rules and notification history are never touched.
 */

export type ObjectDetectionConfig = {
  settings: ObjectDetectionSettings;
  cameras: CameraDetectionSettings[];
};

function asBoolean(value: unknown): boolean {
  return Number(value) === 1;
}

function rowToSettings(row: Record<string, unknown>): ObjectDetectionSettings {
  return {
    enabled: asBoolean(row.enabled),
    personEnabled: asBoolean(row.person_enabled),
    personConfidence: Number(row.person_confidence),
    vehicleEnabled: asBoolean(row.vehicle_enabled),
    vehicleConfidence: Number(row.vehicle_confidence),
    baseFps: Number(row.base_fps),
    activeFps: Number(row.active_fps),
    maxFps: Number(row.max_fps),
    motionBoost: asBoolean(row.motion_boost),
    activityTimeoutSeconds: Number(row.activity_timeout_s),
    disappearanceThresholdSeconds: Number(row.disappearance_timeout_s),
    maxConcurrentInference: Number(row.max_concurrent),
    queueSize: Number(row.queue_size),
    minimumEventDurationSeconds: Number(row.min_event_duration_s),
    detectionSource: row.detection_source as ObjectDetectionSettings["detectionSource"],
  };
}

function rowToCamera(row: Record<string, unknown>): CameraDetectionSettings {
  return {
    cameraId: Number(row.camera_id),
    enabled: asBoolean(row.enabled),
    personEnabled: asBoolean(row.person_enabled),
    personConfidence:
      row.person_confidence === null || row.person_confidence === undefined ? null : Number(row.person_confidence),
    vehicleEnabled: asBoolean(row.vehicle_enabled),
    vehicleConfidence:
      row.vehicle_confidence === null || row.vehicle_confidence === undefined ? null : Number(row.vehicle_confidence),
  };
}

/** Read the full configuration. Missing rows fall back to the safe defaults. */
export function readObjectDetectionConfig(db: DatabaseSync): ObjectDetectionConfig {
  const settingsRow = db
    .prepare("SELECT * FROM object_detection_settings WHERE id = 1")
    .get() as Record<string, unknown> | undefined;
  const settings = settingsRow ? rowToSettings(settingsRow) : { ...OBJECT_DETECTION_DEFAULTS };

  const rows = db
    .prepare("SELECT * FROM object_detection_camera_settings ORDER BY camera_id")
    .all() as Array<Record<string, unknown>>;
  const byId = new Map(rows.map((row) => [Number(row.camera_id), rowToCamera(row)]));
  const cameras = CAMERA_IDS.map(
    (cameraId): CameraDetectionSettings =>
      byId.get(cameraId) ?? { ...CAMERA_DETECTION_DEFAULTS, cameraId },
  );
  return { settings, cameras };
}

/** Store a validated configuration. The caller has already validated bounds. */
export function saveObjectDetectionConfig(
  db: DatabaseSync,
  input: ObjectDetectionConfig,
  now: string = new Date().toISOString(),
): void {
  const s = input.settings;
  db.prepare(
    `UPDATE object_detection_settings SET
       enabled = ?, person_enabled = ?, person_confidence = ?,
       vehicle_enabled = ?, vehicle_confidence = ?,
       base_fps = ?, active_fps = ?, max_fps = ?, motion_boost = ?,
       activity_timeout_s = ?, disappearance_timeout_s = ?,
       max_concurrent = ?, queue_size = ?, min_event_duration_s = ?,
       detection_source = ?, updated_at = ?
     WHERE id = 1`,
  ).run(
    s.enabled ? 1 : 0,
    s.personEnabled ? 1 : 0,
    s.personConfidence,
    s.vehicleEnabled ? 1 : 0,
    s.vehicleConfidence,
    s.baseFps,
    s.activeFps,
    s.maxFps,
    s.motionBoost ? 1 : 0,
    s.activityTimeoutSeconds,
    s.disappearanceThresholdSeconds,
    s.maxConcurrentInference,
    s.queueSize,
    s.minimumEventDurationSeconds,
    s.detectionSource,
    now,
  );

  const upsertCamera = db.prepare(
    `INSERT INTO object_detection_camera_settings
       (camera_id, enabled, person_enabled, person_confidence, vehicle_enabled, vehicle_confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(camera_id) DO UPDATE SET
       enabled = excluded.enabled,
       person_enabled = excluded.person_enabled,
       person_confidence = excluded.person_confidence,
       vehicle_enabled = excluded.vehicle_enabled,
       vehicle_confidence = excluded.vehicle_confidence,
       updated_at = excluded.updated_at`,
  );
  for (const camera of input.cameras) {
    upsertCamera.run(
      camera.cameraId,
      camera.enabled ? 1 : 0,
      camera.personEnabled ? 1 : 0,
      camera.personConfidence,
      camera.vehicleEnabled ? 1 : 0,
      camera.vehicleConfidence,
      now,
      now,
    );
  }
}

/** Read the worker heartbeat row. Returns null when the worker never ran. */
export function readObjectWorkerHeartbeat(db: DatabaseSync): ObjectWorkerHeartbeat | null {
  const row = db.prepare("SELECT * FROM object_worker_heartbeat WHERE id = 1").get() as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  let metrics: ObjectWorkerMetrics | null = null;
  if (typeof row.metrics === "string" && row.metrics) {
    try {
      metrics = JSON.parse(row.metrics) as ObjectWorkerMetrics;
    } catch {
      metrics = null;
    }
  }
  const status = (OBJECT_WORKER_STATUSES as readonly string[]).includes(String(row.status))
    ? (row.status as ObjectWorkerStatus)
    : "error";
  return {
    status,
    detail: row.detail === null || row.detail === undefined ? null : String(row.detail),
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    metrics,
  };
}

/** Convenience wrapper used by API routes. */
export function objectDetectionConfig(dataDir: string = getConfig().dataDir): ObjectDetectionConfig {
  return readObjectDetectionConfig(openEventStore(dataDir).db);
}
