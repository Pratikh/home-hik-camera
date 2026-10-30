import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CctvEvent,
  EventClassification,
  EventStats,
  EventType,
  NotificationRecord,
  NotificationRule,
  NotificationStatus,
  Weekday,
} from "@/lib/events";
import {
  DEFAULT_COOLDOWN_SECONDS,
  cameraIdsFromLegacy,
  isEventType,
  isRuleEventType,
  legacyRuleFields,
  ruleEventTypesFromLegacy,
  WEEKDAYS,
  type RuleEventType,
} from "@/lib/events";
import { CAMERA_IDS, isValidCameraId } from "@/lib/cameras";
import { isFaceId, type DetectedFace, type FaceProcessingSummary, type FaceQuery } from "@/lib/faces";
import { defaultPriority, isEventPriority, priorityRank, type EventPriority } from "@/lib/priority";

/** Sources that can create an event row. The DVR poller and the object detector. */
export type EventSource = "hikvision" | "object-detection-worker";

export type NewEvent = {
  id: string;
  dedupeKey: string;
  cameraId: number;
  type: EventType;
  classification: EventClassification | null;
  timestamp: string;
  endTimestamp: string | null;
  source: EventSource;
  metaId: string;
  priority?: EventPriority;
  /** Detector confidence, when the source measured one. */
  confidence?: number | null;
  /** Extra metadata merged with the legacy `metaId` field. */
  metadata?: Record<string, unknown>;
};

export type EventQuery = {
  cameraId: number | null;
  type: EventType | null;
  classification: EventClassification | "none" | null;
  start: string;
  end: string;
  page: number;
  pageSize: number;
  importantOnly?: boolean;
  notified?: boolean | null;
  read?: boolean | null;
  priority?: EventPriority | null;
};

export type NotificationQuery = {
  start: string;
  end: string;
  cameraId: number | null;
  status: NotificationStatus | null;
  priority: EventPriority | null;
  page: number;
  pageSize: number;
};

/** One completed face job waiting for a notification decision. */
export type FaceTestCandidate = {
  eventId: string;
  cameraId: number;
  eventTimestamp: string;
  finishedAt: string;
  faces: number;
  maxConfidence: number;
};

