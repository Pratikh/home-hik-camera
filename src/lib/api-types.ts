import type {
  CameraDetectionSettings,
  DetectionSource,
  ObjectDetectionSettings,
  ObjectWorkerHeartbeat,
} from "@/lib/object-detection";
export type DvrState = "connected" | "disconnected" | "not_configured" | "auth_failed";
export type GatewayState = "connected" | "disconnected";
export type HealthDvrState = "connected" | "disconnected" | "not_configured";

import type { CctvEvent, EventStats, NotificationRecord, NotificationRule } from "@/lib/events";
import type { EventPriority } from "@/lib/priority";

export type CameraView = {
  id: number;
  name: string;
  online: boolean | null;
  mainChannel: number;
  subChannel: number;
  mainPath: string;
  subPath: string;
};

export type CamerasResponse = {
  dvr: DvrState;
  dvrMessage: string;
  videoGateway: GatewayState;
  cameras: CameraView[];
};

export type DvrStatusResponse = {
  dvr: DvrState;
  message: string;
  videoGateway: GatewayState;
  checkedAt: string;
};

export type DeviceDetails = {
  name: string | null;
  model: string | null;
  serialNumber: string | null;
  firmware: string | null;
  encodingVersion: string | null;
  hardwareVersion: string | null;
  webVersion: string | null;
  pluginVersion: string | null;
  channelCount: number | null;
  hddCount: number | null;
  currentDeviceTime: string | null;
};

export type DvrInfoResponse = {
  dvr: DvrState;
  message: string;
  videoGateway: GatewayState;
  device: DeviceDetails | null;
  checkedAt: string;
};

export type StreamMode = "webrtc" | "hls" | "placeholder" | "unavailable";

export type StreamResponse = {
  path: string;
  channel: number | null;
  mode: StreamMode;
  message: string | null;
  whepUrl: string | null;
  hlsUrl: string | null;
};

export type SettingsResponse = {
  dvrHost: string;
  dvrHttpPort: number;
  dvrRtspPort: number;
  dvrUsername: string;
  dvrPasswordMask: string;
  webrtcAdditionalHost: string;
  videoDevPlaceholder: boolean;
  backend: "Connected";
  dvr: DvrState;
  dvrMessage: string;
  videoGateway: GatewayState;
};

export type HealthBody = {
  application: "ok" | "misconfigured";
  dvr: HealthDvrState;
  videoGateway: GatewayState;
  database: "ok" | "error";
  mediamtx: "ok" | "offline";
  events: "ok" | "stopped" | "error";
};

export type OperationalState = "ok" | "running" | "idle" | "stopped" | "disabled" | "error" | "unknown";

export type SystemHealthBody = {
  checkedAt: string;
  status: "healthy" | "degraded" | "unhealthy";
  application: "ok" | "misconfigured";
  database: {
    status: "ok" | "error";
    events: number | null;
    users: number | null;
  };
  dvr: HealthDvrState;
  mediamtx: {
    status: "ok" | "offline" | "unknown";
    reachable: boolean | null;
    drift: boolean | null;
    message: string | null;
    paths: Array<{ path: string; ready: boolean; tracks: number; bytesReceived: number }>;
  };
  events: {
    ingestion: "running" | "stopped" | "unknown";
    lastPoll: string | null;
    lastError: string | null;
  };
  faceDetection: {
    enabled: boolean;
    worker: "running" | "stopped" | "unknown" | "disabled";
    lastHeartbeat: string | null;
    heartbeatAgeSeconds: number | null;
    /** The worker has not checked in recently enough to be trusted. */
    stale: boolean;
    queue: { pending: number; processing: number; completed: number; failed: number } | null;
    detail: string | null;
    warning: string | null;
  };
  thumbnails: {
    enabled: boolean;
    worker: OperationalState;
    queued: number | null;
    concurrency: number | null;
    lastError: string | null;
    lastRunAt: string | null;
    diskBytes: number | null;
  };
  storage: {
    status: "ok" | "unknown" | "error";
    totalBytes: number | null;
    freeBytes: number | null;
    usedPercent: number | null;
  };
  backups: {
    status: "ok" | "stale" | "failed" | "unknown";
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    ageSeconds: number | null;
    detail: string | null;
  };
  retention: {
    status: "ok" | "error" | "unknown" | "disabled";
    lastRunAt: string | null;
    lastError: string | null;
    removed: {
      events: number;
      notifications: number;
      snapshots: number;
      orphanedSnapshots: number;
      crops: number;
      orphanedCrops: number;
    } | null;
  };
  sessions: { active: number | null };
  warnings: string[];
};

