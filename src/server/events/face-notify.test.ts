import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_FACE_TEST_COOLDOWN_SECONDS, FACE_TEST_RULE_ID, faceNotificationContent, faceTestWindowState } from "@/lib/faces";
import { runFaceTestNotifications, type FaceTestRun } from "@/server/events/face-notify";
import type { TelegramFaceInput } from "@/server/notifications/telegram";
import type { FaceMediaJob } from "@/server/notifications/telegram-media";
import { EventStore, memoryEventStore } from "@/server/events/event-store";

/**
 * FACE-NOTIFY-001 … 016 — the temporary face-notification test mode.
 *
 * These are hub-level tests: the detector itself is covered by the worker
 * suite, and here every completed face job is seeded directly, so the
 * notification decision, cooldown, expiry, duplicate protection and content can
 * be asserted deterministically.
 */

const NOW = new Date("2026-10-10T10:00:00+05:30");
const UNTIL = "2026-10-12T10:00:00+05:30";
const CURSOR_BOOTSTRAP = "2026-10-01T00:00:00.000Z";

let faceSequence = 0;
function nextFaceId(): string {
  faceSequence += 1;
  return `face_${String(faceSequence).padStart(24, "0")}`;
}

const ENABLED = {
  faceDetectionTestNotifications: true,
  faceDetectionTestUntil: UNTIL,
  faceDetectionTestNotificationCooldownSeconds: 300,
};

type SeedFace = { confidence: number };

function seedCompletedJob(
  store: EventStore,
  input: {
    id: string;
    cameraId?: number;
    finishedAt?: string;
    eventTimestamp?: string;
    faces?: SeedFace[];
    status?: string;
  },
): void {
  const cameraId = input.cameraId ?? 1;
  const eventTimestamp = input.eventTimestamp ?? "2026-10-10T09:59:00+05:30";
  store.insertEvent({
    id: input.id,
    dedupeKey: `dedupe-${input.id}`,
    cameraId,
    type: "motion",
    classification: "person",
    timestamp: eventTimestamp,
    endTimestamp: null,
    source: "hikvision",
    metaId: `meta-${input.id}`,
  });
  // Production stores the full camera snapshot on the event itself.
  store.setSnapshotPath(input.id, `2026/10/10/${cameraId}-${input.id}.jpg`);
  const faces = input.faces ?? [{ confidence: 0.82 }];
  faces.forEach((face, index) => {
    store.db
      .prepare(
        `INSERT INTO event_faces (id, event_id, confidence, x, y, width, height, crop_path, detector,
                                  detection_index, created_at)
         VALUES (?, ?, ?, 10, 20, 30, 40, ?, 'yunet', ?, '2026-10-10T04:29:00.000Z')`,
      )
      .run(
        nextFaceId(),
        input.id,
        face.confidence,
        `2026/10/${input.id}-face-${index + 1}.jpg`,
        index,
      );
  });
  const finishedAt = input.finishedAt ?? "2026-10-10T04:29:30.000Z";
  store.db
    .prepare(
      `INSERT INTO face_processing (event_id, status, attempts, faces_found, detector, model,
                                    started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, 1, ?, 'yunet', 'face_detection_yunet_2023mar', ?, ?, ?, ?)`,
    )
    .run(input.id, input.status ?? "COMPLETED", faces.length, finishedAt, finishedAt, finishedAt, finishedAt);
}

type RunOverrides = Partial<Parameters<typeof runFaceTestNotifications>[0]> & {
  /**
   * Mark the window as already active and the cursor as old, so seeded jobs are
   * "new". Set false to exercise the first activation pass itself.
   */
  armed?: boolean;
};

function run(store: EventStore, overrides: RunOverrides = {}): Promise<FaceTestRun> {
  const { armed = true, ...rest } = overrides;
  if (armed) {
    store.setSetting("face_test_notify_window", (rest.config ?? ENABLED).faceDetectionTestUntil ?? "");
    store.setSetting("face_test_notify_cursor_at", CURSOR_BOOTSTRAP);
    store.setSetting("face_test_notify_cursor_id", "");
  }
  return runFaceTestNotifications({
    store,
    config: ENABLED,
    dataDir: "/tmp/face-notify-test",
    now: NOW,
    cameraNames: { 1: "Parking", 2: "Right Side Outside Camera" },
    publish: () => undefined,
    log: () => undefined,
    /*
     * Telegram is stubbed by default so the decision tests below never touch the
     * Telegram module or the network. The Telegram integration has its own
     * describe block, which overrides this.
     */
    telegram: async () => ({ ok: false as const, status: "disabled" as const, detail: null }),
    // Same idea for the background media job: recorded, never queued, in these tests.
    enqueueMedia: (job: FaceMediaJob) => {
      void job;
      return "queued" as const;
    },
    ...rest,
  });
}

