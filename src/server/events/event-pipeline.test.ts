import { describe, expect, it } from "vitest";
import type { AppConfig } from "@/lib/config";
import type { NotificationRule } from "@/lib/events";
import { memoryEventStore } from "@/server/events/event-store";
import { processEventNotification } from "@/server/events/event-pipeline";
import { effectiveDetectionSource } from "@/lib/object-detection";

/**
 * One shared decision point for DVR and AI events. These tests pin the
 * detection-source semantics, the existing cooldown/dedup behaviour and the
 * media-only queueing.
 */

const CONFIG = {
  dataDir: "/tmp/event-pipeline-test",
  telegramNotificationsEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
  telegramEventNotifications: false,
} as unknown as AppConfig;

function rule(overrides: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-person",
    name: "Person",
    enabled: true,
    cameraIds: [1],
    eventTypes: ["person", "vehicle"],
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
    ...overrides,
  };
}

let sequence = 0;
/*
 * These cases cover rule/priority/schedule/cooldown semantics, so both sources
 * use a timestamp that is current relative to NOW. Freshness has its own suite
 * (notification-freshness.test.ts); keeping this clock fixed keeps that split
 * honest instead of accidentally relying on "old means suppressed".
 */
const NOW = new Date("2026-10-23T17:00:20+05:30");
const RECENT = "2026-10-23T17:00:00+05:30";

function event(source: "hikvision" | "object-detection-worker", classification: "person" | "vehicle" | null, timestamp = RECENT) {
  sequence += 1;
  return {
    id: `evt_pipe_${String(sequence).padStart(4, "0")}`,
    cameraId: 1,
    type: "motion" as const,
    classification,
    timestamp,
    priority: "HIGH" as const,
    source,
  };
}

function seed(store: ReturnType<typeof memoryEventStore>, item: ReturnType<typeof event>) {
  store.insertEvent({
    id: item.id,
    dedupeKey: `dedupe-${item.id}`,
    cameraId: item.cameraId,
    type: item.type,
    classification: item.classification,
    timestamp: item.timestamp,
    endTimestamp: null,
    source: item.source,
    metaId: "test",
    priority: item.priority,
    confidence: null,
  });
}

function decisions(store: ReturnType<typeof memoryEventStore>, eventId: string) {
  return store.db.prepare("SELECT * FROM notification_history WHERE event_id = ?").all(eventId) as Array<{
    status: string;
    reason: string | null;
  }>;
}

function mediaJobs(store: ReturnType<typeof memoryEventStore>, eventId: string) {
  return store.db.prepare("SELECT * FROM telegram_media_jobs WHERE event_id = ?").all(eventId) as Array<{
    snapshot_path: string | null;
  }>;
}

