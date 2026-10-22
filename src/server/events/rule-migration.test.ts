import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { EventStore } from "@/server/events/event-store";

/**
 * V5.2 rule migration.
 *
 * A pre-multi-select database must open without losing rules. The new columns
 * are additive; the backfill only fills NULLs, is idempotent, and leaves the
 * legacy single-value fields intact.
 */
function legacyDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE notification_rules (
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
  `);
  db.prepare(
    `INSERT INTO notification_rules
      (id, enabled, camera_id, event_type, classification, quiet_hours_start, quiet_hours_end, created_at, updated_at)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "rule-legacy",
    2,
    "motion",
    "person",
    "23:00",
    "07:00",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:00.000Z",
  );
  return db;
}

describe("notification rule V5.2 migration", () => {
  it("adds multi-select columns and backfills a legacy rule without changing its behavior", () => {
    const db = legacyDatabase();
    const store = new EventStore(db);
    const rule = store.rules().find((item) => item.id === "rule-legacy");
    expect(rule).toBeDefined();
    expect(rule?.cameraId).toBe(2);
    expect(rule?.eventType).toBe("motion");
    expect(rule?.classification).toBe("person");
    expect(rule?.cameraIds).toEqual([2]);
    expect(rule?.eventTypes).toEqual(["person"]);

    const raw = db.prepare("SELECT camera_ids, event_types, updated_at FROM notification_rules WHERE id = ?").get(
      "rule-legacy",
    ) as { camera_ids: string | null; event_types: string | null; updated_at: string };
    expect(JSON.parse(raw.camera_ids!)).toEqual([2]);
    expect(JSON.parse(raw.event_types!)).toEqual(["person"]);
    // The backfill is not a content update.
    expect(raw.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("keeps a legacy all-camera / any-event rule equivalent to all four cameras and all three filters", () => {
    const db = legacyDatabase();
    db.prepare("DELETE FROM notification_rules").run();
    db.prepare(
      `INSERT INTO notification_rules
        (id, enabled, camera_id, event_type, classification, quiet_hours_start, quiet_hours_end, created_at, updated_at)
       VALUES ('rule-any', 1, NULL, NULL, NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    const store = new EventStore(db);
    const rule = store.rules()[0]!;
    expect(rule.cameraIds).toEqual([1, 2, 3, 4]);
    expect(rule.eventTypes).toEqual(["person", "vehicle", "motion"]);
  });

  it("is idempotent: a second open leaves the same one rule and the same selection", () => {
    const db = legacyDatabase();
    const first = new EventStore(db);
    const before = first.rules()[0]!;
    const second = new EventStore(db);
    const after = second.rules()[0]!;
    expect(second.rules()).toHaveLength(1);
    expect(after.cameraIds).toEqual(before.cameraIds);
    expect(after.eventTypes).toEqual(before.eventTypes);
    expect(after.name).toBe(before.name);
  });

  it("round-trips a multi-select rule through saveRule and rules()", () => {
    const db = legacyDatabase();
    const store = new EventStore(db);
    const existing = store.rules()[0]!;
    store.saveRule({
      ...existing,
      cameraIds: [1, 3],
      eventTypes: ["person", "vehicle"],
      name: "Parking and First Floor",
    });
    const reloaded = store.rules()[0]!;
    expect(reloaded.cameraIds).toEqual([1, 3]);
    expect(reloaded.eventTypes).toEqual(["person", "vehicle"]);
    // Legacy columns are kept broadly meaningful, while arrays stay exact.
    expect(reloaded.cameraId).toBeNull();
    expect(reloaded.eventType).toBe("motion");
    expect(reloaded.classification).toBeNull();
  });
});