/** Notification rows written for the test rule, oldest first. */
function faceTestRows(store: EventStore) {
  return store.db
    .prepare("SELECT * FROM notification_history WHERE rule_id = ? ORDER BY created_at ASC")
    .all(FACE_TEST_RULE_ID) as Array<Record<string, unknown>>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FACE-NOTIFY-001 default configuration", () => {
  it("is off unless explicitly enabled, with a 300 second cooldown", async () => {
    const { readConfig } = await import("@/lib/config");
    const config = readConfig({});
    expect(config.faceDetectionTestNotifications).toBe(false);
    expect(config.faceDetectionTestNotificationCooldownSeconds).toBe(DEFAULT_FACE_TEST_COOLDOWN_SECONDS);
    expect(config.faceDetectionTestNotificationCooldownSeconds).toBe(300);
    expect(config.faceDetectionTestUntil).toBe("");
    expect(readConfig({ FACE_DETECTION_TEST_NOTIFICATIONS: "TRUE" }).faceDetectionTestNotifications).toBe(true);
    expect(readConfig({ FACE_DETECTION_TEST_NOTIFICATIONS: "1" }).faceDetectionTestNotifications).toBe(false);
    expect(readConfig({ FACE_DETECTION_TEST_NOTIFICATION_COOLDOWN_SECONDS: "60" }).faceDetectionTestNotificationCooldownSeconds).toBe(60);
    expect(readConfig({ FACE_DETECTION_TEST_NOTIFICATION_COOLDOWN_SECONDS: "-5" }).faceDetectionTestNotificationCooldownSeconds).toBe(300);
  });

  it("keeps face detection independent of the test flag", async () => {
    const { readConfig } = await import("@/lib/config");
    const config = readConfig({ FACE_DETECTION_ENABLED: "true" });
    expect(config.faceDetectionEnabled).toBe(true);
    expect(config.faceDetectionTestNotifications).toBe(false);
  });

  it("reports the window state without touching the database", () => {
    expect(faceTestWindowState({ enabled: false, until: UNTIL, now: NOW })).toMatchObject({
      active: false,
      reason: "DISABLED",
    });
    expect(faceTestWindowState({ enabled: true, until: UNTIL, now: NOW })).toMatchObject({
      active: true,
      reason: "ACTIVE",
    });
  });
});

describe("FACE-NOTIFY-002 the flag alone gates the notification", () => {
  it("sends nothing when FACE_DETECTION_TEST_NOTIFICATIONS is false", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_111111111111111111111111" });
    const publish = vi.fn();

    const result = await run(store, {
      config: { ...ENABLED, faceDetectionTestNotifications: false },
      publish,
    });

    expect(result.active).toBe(false);
    expect(result.reason).toBe("DISABLED");
    expect(result.sent).toBe(0);
    expect(publish).not.toHaveBeenCalled();
    expect(faceTestRows(store)).toHaveLength(0);
    // Detection records are untouched by the notification decision.
    expect(store.facesForEvent("evt_111111111111111111111111")).toHaveLength(1);
  });
});

