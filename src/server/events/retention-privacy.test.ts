import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openEventStore } from "@/server/events/event-store";
import { runRetention } from "@/server/events/retention";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const iso = (at: number) => new Date(at).toISOString();

/**
 * Privacy retention: event media retention is not enough. Detection-track
 * metadata (no foreign key to events), audit rows, stale presence rows and
 * completed detection-test requests carry behaviour/PII and used to be kept
 * forever.
 */
describe("retention of privacy-sensitive metadata", () => {
  it("prunes tracks, audit rows, test requests and presence without touching recent rows", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cctv-retention-"));
    const store = openEventStore(dir);
    const db = store.db;

    const eventColumns = `(id, dedupe_key, camera_id, type, timestamp, source, metadata, created_at, priority, notified, read_at)`;
    const insertEvent = db.prepare(
      `INSERT INTO events ${eventColumns} VALUES (?, ?, 1, 'motion', ?, 'hikvision', '{}', ?, 'NORMAL', 0, NULL)`,
    );
    insertEvent.run("evt_old", "dedupe-old", iso(NOW - 40 * DAY), iso(NOW - 40 * DAY));
    insertEvent.run("evt_new", "dedupe-new", iso(NOW - 1 * DAY), iso(NOW - 1 * DAY));

    const insertTrack = db.prepare(
      `INSERT INTO object_detection_tracks (id, camera_id, classification, raw_class, confidence, threshold, x, y, width, height, first_seen, last_seen, detection_count, snapshot_path, event_id, status, detector, model, created_at, updated_at)
       VALUES (?, 1, 'person', 'person', 0.9, 0.5, 0, 0, 10, 10, ?, ?, 1, NULL, NULL, 'stopped', 'yolox', 'yolox-nano', ?, ?)`,
    );
    insertTrack.run("track-old", iso(NOW - 40 * DAY), iso(NOW - 40 * DAY), iso(NOW - 40 * DAY), iso(NOW - 40 * DAY));
    insertTrack.run("track-new", iso(NOW - DAY), iso(NOW - DAY), iso(NOW - DAY), iso(NOW - DAY));

    const insertAudit = db.prepare(
      "INSERT INTO audit_logs (id, user_id, action, resource, metadata, ip_address, user_agent, created_at) VALUES (?, NULL, 'LOGIN_FAILED', 'admin', NULL, '203.0.113.9', 'ua', ?)",
    );
    insertAudit.run("audit-old", iso(NOW - 400 * DAY));
    insertAudit.run("audit-new", iso(NOW - DAY));

    const insertTest = db.prepare(
      "INSERT INTO object_detection_test_requests (id, event_id, camera_id, snapshot_path, status, result, created_at, updated_at) VALUES (?, 'evt_new', 1, 'x.jpg', 'done', NULL, ?, ?)",
    );
    insertTest.run("test-old", iso(NOW - 10 * DAY), iso(NOW - 10 * DAY));
    insertTest.run("test-new", iso(NOW - DAY), iso(NOW - DAY));

    const insertPresence = db.prepare("INSERT INTO viewer_presence (user_id, path, seen_at) VALUES ('u1', ?, ?)");
    insertPresence.run("cam1_main", NOW - 48 * 60 * 60 * 1000);
    insertPresence.run("cam2_main", NOW - 5_000);

    const result = await runRetention({
      store,
      dataDir: dir,
      cutoffIso: iso(NOW - 30 * DAY),
      auditCutoffIso: iso(NOW - 365 * DAY),
      testRequestCutoffIso: iso(NOW - 7 * DAY),
      presenceBeforeMs: NOW - 24 * 60 * 60 * 1000,
    });

    expect(result.events).toBe(1);
    expect(result.detectionTracks).toBe(1);
    expect(result.auditLogs).toBe(1);
    expect(result.testRequests).toBe(1);
    expect(result.presence).toBe(1);

    const count = (table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count("events")).toBe(1);
    expect((db.prepare("SELECT id FROM events").get() as { id: string }).id).toBe("evt_new");
    expect((db.prepare("SELECT id FROM object_detection_tracks").get() as { id: string }).id).toBe("track-new");
    expect((db.prepare("SELECT id FROM audit_logs").get() as { id: string }).id).toBe("audit-new");
    expect((db.prepare("SELECT id FROM object_detection_test_requests").get() as { id: string }).id).toBe("test-new");
    expect((db.prepare("SELECT path FROM viewer_presence").get() as { path: string }).path).toBe("cam2_main");
  });

  it("still prunes privacy metadata when event retention is disabled", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cctv-retention-off-"));
    const store = openEventStore(dir);
    store.db
      .prepare(
        "INSERT INTO audit_logs (id, user_id, action, resource, metadata, ip_address, user_agent, created_at) VALUES ('a-old', NULL, 'LOGIN', 'u', NULL, NULL, NULL, ?)",
      )
      .run(iso(NOW - 800 * DAY));
    store.db
      .prepare("INSERT INTO viewer_presence (user_id, path, seen_at) VALUES ('u1', 'cam1_main', ?)")
      .run(NOW - 48 * 60 * 60 * 1000);

    const result = await runRetention({
      store,
      dataDir: dir,
      cutoffIso: null,
      auditCutoffIso: iso(NOW - 365 * DAY),
      presenceBeforeMs: NOW - 24 * 60 * 60 * 1000,
    });
    expect(result.events).toBe(0);
    expect(result.auditLogs).toBe(1);
    expect(result.presence).toBe(1);
  });
});
