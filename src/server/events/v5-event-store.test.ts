import { describe, expect, it } from "vitest";
import { DEFAULT_COOLDOWN_SECONDS, dedupeKey } from "@/lib/events";
import { memoryEventStore, type NewEvent } from "@/server/events/event-store";

function event(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    id: "evt_aaaaaaaaaaaaaaaaaaaaaaaa",
    dedupeKey: "1|motion|2026-10-07T23:42:13+05:30|person",
    cameraId: 1,
    type: "motion",
    classification: "person",
    timestamp: "2026-10-07T23:42:13+05:30",
    endTimestamp: null,
    source: "hikvision",
    metaId: "log.hikvision.com/Alarm/motionStart/1",
    ...overrides,
  };
}

describe("notification history and duplicate protection", () => {
  it("records an event/rule decision exactly once", () => {
    const store = memoryEventStore();
    const decision = {
      eventId: "evt_1",
      ruleId: "rule-night",
      ruleName: "Night person",
      cameraId: 1,
      priority: "HIGH" as const,
      status: "sent" as const,
      reason: null,
      eventTimestamp: "2026-10-07T23:42:13+05:30",
    };
    expect(store.recordNotification(decision)).toBe(true);
    expect(store.recordNotification(decision)).toBe(false);
    expect(store.notificationStats("2020-01-01T00:00:00+05:30", "2030-01-01T00:00:00+05:30").sent).toBe(1);
  });

  it("survives a restart because the guard is the database, not memory", () => {
    const store = memoryEventStore();
    expect(
      store.recordNotification({
        eventId: "evt_1",
        ruleId: "rule-night",
        ruleName: "Night person",
        cameraId: 1,
        priority: "HIGH",
        status: "sent",
        reason: null,
        eventTimestamp: "2026-10-07T23:42:13+05:30",
      }),
    ).toBe(true);
    expect(store.hasNotification("evt_1", "rule-night")).toBe(true);
    // A second pass over the same DVR message must not notify again.
    expect(
      store.recordNotification({
        eventId: "evt_1",
        ruleId: "rule-night",
        ruleName: "Night person",
        cameraId: 1,
        priority: "HIGH",
        status: "sent",
        reason: null,
        eventTimestamp: "2026-10-07T23:42:13+05:30",
      }),
    ).toBe(false);
  });

  it("treats a no-rule decision as its own single record", () => {
    const store = memoryEventStore();
    const base = {
      eventId: "evt_2",
      ruleId: null,
      ruleName: null,
      cameraId: 1,
      priority: "NORMAL" as const,
      status: "suppressed" as const,
      reason: "No notification rule matched",
      eventTimestamp: "2026-10-07T23:42:13+05:30",
    };
    expect(store.recordNotification(base)).toBe(true);
    expect(store.recordNotification(base)).toBe(false);
  });

  it("counts only sent notifications inside the cooldown window", () => {
    const store = memoryEventStore();
    store.recordNotification({
      eventId: "evt_a",
      ruleId: "rule-night",
      ruleName: "Night",
      cameraId: 1,
      priority: "HIGH",
      status: "sent",
      reason: null,
      eventTimestamp: "2026-10-07T23:42:13+05:30",
    });
    store.recordNotification({
      eventId: "evt_b",
      ruleId: "rule-night",
      ruleName: "Night",
      cameraId: 1,
      priority: "HIGH",
      status: "suppressed",
      reason: "Cooldown active for this rule",
      eventTimestamp: "2026-10-07T23:43:13+05:30",
    });
    const far = "2000-01-01T00:00:00+05:30";
    const past = "2030-01-01T00:00:00+05:30";
    expect(store.countSentSince("rule-night", far)).toBe(1);
    // A window that has already closed reports nothing, which reopens the gate.
    expect(store.countSentSince("rule-night", past)).toBe(0);
  });

  it("keeps the seeded rules usable after V5 columns are added", () => {
    const store = memoryEventStore();
    const rules = store.rules();
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.cooldownSeconds).toBe(DEFAULT_COOLDOWN_SECONDS);
    }
  });
});

