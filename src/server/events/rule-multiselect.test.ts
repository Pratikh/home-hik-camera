import { describe, expect, it } from "vitest";
import {
  legacyRuleFields,
  type EventClassification,
  type NotificationRule,
  type RuleEventType,
} from "@/lib/events";
import { memoryEventStore } from "@/server/events/event-store";
import { recordNotificationDecisions } from "@/server/events/notification-decisions";
import { cooldownBlocks, cooldownWindowStart, evaluateRules, type RuleInput } from "@/server/events/rule-engine";

/**
 * Multi-select rule matching, against the real rule engine and the real
 * notification decision writer. No React state and no mocked matcher.
 *
 * Camera ids are the application's actual ids: 1 Parking, 2 Right Side,
 * 3 First Floor, 4 Left Side. "Motion" means unclassified motion.
 */

const PARKING = 1;
const RIGHT_SIDE = 2;
const FIRST_FLOOR = 3;
const LEFT_SIDE = 4;

const INSIDE = new Date("2026-10-07T10:00:00+05:30"); // 10:00 IST
const NIGHT = new Date("2026-10-07T23:30:00+05:30");
const OUTSIDE_DAY_WINDOW = new Date("2026-10-07T23:30:00+05:30");

function baseRule(patch: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-test",
    name: "Test rule",
    enabled: true,
    cameraId: null,
    eventType: "motion",
    classification: "person",
    minimumPriority: null,
    scheduleStart: null,
    scheduleEnd: null,
    daysOfWeek: [],
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursBehavior: "suppress",
    cooldownSeconds: 0,
    ...patch,
  };
}

function multiRule(
  cameraIds: number[],
  eventTypes: RuleEventType[],
  patch: Partial<NotificationRule> = {},
): NotificationRule {
  const fallback = baseRule(patch);
  return {
    ...fallback,
    cameraIds,
    eventTypes,
    ...legacyRuleFields({ cameraIds, eventTypes, fallback }),
  };
}

let sequence = 0;
function event(
  cameraId: number,
  classification: EventClassification | null,
  timestamp = "2026-10-07T10:00:00+05:30",
  priority: RuleInput["priority"] = undefined,
): RuleInput {
  sequence += 1;
  return {
    id: `evt_${sequence.toString().padStart(4, "0")}`,
    cameraId,
    type: "motion",
    classification,
    timestamp,
    priority,
  };
}

function decision(rule: NotificationRule, input: RuleInput, at = INSIDE) {
  return evaluateRules([rule], input, at);
}