describe("FACE-NOTIFY-003 enabled and inside the window", () => {
  it("records a sent decision and publishes one face notification", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_222222222222222222222222", faces: [{ confidence: 0.82 }] });
    const publish = vi.fn();
    const log = vi.fn();

    const result = await run(store, { publish, log });

    expect(result.active).toBe(true);
    expect(result.sent).toBe(1);
    expect(result.decisions[0]).toMatchObject({
      eventId: "evt_222222222222222222222222",
      cameraId: 1,
      cameraName: "Parking",
      faces: 1,
      status: "sent",
      reason: "SENT",
    });

    const rows = faceTestRows(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_id: "evt_222222222222222222222222",
      rule_id: FACE_TEST_RULE_ID,
      rule_name: "Face detected (test mode)",
      camera_id: 1,
      status: "sent",
      reason: null,
    });

    expect(publish).toHaveBeenCalledTimes(1);
    const payload = publish.mock.calls[0]![0];
    expect(payload.notify).toBe(true);
    expect(payload.face).toEqual({
      eventId: "evt_222222222222222222222222",
      cameraId: 1,
      cameraName: "Parking",
      faces: 1,
      maxConfidence: 0.82,
    });
    // The full event travels with it, exactly like a normal live event.
    expect(payload.event.id).toBe("evt_222222222222222222222222");
    expect(payload.event.cameraName).toBe("Parking");

    expect(log.mock.calls[0]![0]).toContain("result=SENT");
    expect(log.mock.calls[0]![0]).toContain("camera_name=\"Parking\"");
    expect(log.mock.calls[0]![0]).toContain("max_confidence=0.82");
  });

  it("does not replay detections that completed before the mode was activated", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_333333333333333333333333", finishedAt: "2026-10-10T04:00:00.000Z" });
    const publish = vi.fn();

    // First active pass parks the cursor on the newest job and sends nothing.
    const first = await run(store, { publish, armed: false });
    expect(first.sent).toBe(0);
    expect(publish).not.toHaveBeenCalled();

    // A job that completes afterwards is notified.
    seedCompletedJob(store, { id: "evt_444444444444444444444444", finishedAt: "2026-10-10T04:35:00.000Z" });
    const second = await run(store, { publish, armed: false });
    expect(second.sent).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0].face.eventId).toBe("evt_444444444444444444444444");
  });
});

describe("FACE-NOTIFY-004 / 005 / 006 expiry fails closed", () => {
  it("FACE-NOTIFY-004 sends nothing after the window has expired", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_555555555555555555555555" });
    const publish = vi.fn();

    const result = await run(store, {
      config: { ...ENABLED, faceDetectionTestUntil: "2026-10-09T10:00:00+05:30" },
      publish,
    });

    expect(result.active).toBe(false);
    expect(result.reason).toBe("TEST_WINDOW_EXPIRED");
    expect(publish).not.toHaveBeenCalled();
    expect(faceTestRows(store)).toHaveLength(0);
  });

  it("FACE-NOTIFY-005 sends nothing when the expiry is missing", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_666666666666666666666666" });
    const publish = vi.fn();

    const result = await run(store, {
      config: { ...ENABLED, faceDetectionTestUntil: "" },
      publish,
    });

    expect(result.active).toBe(false);
    expect(result.reason).toBe("MISSING_UNTIL");
    expect(publish).not.toHaveBeenCalled();
    expect(faceTestRows(store)).toHaveLength(0);
  });

  it("FACE-NOTIFY-006 sends nothing when the expiry is invalid", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_777777777777777777777777" });
    const publish = vi.fn();

    for (const invalid of ["tomorrow", "2026-10-12", "2026-10-12T10:00:00", "2026-13-45T10:00:00+05:30"]) {
      const result = await run(store, {
        config: { ...ENABLED, faceDetectionTestUntil: invalid },
        publish,
      });
      expect(result.active, invalid).toBe(false);
      expect(result.reason, invalid).toBe("INVALID_UNTIL");
    }
    expect(publish).not.toHaveBeenCalled();
    expect(faceTestRows(store)).toHaveLength(0);
  });
});

