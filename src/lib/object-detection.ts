/**
 * Live object-detection configuration, shared by the Admin UI, the API routes
 * and the detection worker.
 *
 * This module is deliberately client-safe: it contains types, defaults and
 * validation only. Nothing here opens a database, reads the filesystem or talks
 * to a stream, so the same rules are enforced by the browser form and by the
 * server that stores the values.
 *
 * Detection is OFF by default. Turning it on is an explicit Admin decision.
 */

/** The classes the bundled detector knows. Everything else is ignored. */
export const OBJECT_DETECTION_RAW_CLASSES = ["person", "car", "motorcycle", "bus", "truck"] as const;
export type ObjectRawClass = (typeof OBJECT_DETECTION_RAW_CLASSES)[number];

/** Application-level classification used by events, rules and notifications. */
export const OBJECT_DETECTION_CLASSES = ["person", "vehicle"] as const;
export type ObjectDetectionClass = (typeof OBJECT_DETECTION_CLASSES)[number];

/** Map a raw detector class onto the event classification. */
export function classificationForRawClass(raw: ObjectRawClass): ObjectDetectionClass {
  return raw === "person" ? "person" : "vehicle";
}

/**
 * Where person/vehicle notifications may come from.
 *
 * - ai_only: only the object-detection worker's events notify. DVR person and
 *   vehicle events are still stored but never raise a rule notification.
 * - dvr_only: the historical behaviour; only DVR events notify.
 * - ai_both: both sources may notify; the existing per-rule cooldown and
 *   notification history stay the duplicate guard.
 */
export const DETECTION_SOURCES = ["ai_only", "dvr_only", "ai_both"] as const;
export type DetectionSource = (typeof DETECTION_SOURCES)[number];

export const DETECTION_SOURCE_LABELS: Record<DetectionSource, string> = {
  ai_only: "AI only",
  dvr_only: "DVR only",
  ai_both: "AI + DVR",
};

export const DETECTION_SOURCE_DESCRIPTIONS: Record<DetectionSource, string> = {
  ai_only:
    "Only the object-detection worker raises person/vehicle notifications. DVR person/vehicle events are still stored and searchable, but do not notify.",
  dvr_only:
    "The historical behaviour: the DVR's own Human/Vehicle labels raise notifications. The object detector may still store events but they are not the notification source.",
  ai_both:
    "Both sources can notify. The existing per-rule cooldown and duplicate protection still apply, so a burst cannot notify twice per rule.",
};

/** Slider stops offered by the UI; the stored value may be any value in range. */
export const CONFIDENCE_SLIDER_VALUES = [0.5, 0.6, 0.7, 0.8, 0.9, 0.99] as const;
export const CONFIDENCE_MIN = 0.5;
export const CONFIDENCE_MAX = 0.99;

/** Sampling rates the UI offers. The validator accepts any value in [0.5, 5]. */
export const FPS_CHOICES = [0.5, 1, 2, 3, 5] as const;
export const FPS_MIN = 0.5;
export const FPS_MAX = 5;

export const MAX_CONCURRENT_MIN = 1;
export const MAX_CONCURRENT_MAX = 4;
export const QUEUE_SIZE_MIN = 1;
export const QUEUE_SIZE_MAX = 10;
export const DISAPPEARANCE_MIN = 1;
export const DISAPPEARANCE_MAX = 10;
export const ACTIVITY_TIMEOUT_MIN = 1;
export const ACTIVITY_TIMEOUT_MAX = 60;
export const MIN_DURATION_MAX = 60;

export type ObjectDetectionSettings = {
  /** Master switch. Off means the worker loads no model and detects nothing. */
  enabled: boolean;
  personEnabled: boolean;
  /** 0.50 – 0.99. */
  personConfidence: number;
  vehicleEnabled: boolean;
  /** 0.50 – 0.99. */
  vehicleConfidence: number;
  /** Frames analysed per second per camera while idle. 0.5 – 5. */
  baseFps: number;
  /** Frames analysed per second while activity is recent. */
  activeFps: number;
  /** Hard cap for adaptive sampling. */
  maxFps: number;
  motionBoost: boolean;
  /** Seconds the boosted rate stays active after the last detection. */
  activityTimeoutSeconds: number;
  /** Seconds without a detection before a tracked object's event ends. */
  disappearanceThresholdSeconds: number;
  /** How many camera frames may be inferred at once. */
  maxConcurrentInference: number;
  /** Frames waiting for inference. The oldest is dropped when full. */
  queueSize: number;
  /** Detections shorter than this are not turned into events. 0 disables it. */
  minimumEventDurationSeconds: number;
  detectionSource: DetectionSource;
};