describe("multi-select rule matching", () => {
  it("TEST A: two cameras + one event matches only those cameras", () => {
    const rule = multiRule([PARKING, RIGHT_SIDE], ["person"]);
    expect(decision(rule, event(PARKING, "person")).notify).toBe(true);
    expect(decision(rule, event(RIGHT_SIDE, "person")).notify).toBe(true);
    expect(decision(rule, event(FIRST_FLOOR, "person")).notify).toBe(false);
    expect(decision(rule, event(LEFT_SIDE, "person")).notify).toBe(false);
  });

  it("TEST B: one camera + two events matches only those events", () => {
    const rule = multiRule([PARKING], ["person", "vehicle"]);
    expect(decision(rule, event(PARKING, "person")).notify).toBe(true);
    expect(decision(rule, event(PARKING, "vehicle")).notify).toBe(true);
    expect(decision(rule, event(PARKING, null)).notify).toBe(false);
    expect(decision(rule, event(RIGHT_SIDE, "person")).notify).toBe(false);
  });

  it("TEST C: two cameras + two events matches every valid combination", () => {
    const rule = multiRule([PARKING, RIGHT_SIDE], ["person", "vehicle"]);
    expect(decision(rule, event(PARKING, "person")).notify).toBe(true);
    expect(decision(rule, event(PARKING, "vehicle")).notify).toBe(true);
    expect(decision(rule, event(RIGHT_SIDE, "person")).notify).toBe(true);
    expect(decision(rule, event(RIGHT_SIDE, "vehicle")).notify).toBe(true);
    expect(decision(rule, event(FIRST_FLOOR, "person")).notify).toBe(false);
    expect(decision(rule, event(FIRST_FLOOR, "vehicle")).notify).toBe(false);
    expect(decision(rule, event(PARKING, null)).notify).toBe(false);
  });

  it("TEST D: camera match but event mismatch does not match", () => {
    const rule = multiRule([PARKING], ["person"]);
    expect(decision(rule, event(PARKING, "vehicle")).decisions).toHaveLength(0);
    expect(decision(rule, event(PARKING, "vehicle")).notify).toBe(false);
  });

  it("TEST E: event match but camera mismatch does not match", () => {
    const rule = multiRule([PARKING], ["person"]);
    expect(decision(rule, event(RIGHT_SIDE, "person")).decisions).toHaveLength(0);
    expect(decision(rule, event(RIGHT_SIDE, "person")).notify).toBe(false);
  });

  it("TEST F: a legacy single-value rule keeps its exact behavior", () => {
    const legacy = baseRule({ cameraId: PARKING, eventType: "motion", classification: "person" });
    expect(legacy.cameraIds).toBeUndefined();
    expect(legacy.eventTypes).toBeUndefined();
    expect(decision(legacy, event(PARKING, "person")).notify).toBe(true);
    expect(decision(legacy, event(RIGHT_SIDE, "person")).notify).toBe(false);
    expect(decision(legacy, event(PARKING, "vehicle")).notify).toBe(false);
  });

  it("TEST G: all cameras uses the explicit four-id selection, not an empty array", () => {
    const rule = multiRule([PARKING, RIGHT_SIDE, FIRST_FLOOR, LEFT_SIDE], ["person"]);
    for (const cameraId of [PARKING, RIGHT_SIDE, FIRST_FLOOR, LEFT_SIDE]) {
      expect(decision(rule, event(cameraId, "person")).notify).toBe(true);
    }
    expect(decision(rule, event(PARKING, "vehicle")).notify).toBe(false);
    // An empty selection is never interpreted as all cameras.
    expect(decision(multiRule([], ["person"]), event(PARKING, "person")).notify).toBe(false);
  });

  it("TEST H: minimum priority still applies to a multi-select rule", () => {
    const rule = multiRule([PARKING, RIGHT_SIDE], ["person"], { minimumPriority: "HIGH" });
    expect(decision(rule, event(PARKING, "person", undefined, "HIGH")).notify).toBe(true);
    expect(decision(rule, event(RIGHT_SIDE, "person", undefined, "LOW")).notify).toBe(false);
  });

  it("TEST I: schedule still applies to a multi-select rule", () => {
    const rule = multiRule([PARKING, RIGHT_SIDE], ["person"], {
      scheduleStart: "08:00",
      scheduleEnd: "20:00",
    });
    expect(decision(rule, event(PARKING, "person"), INSIDE).notify).toBe(true);
    expect(decision(rule, event(PARKING, "person"), OUTSIDE_DAY_WINDOW).decisions).toHaveLength(0);
  });

  it("TEST J: quiet hours still apply to a multi-select rule", () => {
    const suppress = multiRule([PARKING, RIGHT_SIDE], ["person"], {
      quietHoursStart: "23:00",
      quietHoursEnd: "07:00",
      quietHoursBehavior: "suppress",
    });
    const storeOnly = multiRule([PARKING, RIGHT_SIDE], ["person"], {
      quietHoursStart: "23:00",
      quietHoursEnd: "07:00",
      quietHoursBehavior: "store_only",
    });
    const notifyAnyway = multiRule([PARKING, RIGHT_SIDE], ["person"], {
      quietHoursStart: "23:00",
      quietHoursEnd: "07:00",
      quietHoursBehavior: "notify",
    });

    const suppressed = decision(suppress, event(PARKING, "person"), NIGHT);
    expect(suppressed.notify).toBe(false);
    expect(suppressed.decisions[0]?.reason).toContain("quiet hours");

    const stored = decision(storeOnly, event(PARKING, "person"), NIGHT);
    expect(stored.notify).toBe(false);
    expect(stored.decisions[0]?.reason).toContain("without notifying");

    expect(decision(notifyAnyway, event(PARKING, "person"), NIGHT).notify).toBe(true);
    // Outside quiet hours all three behaviors notify.
    expect(decision(suppress, event(PARKING, "person"), INSIDE).notify).toBe(true);
  });

  it("TEST K: cooldown still applies across two matching events", () => {
    const store = memoryEventStore();
    const rule = multiRule([PARKING, RIGHT_SIDE], ["person"], { cooldownSeconds: 300 });
    store.saveRule(rule);
    const saved = store.rules().find((item) => item.id === "rule-test")!;
    // Notification rows use the real clock, so keep these events near "now" to
    // exercise the same cooldown window the production poll uses.
    const base = Date.now();
    const first = event(PARKING, "person", new Date(base - 60_000).toISOString());
    const second = event(RIGHT_SIDE, "person", new Date(base - 30_000).toISOString());
    for (const item of [first, second]) {
      store.insertEvent({
        id: item.id,
        dedupeKey: `dedupe-${item.id}`,
        cameraId: item.cameraId,
        type: "motion",
        classification: item.classification,
        timestamp: item.timestamp,
        endTimestamp: null,
        source: "hikvision",
        metaId: item.id,
        priority: item.priority,
      });
    }

    const atFirst = new Date(first.timestamp);
    const firstEvaluation = evaluateRules([saved], first, atFirst, {
      cooldownActive: (candidate) =>
        cooldownBlocks(candidate, store.countSentSince(candidate.id, new Date(atFirst.getTime() - 300_000).toISOString())),
    });
    expect(recordNotificationDecisions({ store, event: first, evaluation: firstEvaluation, priority: "HIGH" }).delivered).toBe(
      true,
    );

    const atSecond = new Date(second.timestamp);
    const secondEvaluation = evaluateRules([saved], second, atSecond, {
      cooldownActive: (candidate) =>
        cooldownBlocks(
          candidate,
          store.countSentSince(candidate.id, cooldownWindowStart(candidate, atSecond).toISOString()),
        ),
    });
    expect(secondEvaluation.notify).toBe(false);
    expect(secondEvaluation.decisions[0]?.reason).toContain("Cooldown");
    expect(
      recordNotificationDecisions({ store, event: second, evaluation: secondEvaluation, priority: "HIGH" }).delivered,
    ).toBe(false);

    const stats = store.notificationStats("2000-01-01T00:00:00+05:30", "2030-01-01T00:00:00+05:30");
    expect(stats.sent).toBe(1);
    expect(stats.suppressed).toBe(1);
  });

  it("TEST L: duplicate protection records the same event/rule decision once", () => {
    const store = memoryEventStore();
    const rule = multiRule([PARKING], ["person"]);
    store.saveRule(rule);
    const saved = store.rules().find((item) => item.id === "rule-test")!;
    const input = event(PARKING, "person");
    store.insertEvent({
      id: input.id,
      dedupeKey: "dedupe-duplicate",
      cameraId: input.cameraId,
      type: "motion",
      classification: input.classification,
      timestamp: input.timestamp,
      endTimestamp: null,
      source: "hikvision",
      metaId: input.id,
      priority: input.priority,
    });

    const evaluation = evaluateRules([saved], input, INSIDE);
    const first = recordNotificationDecisions({ store, event: input, evaluation, priority: "HIGH" });
    const second = recordNotificationDecisions({ store, event: input, evaluation, priority: "HIGH" });
    expect(first.delivered).toBe(true);
    expect(first.recorded).toBe(1);
    expect(second.delivered).toBe(false);
    expect(second.recorded).toBe(0);
    expect(store.notificationStats("2000-01-01T00:00:00+05:30", "2030-01-01T00:00:00+05:30").sent).toBe(1);
  });
});