describe("FACE-NOTIFY-007 / 008 cooldown", () => {
  it("FACE-NOTIFY-007 suppresses a repeat for the same camera inside the cooldown", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_888888888888888888888888", finishedAt: "2026-10-10T04:29:00.000Z" });
    seedCompletedJob(store, { id: "evt_999999999999999999999999", finishedAt: "2026-10-10T04:31:00.000Z" });
    const publish = vi.fn();
    const log = vi.fn();

    const result = await run(store, { publish, log });

    expect(result.sent).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.decisions.map((item) => item.reason)).toEqual(["SENT", "COOLDOWN"]);

    const rows = faceTestRows(store);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ status: "suppressed", reason: "Cooldown active for this camera" });
    expect(log.mock.calls[1]![0]).toContain("result=SUPPRESSED reason=COOLDOWN");
  });

  it("sends again once the cooldown has passed", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_aaaaaaaaaaaaaaaaaaaaaaaa", finishedAt: "2026-10-10T04:29:00.000Z" });
    seedCompletedJob(store, { id: "evt_bbbbbbbbbbbbbbbbbbbbbbbb", finishedAt: "2026-10-10T04:40:00.000Z" });
    const publish = vi.fn();

    const result = await run(store, { publish });

    expect(result.sent).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("FACE-NOTIFY-008 keeps a separate cooldown per camera", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_cccccccccccccccccccccccc", cameraId: 1, finishedAt: "2026-10-10T04:29:00.000Z" });
    seedCompletedJob(store, { id: "evt_dddddddddddddddddddddddd", cameraId: 2, finishedAt: "2026-10-10T04:29:10.000Z" });
    seedCompletedJob(store, { id: "evt_eeeeeeeeeeeeeeeeeeeeeeee", cameraId: 1, finishedAt: "2026-10-10T04:29:20.000Z" });
    const publish = vi.fn();

    const result = await run(store, { publish });

    expect(result.sent).toBe(2);
    expect(result.suppressed).toBe(1);
    expect(result.decisions.map((item) => `${item.cameraId}:${item.reason}`)).toEqual([
      "1:SENT",
      "2:SENT",
      "1:COOLDOWN",
    ]);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("honours a zero cooldown as 'no cooldown'", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_f0f0f0f0f0f0f0f0f0f0f0f0", finishedAt: "2026-10-10T04:29:00.000Z" });
    seedCompletedJob(store, { id: "evt_f1f1f1f1f1f1f1f1f1f1f1f1", finishedAt: "2026-10-10T04:29:05.000Z" });
    const publish = vi.fn();

    const result = await run(store, {
      config: { ...ENABLED, faceDetectionTestNotificationCooldownSeconds: 0 },
      publish,
    });

    expect(result.sent).toBe(2);
  });
});

describe("FACE-NOTIFY-009 the cooldown is persistent", () => {
  it("survives a full restart of the hub", async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "face-notify-db-"));
    const file = path.join(dataDir, "events.sqlite");

    const first = new EventStore(new DatabaseSync(file));
    seedCompletedJob(first, { id: "evt_a1a1a1a1a1a1a1a1a1a1a1a1", finishedAt: "2026-10-10T04:29:00.000Z" });
    const firstRun = await run(first, { publish: () => undefined });
    expect(firstRun.sent).toBe(1);
    first.db.close();

    // A brand new process, same database: the cooldown anchor is the history.
    const second = new EventStore(new DatabaseSync(file));
    seedCompletedJob(second, { id: "evt_a2a2a2a2a2a2a2a2a2a2a2a2", finishedAt: "2026-10-10T04:31:00.000Z" });
    const publish = vi.fn();
    const secondRun = await run(second, { publish });
    second.db.close();

    expect(secondRun.suppressed).toBe(1);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("FACE-NOTIFY-010 one notification per event", () => {
  it("summarises several faces in a single notification", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, {
      id: "evt_b1b1b1b1b1b1b1b1b1b1b1b1",
      faces: [{ confidence: 0.71 }, { confidence: 0.93 }, { confidence: 0.62 }],
    });
    const publish = vi.fn();

    const result = await run(store, { publish });

    expect(result.sent).toBe(1);
    expect(result.decisions[0]).toMatchObject({ faces: 3, maxConfidence: 0.93 });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0].face).toMatchObject({ faces: 3, maxConfidence: 0.93 });
    expect(faceTestRows(store)).toHaveLength(1);
  });
});

describe("FACE-NOTIFY-011 / 012 / 013 notification content", () => {
  it("FACE-NOTIFY-011 names the camera, and FACE-NOTIFY-012/013 give the count and confidence", () => {
    const single = faceNotificationContent({ cameraName: "Parking", faces: 1, maxConfidence: 0.82 });
    expect(single.title).toBe("👤 Face detected");
    expect(single.body).toBe("Parking · 1 face · 82% confidence");

    const many = faceNotificationContent({ cameraName: "Right Side Outside Camera", faces: 3, maxConfidence: 0.9142 });
    expect(many.title).toBe("👤 Face detected");
    expect(many.body).toBe("Right Side Outside Camera · 3 faces · max confidence 91%");
  });

  it("never shows a raw decimal or an identity", () => {
    const { title, body } = faceNotificationContent({ cameraName: "Parking", faces: 2, maxConfidence: 0.823742 });
    expect(body).not.toMatch(/\d\.\d/);
    expect(body).toContain("82%");
    expect(title).not.toMatch(/priyanka|person/i);
    expect(body).not.toMatch(/priyanka|person/i);
  });

  it("carries the real detected values into the published payload", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_c1c1c1c1c1c1c1c1c1c1c1c1", cameraId: 2, faces: [{ confidence: 0.5 }, { confidence: 0.9142 }] });
    const publish = vi.fn();
    await run(store, { publish });

    const face = publish.mock.calls[0]![0].face;
    const content = faceNotificationContent(face);
    expect(content.body).toBe("Right Side Outside Camera · 2 faces · max confidence 91%");

    const row = faceTestRows(store)[0]!;
    expect(row.camera_id).toBe(2);
  });
});