describe("event queries and statistics", () => {
  function seed(store: ReturnType<typeof memoryEventStore>) {
    const rows: Array<Partial<NewEvent>> = [
      { id: "evt_person_high", cameraId: 1, classification: "person", priority: "HIGH", timestamp: "2026-10-07T10:00:00+05:30" },
      { id: "evt_vehicle_norm", cameraId: 2, classification: "vehicle", priority: "NORMAL", timestamp: "2026-10-07T11:00:00+05:30" },
      { id: "evt_plain_norm", cameraId: 2, classification: null, priority: "NORMAL", timestamp: "2026-10-07T12:00:00+05:30" },
      { id: "evt_intrusion_crit", cameraId: 3, type: "intrusion", classification: null, priority: "CRITICAL", timestamp: "2026-10-07T13:00:00+05:30" },
    ];
    rows.forEach((row, index) => {
      const timestamp = row.timestamp ?? "2026-10-07T10:00:00+05:30";
      store.insertEvent(
        event({
          ...row,
          timestamp,
          dedupeKey: dedupeKey({
            cameraId: row.cameraId ?? 1,
            type: row.type ?? "motion",
            timestamp,
            classification: row.classification ?? null,
          }),
          id: row.id ?? `evt_${index}`,
        }),
      );
    });
  }

  const day = { start: "2026-10-07T00:00:00+05:30", end: "2026-10-07T23:59:59+05:30" };

  it("filters to important events only", () => {
    const store = memoryEventStore();
    seed(store);
    const result = store.query({ ...day, cameraId: null, type: null, classification: null, page: 1, pageSize: 20, importantOnly: true });
    expect(result.total).toBe(2);
    expect(result.events.every((item) => item.priority === "HIGH" || item.priority === "CRITICAL")).toBe(true);
  });

  it("filters by camera and by classification", () => {
    const store = memoryEventStore();
    seed(store);
    expect(store.query({ ...day, cameraId: 2, type: null, classification: null, page: 1, pageSize: 20 }).total).toBe(2);
    expect(store.query({ ...day, cameraId: null, type: null, classification: "vehicle", page: 1, pageSize: 20 }).total).toBe(1);
    expect(store.query({ ...day, cameraId: null, type: null, classification: "none", page: 1, pageSize: 20 }).total).toBe(2);
  });

  it("filters by notification and read state", () => {
    const store = memoryEventStore();
    seed(store);
    store.markNotified("evt_person_high");
    expect(store.query({ ...day, cameraId: null, type: null, classification: null, page: 1, pageSize: 20, notified: true }).total).toBe(1);
    expect(store.query({ ...day, cameraId: null, type: null, classification: null, page: 1, pageSize: 20, notified: false }).total).toBe(3);
    store.markRead("evt_person_high", "2026-10-07T14:00:00+05:30");
    expect(store.query({ ...day, cameraId: null, type: null, classification: null, page: 1, pageSize: 20, read: true }).total).toBe(1);
    expect(store.query({ ...day, cameraId: null, type: null, classification: null, page: 1, pageSize: 20, read: false }).total).toBe(3);
  });

  it("paginates without loading the whole table", () => {
    const store = memoryEventStore();
    seed(store);
    const first = store.query({ ...day, cameraId: null, type: null, classification: null, page: 1, pageSize: 2 });
    const second = store.query({ ...day, cameraId: null, type: null, classification: null, page: 2, pageSize: 2 });
    expect(first.events).toHaveLength(2);
    expect(second.events).toHaveLength(2);
    expect(first.total).toBe(4);
    expect(first.events[0]?.id).not.toBe(second.events[0]?.id);
  });

  it("counts each metric and breaks activity down by camera", () => {
    const store = memoryEventStore();
    seed(store);
    const stats = store.stats(day.start, day.end, "2026-10-07");
    expect(stats.total).toBe(4);
    expect(stats.person).toBe(1);
    expect(stats.vehicle).toBe(1);
    // "motion" counts unclassified motion only, so person and vehicle motion
    // are not double counted. One plain-motion row here.
    expect(stats.motion).toBe(1);
    expect(stats.critical).toBe(1);
    expect(stats.high).toBe(1);
    expect(stats.cameras).toEqual([
      { cameraId: 1, total: 1 },
      { cameraId: 2, total: 2 },
      { cameraId: 3, total: 1 },
    ]);
  });

  it("returns only important events for the dashboard feed", () => {
    const store = memoryEventStore();
    seed(store);
    const important = store.recentImportant(10);
    expect(important).toHaveLength(2);
    expect(important.every((item) => item.priority === "HIGH" || item.priority === "CRITICAL")).toBe(true);
  });
});

describe("retention", () => {
  it("deletes old events, keeps recent ones, and never touches notifications for kept events", () => {
    const store = memoryEventStore();
    store.insertEvent(event({ id: "evt_old", timestamp: "2026-09-01T00:00:00+05:30", dedupeKey: "old" }));
    store.insertEvent(event({ id: "evt_recent", timestamp: "2026-10-07T00:00:00+05:30", dedupeKey: "recent" }));
    store.recordNotification({
      eventId: "evt_recent",
      ruleId: "rule-person",
      ruleName: "Person",
      cameraId: 1,
      priority: "HIGH",
      status: "sent",
      reason: null,
      eventTimestamp: "2026-10-07T00:00:00+05:30",
    });

    const cutoff = "2026-10-01T00:00:00+05:30";
    expect(store.deleteOlderThan(cutoff)).toBe(1);
    expect(store.count()).toBe(1);
    expect(store.get("evt_recent")).not.toBeNull();
    expect(store.get("evt_old")).toBeNull();
    // History for a retained event is untouched by event retention.
    expect(store.notificationStats("2000-01-01T00:00:00+05:30", "2030-01-01T00:00:00+05:30").sent).toBe(1);
  });

  it("reports the snapshot paths that retention is about to remove", () => {
    const store = memoryEventStore();
    store.insertEvent(event({ id: "evt_old", timestamp: "2026-09-01T00:00:00+05:30", dedupeKey: "old" }));
    store.insertEvent(event({ id: "evt_recent", timestamp: "2026-10-07T00:00:00+05:30", dedupeKey: "recent" }));
    store.setSnapshotPath("evt_old", "2026/09/01/1-evt_old.jpg");
    store.setSnapshotPath("evt_recent", "2026/10/07/1-evt_recent.jpg");
    expect(store.snapshotPathsBefore("2026-10-01T00:00:00+05:30")).toEqual(["2026/09/01/1-evt_old.jpg"]);
  });

  it("does not delete events near the cutoff boundary early", () => {
    const store = memoryEventStore();
    // 23:59 Kolkata on the cutoff day must survive a cutoff at 00:00 that day.
    store.insertEvent(event({ id: "evt_boundary", timestamp: "2026-10-01T23:59:00+05:30", dedupeKey: "boundary" }));
    expect(store.deleteOlderThan("2026-10-01T00:00:00+05:30")).toBe(0);
    expect(store.count()).toBe(1);
  });
});
