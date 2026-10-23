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
  telegramFaceNotifications: false,
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
function event(source: "hikvision" | "object-detection-worker", classification: "person" | "vehicle" | null, timestamp = "2026-10-23T17:00:00+05:30") {
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
        cameraName: "Parking",
        snapshotPath: null,
      }).delivered,
    ).toBe(false);
  });
});