describe("FACE-NOTIFY-014 no filesystem paths", () => {
  it("keeps crop paths out of the payload, the content and the notification log", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_d1d1d1d1d1d1d1d1d1d1d1d1" });
    const publish = vi.fn();
    const log = vi.fn();
    await run(store, { publish, log });

    const serialised = JSON.stringify(publish.mock.calls[0]![0]);
    expect(serialised).not.toContain("face-crops");
    expect(serialised).not.toContain(".jpg");
    expect(serialised).not.toContain("/tmp");

    const { title, body } = faceNotificationContent(publish.mock.calls[0]![0].face);
    expect(`${title} ${body}`).not.toContain("/");
    expect(`${title} ${body}`).not.toContain(".jpg");

    expect(log.mock.calls[0]![0]).not.toContain("face-crops");
    expect(log.mock.calls[0]![0]).not.toContain(".jpg");

    // The database keeps the crop path where it belongs: on the face row only.
    expect(faceTestRows(store)[0]).not.toHaveProperty("crop_path");
  });
});

describe("FACE-NOTIFY-015 existing notifications are untouched", () => {
  it("does not modify, replace or suppress the existing motion history", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_e1e1e1e1e1e1e1e1e1e1e1e1" });
    const motionDecision = {
      eventId: "evt_e1e1e1e1e1e1e1e1e1e1e1e1",
      ruleId: "rule-person",
      ruleName: "Person detected",
      cameraId: 1,
      priority: "HIGH" as const,
      status: "sent" as const,
      reason: null,
      eventTimestamp: "2026-10-10T09:59:00+05:30",
    };
    store.recordNotification(motionDecision);
    const before = store.db.prepare("SELECT * FROM notification_history WHERE rule_id = 'rule-person'").all();

    const result = await run(store);

    expect(result.sent).toBe(1);
    const after = store.db.prepare("SELECT * FROM notification_history WHERE rule_id = 'rule-person'").all();
    expect(after).toEqual(before);
    // The motion rule still has exactly its own one sent notification.
    expect(store.countSentSince("rule-person", "2000-01-01T00:00:00+05:30")).toBe(1);
    // Two different rules, two different rows, for the same event.
    expect(faceTestRows(store)).toHaveLength(1);
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM notification_history").get()).toEqual({ count: 2 });
  });

  it("reacts to its own flag only", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_e2e2e2e2e2e2e2e2e2e2e2e2" });
    await run(store, { config: { ...ENABLED, faceDetectionTestNotifications: false } });
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM notification_history").get()).toEqual({ count: 0 });
    expect(store.setting("events_last_error")).toBeNull();
  });
});

describe("FACE-NOTIFY-016 duplicate safety", () => {
  it("does not send twice for the same event", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_f2f2f2f2f2f2f2f2f2f2f2f2" });
    const publish = vi.fn();

    await run(store, { publish });
    const second = await run(store, { publish });

    expect(second.evaluated).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(faceTestRows(store)).toHaveLength(1);
  });

  it("still does not duplicate when the cursor is lost", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_f3f3f3f3f3f3f3f3f3f3f3f3" });
    const publish = vi.fn();
    await run(store, { publish });

    // Simulate a restored database or a hand-rewound cursor: the notification
    // history itself must still block the second decision.
    store.setSetting("face_test_notify_window", UNTIL);
    store.setSetting("face_test_notify_cursor_at", CURSOR_BOOTSTRAP);
    store.setSetting("face_test_notify_cursor_id", "");
    const second = await run(store, { publish, armed: false });

    expect(second.sent).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(faceTestRows(store)).toHaveLength(1);
  });

  it("does not resurrect a suppressed decision later", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_f4f4f4f4f4f4f4f4f4f4f4f4", finishedAt: "2026-10-10T04:29:00.000Z" });
    seedCompletedJob(store, { id: "evt_f5f5f5f5f5f5f5f5f5f5f5f5", finishedAt: "2026-10-10T04:30:00.000Z" });
    const publish = vi.fn();
    await run(store, { publish });

    // Long after the cooldown, a later pass must not re-send the suppressed one.
    const later = await run(store, { now: new Date("2026-10-10T11:00:00+05:30"), publish });
    expect(later.sent).toBe(0);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(faceTestRows(store)).toHaveLength(2);
  });

  it("cannot exceed the per-cycle batch limit, and finishes the rest next time", async () => {
    const store = memoryEventStore();
    for (let index = 0; index < 30; index += 1) {
      seedCompletedJob(store, {
        id: `evt_${String(index).padStart(24, "0")}`,
        cameraId: index + 1,
        finishedAt: `2026-10-10T04:${String(20 + index).padStart(2, "0")}:00.000Z`,
      });
    }
    const publish = vi.fn();

    const first = await run(store, { publish });
    expect(first.evaluated).toBe(25);
    const second = await run(store, { publish });
    expect(second.evaluated).toBe(5);
    expect(faceTestRows(store)).toHaveLength(30);
    // Every distinct camera got its own notification, none twice.
    expect(publish).toHaveBeenCalledTimes(30);
  });
});