export type CameraDetectionSettings = {
  cameraId: number;
  enabled: boolean;
  personEnabled: boolean;
  /** null means "use the global person confidence". */
  personConfidence: number | null;
  vehicleEnabled: boolean;
  /** null means "use the global vehicle confidence". */
  vehicleConfidence: number | null;
};

/** The effective values one camera would use, after global/camera resolution. */
export type EffectiveCameraDetection = {
  enabled: boolean;
  person: { enabled: boolean; confidence: number };
  vehicle: { enabled: boolean; confidence: number };
};

export const OBJECT_DETECTION_DEFAULTS: ObjectDetectionSettings = {
  enabled: false,
  personEnabled: true,
  personConfidence: 0.7,
  vehicleEnabled: true,
  vehicleConfidence: 0.7,
  baseFps: 1,
  activeFps: 3,
  maxFps: 5,
  motionBoost: true,
  activityTimeoutSeconds: 10,
  disappearanceThresholdSeconds: 3,
  maxConcurrentInference: 1,
  queueSize: 2,
  minimumEventDurationSeconds: 0,
  detectionSource: "ai_only",
};

export const CAMERA_DETECTION_DEFAULTS: Omit<CameraDetectionSettings, "cameraId"> = {
  enabled: false,
  personEnabled: true,
  personConfidence: null,
  vehicleEnabled: true,
  vehicleConfidence: null,
};

export type DetectionValidation =
  | { ok: true; value: ObjectDetectionSettings }
  | { ok: false; errors: string[] };

export type CameraValidation =
  | { ok: true; value: CameraDetectionSettings[] }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBool(
  body: Record<string, unknown>,
  key: keyof ObjectDetectionSettings,
  fallback: boolean,
  errors: string[],
): boolean {
  const value = body[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    errors.push(`${key} must be a boolean`);
    return fallback;
  }
  return value;
}

