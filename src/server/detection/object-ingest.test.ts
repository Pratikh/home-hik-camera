import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "@/lib/config";
import type { NotificationRule } from "@/lib/events";
import { memoryEventStore, openEventStore } from "@/server/events/event-store";
import { ingestObjectTracks } from "@/server/detection/object-ingest";

/**
 * Worker track → hub event. The event must keep the detector's exact frame,
 * confidence, threshold, bounding box and track id, run the normal rule engine
 * once, and update its end time while the object is still visible.
 */

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "object-ingest-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function config(dataDir: string): AppConfig {
  return {
    dataDir,
    telegramNotificationsEnabled: true,
    telegramBotToken: "test-token",
    telegramChatId: "-1001234567890",
    telegramFaceNotifications: true,
    telegramEventNotifications: true,
  } as unknown as AppConfig;
}

function rule(): NotificationRule {
  return {
    id: "rule-ai-person",
    name: "AI person",
    enabled: true,
    cameraIds: [1],
    eventTypes: ["person"],
    cameraId: 1,
    eventType: "motion",
    classification: "person",
    minimumPriority: null,
    scheduleStart: null,
    scheduleEnd: null,
    daysOfWeek: [],
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursBehavior: "notify",
    cooldownSeconds: 0,
  };
}

let sequence = 0;
function seedTrack(
  store: ReturnType<typeof memoryEventStore>,
  dataDir: string,
  overrides: Partial<{
    firstSeen: string;
    lastSeen: string;
    status: string;
    snapshotPath: string | null;
    writeSnapshot: boolean;
    classification: "person" | "vehicle";
    confidence: number;
  }> = {},
) {
  sequence += 1;
  const eventId = `evt_ai${String(sequence).padStart(22, "0")}`;
  const trackId = `trk_${sequence}`;
  const firstSeen = overrides.firstSeen ?? "2026-10-23T17:00:00+05:30";
  const lastSeen = overrides.lastSeen ?? "2026-10-23T17:00:03+05:30";
  const classification = overrides.classification ?? "person";
  const relative = overrides.snapshotPath === undefined ? `2026/10/23/1-${eventId}.jpg` : overrides.snapshotPath;
  if (relative && overrides.writeSnapshot !== false) {
    const file = path.join(dataDir, "events", relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  }
  store.db
    .prepare(
      `INSERT INTO object_detection_tracks
         (id, camera_id, classification, raw_class, confidence, threshold,
          x, y, width, height, first_seen, last_seen, detection_count,
          snapshot_path, event_id, status, detector, model, created_at, updated_at)
       VALUES (?, 1, ?, ?, ?, 0.7, 120, 200, 40, 90, ?, ?, 3, ?, ?, ?, 'yolox', 'yolox-nano', ?, ?)`,
    )
    .run(
      trackId,
      classification,
      classification,
      overrides.confidence ?? 0.83,
      firstSeen,
      lastSeen,
      relative,
      eventId,
      overrides.status ?? "active",
      firstSeen,
      lastSeen,
    );
  return { eventId, trackId, firstSeen, lastSeen, relative };
}

function newStore() {
  const store = memoryEventStore();
  for (const existing of store.rules()) store.deleteRule(existing.id);
  store.saveRule(rule());
  return store;
}

describe("ingestObjectTracks", () => {
  it("creates one event with the detector's exact frame, confidence and box", async () => {
    const dataDir = tempDir();
    const store = newStore();
    const track = seedTrack(store, dataDir);

    const result = await ingestObjectTracks({
      store,
      config: config(dataDir),
      cameraNames: { 1: "Parking" },
      dvrOffsetOverrideMs: 0,
    });
    expect(result.created).toBe(1);

    const event = store.get(track.eventId)!;
    expect(event.cameraId).toBe(1);
    expect(event.type).toBe("motion");
    expect(event.classification).toBe("person");
    expect(event.source).toBe("object-detection-worker");
    expect(event.confidence).toBeCloseTo(0.83);
    expect(event.hasSnapshot).toBe(true);
    expect(event.endTimestamp).toBe(track.lastSeen);
    expect(event.priority).toBe("HIGH");

    const metadata = store.eventMetadata(track.eventId)!;
    const detection = metadata.detection as Record<string, unknown>;
    expect(detection).toMatchObject({
      provider: "object-detection-worker",
      rawClass: "person",
      classification: "person",
      detector: "yolox",
      model: "yolox-nano",
      threshold: 0.7,
      trackId: track.trackId,
      boundingBox: { x: 120, y: 200, width: 40, height: 90 },
    });
    expect(detection.confidence).toBeCloseTo(0.83);

    // The normal rule engine ran and recorded the accepted decision.
    const history = store.db.prepare("SELECT status FROM notification_history WHERE event_id = ?").all(track.eventId) as Array<{ status: string }>;
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe("sent");

    // Telegram media uses the same exact-frame snapshot. The media queue lives
    // in DATA_DIR/events.sqlite (the worker's own store), not in the in-memory
    // store this test uses for events.
    const mediaStore = openEventStore(dataDir);
    const job = mediaStore.db.prepare("SELECT snapshot_path FROM telegram_media_jobs WHERE event_id = ?").get(track.eventId) as
      | { snapshot_path: string | null }
      | undefined;
    expect(job?.snapshot_path).toBe(track.relative);
    expect(store.get(track.eventId)!.notified).toBe(true);
  });

  it("is idempotent and keeps the event end time in sync while the track lives", async () => {
    const dataDir = tempDir();
    const store = newStore();
    const track = seedTrack(store, dataDir);

    await ingestObjectTracks({ store, config: config(dataDir), cameraNames: { 1: "Parking" }, dvrOffsetOverrideMs: 0 });
    const second = await ingestObjectTracks({ store, config: config(dataDir), cameraNames: { 1: "Parking" }, dvrOffsetOverrideMs: 0 });
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(store.db.prepare("SELECT COUNT(*) AS c FROM events WHERE source = 'object-detection-worker'").get()).toMatchObject({ c: 1 });

    const later = "2026-10-23T17:00:07+05:30";
    store.db.prepare("UPDATE object_detection_tracks SET last_seen = ?, detection_count = 5, status = 'ended' WHERE id = ?").run(later, track.trackId);

    const third = await ingestObjectTracks({ store, config: config(dataDir), cameraNames: { 1: "Parking" }, dvrOffsetOverrideMs: 0 });
    expect(third.updated).toBe(1);
    const event = store.get(track.eventId)!;
    expect(event.endTimestamp).toBe(later);
    const metadata = store.eventMetadata(track.eventId)!;
    expect((metadata.detection as Record<string, unknown>).lastSeen).toBe(later);

    // Still one history row: progress updates never notify twice.
    const history = store.db.prepare("SELECT COUNT(*) AS c FROM notification_history WHERE event_id = ?").get(track.eventId);
    expect(history).toMatchObject({ c: 1 });
  });

  it("shifts the clip timestamp by the measured DVR clock offset", async () => {
    const dataDir = tempDir();
    const store = newStore();
    const track = seedTrack(store, dataDir);

    await ingestObjectTracks({
      store,
      config: config(dataDir),
      cameraNames: { 1: "Parking" },
      dvrOffsetOverrideMs: 180_000, // the DVR clock is 3 minutes ahead of the host
    });

    const job = openEventStore(dataDir).db
      .prepare("SELECT event_timestamp, clip_timestamp FROM telegram_media_jobs WHERE event_id = ?")
      .get(track.eventId) as { event_timestamp: string; clip_timestamp: string } | undefined;
    // The event keeps the real detection time; the clip search uses the DVR's
    // own clock (server 17:00 + 3 min = 17:03), and the caption uses the event time.
    expect(job?.event_timestamp).toBe(track.firstSeen);
    expect(job?.clip_timestamp).toBe("2026-10-23T17:03:00+05:30");
    expect(store.get(track.eventId)!.timestamp).toBe(track.firstSeen);
  });

  it("creates the event even when the snapshot file has disappeared", async () => {
    const dataDir = tempDir();
    const store = newStore();
    const track = seedTrack(store, dataDir, { writeSnapshot: false });

    const result = await ingestObjectTracks({ store, config: config(dataDir), cameraNames: { 1: "Parking" }, dvrOffsetOverrideMs: 0 });
    expect(result.created).toBe(1);
    const event = store.get(track.eventId)!;
    expect(event.hasSnapshot).toBe(false);
    const job = openEventStore(dataDir).db
      .prepare("SELECT snapshot_path FROM telegram_media_jobs WHERE event_id = ?")
      .get(track.eventId) as { snapshot_path: string | null } | undefined;
    expect(job?.snapshot_path).toBeNull();
  });
});