describe("FACE-NOTIFY-011/013/014 the browser notification itself", () => {
  it("targets the event detail page with a face-specific tag", async () => {
    const { faceNotificationOptions } = await import("@/lib/faces");
    const options = faceNotificationOptions({
      eventId: "evt_999999999999999999999999",
      cameraId: 1,
      cameraName: "Parking",
      faces: 1,
      maxConfidence: 0.82,
    });

    expect(options).toEqual({
      title: "👤 Face detected",
      body: "Parking · 1 face · 82% confidence",
      tag: "face:evt_999999999999999999999999",
      href: "/events/evt_999999999999999999999999",
      eventId: "evt_999999999999999999999999",
    });
    // A separate tag means the face notification never replaces the event's own.
    expect(options.tag).not.toBe(options.eventId);
    expect(options.href).not.toContain("/faces");
    expect(JSON.stringify(options)).not.toContain(".jpg");
    expect(JSON.stringify(options)).not.toContain("face-crops");
  });
});

/* ---------------------------------------------------------------------------
 * Telegram integration (TELEGRAM-012 … TELEGRAM-015).
 *
 * Telegram rides on the SAME accepted decision: the existing cooldown, expiry,
 * deduplication and cursor decide whether anything is sent at all. These tests
 * assert that relationship, and that a Telegram failure cannot damage the
 * browser notification or the run.
 * ------------------------------------------------------------------------- */

