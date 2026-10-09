import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { memoryEventStore, openEventStore, type EventStore } from "@/server/events/event-store";
import { runRetention, sweepOrphanFaceCrops } from "@/server/events/retention";

/**
 * FACE-018 — retention must not leave orphan crops behind, and must never
 * remove a file that still belongs to a live event.
 */

const EVENT_OLD = "evt_oldoldoldoldoldoldoldold";
const EVENT_NEW = "evt_newnewnewnewnewnewnewnew";
const CROP_OLD = "2026/09/evt_oldoldoldoldoldoldoldold-face-1.jpg";
const CROP_NEW = "2026/10/evt_newnewnewnewnewnewnewnew-face-1.jpg";
const CUTOFF = "2026-10-01T00:00:00+05:30";

function tempDataDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "face-retention-"));
}

async function writeCrop(dataDir: string, relative: string, body = "crop"): Promise<string> {
  const target = path.join(dataDir, "face-crops", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  return target;
}

function seed(store: EventStore): void {
  store.insertEvent({
    id: EVENT_OLD,
    dedupeKey: "old",
    cameraId: 1,
    type: "motion",
    classification: "person",
    timestamp: "2026-09-01T10:00:00+05:30",
    endTimestamp: null,
    source: "hikvision",
    metaId: "meta-old",
  });
  store.insertEvent({
    id: EVENT_NEW,
    dedupeKey: "new",
    cameraId: 1,
    type: "motion",
    classification: "person",
    timestamp: "2026-10-09T10:00:00+05:30",
    endTimestamp: null,
    source: "hikvision",
    metaId: "meta-new",
  });
}

function addFace(store: EventStore, id: string, eventId: string, cropPath: string, index = 0): void {
  store.db
    .prepare(
      `INSERT INTO event_faces (id, event_id, confidence, x, y, width, height, crop_path, detector,
                                detection_index, created_at)
       VALUES (?, ?, 0.9, 1, 2, 30, 40, ?, 'yunet', ?, '2026-10-09T10:00:00+05:30')`,
    )
    .run(id, eventId, cropPath, index);
}

describe("retention with face crops", () => {
  it("removes the old event, its faces, its job row and its crop files", async () => {
    const store = memoryEventStore();
    seed(store);
    const dataDir = tempDataDir();
    const oldFile = await writeCrop(dataDir, CROP_OLD);
    const newFile = await writeCrop(dataDir, CROP_NEW);
    addFace(store, "face_111111111111111111111111", EVENT_OLD, CROP_OLD);
    addFace(store, "face_222222222222222222222222", EVENT_NEW, CROP_NEW);
    store.db
      .prepare("INSERT INTO face_processing (event_id, status, created_at, updated_at) VALUES (?, 'COMPLETED', ?, ?)")
      .run(EVENT_OLD, CUTOFF, CUTOFF);

    const result = await runRetention({ store, dataDir, cutoffIso: CUTOFF });

    expect(result.events).toBe(1);
    expect(result.crops).toBe(1);
    expect(store.get(EVENT_OLD)).toBeNull();
    expect(store.get(EVENT_NEW)).not.toBeNull();
    await expect(readable(oldFile)).resolves.toBe(false);
    await expect(readable(newFile)).resolves.toBe(true);
    expect(store.faceById("face_111111111111111111111111")).toBeNull();
    expect(store.faceById("face_222222222222222222222222")).not.toBeNull();
    expect(store.faceProcessing(EVENT_OLD)).toBeNull();
  });

  it("sweeps a crop whose event row is already gone", async () => {
    const store = memoryEventStore();
    seed(store);
    const dataDir = tempDataDir();
    // A leftover from a crash between the database delete and the unlink.
    const orphan = await writeCrop(dataDir, "2026/09/evt_ffffffffffffffffffffffff-face-1.jpg");
    const kept = await writeCrop(dataDir, CROP_NEW);
    addFace(store, "face_222222222222222222222222", EVENT_NEW, CROP_NEW);

    const result = await runRetention({ store, dataDir, cutoffIso: CUTOFF });

    expect(result.orphanedCrops).toBe(1);
    await expect(readable(orphan)).resolves.toBe(false);
    await expect(readable(kept)).resolves.toBe(true);
  });

  it("never deletes a file that is not one of ours", async () => {
    const store = memoryEventStore();
    const dataDir = tempDataDir();
    const notes = await writeCrop(dataDir, "2026/09/notes.txt", "keep me");
    const disguised = await writeCrop(dataDir, "2026/09/evt_ffffffffffffffffffffffff-face-1.png", "keep me too");

    await runRetention({ store, dataDir, cutoffIso: CUTOFF });

    await expect(readable(notes)).resolves.toBe(true);
    await expect(readable(disguised)).resolves.toBe(true);
  });

  it("sweeps nothing when every crop is still referenced", async () => {
    const store = memoryEventStore();
    seed(store);
    const dataDir = tempDataDir();
    await writeCrop(dataDir, CROP_NEW);
    addFace(store, "face_222222222222222222222222", EVENT_NEW, CROP_NEW);

    await expect(sweepOrphanFaceCrops(dataDir, new Set(store.allFaceCropPaths()))).resolves.toBe(0);
  });

  it("tolerates a missing crop directory", async () => {
    const store = memoryEventStore();
    const empty = tempDataDir();
    await expect(sweepOrphanFaceCrops(empty, new Set())).resolves.toBe(0);
    const result = await runRetention({ store, dataDir: empty, cutoffIso: CUTOFF });
    expect(result.crops).toBe(0);
  });

  it("ignores a stored crop path that escapes the directory", async () => {
    const store = memoryEventStore();
    seed(store);
    const dataDir = tempDataDir();
    const outside = path.join(dataDir, "outside.jpg");
    await writeFile(outside, "secret");
    addFace(store, "face_333333333333333333333333", EVENT_OLD, "../../outside.jpg");

    await runRetention({ store, dataDir, cutoffIso: CUTOFF });

    // The escaping path was never used to delete anything.
    await expect(readable(outside)).resolves.toBe(true);
  });

  it("writes the same schema the worker expects", () => {
    const store = memoryEventStore();
    const columns = (table: string) =>
      (store.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
    expect(columns("event_faces")).toEqual([
      "id",
      "event_id",
      "person_id",
      "confidence",
      "x",
      "y",
      "width",
      "height",
      "crop_path",
      "detector",
      "model",
      "detection_index",
      "created_at",
    ]);
    expect(columns("face_processing")).toEqual([
      "event_id",
      "status",
      "attempts",
      "faces_found",
      "detector",
      "model",
      "error",
      "started_at",
      "finished_at",
      "created_at",
      "updated_at",
    ]);
    // The tables the future recognition phase will use exist and are empty.
    expect(columns("people")).toEqual(["id", "name", "notes", "created_at", "updated_at"]);
    expect(columns("person_face_references")).toEqual([
      "id",
      "person_id",
      "image_path",
      "embedding",
      "embedding_model",
      "created_at",
    ]);
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM people").get()).toEqual({ count: 0 });
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM person_face_references").get()).toEqual({ count: 0 });
  });

  it("opens a file-backed database in WAL mode so the worker can share it", () => {
    const dataDir = tempDataDir();
    const store = openEventStore(dataDir);
    const mode = store.db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(mode.journal_mode.toLowerCase()).toBe("wal");
    const foreignKeys = store.db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(foreignKeys.foreign_keys).toBe(1);
  });

  it("keeps the retention query and the cascade consistent for notifications", async () => {
    const store = memoryEventStore();
    seed(store);
    store.recordNotification({
      eventId: EVENT_NEW,
      ruleId: "rule-person",
      ruleName: "Person",
      cameraId: 1,
      priority: "HIGH",
      status: "sent",
      reason: null,
      eventTimestamp: "2026-10-09T10:00:00+05:30",
    });
    const dataDir = tempDataDir();

    await runRetention({ store, dataDir, cutoffIso: CUTOFF });

    expect(store.notificationStats("2000-01-01T00:00:00+05:30", "2030-01-01T00:00:00+05:30").sent).toBe(1);
  });
});

async function readable(file: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