type RuleRow = {
  id: string;
  name: string | null;
  enabled: number;
  camera_id: number | null;
  event_type: string | null;
  classification: string | null;
  camera_ids: string | null;
  event_types: string | null;
  minimum_priority: string | null;
  schedule_start: string | null;
  schedule_end: string | null;
  days_of_week: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  quiet_hours_behavior: string | null;
  cooldown_seconds: number | null;
  created_at: string;
  updated_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  camera_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  classification TEXT,
  timestamp TEXT NOT NULL,
  end_timestamp TEXT,
  confidence REAL,
  snapshot_path TEXT,
  recording_start TEXT,
  recording_end TEXT,
  source TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  notified INTEGER NOT NULL DEFAULT 0,
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS events_camera_id ON events(camera_id);
CREATE INDEX IF NOT EXISTS events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS events_type ON events(type);
CREATE INDEX IF NOT EXISTS events_classification ON events(classification);
CREATE TABLE IF NOT EXISTS notification_rules (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL,
  camera_id INTEGER,
  event_type TEXT,
  classification TEXT,
  -- Multi-select selections, JSON arrays. NULL on rows written before V5.2 and
  -- on any row the legacy columns already describe fully. The legacy columns
  -- stay authoritative for those rows.
  camera_ids TEXT,
  event_types TEXT,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_history (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  rule_id TEXT,
  rule_name TEXT,
  camera_id INTEGER NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  event_timestamp TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_history_event_rule
  ON notification_history(event_id, IFNULL(rule_id, ''));
CREATE INDEX IF NOT EXISTS notification_history_event_id ON notification_history(event_id);
CREATE INDEX IF NOT EXISTS notification_history_rule_id ON notification_history(rule_id);
CREATE INDEX IF NOT EXISTS notification_history_created_at ON notification_history(created_at);
/*
 * Durable queue for the Telegram media work (face snapshot + event clip).
 *
 * Media delivery is asynchronous, so it needs somewhere to live across a hub
 * restart; the text notification is sent by the decision itself and is not
 * queued here. event_id is UNIQUE, which is what stops a restart from
 * producing a second clip for the same accepted event.
 */
CREATE TABLE IF NOT EXISTS telegram_media_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  camera_id INTEGER NOT NULL,
  camera_name TEXT NOT NULL,
  faces INTEGER NOT NULL,
  max_confidence REAL NOT NULL,
  event_timestamp TEXT NOT NULL,
  -- Timestamp used for the recording clip search. AI events are shifted by the
  -- measured DVR clock offset, while event_timestamp is the real event time
  -- used for the caption.
  clip_timestamp TEXT,
  -- Safe, non-secret caption metadata.
  classification TEXT,
  confidence REAL,
  snapshot_path TEXT,
  channel TEXT NOT NULL DEFAULT 'face',
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT '',
  detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS telegram_media_jobs_status ON telegram_media_jobs(status, id);
CREATE INDEX IF NOT EXISTS notification_rules_enabled ON notification_rules(enabled);
CREATE INDEX IF NOT EXISTS notification_rules_camera_id ON notification_rules(camera_id);
CREATE TABLE IF NOT EXISTS event_ai_results (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence REAL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
--
-- Live object detection (additive; the detection worker shares these tables).
CREATE TABLE IF NOT EXISTS object_detection_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  person_enabled INTEGER NOT NULL DEFAULT 1,
  person_confidence REAL NOT NULL DEFAULT 0.7,
  vehicle_enabled INTEGER NOT NULL DEFAULT 1,
  vehicle_confidence REAL NOT NULL DEFAULT 0.7,
  base_fps REAL NOT NULL DEFAULT 1,
  active_fps REAL NOT NULL DEFAULT 3,
  max_fps REAL NOT NULL DEFAULT 5,
  motion_boost INTEGER NOT NULL DEFAULT 1,
  activity_timeout_s INTEGER NOT NULL DEFAULT 10,
  disappearance_timeout_s INTEGER NOT NULL DEFAULT 3,
  max_concurrent INTEGER NOT NULL DEFAULT 1,
  queue_size INTEGER NOT NULL DEFAULT 2,
  min_event_duration_s REAL NOT NULL DEFAULT 0,
  detection_source TEXT NOT NULL DEFAULT 'ai_only',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS object_detection_camera_settings (
  camera_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  person_enabled INTEGER NOT NULL DEFAULT 1,
  person_confidence REAL,
  vehicle_enabled INTEGER NOT NULL DEFAULT 1,
  vehicle_confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS object_detection_tracks (
  id TEXT PRIMARY KEY,
  camera_id INTEGER NOT NULL,
  classification TEXT NOT NULL,
  raw_class TEXT NOT NULL,
  confidence REAL NOT NULL,
  threshold REAL NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  detection_count INTEGER NOT NULL DEFAULT 1,
  snapshot_path TEXT,
  event_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  detector TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS object_detection_tracks_status ON object_detection_tracks(status, updated_at);
CREATE INDEX IF NOT EXISTS object_detection_tracks_event ON object_detection_tracks(event_id);
CREATE INDEX IF NOT EXISTS object_detection_tracks_camera ON object_detection_tracks(camera_id, status);
--
CREATE TABLE IF NOT EXISTS object_detection_test_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  camera_id INTEGER NOT NULL,
  snapshot_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS object_detection_test_requests_status
  ON object_detection_test_requests(status, created_at);
CREATE TABLE IF NOT EXISTS object_worker_heartbeat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL,
  detail TEXT,
  metrics TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT
);
-- Session pruning and "sign out everywhere" both filter on these columns.
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at ON auth_sessions(expires_at);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  metadata TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_action ON audit_logs(action);
CREATE TABLE IF NOT EXISTS viewer_presence (
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, path)
);
-- ---------------------------------------------------------------------------
-- Face DETECTION (phase one: detection only, no recognition).
--
-- event_faces stores a detected face: where it is and how confident the
-- detector was. person_id is NULL for every row in this phase, which is what
-- "Unassigned" means. The people and person_face_references tables are created
-- empty so a future recognition phase can assign people and store reference
-- images without migrating event_faces. No code in this project writes them,
-- and no embeddings are generated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS person_face_references (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  image_path TEXT NOT NULL,
  -- Reserved for a future local embedding. Never written in this phase.
  embedding BLOB,
  embedding_model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS person_face_references_person_id ON person_face_references(person_id);
CREATE TABLE IF NOT EXISTS event_faces (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  confidence REAL NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  crop_path TEXT,
  detector TEXT NOT NULL,
  model TEXT,
  detection_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  -- The duplicate guard: one event can never hold two faces at the same index,
  -- so a re-processed snapshot replaces its rows instead of appending them.
  UNIQUE(event_id, detection_index)
);
CREATE INDEX IF NOT EXISTS event_faces_event_id ON event_faces(event_id);
CREATE INDEX IF NOT EXISTS event_faces_person_id ON event_faces(person_id);
CREATE INDEX IF NOT EXISTS event_faces_created_at ON event_faces(created_at);
-- Idempotent work queue for the local face worker. One row per event, cascaded
-- away with the event.
CREATE TABLE IF NOT EXISTS face_processing (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  faces_found INTEGER NOT NULL DEFAULT 0,
  detector TEXT,
  model TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS face_processing_status ON face_processing(status);
CREATE INDEX IF NOT EXISTS face_processing_finished_at ON face_processing(finished_at);
-- Liveness marker written by the optional local face worker. One row, so it
-- cannot grow; a missing or stale row is what makes a silent worker visible.
CREATE TABLE IF NOT EXISTS face_worker_heartbeat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_seen_at TEXT NOT NULL,
  poll_interval_ms INTEGER NOT NULL,
  pid INTEGER,
  status TEXT NOT NULL,
  detail TEXT
);
`;

function mapEvent(row: Record<string, unknown>): CctvEvent {
  const classification = row.classification;
  const type = isEventType(String(row.type)) ? String(row.type) as EventType : "motion";
  const castClassification = classification === "person" || classification === "vehicle" ? classification : null;
  const storedPriority = typeof row.priority === "string" ? row.priority : "";
  return {
    id: String(row.id),
    cameraId: Number(row.camera_id),
    type,
    classification: castClassification,
    timestamp: String(row.timestamp),
    endTimestamp: row.end_timestamp ? String(row.end_timestamp) : null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    hasSnapshot: typeof row.snapshot_path === "string" && row.snapshot_path.length > 0,
    recordingStart: row.recording_start ? String(row.recording_start) : null,
    recordingEnd: row.recording_end ? String(row.recording_end) : null,
    source: String(row.source),
    // A row written before V5 has no priority; derive it from what the DVR reported.
    priority: isEventPriority(storedPriority) ? storedPriority : defaultPriority(type, castClassification),
    notified: row.notified === 1,
    readAt: row.read_at ? String(row.read_at) : null,
  };
}

/** Detected-face rows always come back joined to the event they belong to. */
const FACE_SELECT = `
SELECT f.id, f.event_id, f.person_id, f.confidence, f.x, f.y, f.width, f.height, f.crop_path,
       f.detector, f.model, f.created_at,
       e.camera_id AS camera_id, e.timestamp AS event_timestamp,
       e.type AS event_type, e.classification AS event_classification
FROM event_faces f
JOIN events e ON e.id = f.event_id`;

function mapFace(row: Record<string, unknown>): DetectedFace {
  const type = isEventType(String(row.event_type)) ? (String(row.event_type) as EventType) : "motion";
  const classification = row.event_classification;
  return {
    id: String(row.id),
    eventId: String(row.event_id),
    // NULL in this phase: the face is detected but not assigned to a person.
    personId: row.person_id ? String(row.person_id) : null,
    confidence: Number(row.confidence),
    x: Number(row.x),
    y: Number(row.y),
    width: Number(row.width),
    height: Number(row.height),
    hasCrop: typeof row.crop_path === "string" && row.crop_path.length > 0,
    detector: String(row.detector ?? ""),
    model: row.model ? String(row.model) : null,
    createdAt: String(row.created_at),
    cameraId: Number(row.camera_id),
    eventTimestamp: String(row.event_timestamp),
    eventType: type,
    eventClassification: classification === "person" || classification === "vehicle" ? classification : null,
  };
}

/**
 * Read the V5.2 multi-select columns. `null` means "no multi-select data; use
 * the legacy columns". A malformed value is also treated as absent so a corrupt
 * row cannot crash rule loading or silently widen a match.
 */
function parseCameraIds(value: string | null): number[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const ids: number[] = [];
    for (const item of parsed) {
      if (!isValidCameraId(item)) return null;
      if (!ids.includes(item)) ids.push(item);
    }
    return ids;
  } catch {
    return null;
  }
}

function parseEventTypes(value: string | null): RuleEventType[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const types: RuleEventType[] = [];
    for (const item of parsed) {
      if (!isRuleEventType(item)) return null;
      if (!types.includes(item)) types.push(item);
    }
    return types;
  } catch {
    return null;
  }
}

function parseDays(value: string | null): Weekday[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is Weekday => (WEEKDAYS as readonly string[]).includes(item));
}

function mapRule(row: RuleRow): NotificationRule {
  const classification = row.classification;
  const behavior = row.quiet_hours_behavior;
  const legacyCameraId = row.camera_id !== null && isValidCameraId(row.camera_id) ? row.camera_id : null;
  const legacyEventType = row.event_type && isEventType(row.event_type) ? row.event_type : null;
  const legacyClassification: EventClassification | "" | null =
    classification === "person" || classification === "vehicle" || classification === ""
      ? classification
      : null;
  /*
   * New rows carry authoritative arrays. Old rows fall back to their legacy
   * single values, converted without widening or narrowing the match.
   */
  const cameraIds = parseCameraIds(row.camera_ids) ?? cameraIdsFromLegacy(legacyCameraId);
  const eventTypes = parseEventTypes(row.event_types) ?? ruleEventTypesFromLegacy(legacyEventType, legacyClassification);
  return {
    id: row.id,
    name: row.name && row.name.trim() ? row.name : defaultRuleName(row),
    enabled: row.enabled === 1,
    cameraIds,
    eventTypes,
    cameraId: legacyCameraId,
    eventType: legacyEventType,
    classification: legacyClassification,
    minimumPriority: row.minimum_priority && isEventPriority(row.minimum_priority) ? row.minimum_priority : null,
    scheduleStart: row.schedule_start,
    scheduleEnd: row.schedule_end,
    daysOfWeek: parseDays(row.days_of_week),
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
    quietHoursBehavior:
      behavior === "notify" || behavior === "suppress" || behavior === "store_only" ? behavior : "suppress",
    cooldownSeconds:
      typeof row.cooldown_seconds === "number" && row.cooldown_seconds >= 0
        ? row.cooldown_seconds
        : DEFAULT_COOLDOWN_SECONDS,
  };
}

function defaultRuleName(row: RuleRow): string {
  if (row.classification === "person") return "Person detected";
  if (row.classification === "vehicle") return "Vehicle detected";
  if (row.classification === "") return "Unclassified motion";
  if (row.event_type === "motion") return "Motion detected";
  return "Notification rule";
}

type NotificationRow = {
  id: string;
  event_id: string;
  rule_id: string | null;
  rule_name: string | null;
  camera_id: number;
  priority: string;
  status: string;
  reason: string | null;
  created_at: string;
  event_timestamp: string | null;
  type?: string | null;
  classification?: string | null;
};

function mapNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    cameraId: Number(row.camera_id),
    priority: isEventPriority(row.priority) ? row.priority : "NORMAL",
    status: row.status === "sent" || row.status === "failed" ? row.status : "suppressed",
    reason: row.reason,
    createdAt: row.created_at,
    eventTimestamp: row.event_timestamp ?? undefined,
    eventType: row.type && isEventType(row.type) ? row.type : undefined,
    classification:
      row.classification === "person" || row.classification === "vehicle" ? row.classification : undefined,
  };
}

export class EventStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(SCHEMA);
    this.migrate();
    this.seed();
    // Seeded default rules are legacy-shaped too, so backfill after seed().
    this.backfillRuleSelections();
  }

  /**
   * Additive migration for databases created before V5. Existing installs have
   * an `events` table without the V5 columns and a `notification_rules` table
   * without the rule-engine columns, so each column is added only when missing.
   */
  private migrate(): void {
    const columns = (table: string): Set<string> => {
      const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      return new Set(rows.map((row) => row.name));
    };

    const addColumn = (table: string, column: string, definition: string): void => {
      if (columns(table).has(column)) return;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };

    addColumn("events", "priority", "TEXT NOT NULL DEFAULT 'NORMAL'");
    addColumn("events", "notified", "INTEGER NOT NULL DEFAULT 0");
    addColumn("events", "read_at", "TEXT");

    addColumn("notification_rules", "name", "TEXT");
    addColumn("notification_rules", "minimum_priority", "TEXT");
    addColumn("notification_rules", "schedule_start", "TEXT");
    addColumn("notification_rules", "schedule_end", "TEXT");
    addColumn("notification_rules", "days_of_week", "TEXT");
    addColumn("notification_rules", "quiet_hours_behavior", "TEXT");
    addColumn("notification_rules", "cooldown_seconds", "INTEGER");
    // V5.2 multi-select. Additive and idempotent; legacy rows are backfilled
    // after seed() below once their old single-value fields are visible.
    addColumn("notification_rules", "camera_ids", "TEXT");
    addColumn("notification_rules", "event_types", "TEXT");

    // Telegram media is queued for both channels; older rows were face-only.
    addColumn("telegram_media_jobs", "channel", "TEXT NOT NULL DEFAULT 'face'");
    // A clip that lost the DVR's playback slot is retried a little later.
    addColumn("telegram_media_jobs", "next_attempt_at", "TEXT NOT NULL DEFAULT ''");
    // Caption metadata and the DVR-adjusted clip time (additive columns).
    addColumn("telegram_media_jobs", "classification", "TEXT");
    addColumn("telegram_media_jobs", "confidence", "REAL");
    addColumn("telegram_media_jobs", "clip_timestamp", "TEXT");

    // Backfill priority for rows that predate the column. ALTER TABLE fills the
    // default 'NORMAL' on every existing row, so the work list is "rows written
    // before V5" rather than "rows with a null priority". A migration marker
    // keeps this to exactly one pass.
    if (!this.setting("v5_priority_backfilled")) {
      const legacy = this.db
        .prepare("SELECT id, type, classification FROM events")
        .all() as Array<{ id: string; type: string; classification: string | null }>;
      const update = this.db.prepare("UPDATE events SET priority = ? WHERE id = ? AND priority = 'NORMAL'");
      for (const row of legacy) {
        const type = isEventType(row.type) ? (row.type as EventType) : "motion";
        const classification =
          row.classification === "person" || row.classification === "vehicle" ? row.classification : null;
        const derived = defaultPriority(type, classification);
        if (derived !== "NORMAL") update.run(derived, row.id);
      }
      this.setSetting("v5_priority_backfilled", "1");
    }

    // Pre-V5 rules have no name. Give them the same descriptive name the mapper
    // falls back to, so the settings list is readable and editable.
    if (!this.setting("v5_rule_names_backfilled")) {
      const rows = this.db
        .prepare("SELECT * FROM notification_rules WHERE name IS NULL OR name = ''")
        .all() as unknown as RuleRow[];
      const update = this.db.prepare("UPDATE notification_rules SET name = ? WHERE id = ?");
      for (const row of rows) update.run(defaultRuleName(row), row.id);
      this.setSetting("v5_rule_names_backfilled", "1");
    }

    // Object-detection defaults. INSERT OR IGNORE only: existing Admin settings
    // are never overwritten by a restart or a migration.
    const nowIso = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO object_detection_settings
           (id, enabled, person_enabled, person_confidence, vehicle_enabled, vehicle_confidence,
            base_fps, active_fps, max_fps, motion_boost, activity_timeout_s, disappearance_timeout_s,
            max_concurrent, queue_size, min_event_duration_s, detection_source, created_at, updated_at)
         VALUES (1, 0, 1, 0.7, 1, 0.7, 1, 3, 5, 1, 10, 3, 1, 2, 0, 'ai_only', ?, ?)`,
      )
      .run(nowIso, nowIso);
    const seedCamera = this.db.prepare(
      `INSERT OR IGNORE INTO object_detection_camera_settings
         (camera_id, enabled, person_enabled, person_confidence, vehicle_enabled, vehicle_confidence, created_at, updated_at)
       VALUES (?, 0, 1, NULL, 1, NULL, ?, ?)`,
    );
    for (const cameraId of CAMERA_IDS) seedCamera.run(cameraId, nowIso, nowIso);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS events_camera_timestamp ON events(camera_id, timestamp);
      CREATE INDEX IF NOT EXISTS events_type_timestamp ON events(type, timestamp);
      CREATE INDEX IF NOT EXISTS events_classification_timestamp ON events(classification, timestamp);
      CREATE INDEX IF NOT EXISTS events_priority_timestamp ON events(priority, timestamp);
      CREATE INDEX IF NOT EXISTS events_notified ON events(notified);
    `);
  }

  /**
   * V5.2: fill the multi-select columns for rules written before they existed.
   *
   * Additive and idempotent. It only fills rows whose columns are still NULL,
   * never rewrites an existing array, and never deletes or renames a rule. Rows
   * whose legacy event type cannot be represented are left NULL; `mapRule` then
   * keeps using the legacy fields for matching.
   */
  private backfillRuleSelections(): void {
    const rows = this.db
      .prepare("SELECT * FROM notification_rules WHERE camera_ids IS NULL OR event_types IS NULL")
      .all() as unknown as RuleRow[];
    if (rows.length === 0) return;
    const update = this.db.prepare(
      "UPDATE notification_rules SET camera_ids = ?, event_types = ? WHERE id = ?",
    );
    for (const row of rows) {
      const mapped = mapRule(row);
      if (!mapped.cameraIds || mapped.cameraIds.length === 0) continue;
      if (!mapped.eventTypes || mapped.eventTypes.length === 0) continue;
      update.run(JSON.stringify(mapped.cameraIds), JSON.stringify(mapped.eventTypes), row.id);
    }
  }

  private seed(): void {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM notification_rules").get() as { count: number };
    if (count.count > 0) return;
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT INTO notification_rules
        (id, name, enabled, camera_id, event_type, classification, quiet_hours_start, quiet_hours_end,
         quiet_hours_behavior, cooldown_seconds, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?, '23:00', '07:00', ?, ?, ?, ?)`,
    );
    insert.run("rule-person", "Person anywhere", 1, null, "person", "notify", 300, now, now);
    insert.run("rule-vehicle", "Vehicle anywhere", 0, null, "vehicle", "suppress", 300, now, now);
    insert.run("rule-motion", "Motion anywhere", 0, "motion", "", "suppress", 300, now, now);
  }

  insertEvent(event: NewEvent): boolean {
    const priority = event.priority ?? defaultPriority(event.type, event.classification);
    const result = this.db
      .prepare(
        `INSERT INTO events (
          id, dedupe_key, camera_id, type, classification, timestamp, end_timestamp, confidence,
          snapshot_path, recording_start, recording_end, source, metadata, created_at, priority
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(
        event.id,
        event.dedupeKey,
        event.cameraId,
        event.type,
        event.classification,
        event.timestamp,
        event.endTimestamp,
        event.confidence ?? null,
        event.timestamp,
        event.endTimestamp,
        event.source,
        JSON.stringify({ metaId: event.metaId, ...(event.metadata ?? {}) }),
        new Date().toISOString(),
        priority,
      );
    return Number(result.changes) > 0;
  }

  /**
   * Object-detection tracks that the hub still has to turn into events, or whose
   * event needs its end time refreshed. The join is the durable "processed"
   * marker: an event row with the track's event_id means it was ingested.
   */
  objectTracksNeedingEvents(limit = 50): Array<{
    trackId: string;
    eventId: string;
    cameraId: number;
    classification: EventClassification;
    rawClass: string;
    confidence: number;
    threshold: number;
    x: number;
    y: number;
    width: number;
    height: number;
    firstSeen: string;
    lastSeen: string;
    detectionCount: number;
    snapshotPath: string | null;
    status: string;
    detector: string | null;
    model: string | null;
    existingEventId: string | null;
    existingEnd: string | null;
  }> {
    const rows = this.db
      .prepare(
        `SELECT t.*, e.id AS existing_event_id, e.end_timestamp AS existing_end
         FROM object_detection_tracks t
         LEFT JOIN events e ON e.id = t.event_id
         WHERE t.event_id IS NOT NULL
           AND t.classification IN ('person', 'vehicle')
           AND (e.id IS NULL OR IFNULL(e.end_timestamp, '') <> IFNULL(t.last_seen, ''))
         ORDER BY t.first_seen ASC
         LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      trackId: String(row.id),
      eventId: String(row.event_id),
      cameraId: Number(row.camera_id),
      classification: row.classification as EventClassification,
      rawClass: String(row.raw_class),
      confidence: Number(row.confidence),
      threshold: Number(row.threshold),
      x: Number(row.x),
      y: Number(row.y),
      width: Number(row.width),
      height: Number(row.height),
      firstSeen: String(row.first_seen),
      lastSeen: String(row.last_seen),
      detectionCount: Number(row.detection_count),
      snapshotPath: row.snapshot_path === null || row.snapshot_path === undefined ? null : String(row.snapshot_path),
      status: String(row.status),
      detector: row.detector === null || row.detector === undefined ? null : String(row.detector),
      model: row.model === null || row.model === undefined ? null : String(row.model),
      existingEventId: row.existing_event_id === null || row.existing_event_id === undefined ? null : String(row.existing_event_id),
      existingEnd: row.existing_end === null || row.existing_end === undefined ? null : String(row.existing_end),
    }));
  }

  /**
   * Update a detected event's end time while its object is still visible.
   * Never touches notification state: the decision was recorded once at start.
   */
  updateEventProgress(eventId: string, endTimestamp: string, metadata: Record<string, unknown>): void {
    const existing = this.db.prepare("SELECT metadata FROM events WHERE id = ?").get(eventId) as
      | { metadata: string | null }
      | undefined;
    if (!existing) return;
    let merged: Record<string, unknown> = {};
    if (existing.metadata) {
      try {
        const parsed = JSON.parse(existing.metadata) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) merged = parsed as Record<string, unknown>;
      } catch {
        merged = {};
      }
    }
    this.db
      .prepare("UPDATE events SET end_timestamp = ?, recording_end = ?, metadata = ? WHERE id = ?")
      .run(endTimestamp, endTimestamp, JSON.stringify({ ...merged, ...metadata }), eventId);
  }

  /** Parsed metadata for one event; used by the event detail page. */
  eventMetadata(eventId: string): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT metadata FROM events WHERE id = ?").get(eventId) as
      | { metadata: string | null }
      | undefined;
    if (!row?.metadata) return null;
    try {
      const parsed = JSON.parse(row.metadata) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  closeOpenEvent(cameraId: number, endTimestamp: string): void {
    this.db
      .prepare(
        `UPDATE events
         SET end_timestamp = ?, recording_end = ?
         WHERE id = (
           SELECT id FROM events
           WHERE camera_id = ? AND type = 'motion' AND end_timestamp IS NULL AND timestamp <= ?
           ORDER BY timestamp DESC
           LIMIT 1
         )`,
      )
      .run(endTimestamp, endTimestamp, cameraId, endTimestamp);
  }

  query(input: EventQuery): { events: CctvEvent[]; total: number } {
    const where = ["timestamp >= ?", "timestamp <= ?"];
    const params: Array<string | number> = [input.start, input.end];
    if (input.cameraId) {
      where.push("camera_id = ?");
      params.push(input.cameraId);
    }
    if (input.type) {
      where.push("type = ?");
      params.push(input.type);
    }
    if (input.classification === "none") where.push("classification IS NULL");
    else if (input.classification) {
      where.push("classification = ?");
      params.push(input.classification);
    }
    if (input.priority) {
      where.push("priority = ?");
      params.push(input.priority);
    }
    if (input.importantOnly) where.push(`priority IN ('HIGH', 'CRITICAL')`);
    if (input.notified === true) where.push("notified = 1");
    if (input.notified === false) where.push("notified = 0");
    if (input.read === true) where.push("read_at IS NOT NULL");
    if (input.read === false) where.push("read_at IS NULL");
    const clause = where.join(" AND ");
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM events WHERE ${clause}`).get(...params) as { count: number };
    const offset = (input.page - 1) * input.pageSize;
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE ${clause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...params, input.pageSize, offset) as Array<Record<string, unknown>>;
    return { events: rows.map(mapEvent), total: total.count };
  }

  markRead(id: string, readAt: string | null): boolean {
    const result = this.db.prepare("UPDATE events SET read_at = ? WHERE id = ?").run(readAt, id);
    return Number(result.changes) > 0;
  }

  setSnapshotPath(id: string, relativePath: string): void {
    this.db.prepare("UPDATE events SET snapshot_path = ? WHERE id = ?").run(relativePath, id);
  }

  snapshotPath(id: string): string | null {
    const row = this.db.prepare("SELECT snapshot_path FROM events WHERE id = ?").get(id) as { snapshot_path: string | null } | undefined;
    return row?.snapshot_path ?? null;
  }

  get(id: string): CctvEvent | null {
    const row = this.db.prepare("SELECT * FROM events WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapEvent(row) : null;
  }

  stats(start: string, end: string, date: string): EventStats {
    const rows = this.db
      .prepare(
        `SELECT type, classification, priority, COUNT(*) AS count
         FROM events
         WHERE timestamp >= ? AND timestamp <= ?
         GROUP BY type, classification, priority`,
      )
      .all(start, end) as Array<{ type: string; classification: string | null; priority: string; count: number }>;
    const stats: EventStats = { date, total: 0, person: 0, vehicle: 0, motion: 0, critical: 0, high: 0, cameras: [] };
    for (const row of rows) {
      stats.total += row.count;
      if (row.classification === "person") stats.person += row.count;
      else if (row.classification === "vehicle") stats.vehicle += row.count;
      else if (row.type === "motion") stats.motion += row.count;
      if (row.priority === "CRITICAL") stats.critical += row.count;
      else if (row.priority === "HIGH") stats.high += row.count;
    }
    const cameraRows = this.db
      .prepare(
        `SELECT camera_id, COUNT(*) AS count
         FROM events
         WHERE timestamp >= ? AND timestamp <= ?
         GROUP BY camera_id
         ORDER BY camera_id`,
      )
      .all(start, end) as Array<{ camera_id: number; count: number }>;
    stats.cameras = cameraRows.map((row) => ({ cameraId: Number(row.camera_id), total: row.count }));
    return stats;
  }

  recent(limit: number): CctvEvent[] {
    const rows = this.db.prepare("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map(mapEvent);
  }

  /** Dashboard feed: only events whose priority is HIGH or CRITICAL. */
  recentImportant(limit: number): CctvEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM events WHERE priority IN ('HIGH', 'CRITICAL') ORDER BY timestamp DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(mapEvent);
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM events").get() as { count: number };
    return row.count;
  }

  saveAiResult(input: { eventId: string; provider: string; label: string; confidence: number | null }): void {
    this.db
      .prepare(
        `INSERT INTO event_ai_results (id, event_id, provider, label, confidence, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(randomUUID(), input.eventId, input.provider, input.label, input.confidence, new Date().toISOString());
  }

  /**
   * Retention removes this hub's own rows only. It never touches DVR
   * recordings, MediaMTX paths, or user accounts.
   */
  deleteOlderThan(cutoffIso: string): number {
    const result = this.db.prepare("DELETE FROM events WHERE timestamp < ?").run(cutoffIso);
    return Number(result.changes);
  }

  deleteNotificationsOlderThan(cutoffIso: string): number {
    const result = this.db.prepare("DELETE FROM notification_history WHERE created_at < ?").run(cutoffIso);
    return Number(result.changes);
  }

  /** Snapshot paths for events that retention is about to delete. */
  snapshotPathsBefore(cutoffIso: string): string[] {
    const rows = this.db
      .prepare("SELECT snapshot_path FROM events WHERE timestamp < ? AND snapshot_path IS NOT NULL")
      .all(cutoffIso) as Array<{ snapshot_path: string }>;
    return rows.map((row) => row.snapshot_path);
  }

  /** Every snapshot path still referenced. Used by the orphan-file sweep. */
  allSnapshotPaths(): string[] {
    const rows = this.db
      .prepare("SELECT snapshot_path FROM events WHERE snapshot_path IS NOT NULL AND snapshot_path <> ''")
      .all() as Array<{ snapshot_path: string }>;
    return rows.map((row) => row.snapshot_path);
  }

  /**
   * Liveness marker for the optional local face worker.
   *
   * A row is only a hint: the health endpoint also checks its age against the
   * worker's poll interval, so a cleanly exited or crashed worker becomes
   * visible as "stopped" instead of silently looking healthy forever.
   */
  faceWorkerHeartbeat(): {
    lastSeenAt: string;
    pollIntervalMs: number;
    pid: number | null;
    status: string;
    detail: string | null;
  } | null {
    const row = this.db
      .prepare("SELECT last_seen_at, poll_interval_ms, pid, status, detail FROM face_worker_heartbeat WHERE id = 1")
      .get() as
      | { last_seen_at: string; poll_interval_ms: number; pid: number | null; status: string; detail: string | null }
      | undefined;
    if (!row) return null;
    return {
      lastSeenAt: row.last_seen_at,
      pollIntervalMs: row.poll_interval_ms,
      pid: row.pid,
      status: row.status,
      detail: row.detail,
    };
  }

  /**
   * Thumbnail-worker state persisted in `app_settings`.
   *
   * The worker runs in the instrumentation module, while the health route runs
   * in a separate module instance; in-memory state is not shared reliably. The
   * database is the common place to record whether generation is idle, busy, or
   * stalled with a non-empty queue.
   */
  thumbnailWorkerStatus(): {
    lastRunAt: string | null;
    queued: number;
    status: string | null;
    lastError: string | null;
  } {
    const queued = this.setting("thumbnail_worker_queued");
    return {
      lastRunAt: this.setting("thumbnail_worker_last_run"),
      queued: queued && /^\d+$/.test(queued) ? Number(queued) : 0,
      status: this.setting("thumbnail_worker_status"),
      lastError: this.setting("thumbnail_worker_last_error") || null,
    };
  }

  /** The most recent retention pass, recorded for the admin status page. */
  retentionStatus(): {
    lastRunAt: string | null;
    lastError: string | null;
    events: number;
    notifications: number;
    snapshots: number;
    orphanedSnapshots: number;
    crops: number;
    orphanedCrops: number;
  } {
    const numberSetting = (key: string): number => {
      const value = this.setting(key);
      return value && /^\d+$/.test(value) ? Number(value) : 0;
    };
    return {
      lastRunAt: this.setting("retention_last_run"),
      lastError: this.setting("retention_last_error"),
      events: numberSetting("retention_last_events"),
      notifications: numberSetting("retention_last_notifications"),
      snapshots: numberSetting("retention_last_snapshots"),
      orphanedSnapshots: numberSetting("retention_last_orphaned_snapshots"),
      crops: numberSetting("retention_last_crops"),
      orphanedCrops: numberSetting("retention_last_orphaned_crops"),
    };
  }

  /**
   * Record a notification decision. The unique (event_id, rule_id) index makes
   * this the single point of duplicate protection: a polling overlap, an API
   * retry, or a restart that re-reads the same DVR message cannot insert twice.
   * Returns false when the decision was already recorded.
   */
  recordNotification(input: {
    eventId: string;
    ruleId: string | null;
    ruleName: string | null;
    cameraId: number;
    priority: EventPriority;
    status: NotificationStatus;
    reason: string | null;
    eventTimestamp: string;
  }): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO notification_history
          (id, event_id, rule_id, rule_name, camera_id, priority, status, reason, created_at, event_timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id, IFNULL(rule_id, '')) DO NOTHING`,
      )
      .run(
        randomUUID(),
        input.eventId,
        input.ruleId,
        input.ruleName,
        input.cameraId,
        input.priority,
        input.status,
        input.reason,
        new Date().toISOString(),
        input.eventTimestamp,
      );
    return Number(result.changes) > 0;
  }

  /** True when this exact event/rule pair was already decided. */
  hasNotification(eventId: string, ruleId: string | null): boolean {
    const row = this.db
      .prepare("SELECT 1 AS hit FROM notification_history WHERE event_id = ? AND IFNULL(rule_id, '') = ?")
      .get(eventId, ruleId ?? "") as { hit: number } | undefined;
    return Boolean(row);
  }

  /** Counts notifications actually delivered by a rule within a cooldown window. */
  countSentSince(ruleId: string, sinceIso: string, excludeEventId?: string): number {
    // created_at is stored as a UTC ISO string while the cooldown window is
    // formatted in IST (+05:30). Comparing those strings lexicographically is
    // wrong across the offset boundary, so compare actual instants.
    //
    // excludeEventId is used by the face-notification path: the event may
    // already have its own "sent" decision from event ingestion, and that row
    // must not count as an earlier notification when checking its cooldown.
    const row = (
      excludeEventId === undefined
        ? this.db
            .prepare(
              `SELECT COUNT(*) AS count FROM notification_history
               WHERE rule_id = ? AND status = 'sent' AND julianday(created_at) >= julianday(?)`,
            )
            .get(ruleId, sinceIso)
        : this.db
            .prepare(
              `SELECT COUNT(*) AS count FROM notification_history
               WHERE rule_id = ? AND status = 'sent' AND julianday(created_at) >= julianday(?)
                 AND event_id <> ?`,
            )
            .get(ruleId, sinceIso, excludeEventId)
    ) as { count: number };
    return row.count;
  }

  notifications(input: NotificationQuery): { notifications: NotificationRecord[]; total: number } {
    const where = ["h.created_at >= ?", "h.created_at <= ?"];
    const params: Array<string | number> = [input.start, input.end];
    if (input.cameraId) {
      where.push("h.camera_id = ?");
      params.push(input.cameraId);
    }
    if (input.status) {
      where.push("h.status = ?");
      params.push(input.status);
    }
    if (input.priority) {
      where.push("h.priority = ?");
      params.push(input.priority);
    }
    const clause = where.join(" AND ");
    const total = this.db
      .prepare(`SELECT COUNT(*) AS count FROM notification_history h WHERE ${clause}`)
      .get(...params) as { count: number };
    const offset = (input.page - 1) * input.pageSize;
    const rows = this.db
      .prepare(
        `SELECT h.*, e.type, e.classification
         FROM notification_history h
         LEFT JOIN events e ON e.id = h.event_id
         WHERE ${clause}
         ORDER BY h.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, input.pageSize, offset) as unknown as NotificationRow[];
    return { notifications: rows.map(mapNotification), total: total.count };
  }

  notificationStats(start: string, end: string): { sent: number; suppressed: number; failed: number } {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS count FROM notification_history
         WHERE created_at >= ? AND created_at <= ? GROUP BY status`,
      )
      .all(start, end) as Array<{ status: string; count: number }>;
    const stats = { sent: 0, suppressed: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === "sent") stats.sent += row.count;
      else if (row.status === "failed") stats.failed += row.count;
      else stats.suppressed += row.count;
    }
    return stats;
  }

  markNotified(eventId: string): void {
    this.db.prepare("UPDATE events SET notified = 1 WHERE id = ?").run(eventId);
  }

  /** Highest-priority rank stored, used only for diagnostics. */
  priorityRankOf(id: string): number | null {
    const row = this.db.prepare("SELECT priority FROM events WHERE id = ?").get(id) as { priority: string } | undefined;
    if (!row || !isEventPriority(row.priority)) return null;
    return priorityRank(row.priority);
  }

  rules(): NotificationRule[] {
    const rows = this.db.prepare("SELECT * FROM notification_rules ORDER BY id").all() as unknown as RuleRow[];
    return rows.map(mapRule);
  }

  saveRule(rule: NotificationRule): void {
    const now = new Date().toISOString();
    /*
     * The arrays are the source of truth. A legacy-shaped caller still works:
     * its single values are converted to arrays, and the legacy columns are kept
     * in sync for older queries. Empty arrays are preserved as empty (match
     * nothing), never interpreted as "all".
     */
    const cameraIds = rule.cameraIds ?? cameraIdsFromLegacy(rule.cameraId) ?? [];
    const eventTypes =
      rule.eventTypes ?? ruleEventTypesFromLegacy(rule.eventType, rule.classification) ?? [];
    const legacy = legacyRuleFields({ cameraIds, eventTypes, fallback: rule });
    this.db
      .prepare(
        `INSERT INTO notification_rules
          (id, name, enabled, camera_id, event_type, classification, camera_ids, event_types,
           minimum_priority, schedule_start, schedule_end, days_of_week, quiet_hours_start,
           quiet_hours_end, quiet_hours_behavior, cooldown_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          enabled = excluded.enabled,
          camera_id = excluded.camera_id,
          event_type = excluded.event_type,
          classification = excluded.classification,
          camera_ids = excluded.camera_ids,
          event_types = excluded.event_types,
          minimum_priority = excluded.minimum_priority,
          schedule_start = excluded.schedule_start,
          schedule_end = excluded.schedule_end,
          days_of_week = excluded.days_of_week,
          quiet_hours_start = excluded.quiet_hours_start,
          quiet_hours_end = excluded.quiet_hours_end,
          quiet_hours_behavior = excluded.quiet_hours_behavior,
          cooldown_seconds = excluded.cooldown_seconds,
          updated_at = excluded.updated_at`,
      )
      .run(
        rule.id,
        rule.name,
        rule.enabled ? 1 : 0,
        legacy.cameraId,
        legacy.eventType,
        legacy.classification,
        JSON.stringify(cameraIds),
        JSON.stringify(eventTypes),
        rule.minimumPriority,
        rule.scheduleStart,
        rule.scheduleEnd,
        rule.daysOfWeek.length > 0 ? rule.daysOfWeek.join(",") : null,
        rule.quietHoursStart,
        rule.quietHoursEnd,
        rule.quietHoursBehavior,
        rule.cooldownSeconds,
        now,
        now,
      );
  }

  deleteRule(id: string): boolean {
    const result = this.db.prepare("DELETE FROM notification_rules WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  setting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  // -------------------------------------------------------------------------
  // Detected faces (read-only here: the local face worker owns every write).
  // -------------------------------------------------------------------------

  faceById(id: string): DetectedFace | null {
    if (!isFaceId(id)) return null;
    const row = this.db.prepare(`${FACE_SELECT} WHERE f.id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? mapFace(row) : null;
  }

  faces(query: FaceQuery): { faces: DetectedFace[]; total: number } {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (query.cameraId !== null) {
      where.push("e.camera_id = ?");
      params.push(query.cameraId);
    }
    if (query.start) {
      where.push("e.timestamp >= ?");
      params.push(query.start);
    }
    if (query.end) {
      where.push("e.timestamp <= ?");
      params.push(query.end);
    }
    if (query.assigned === true) where.push("f.person_id IS NOT NULL");
    if (query.assigned === false) where.push("f.person_id IS NULL");
    if (query.minConfidence !== null) {
      where.push("f.confidence >= ?");
      params.push(query.minConfidence);
    }
    if (query.eventId) {
      where.push("f.event_id = ?");
      params.push(query.eventId);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = this.db
      .prepare(`SELECT COUNT(*) AS count FROM event_faces f JOIN events e ON e.id = f.event_id ${clause}`)
      .get(...params) as { count: number };
    const offset = (query.page - 1) * query.pageSize;
    const rows = this.db
      .prepare(
        `${FACE_SELECT} ${clause} ORDER BY e.timestamp DESC, f.confidence DESC, f.detection_index ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, query.pageSize, offset) as Array<Record<string, unknown>>;
    return { faces: rows.map(mapFace), total: total.count };
  }

  /**
   * Best stored face crop for one event, or null.
   *
   * Used by the Telegram media worker: the crop is the preferred still image for
   * a person notification. Only a path the server itself stored is returned; the
   * caller still confines it to DATA_DIR/face-crops with `faceCropFile`.
   */
  cropPathForEvent(eventId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT crop_path FROM event_faces
         WHERE event_id = ? AND crop_path IS NOT NULL AND crop_path <> ''
         ORDER BY confidence DESC, detection_index ASC LIMIT 1`,
      )
      .get(eventId) as { crop_path: string } | undefined;
    return row?.crop_path ?? null;
  }

  /** Faces for one event, strongest first. Used by the event detail panel. */
  facesForEvent(eventId: string): DetectedFace[] {
    const rows = this.db
      .prepare(`${FACE_SELECT} WHERE f.event_id = ? ORDER BY f.confidence DESC, f.detection_index ASC`)
      .all(eventId) as Array<Record<string, unknown>>;
    return rows.map(mapFace);
  }

  faceProcessing(eventId: string): {
    status: string;
    facesFound: number;
    attempts: number;
    detector: string | null;
    model: string | null;
    error: string | null;
    updatedAt: string;
  } | null {
    const row = this.db
      .prepare("SELECT status, faces_found, attempts, detector, model, error, updated_at FROM face_processing WHERE event_id = ?")
      .get(eventId) as
      | { status: string; faces_found: number; attempts: number; detector: string | null; model: string | null; error: string | null; updated_at: string }
      | undefined;
    if (!row) return null;
    return {
      status: row.status,
      facesFound: row.faces_found,
      attempts: row.attempts,
      detector: row.detector,
      model: row.model,
      error: row.error,
      updatedAt: row.updated_at,
    };
  }

  faceProcessingSummary(): FaceProcessingSummary {
    const summary: FaceProcessingSummary = { pending: 0, processing: 0, completed: 0, failed: 0 };
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM face_processing GROUP BY status")
      .all() as Array<{ status: string; count: number }>;
    for (const row of rows) {
      if (row.status === "PENDING") summary.pending += row.count;
      else if (row.status === "PROCESSING") summary.processing += row.count;
      else if (row.status === "COMPLETED") summary.completed += row.count;
      else if (row.status === "FAILED") summary.failed += row.count;
    }
    return summary;
  }

  /* ---------------------------------------------------------------------- */
  /* Telegram media queue (durable, additive table)                         */
  /* ---------------------------------------------------------------------- */

  /**
   * Queue the media for one accepted event.
   *
   * `INSERT OR IGNORE` on the UNIQUE event_id makes this idempotent, so a
   * duplicate decision — including one replayed after a restart — cannot create
   * a second clip.
   */
  enqueueTelegramMediaJob(input: {
    eventId: string;
    cameraId: number;
    cameraName: string;
    faces: number;
    maxConfidence: number;
    /** The event's real timestamp (captions use this, never the send time). */
    eventTimestamp: string;
    /** DVR-clock-adjusted timestamp for the clip search; defaults to eventTimestamp. */
    clipTimestamp?: string | null;
    classification?: "person" | "vehicle" | null;
    /** Detector confidence shown in the caption; null when unknown. */
    confidence?: number | null;
    snapshotPath: string | null;
    /** Which Telegram channel queued the job. Older rows default to "face". */
    channel?: "face" | "event";
    now: string;
    limit?: number;
  }): "queued" | "duplicate" | "full" {
    const limit = input.limit ?? 50;
    const pending = this.telegramMediaQueueDepth();
    if (pending >= limit) {
      // Keep the newest detections: drop the oldest queued job.
      this.db
        .prepare(
          `DELETE FROM telegram_media_jobs WHERE id = (
             SELECT id FROM telegram_media_jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 1
           )`,
        )
        .run();
    }
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO telegram_media_jobs
           (event_id, camera_id, camera_name, faces, max_confidence, event_timestamp,
            clip_timestamp, classification, confidence, snapshot_path, channel, status,
            attempts, next_attempt_at, detail, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', NULL, ?, ?)`,
      )
      .run(
        input.eventId,
        input.cameraId,
        input.cameraName,
        input.faces,
        input.maxConfidence,
        input.eventTimestamp,
        input.clipTimestamp ?? input.eventTimestamp,
        input.classification ?? null,
        input.confidence ?? null,
        input.snapshotPath,
        input.channel ?? "face",
        input.now,
        input.now,
      );
    if (Number(result.changes) === 0) return "duplicate";
    return pending >= limit ? "full" : "queued";
  }

  telegramMediaQueueDepth(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM telegram_media_jobs WHERE status = 'pending'")
      .get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  /** Take the oldest pending job, marking it in-flight so a crash is visible. */
  claimNextTelegramMediaJob(now: string): {
    id: number;
    eventId: string;
    cameraId: number;
    cameraName: string;
    faces: number;
    maxConfidence: number;
    eventTimestamp: string;
    clipTimestamp: string | null;
    classification: "person" | "vehicle" | null;
    confidence: number | null;
    snapshotPath: string | null;
    channel: "face" | "event";
    attempts: number;
  } | null {
    const row = this.db
      .prepare(
        `SELECT id FROM telegram_media_jobs
         WHERE status = 'pending' AND (next_attempt_at = '' OR next_attempt_at <= ?)
         ORDER BY id ASC LIMIT 1`,
      )
      .get(now) as { id: number } | undefined;
    if (!row) return null;
    const claimed = this.db
      .prepare(
        "UPDATE telegram_media_jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'pending'",
      )
      .run(now, row.id);
    if (Number(claimed.changes) === 0) return null;
    const job = this.db
      .prepare(
        `SELECT id, event_id, camera_id, camera_name, faces, max_confidence, event_timestamp,
                clip_timestamp, classification, confidence, snapshot_path, channel, attempts
         FROM telegram_media_jobs WHERE id = ?`,
      )
      .get(row.id) as {
      id: number;
      event_id: string;
      camera_id: number;
      camera_name: string;
      faces: number;
      max_confidence: number;
      event_timestamp: string;
      clip_timestamp: string | null;
      classification: string | null;
      confidence: number | null;
      snapshot_path: string | null;
      channel: string | null;
      attempts: number;
    };
    return {
      id: job.id,
      eventId: job.event_id,
      cameraId: job.camera_id,
      cameraName: job.camera_name,
      faces: job.faces,
      maxConfidence: job.max_confidence,
      eventTimestamp: job.event_timestamp,
      clipTimestamp: job.clip_timestamp,
      classification:
        job.classification === "person" || job.classification === "vehicle" ? job.classification : null,
      confidence: job.confidence === null || job.confidence === undefined ? null : Number(job.confidence),
      snapshotPath: job.snapshot_path,
      channel: job.channel === "event" ? "event" : "face",
      attempts: job.attempts,
    };
  }

  /**
   * Put a finished-but-retryable job back in the queue for later.
   *
   * The delay is what makes a DVR that is busy with live/playback work recover:
   * the media worker does not hammer the one playback slot.
   */
  retryTelegramMediaJob(id: number, nextAttemptAt: string, detail: string | null, now: string): void {
    this.db
      .prepare(
        `UPDATE telegram_media_jobs
         SET status = 'pending', next_attempt_at = ?, detail = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nextAttemptAt, detail, now, id);
  }

  finishTelegramMediaJob(id: number, status: "done" | "failed", detail: string | null, now: string): void {
    this.db
      .prepare("UPDATE telegram_media_jobs SET status = ?, detail = ?, updated_at = ? WHERE id = ?")
      .run(status, detail, now, id);
  }

  /**
   * Return jobs left in-flight by a crash to the queue.
   *
   * Called once at startup: a job that was running when the process died is
   * retried, which is safe because the queue is idempotent per event.
   */
  resetStaleTelegramMediaJobs(now: string): number {
    const result = this.db
      .prepare("UPDATE telegram_media_jobs SET status = 'pending', updated_at = ? WHERE status = 'running'")
      .run(now);
    return Number(result.changes);
  }

  /** Retention for the queue's own history. */
  pruneTelegramMediaJobs(beforeIso: string): number {
    const result = this.db
      .prepare("DELETE FROM telegram_media_jobs WHERE status <> 'pending' AND status <> 'running' AND updated_at < ?")
      .run(beforeIso);
    return Number(result.changes);
  }

  /** How many pending clips have accumulated: used by the status endpoint. */
  telegramMediaJobsByStatus(): Record<string, number> {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM telegram_media_jobs GROUP BY status")
      .all() as Array<{ status: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.status, row.count]));
  }

  /** Every crop path still referenced, used by the orphan sweep. */
  allFaceCropPaths(): string[] {
    const rows = this.db
      .prepare("SELECT crop_path FROM event_faces WHERE crop_path IS NOT NULL AND crop_path <> ''")
      .all() as Array<{ crop_path: string }>;
    return rows.map((row) => row.crop_path);
  }

  /** Crop paths belonging to events that retention is about to delete. */
  faceCropPathsBefore(cutoffIso: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT f.crop_path FROM event_faces f JOIN events e ON e.id = f.event_id
         WHERE e.timestamp < ? AND f.crop_path IS NOT NULL AND f.crop_path <> ''`,
      )
      .all(cutoffIso) as Array<{ crop_path: string }>;
    return rows.map((row) => row.crop_path);
  }

  // -------------------------------------------------------------------------
  // Temporary face-notification test mode (read-only here; the notifier writes
  // through the existing `recordNotification`).
  // -------------------------------------------------------------------------

  /**
   * Completed face jobs that have faces and no decision yet for `ruleId`.
   *
   * The cursor is a (finished_at, event_id) pair, so a restart resumes exactly
   * where it stopped and a busy second cannot be skipped. `NOT EXISTS` on the
   * notification history is the second half of the duplicate guard.
   */
  faceTestCandidates(input: {
    ruleId: string;
    cursorAt: string | null;
    cursorId: string | null;
    limit: number;
  }): FaceTestCandidate[] {
    const where: string[] = ["fp.status = 'COMPLETED'"];
    const params: Array<string | number> = [];
    if (input.cursorAt) {
      // Strict cursor: already-decided rows are also excluded below.
      where.push("(fp.finished_at > ? OR (fp.finished_at = ? AND fp.event_id > ?))");
      params.push(input.cursorAt, input.cursorAt, input.cursorId ?? "");
    }
    where.push(
      "NOT EXISTS (SELECT 1 FROM notification_history h WHERE h.event_id = fp.event_id AND h.rule_id = ?)",
    );
    params.push(input.ruleId);
    const rows = this.db
      .prepare(
        `SELECT fp.event_id AS event_id, e.camera_id AS camera_id, e.timestamp AS event_timestamp,
                fp.finished_at AS finished_at, COUNT(f.id) AS faces, MAX(f.confidence) AS max_confidence
         FROM face_processing fp
         JOIN events e ON e.id = fp.event_id
         JOIN event_faces f ON f.event_id = fp.event_id
         WHERE ${where.join(" AND ")}
         GROUP BY fp.event_id
         ORDER BY fp.finished_at ASC, fp.event_id ASC
         LIMIT ?`,
      )
      .all(...params, input.limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      eventId: String(row.event_id),
      cameraId: Number(row.camera_id),
      eventTimestamp: String(row.event_timestamp),
      finishedAt: String(row.finished_at),
      faces: Number(row.faces),
      maxConfidence: Number(row.max_confidence),
    }));
  }

  /** The newest completed face job, used to park the cursor on activation. */
  latestFaceTestCursor(): { finishedAt: string; eventId: string } | null {
    const row = this.db
      .prepare("SELECT finished_at, event_id FROM face_processing ORDER BY finished_at DESC, event_id DESC LIMIT 1")
      .get() as { finished_at: string; event_id: string } | undefined;
    return row ? { finishedAt: row.finished_at, eventId: row.event_id } : null;
  }

  /**
   * Detection time of the most recent *sent* test notification for a camera —
   * the cooldown anchor.
   *
   * Anchoring on the detection's own `finished_at` rather than on when the row
   * was written keeps the cooldown correct across a restart, a backlog, or a
   * hub that was briefly down: five minutes between detections means five
   * minutes, whichever process noticed them.
   */
  lastSentFaceTestAt(ruleId: string, cameraId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT fp.finished_at AS finished_at
         FROM notification_history h
         JOIN face_processing fp ON fp.event_id = h.event_id
         WHERE h.rule_id = ? AND h.camera_id = ? AND h.status = 'sent'
         ORDER BY fp.finished_at DESC
         LIMIT 1`,
      )
      .get(ruleId, cameraId) as { finished_at: string } | undefined;
    return row?.finished_at ?? null;
  }
}

const stores = new Map<string, EventStore>();

export function openEventStore(dataDir: string): EventStore {
  const existing = stores.get(dataDir);
  if (existing) return existing;
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "events.sqlite"));
  /*
   * The local face worker reads and writes this same database from a separate
   * process. WAL lets the two read concurrently, busy_timeout makes a brief
   * write overlap wait instead of throwing, and foreign_keys makes the
   * ON DELETE CASCADE on event_faces and face_processing real, so retention
   * cannot leave face rows behind.
   */
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA synchronous = NORMAL");
  /*
   * Bound the WAL file. A long-lived writer under continuous event ingestion
   * would otherwise let the -wal file grow until the next checkpoint. 64 MB is
   * far above steady-state traffic for this hub and cheap to keep.
   */
  db.exec("PRAGMA journal_size_limit = 67108864");
  db.exec("PRAGMA wal_autocheckpoint = 1000");
  const store = new EventStore(db);
  stores.set(dataDir, store);
  return store;
}

export function memoryEventStore(): EventStore {
  const db = new DatabaseSync(":memory:");
  // Foreign keys are off by default in SQLite; the cascade tests depend on them.
  db.exec("PRAGMA foreign_keys = ON");
  return new EventStore(db);
}

export function newRuleId(): string {
  return `rule-${randomUUID()}`;
}