describe("TELEGRAM-012 … 015 — Telegram shares the existing decision", () => {
  // The parameter is declared so `mock.calls[0][0]` is typed; it is not read.
  const TELEGRAM_OK = async (input: TelegramFaceInput) => {
    void input;
    return { ok: true as const, status: "sent" as const };
  };

  it("sends Telegram exactly once for an accepted notification, with the real detected data", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, {
      id: "evt_7a7a7a7a7a7a7a7a7a7a7a7a",
      cameraId: 2,
      faces: [{ confidence: 0.61 }, { confidence: 0.914 }],
    });
    const telegram = vi.fn(TELEGRAM_OK);

    const result = await run(store, { telegram });

    expect(result.sent).toBe(1);
    expect(telegram).toHaveBeenCalledTimes(1);
    expect(telegram.mock.calls[0]![0]).toEqual({
      cameraName: "Right Side Outside Camera",
      faces: 2,
      maxConfidence: 0.914,
      eventTimestamp: "2026-10-10T09:59:00+05:30",
    });
    expect(result.decisions[0]!.telegram).toBe("sent");
  });

  it("TELEGRAM-012 a Telegram failure does not break the browser notification", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_7b7b7b7b7b7b7b7b7b7b7b7b" });
    const publish = vi.fn();
    const telegram = vi.fn(async () => ({ ok: false as const, status: "http_error" as const, detail: "HTTP 500" }));

    const result = await run(store, { publish, telegram });

    // The browser leg still happened, the decision is still recorded as sent…
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]![0].face.faces).toBe(1);
    expect(result.sent).toBe(1);
    expect(faceTestRows(store)).toHaveLength(1);
    expect(faceTestRows(store)[0]!.status).toBe("sent");
    // …and only the Telegram outcome records the failure.
    expect(result.decisions[0]!.telegram).toBe("failed");
  });

  it("TELEGRAM-012 a Telegram sender that throws is contained too", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_7c7c7c7c7c7c7c7c7c7c7c7c" });
    const publish = vi.fn();
    const telegram = vi.fn(async () => {
      throw new Error("boom");
    });

    const result = await run(store, { publish, telegram });

    expect(result.sent).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.decisions[0]!.telegram).toBe("failed");
  });

  it("TELEGRAM-013 the existing cooldown suppresses Telegram as well", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_7d7d7d7d7d7d7d7d7d7d7d7d", finishedAt: "2026-10-10T04:29:00.000Z" });
    seedCompletedJob(store, { id: "evt_7e7e7e7e7e7e7e7e7e7e7e7e", finishedAt: "2026-10-10T04:30:00.000Z" });
    const telegram = vi.fn(TELEGRAM_OK);

    const result = await run(store, { telegram });

    // One accepted, one suppressed by the per-camera cooldown.
    expect(result.sent).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(telegram).toHaveBeenCalledTimes(1);
    expect(result.decisions.map((item) => item.telegram)).toEqual(["sent", "skipped"]);
  });

  it("TELEGRAM-014 a duplicate event never produces a second Telegram message", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_7f7f7f7f7f7f7f7f7f7f7f7f" });
    const telegram = vi.fn(TELEGRAM_OK);

    await run(store, { telegram });
    // A second pass, and a pass after the cursor is rewound, must both be silent.
    await run(store, { telegram });
    store.setSetting("face_test_notify_window", UNTIL);
    store.setSetting("face_test_notify_cursor_at", CURSOR_BOOTSTRAP);
    store.setSetting("face_test_notify_cursor_id", "");
    await run(store, { telegram, armed: false });

    expect(telegram).toHaveBeenCalledTimes(1);
    expect(faceTestRows(store)).toHaveLength(1);
  });

  it("TELEGRAM-015 an expired test window prevents Telegram too", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_808080808080808080808080" });
    const telegram = vi.fn(TELEGRAM_OK);
    const publish = vi.fn();

    const result = await run(store, {
      telegram,
      publish,
      config: { ...ENABLED, faceDetectionTestUntil: "2026-10-09T10:00:00+05:30" },
    });

    expect(result.active).toBe(false);
    expect(result.reason).toBe("TEST_WINDOW_EXPIRED");
    expect(telegram).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(faceTestRows(store)).toHaveLength(0);
  });

  it("TELEGRAM-002 (integration) the face flag being off leaves Telegram out", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_818181818181818181818181" });
    const telegram = vi.fn(TELEGRAM_OK);
    const publish = vi.fn();

    const result = await run(store, { telegram, publish });

    expect(result.sent).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(telegram).toHaveBeenCalledTimes(1);
    // The real sender decides the flag; here the stub stands in for it, so the
    // assertion that matters is the real module's own test above.
    expect(result.decisions[0]!.telegram).toBe("sent");
  });

  it("never lets Telegram delay or duplicate the recorded decision", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_828282828282828282828282" });
    // A slow Telegram call still yields exactly one decision row.
    const telegram = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { ok: true as const, status: "sent" as const };
    });

    const result = await run(store, { telegram });

    expect(telegram).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
    expect(faceTestRows(store)).toHaveLength(1);
    // The event and its detection row are untouched by the notification path.
    expect(store.get("evt_828282828282828282828282")).not.toBeNull();
    expect(store.faceProcessing("evt_828282828282828282828282")?.status).toBe("COMPLETED");
  });
});

/* ---------------------------------------------------------------------------
 * Telegram media (face crop + event clip) — TELEGRAM-MEDIA-001, 015, 016, 017, 018.
 *
 * The media job is queued by the SAME accepted decision, so the cooldown, the
 * duplicate protection and the test window gate it exactly like the text.
 * ------------------------------------------------------------------------- */