function readNumber(
  body: Record<string, unknown>,
  key: keyof ObjectDetectionSettings,
  fallback: number,
  low: number,
  high: number,
  errors: string[],
  options: { integer?: boolean } = {},
): number {
  const value = body[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${key} must be a number`);
    return fallback;
  }
  if (value < low || value > high) {
    errors.push(`${key} must be between ${low} and ${high}`);
    return fallback;
  }
  if (options.integer && !Number.isInteger(value)) {
    errors.push(`${key} must be a whole number`);
    return fallback;
  }
  return value;
}

function readSource(
  body: Record<string, unknown>,
  fallback: DetectionSource,
  errors: string[],
): DetectionSource {
  const value = body.detectionSource;
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !(DETECTION_SOURCES as readonly string[]).includes(value)) {
    errors.push(`detectionSource must be one of ${DETECTION_SOURCES.join(", ")}`);
    return fallback;
  }
  return value as DetectionSource;
}

/**
 * Validate a full settings object from the Admin UI (or any caller).
 *
 * Missing fields fall back to the defaults, so a partial body cannot silently
 * disable detection; invalid values are collected and the whole update is
 * refused rather than partially applied.
 */
export function validateObjectDetectionSettings(input: unknown): DetectionValidation {
  if (!isRecord(input)) return { ok: false, errors: ["settings must be an object"] };
  const body = input;
  const errors: string[] = [];
  const d = OBJECT_DETECTION_DEFAULTS;

  const value: ObjectDetectionSettings = {
    enabled: readBool(body, "enabled", d.enabled, errors),
    personEnabled: readBool(body, "personEnabled", d.personEnabled, errors),
    personConfidence: readNumber(body, "personConfidence", d.personConfidence, CONFIDENCE_MIN, CONFIDENCE_MAX, errors),
    vehicleEnabled: readBool(body, "vehicleEnabled", d.vehicleEnabled, errors),
    vehicleConfidence: readNumber(body, "vehicleConfidence", d.vehicleConfidence, CONFIDENCE_MIN, CONFIDENCE_MAX, errors),
    baseFps: readNumber(body, "baseFps", d.baseFps, FPS_MIN, FPS_MAX, errors),
    activeFps: readNumber(body, "activeFps", d.activeFps, FPS_MIN, FPS_MAX, errors),
    maxFps: readNumber(body, "maxFps", d.maxFps, FPS_MIN, FPS_MAX, errors),
    motionBoost: readBool(body, "motionBoost", d.motionBoost, errors),
    activityTimeoutSeconds: readNumber(
      body,
      "activityTimeoutSeconds",
      d.activityTimeoutSeconds,
      ACTIVITY_TIMEOUT_MIN,
      ACTIVITY_TIMEOUT_MAX,
      errors,
      { integer: true },
    ),
    disappearanceThresholdSeconds: readNumber(
      body,
      "disappearanceThresholdSeconds",
      d.disappearanceThresholdSeconds,
      DISAPPEARANCE_MIN,
      DISAPPEARANCE_MAX,
      errors,
      { integer: true },
    ),
    maxConcurrentInference: readNumber(
      body,
      "maxConcurrentInference",
      d.maxConcurrentInference,
      MAX_CONCURRENT_MIN,
      MAX_CONCURRENT_MAX,
      errors,
      { integer: true },
    ),
    queueSize: readNumber(body, "queueSize", d.queueSize, QUEUE_SIZE_MIN, QUEUE_SIZE_MAX, errors, { integer: true }),
    minimumEventDurationSeconds: readNumber(
      body,
      "minimumEventDurationSeconds",
      d.minimumEventDurationSeconds,
      0,
      MIN_DURATION_MAX,
      errors,
    ),
    detectionSource: readSource(body, d.detectionSource, errors),
  };

  if (value.maxFps < value.activeFps) errors.push("maxFps must be greater than or equal to activeFps");
  if (value.activeFps < value.baseFps) errors.push("activeFps must be greater than or equal to baseFps");

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { ...value, personConfidence: round2(value.personConfidence), vehicleConfidence: round2(value.vehicleConfidence) } };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function readCameraConfidence(
  camera: Record<string, unknown>,
  key: "personConfidence" | "vehicleConfidence",
  errors: string[],
  label: string,
): number | null {
  const value = camera[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} ${key} must be a number or null`);
    return null;
  }
  if (value < CONFIDENCE_MIN || value > CONFIDENCE_MAX) {
    errors.push(`${label} ${key} must be between ${CONFIDENCE_MIN} and ${CONFIDENCE_MAX}`);
    return null;
  }
  return round2(value);
}

/**
 * Validate the per-camera overrides.
 *
 * Every supplied camera must be a real camera id and must appear at most once.
 * Cameras omitted from the body keep their stored row (the UI always sends all
 * four, but a partial API client cannot lose a camera's settings by accident).
 */