describe("detection source gate", () => {
  it("detection OFF: the DVR's person label notifies as it did before AI", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule());
    const item = event("hikvision", "person");
    seed(store, item);

    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      // The stored setting can still be "AI only"; it only applies while the
      // detector is enabled. This mirrors event-processor's effective source.
      detectionSource: effectiveDetectionSource({ enabled: false, detectionSource: "ai_only" }),
      now: NOW,
      cameraName: "Parking",
      snapshotPath: "2026/10/23/1-evt-dvr.jpg",
    });

    expect(result.delivered).toBe(true);
    expect(decisions(store, item.id)[0]!.status).toBe("sent");
  });

  it("detection OFF: DVR vehicle and motion keep the historical behaviour", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule({ eventTypes: ["motion", "vehicle"] }));
    const vehicle = event("hikvision", "vehicle");
    const motion = event("hikvision", null);
    seed(store, vehicle);
    seed(store, motion);

    for (const item of [vehicle, motion]) {
      expect(
        processEventNotification({
          store,
          event: item,
          config: CONFIG,
          detectionSource: effectiveDetectionSource({ enabled: false, detectionSource: "ai_only" }),
          now: NOW,
          cameraName: "Parking",
          snapshotPath: null,
        }).delivered,
      ).toBe(true);
    }
  });

  it("detection ON keeps AI-only semantics: DVR labels are stored but do not notify", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule());
    const item = event("hikvision", "person");
    seed(store, item);

    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: effectiveDetectionSource({ enabled: true, detectionSource: "ai_only" }),
      cameraName: "Parking",
      snapshotPath: null,
    });

    expect(result.delivered).toBe(false);
    expect(decisions(store, item.id)).toHaveLength(0);
  });

  it("AI only: the DVR's person label is stored but does not notify", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule());
    const item = event("hikvision", "person");
    seed(store, item);

    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_only",
      cameraName: "Parking",
      snapshotPath: "2026/10/23/1-evt.jpg",
    });

    expect(result.delivered).toBe(false);
    expect(decisions(store, item.id)).toHaveLength(0);
    expect(mediaJobs(store, item.id)).toHaveLength(0);
  });

  it("AI only: an AI person event notifies through the normal rule", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule());
    const item = event("object-detection-worker", "person");
    seed(store, item);

    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_only",
      cameraName: "Parking",
      snapshotPath: "2026/10/23/1-evt-ai.jpg",
    });

    expect(result.delivered).toBe(true);
    expect(decisions(store, item.id)[0]!.status).toBe("sent");
    // The media worker is gated by Telegram config, so its queue stays empty in
    // this test config; the decision is what the pipeline owns.
  });

  it("DVR only: an AI event does not notify but the DVR label does", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule());
    const ai = event("object-detection-worker", "person");
    const dvr = event("hikvision", "person");
    seed(store, ai);
    seed(store, dvr);

    expect(
      processEventNotification({
        store,
        event: ai,
        config: CONFIG,
        detectionSource: "dvr_only",
        now: NOW,
        cameraName: "Parking",
        snapshotPath: null,
      }).delivered,
    ).toBe(false);
    expect(
      processEventNotification({
        store,
        event: dvr,
        config: CONFIG,
        detectionSource: "dvr_only",
        now: NOW,
        cameraName: "Parking",
        snapshotPath: null,
      }).delivered,
    ).toBe(true);
  });

  it("AI + DVR: both sources may notify", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule({ cooldownSeconds: 0, cameraIds: [1] }));
    const ai = event("object-detection-worker", "person");
    const dvr = event("hikvision", "person");
    seed(store, ai);
    seed(store, dvr);

    for (const item of [ai, dvr]) {
      expect(
        processEventNotification({
          store,
          event: item,
          config: CONFIG,
          detectionSource: "ai_both",
        now: NOW,
          cameraName: "Parking",
          snapshotPath: null,
        }).delivered,
      ).toBe(true);
    }
  });

  it("unclassified DVR motion keeps notifying in AI-only mode", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule({ eventTypes: ["motion"], classification: "" }));
    const item = event("hikvision", null);
    seed(store, item);

    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_only",
      now: NOW,
      cameraName: "Parking",
      snapshotPath: null,
    });
    expect(result.delivered).toBe(true);
  });
});

describe("existing guarantees still apply", () => {
  it("the same event + rule never notifies twice", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule());
    const item = event("object-detection-worker", "person");
    seed(store, item);

    const first = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_only",
      cameraName: "Parking",
      snapshotPath: null,
    });
    const second = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_only",
      cameraName: "Parking",
      snapshotPath: null,
    });

    expect(first.delivered).toBe(true);
    expect(second.delivered).toBe(false);
    expect(decisions(store, item.id)).toHaveLength(1);
  });

  it("cooldown suppresses the second accepted event of the same rule", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule({ cooldownSeconds: 300 }));
    const first = event("object-detection-worker", "person", "2026-10-23T17:00:00+05:30");
    const second = event("object-detection-worker", "person", "2026-10-23T17:01:00+05:30");
    seed(store, first);
    seed(store, second);

    expect(
      processEventNotification({
        store,
        event: first,
        config: CONFIG,
        detectionSource: "ai_only",
        now: NOW,
        cameraName: "Parking",
        snapshotPath: null,
      }).delivered,
    ).toBe(true);
    expect(
      processEventNotification({
        store,
        event: second,
        config: CONFIG,
        detectionSource: "ai_only",
        now: NOW,
        cameraName: "Parking",
        snapshotPath: null,
      }).delivered,
    ).toBe(false);
  });
});