describe("TELEGRAM-MEDIA — the media job shares the existing decision", () => {
  const TEXT_OK = async (input: TelegramFaceInput) => {
    void input;
    return { ok: true as const, status: "sent" as const };
  };

  it("TELEGRAM-MEDIA-001 queues one media job for an accepted face event, with its crops", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, {
      id: "evt_9a9a9a9a9a9a9a9a9a9a9a9a",
      cameraId: 2,
      faces: [{ confidence: 0.7 }, { confidence: 0.91 }],
    });
    const telegram = vi.fn(TEXT_OK);
    const enqueueMedia = vi.fn((job: FaceMediaJob) => {
      void job;
      return "queued" as const;
    });

    const result = await run(store, { telegram, enqueueMedia });

    // The text notification still happens exactly as before.
    expect(telegram).toHaveBeenCalledTimes(1);
    expect(result.sent).toBe(1);
    // …and the same decision queues the media.
    expect(enqueueMedia).toHaveBeenCalledTimes(1);
    expect(enqueueMedia.mock.calls[0]![0]).toMatchObject({
      eventId: "evt_9a9a9a9a9a9a9a9a9a9a9a9a",
      cameraId: 2,
      cameraName: "Right Side Outside Camera",
      faces: 2,
      maxConfidence: 0.91,
      eventTimestamp: "2026-10-10T09:59:00+05:30",
    });
    // The full camera snapshot for the event — never a face crop.
    expect(enqueueMedia.mock.calls[0]![0].snapshotPath).toBe("2026/10/10/2-evt_9a9a9a9a9a9a9a9a9a9a9a9a.jpg");
    expect(result.decisions[0]!.media).toBe("queued");
  });

  it("TELEGRAM-MEDIA-015 the cooldown suppresses the media too", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_9b9b9b9b9b9b9b9b9b9b9b9b", finishedAt: "2026-10-10T04:29:00.000Z" });
    seedCompletedJob(store, { id: "evt_9c9c9c9c9c9c9c9c9c9c9c9c", finishedAt: "2026-10-10T04:30:00.000Z" });
    const enqueueMedia = vi.fn((job: FaceMediaJob) => {
      void job;
      return "queued" as const;
    });

    const result = await run(store, { telegram: TEXT_OK, enqueueMedia });

    expect(result.sent).toBe(1);
    expect(result.suppressed).toBe(1);
    // One accepted decision, one media job — the suppressed one queues nothing.
    expect(enqueueMedia).toHaveBeenCalledTimes(1);
    expect(result.decisions.map((item) => item.media)).toEqual(["queued", "skipped"]);
  });

  it("TELEGRAM-MEDIA-016 a duplicate event never queues a second media job", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_9d9d9d9d9d9d9d9d9d9d9d9d" });
    const enqueueMedia = vi.fn((job: FaceMediaJob) => {
      void job;
      return "queued" as const;
    });

    await run(store, { telegram: TEXT_OK, enqueueMedia });
    await run(store, { telegram: TEXT_OK, enqueueMedia });
    store.setSetting("face_test_notify_window", UNTIL);
    store.setSetting("face_test_notify_cursor_at", CURSOR_BOOTSTRAP);
    store.setSetting("face_test_notify_cursor_id", "");
    await run(store, { telegram: TEXT_OK, enqueueMedia, armed: false });

    expect(enqueueMedia).toHaveBeenCalledTimes(1);
    expect(faceTestRows(store)).toHaveLength(1);
  });

  it("TELEGRAM-MEDIA-017 Telegram disabled means no media job is queued", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_9e9e9e9e9e9e9e9e9e9e9e9e" });
    const enqueueMedia = vi.fn((job: FaceMediaJob) => {
      void job;
      return "queued" as const;
    });
    const telegram = vi.fn(async () => ({ ok: false as const, status: "disabled" as const, detail: null }));

    const result = await run(store, { telegram, enqueueMedia });

    expect(result.sent).toBe(1);
    expect(result.decisions[0]!.telegram).toBe("disabled");
    expect(enqueueMedia).not.toHaveBeenCalled();
    expect(result.decisions[0]!.media).toBe("skipped");
  });

  it("TELEGRAM-MEDIA-018 an expired test window queues no media", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_9f9f9f9f9f9f9f9f9f9f9f9f" });
    const enqueueMedia = vi.fn((job: FaceMediaJob) => {
      void job;
      return "queued" as const;
    });

    const result = await run(store, {
      telegram: TEXT_OK,
      enqueueMedia,
      config: { ...ENABLED, faceDetectionTestUntil: "2026-10-09T10:00:00+05:30" },
    });

    expect(result.active).toBe(false);
    expect(enqueueMedia).not.toHaveBeenCalled();
  });

  it("a failing media enqueue cannot break the notification", async () => {
    const store = memoryEventStore();
    seedCompletedJob(store, { id: "evt_a0a0a0a0a0a0a0a0a0a0a0a0" });
    const publish = vi.fn();
    const enqueueMedia = vi.fn(() => {
      throw new Error("queue exploded");
    });

    const result = await run(store, { telegram: TEXT_OK, enqueueMedia, publish });

    expect(result.sent).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(result.decisions[0]!.media).toBe("skipped");
  });
});