export function validateCameraDetectionSettings(
  input: unknown,
  cameraIds: readonly number[],
): CameraValidation {
  if (input === undefined || input === null) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, errors: ["cameras must be an array"] };
  const errors: string[] = [];
  const seen = new Set<number>();
  const value: CameraDetectionSettings[] = [];

  for (const entry of input) {
    if (!isRecord(entry)) {
      errors.push("each camera entry must be an object");
      continue;
    }
    const cameraId = entry.cameraId;
    if (typeof cameraId !== "number" || !Number.isInteger(cameraId) || !cameraIds.includes(cameraId)) {
      errors.push("cameraId must be one of " + cameraIds.join(", "));
      continue;
    }
    if (seen.has(cameraId)) {
      errors.push(`cameraId ${cameraId} appears more than once`);
      continue;
    }
    seen.add(cameraId);
    const label = `camera ${cameraId}`;

    const enabled = entry.enabled ?? CAMERA_DETECTION_DEFAULTS.enabled;
    const personEnabled = entry.personEnabled ?? CAMERA_DETECTION_DEFAULTS.personEnabled;
    const vehicleEnabled = entry.vehicleEnabled ?? CAMERA_DETECTION_DEFAULTS.vehicleEnabled;
    if (typeof enabled !== "boolean") errors.push(`${label} enabled must be a boolean`);
    if (typeof personEnabled !== "boolean") errors.push(`${label} personEnabled must be a boolean`);
    if (typeof vehicleEnabled !== "boolean") errors.push(`${label} vehicleEnabled must be a boolean`);

    value.push({
      cameraId,
      enabled: typeof enabled === "boolean" ? enabled : CAMERA_DETECTION_DEFAULTS.enabled,
      personEnabled: typeof personEnabled === "boolean" ? personEnabled : CAMERA_DETECTION_DEFAULTS.personEnabled,
      personConfidence: readCameraConfidence(entry, "personConfidence", errors, label),
      vehicleEnabled: typeof vehicleEnabled === "boolean" ? vehicleEnabled : CAMERA_DETECTION_DEFAULTS.vehicleEnabled,
      vehicleConfidence: readCameraConfidence(entry, "vehicleConfidence", errors, label),
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/**
 * Resolve global settings and one camera's override into the values the worker
 * should use. A camera is only active when both the master switch and the
 * per-camera switch are on.
 */
export function effectiveCameraDetection(
  global: ObjectDetectionSettings,
  camera: CameraDetectionSettings,
): EffectiveCameraDetection {
  if (!global.enabled || !camera.enabled) {
    return {
      enabled: false,
      person: { enabled: false, confidence: camera.personConfidence ?? global.personConfidence },
      vehicle: { enabled: false, confidence: camera.vehicleConfidence ?? global.vehicleConfidence },
    };
  }
  return {
    enabled: true,
    person: {
      enabled: global.personEnabled && camera.personEnabled,
      confidence: camera.personConfidence ?? global.personConfidence,
    },
    vehicle: {
      enabled: global.vehicleEnabled && camera.vehicleEnabled,
      confidence: camera.vehicleConfidence ?? global.vehicleConfidence,
    },
  };
}

/** Worker states the heartbeat can report. */
export const OBJECT_WORKER_STATUSES = ["starting", "running", "disabled", "overloaded", "error", "stopped"] as const;
export type ObjectWorkerStatus = (typeof OBJECT_WORKER_STATUSES)[number];

export type ObjectWorkerHeartbeat = {
  status: ObjectWorkerStatus;
  detail: string | null;
  updatedAt: string | null;
  /** Metrics are best-effort and may be absent when the worker is stopped. */
  metrics: ObjectWorkerMetrics | null;
};

export type ObjectWorkerMetrics = {
  model: string | null;
  cameras: number;
  camerasMonitored: number | null;
  currentFps: number | null;
  inferenceFps: number | null;
  averageInferenceMs: number | null;
  queueDepth: number | null;
  droppedFrames: number | null;
  detectionsToday: number | null;
  personDetectionsToday: number | null;
  vehicleDetectionsToday: number | null;
  cpuPercent: number | null;
  ramMb: number | null;
  lastInferenceAt: string | null;
  lastDetectionAt: string | null;
  errors: number | null;
};

/** True when the worker has reported within the last `maxAgeMs`. */
export function workerHeartbeatFresh(updatedAt: string | null, now: number, maxAgeMs = 30_000): boolean {
  if (!updatedAt) return false;
  const at = Date.parse(updatedAt);
  return Number.isFinite(at) && now - at <= maxAgeMs;
}

/**
 * The bundled detector. Kept as data so the Admin UI can show exactly what is
 * running; the worker reports the same name/version in its heartbeat.
 */
export const OBJECT_DETECTION_MODEL = {
  name: "YOLOX-Nano",
  version: "0.1.1",
  license: "Apache-2.0",
  file: "yolox_nano.onnx",
  inputSize: 416,
  /** Approximate on-disk size of the ONNX file. */
  sizeMb: 3.5,
  rawClasses: OBJECT_DETECTION_RAW_CLASSES,
} as const;