describe("notification pipeline integration", () => {
  it("turns a matching multi-select event into SENT and a non-matching event into no notification", () => {
    const store = memoryEventStore();
    store.saveRule(multiRule([PARKING, RIGHT_SIDE], ["person", "vehicle"]));
    const saved = store.rules().find((item) => item.id === "rule-test")!;

    const matching = event(PARKING, "person", "2026-10-07T10:00:00+05:30");
    const nonMatching = event(FIRST_FLOOR, "person", "2026-10-07T10:01:00+05:30");
    for (const item of [matching, nonMatching]) {
      store.insertEvent({
        id: item.id,
        dedupeKey: `dedupe-${item.id}`,
        cameraId: item.cameraId,
        type: "motion",
        classification: item.classification,
        timestamp: item.timestamp,
        endTimestamp: null,
        source: "hikvision",
        metaId: item.id,
        priority: item.priority,
      });
    }

    const sent = recordNotificationDecisions({
      store,
      event: matching,
      evaluation: evaluateRules([saved], matching, new Date(matching.timestamp)),
      priority: "HIGH",
    });
    expect(sent.delivered).toBe(true);
    expect(store.get(matching.id)?.notified).toBe(true);

    const silent = recordNotificationDecisions({
      store,
      event: nonMatching,
      evaluation: evaluateRules([saved], nonMatching, new Date(nonMatching.timestamp)),
      priority: "HIGH",
    });
    expect(silent.delivered).toBe(false);
    expect(store.get(nonMatching.id)?.notified).toBe(false);

    const history = store.notifications({
      start: "2000-01-01T00:00:00+05:30",
      end: "2030-01-01T00:00:00+05:30",
      cameraId: null,
      status: null,
      priority: null,
      page: 1,
      pageSize: 20,
    });
    expect(history.total).toBe(2);
    expect(history.notifications.find((row) => row.eventId === matching.id)?.status).toBe("sent");
    expect(history.notifications.find((row) => row.eventId === nonMatching.id)?.status).toBe("suppressed");
    expect(history.notifications.find((row) => row.eventId === nonMatching.id)?.reason).toBe(
      "No notification rule matched",
    );
  });

  it("dry-run uses the same multi-select matcher for every combination", () => {
    const rules = [multiRule([PARKING, RIGHT_SIDE], ["person", "vehicle"])];
    const cases: Array<[number, EventClassification | null, boolean]> = [
      [PARKING, "person", true],
      [PARKING, "vehicle", true],
      [RIGHT_SIDE, "person", true],
      [RIGHT_SIDE, "vehicle", true],
      [FIRST_FLOOR, "person", false],
    ];
    for (const [cameraId, classification, expected] of cases) {
      const result = evaluateRules(rules, event(cameraId, classification), INSIDE);
      expect(result.notify, `camera ${cameraId} / ${classification ?? "motion"}`).toBe(expected);
    }
  });
});