export type RecordingType = "continuous" | "motion" | "alarm" | "manual" | "other";

export type RecordingView = {
  id: string;
  camera: number;
  startTime: string;
  endTime: string;
  type: RecordingType | null;
  label: string;
};

export type PlaybackSearchResponse = {
  camera: number;
  cameraName: string;
  date: string;
  startTime: string;
  endTime: string;
  recordings: RecordingView[];
  downloadAvailable: false;
  downloadMessage: string;
};

export type PlaybackSessionResponse = {
  path: string;
  mode: StreamMode;
  message: string | null;
  whepUrl: string | null;
  hlsUrl: string | null;
  startTime: string;
  endTime: string;
};

export type NotificationRulesResponse = {
  rules: NotificationRule[];
  retentionDays: string;
};

export type NotificationsResponse = {
  notifications: NotificationRecord[];
  total: number;
  page: number;
  pageSize: number;
  date: string;
  stats: { sent: number; suppressed: number; failed: number };
};

export type EventListResponse = {
  events: CctvEvent[];
  total: number;
  page: number;
  pageSize: number;
};

export type EventRuleTestResponse = {
  evaluatedAt: string;
  matched: boolean;
  priority: EventPriority;
  notify: boolean;
  message: string;
  decisions: { ruleId: string; ruleName: string; notify: boolean; reason: string | null }[];
  ruleCount: number;
};

export type EventStatsResponse = EventStats & {
  range: string;
  start: string;
  end: string;
  days: number;
};

export type TelegramMediaStatusResponse = {
  /** Master switch and whether the credentials are present. */
  enabled: boolean;
  configured: boolean;
  /** Whether face detections may notify at all. */
  faceNotifications: boolean;
  /** Whether accepted notification-rule decisions may notify. */
  eventNotifications: boolean;
  /** Whether the face crop and the event clip are attached. */
  faceImage: boolean;
  faceVideo: boolean;
  videoPreSeconds: number;
  videoPostSeconds: number;
  clipSeconds: number;
  /** FFmpeg is required for the clip; the text and image work without it. */
  ffmpeg: "available" | "unavailable";
  queueDepth: number;
};

/* -------------------------------------------------------------------------- */
/* Live object detection                                                      */
/* -------------------------------------------------------------------------- */

export type DetectionModelInfo = {
  name: string;
  version: string;
  license: string;
  file: string;
  inputSize: number;
  sizeMb: number;
  rawClasses: readonly string[];
};

export type DetectionSettingsResponse = {
  settings: ObjectDetectionSettings;
  cameras: CameraDetectionSettings[];
  worker: ObjectWorkerHeartbeat | null;
  /** True when the worker reported within the last 30 seconds. */
  workerFresh: boolean;
  model: DetectionModelInfo;
  detectionSources: Array<{ value: DetectionSource; label: string; description: string }>;
};

export type DetectionStatusResponse = {
  enabled: boolean;
  monitoredCameras: number;
  personConfidence: number;
  vehicleConfidence: number;
  worker: ObjectWorkerHeartbeat | null;
  workerFresh: boolean;
  model: string;
};

export type DetectionTestDetection = {
  rawClass: string;
  classification: "person" | "vehicle";
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  accepted: boolean;
};

export type DetectionTestResult = {
  model: string;
  cameraId: number;
  inferenceMs: number;
  image: { width: number; height: number };
  thresholds: { person: number; vehicle: number };
  detections: DetectionTestDetection[];
};

export type DetectionTestResponse = {
  id: string;
  eventId: string;
  cameraId: number;
  status: "pending" | "running" | "done" | "error";
  result: DetectionTestResult | { error: string } | null;
  createdAt: string;
  updatedAt: string;
};
