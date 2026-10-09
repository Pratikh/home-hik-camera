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
import { DEFAULT_COOLDOWN_SECONDS, isEventType, WEEKDAYS } from "@/lib/events";
import { defaultPriority, isEventPriority, priorityRank, type EventPriority } from "@/lib/priority";

export type NewEvent = {
  id: string;
  dedupeKey: string;
  cameraId: number;
  type: EventType;
  classification: EventClassification | null;
  timestamp: string;
  endTimestamp: string | null;
  source: "hikvision";
  metaId: string;
  priority?: EventPriority;
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

type RuleRow = {
  id: string;
  name: string | null;
  enabled: number;
  camera_id: number | null;
  event_type: string | null;
  classification: string | null;
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
  return {
    id: row.id,
    name: row.name && row.name.trim() ? row.name : defaultRuleName(row),
    enabled: row.enabled === 1,
    cameraId: row.camera_id,
    eventType: row.event_type && isEventType(row.event_type) ? row.event_type : null,
    classification:
      classification === "person" || classification === "vehicle" || classification === ""
        ? classification
        : null,
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

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS events_camera_timestamp ON events(camera_id, timestamp);
      CREATE INDEX IF NOT EXISTS events_type_timestamp ON events(type, timestamp);
      CREATE INDEX IF NOT EXISTS events_classification_timestamp ON events(classification, timestamp);
      CREATE INDEX IF NOT EXISTS events_priority_timestamp ON events(priority, timestamp);
      CREATE INDEX IF NOT EXISTS events_notified ON events(notified);
    `);
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
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
        event.timestamp,
        event.endTimestamp,
        event.source,
        JSON.stringify({ metaId: event.metaId }),
        new Date().toISOString(),
        priority,
      );
    return Number(result.changes) > 0;
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
  countSentSince(ruleId: string, sinceIso: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM notification_history
         WHERE rule_id = ? AND status = 'sent' AND created_at >= ?`,
      )
      .get(ruleId, sinceIso) as { count: number };
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
    this.db
      .prepare(
        `INSERT INTO notification_rules
          (id, name, enabled, camera_id, event_type, classification, minimum_priority, schedule_start,
           schedule_end, days_of_week, quiet_hours_start, quiet_hours_end, quiet_hours_behavior,
           cooldown_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          enabled = excluded.enabled,
          camera_id = excluded.camera_id,
          event_type = excluded.event_type,
          classification = excluded.classification,
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
        rule.cameraId,
        rule.eventType,
        rule.classification,
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
}

const stores = new Map<string, EventStore>();

export function openEventStore(dataDir: string): EventStore {
  const existing = stores.get(dataDir);
  if (existing) return existing;
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "events.sqlite"));
  const store = new EventStore(db);
  stores.set(dataDir, store);
  return store;
}

export function memoryEventStore(): EventStore {
  return new EventStore(new DatabaseSync(":memory:"));
}

export function newRuleId(): string {
  return `rule-${randomUUID()}`;
}
