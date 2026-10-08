import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { CctvEvent, EventClassification, EventStats, EventType, NotificationRule } from "@/lib/events";
import { isEventType } from "@/lib/events";

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
};

export type EventQuery = {
  cameraId: number | null;
  type: EventType | null;
  classification: EventClassification | "none" | null;
  start: string;
  end: string;
  page: number;
  pageSize: number;
};

type RuleRow = {
  id: string;
  enabled: number;
  camera_id: number | null;
  event_type: string | null;
  classification: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
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
  created_at TEXT NOT NULL
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
  return {
    id: String(row.id),
    cameraId: Number(row.camera_id),
    type: isEventType(String(row.type)) ? String(row.type) as EventType : "motion",
    classification: classification === "person" || classification === "vehicle" ? classification : null,
    timestamp: String(row.timestamp),
    endTimestamp: row.end_timestamp ? String(row.end_timestamp) : null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    hasSnapshot: typeof row.snapshot_path === "string" && row.snapshot_path.length > 0,
    recordingStart: row.recording_start ? String(row.recording_start) : null,
    recordingEnd: row.recording_end ? String(row.recording_end) : null,
    source: String(row.source),
  };
}

function mapRule(row: RuleRow): NotificationRule {
  const classification = row.classification;
  return {
    id: row.id,
    enabled: row.enabled === 1,
    cameraId: row.camera_id,
    eventType: row.event_type && isEventType(row.event_type) ? row.event_type : null,
    classification:
      classification === "person" || classification === "vehicle" || classification === ""
        ? classification
        : null,
    quietHoursStart: row.quiet_hours_start,
    quietHoursEnd: row.quiet_hours_end,
  };
}

export class EventStore {
  readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(SCHEMA);
    this.seed();
  }

  private seed(): void {
    const count = this.db.prepare("SELECT COUNT(*) AS count FROM notification_rules").get() as { count: number };
    if (count.count > 0) return;
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT INTO notification_rules
        (id, enabled, camera_id, event_type, classification, quiet_hours_start, quiet_hours_end, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, '23:00', '07:00', ?, ?)`,
    );
    insert.run("rule-person", 1, null, "person", now, now);
    insert.run("rule-vehicle", 0, null, "vehicle", now, now);
    insert.run("rule-motion", 0, "motion", "", now, now);
  }

  insertEvent(event: NewEvent): boolean {
    const result = this.db
      .prepare(
        `INSERT INTO events (
          id, dedupe_key, camera_id, type, classification, timestamp, end_timestamp, confidence,
          snapshot_path, recording_start, recording_end, source, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
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
    const clause = where.join(" AND ");
    const total = this.db.prepare(`SELECT COUNT(*) AS count FROM events WHERE ${clause}`).get(...params) as { count: number };
    const offset = (input.page - 1) * input.pageSize;
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE ${clause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...params, input.pageSize, offset) as Array<Record<string, unknown>>;
    return { events: rows.map(mapEvent), total: total.count };
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
        `SELECT type, classification, COUNT(*) AS count
         FROM events
         WHERE timestamp >= ? AND timestamp <= ?
         GROUP BY type, classification`,
      )
      .all(start, end) as Array<{ type: string; classification: string | null; count: number }>;
    const stats: EventStats = { date, total: 0, person: 0, vehicle: 0, motion: 0 };
    for (const row of rows) {
      stats.total += row.count;
      if (row.classification === "person") stats.person += row.count;
      else if (row.classification === "vehicle") stats.vehicle += row.count;
      else if (row.type === "motion") stats.motion += row.count;
    }
    return stats;
  }

  recent(limit: number): CctvEvent[] {
    const rows = this.db.prepare("SELECT * FROM events ORDER BY timestamp DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
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

  deleteOlderThan(cutoffIso: string): number {
    const result = this.db.prepare("DELETE FROM events WHERE timestamp < ?").run(cutoffIso);
    return Number(result.changes);
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
          (id, enabled, camera_id, event_type, classification, quiet_hours_start, quiet_hours_end, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
          enabled = excluded.enabled,
          camera_id = excluded.camera_id,
          event_type = excluded.event_type,
          classification = excluded.classification,
          quiet_hours_start = excluded.quiet_hours_start,
          quiet_hours_end = excluded.quiet_hours_end,
          updated_at = excluded.updated_at`,
      )
      .run(
        rule.id,
        rule.enabled ? 1 : 0,
        rule.cameraId,
        rule.eventType,
        rule.classification,
        rule.quietHoursStart,
        rule.quietHoursEnd,
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