describe("freshness gate through the pipeline", () => {
  const NOW_LOCAL = new Date("2026-10-23T17:00:20+05:30");
  const at = (secondsAgo: number): string =>
    new Date(NOW_LOCAL.getTime() - secondsAgo * 1000).toISOString();

  function freshStore() {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(rule({ cooldownSeconds: 0 }));
    return store;
  }

  it("11. a historical DVR event is stored but never notified", () => {
    const store = freshStore();
    const item = event("hikvision", "person", at(6 * 3600));
    seed(store, item);

    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_both",
      now: NOW_LOCAL,
      cameraName: "Parking",
      snapshotPath: null,
    });

    expect(result.delivered).toBe(false);
    // Stored and visible: only notification eligibility changed.
    expect(store.get(item.id)).not.toBeNull();
    expect(decisions(store, item.id)).toHaveLength(0);
    expect(mediaJobs(store, item.id)).toHaveLength(0);
  });

  it("12/14. replaying the day after a restart notifies only the recent event", () => {
    const store = freshStore();
    const replay = [
      { seconds: 7 * 3600, classification: "person" as const },
      { seconds: 5 * 3600, classification: "person" as const },
      { seconds: 3 * 3600, classification: "person" as const },
      { seconds: 20, classification: "person" as const },
    ];
    const delivered: string[] = [];
    for (const candidate of replay) {
      const item = event("hikvision", candidate.classification, at(candidate.seconds));
      seed(store, item);
      const result = processEventNotification({
        store,
        event: item,
        config: CONFIG,
        detectionSource: "ai_both",
        now: NOW_LOCAL,
        cameraName: "Parking",
        snapshotPath: null,
      });
      if (result.delivered) delivered.push(item.id);
    }
    expect(delivered).toHaveLength(1);
    // Every recovered event exists in the database regardless.
    expect(store.count()).toBe(4);
  });

  it("13. re-polling the same old event never notifies (and never duplicates)", () => {
    const store = freshStore();
    const timestamp = at(4 * 3600);
    const first = event("hikvision", "person", timestamp);
    seed(store, first);
    const r1 = processEventNotification({
      store,
      event: first,
      config: CONFIG,
      detectionSource: "ai_both",
      now: NOW_LOCAL,
      cameraName: "Parking",
      snapshotPath: null,
    });
    // A second poll of the same DVR row cannot insert again (unique dedupe_key).
    const second = { ...first, id: "evt_pipe_replay" };
    const insertedAgain = store.insertEvent({
      id: second.id,
      dedupeKey: `dedupe-${first.id}`,
      cameraId: second.cameraId,
      type: second.type,
      classification: second.classification,
      timestamp: second.timestamp,
      endTimestamp: null,
      source: second.source,
      metaId: "test",
      priority: second.priority,
      confidence: null,
    });
    expect(r1.delivered).toBe(false);
    expect(insertedAgain).toBe(false);
    expect(store.count()).toBe(1);
  });

  it("15. a recent object-detection event still notifies (never age-gated)", () => {
    const store = freshStore();
    // Deliberately old timestamp: AI events are exempt from the DVR policy.
    const item = event("object-detection-worker", "person", at(6 * 3600));
    seed(store, item);
    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_both",
      now: NOW_LOCAL,
      cameraName: "Parking",
      snapshotPath: null,
    });
    expect(result.delivered).toBe(true);
  });

  it("16. a recent DVR event still obeys the notification rules", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    // Rule selects a different camera, so camera filtering must still apply.
    store.saveRule(rule({ cameraIds: [4], cameraId: 4, cooldownSeconds: 0 }));
    const item = event("hikvision", "person", at(25));
    seed(store, item);
    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_both",
      now: NOW_LOCAL,
      cameraName: "Parking",
      snapshotPath: null,
    });
    expect(result.delivered).toBe(false);
    // The audit row says "no rule matched"; nothing was ever sent.
    const rows = decisions(store, item.id);
    expect(rows.every((row) => row.status !== "sent")).toBe(true);
  });

  it("17. quiet hours and cooldown are unaffected for recent events", () => {
    const store = memoryEventStore();
    for (const existing of store.rules()) store.deleteRule(existing.id);
    store.saveRule(
      rule({
        quietHoursStart: "00:00",
        quietHoursEnd: "23:59",
        quietHoursBehavior: "store_only",
        cooldownSeconds: 0,
      }),
    );
    const item = event("hikvision", "person", at(15));
    seed(store, item);
    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_both",
      now: NOW_LOCAL,
      cameraName: "Parking",
      snapshotPath: null,
    });
    expect(result.delivered).toBe(false);
    const rows = decisions(store, item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toContain("store");
  });

  it("a missing DVR timestamp is stored but not notified", () => {
    const store = freshStore();
    const item = event("hikvision", "person", "");
    seed(store, item);
    const result = processEventNotification({
      store,
      event: item,
      config: CONFIG,
      detectionSource: "ai_both",
      now: NOW_LOCAL,
      cameraName: "Parking",
      snapshotPath: null,
    });
    expect(result.delivered).toBe(false);
    expect(store.get(item.id)).not.toBeNull();
  });
});
