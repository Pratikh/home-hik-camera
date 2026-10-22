import { describe, expect, it, vi } from "vitest";
import { type EventClassification, type NotificationRule, type RuleEventType } from "@/lib/events";
import type { EventPriority } from "@/lib/priority";
import { memoryEventStore } from "@/server/events/event-store";
import { recordNotificationDecisions } from "@/server/events/notification-decisions";
import { evaluateRules, type RuleInput } from "@/server/events/rule-engine";
import { deliverTelegramEvent } from "@/server/events/telegram-event";
import type { TelegramEventInput, TelegramResult } from "@/server/notifications/telegram";

/**
 * Rule → Telegram delivery. The sender is always mocked; no test contacts
 * Telegram. Matching itself is covered by the rule-engine suite; these tests
 * prove that only a real accepted rule decision reaches the sender and that a
 * rule update is picked up by the next event.
 */

const PARKING = 1;
const RIGHT_SIDE = 2;
const AT = "2026-10-22T13:39:39+05:30";

const CONFIG = {
  telegramNotificationsEnabled: true,
  telegramEventNotifications: true,
  telegramBotToken: "fake-token",
  telegramChatId: "-1001234567890",
  telegramFaceNotifications: false,
};

function rule(cameraIds: number[], eventTypes: RuleEventType[]): NotificationRule {
  return {
    id: "rule-telegram",
    name: "Telegram rule",
    enabled: true,
    cameraIds,
    eventTypes,
    cameraId: cameraIds.length === 1 ? cameraIds[0]! : null,
    eventType: "motion",
    classification: eventTypes.length === 1 ? (eventTypes[0] === "motion" ? "" : eventTypes[0]) : null,
    minimumPriority: null,
    scheduleStart: null,
    scheduleEnd: null,
    daysOfWeek: [],
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursBehavior: "suppress",
    cooldownSeconds: 0,
  };
}

/** A stored event always carries a resolved priority; the rule input keeps it optional. */
type StoredEvent = RuleInput & { priority: EventPriority };

let sequence = 0;
function event(cameraId: number, classification: EventClassification | null = "person"): StoredEvent {
  sequence += 1;
  return {
    id: `evt_tg_${sequence.toString().padStart(4, "0")}`,
    cameraId,
    type: "motion",
    classification,
    timestamp: AT,
    priority: "HIGH",
  };
}

function insert(store: ReturnType<typeof memoryEventStore>, item: RuleInput): void {
  store.insertEvent({
    id: item.id,
    dedupeKey: `dedupe-${item.id}`,
    cameraId: item.cameraId,
    type: item.type,
    classification: item.classification,
    timestamp: item.timestamp,
    endTimestamp: null,
    source: "hikvision",
    metaId: item.id,
    priority: item.priority,
  });
}

const OK: TelegramResult = { ok: true, status: "sent" };

describe("rule notifications to Telegram", () => {
  it("sends once for an accepted matching rule, with the real event and rule", async () => {
    const store = memoryEventStore();
    for (const seeded of store.rules()) store.deleteRule(seeded.id);
    store.saveRule(rule([PARKING], ["person"]));
    const saved = store.rules()[0]!;
    const input = event(PARKING);
    insert(store, input);

    const sender = vi.fn<(payload: TelegramEventInput) => Promise<TelegramResult>>(async () => OK);
    const evaluation = evaluateRules([saved], input, new Date(input.timestamp));
    const decision = recordNotificationDecisions({ store, event: input, evaluation, priority: "HIGH" });
    expect(decision.delivered).toBe(true);

    const delivery = await deliverTelegramEvent({
      event: input,
      cameraName: "Parking",
      ruleName: decision.deliveredRuleNames[0],
      config: CONFIG,
      telegram: sender,
    });

    expect(delivery).toBe("sent");
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]![0]).toEqual({
      cameraName: "Parking",
      type: "motion",
      classification: "person",
      priority: "HIGH",
      eventTimestamp: AT,
      ruleName: "Telegram rule",
    });
  });

  it("does not send when the rule does not match", async () => {
    const store = memoryEventStore();
    for (const seeded of store.rules()) store.deleteRule(seeded.id);
    store.saveRule(rule([RIGHT_SIDE], ["person"]));
    const saved = store.rules()[0]!;
    const input = event(PARKING);
    insert(store, input);

    const sender = vi.fn(async () => OK);
    const evaluation = evaluateRules([saved], input, new Date(input.timestamp));
    const decision = recordNotificationDecisions({ store, event: input, evaluation, priority: "HIGH" });
    expect(decision.delivered).toBe(false);
    if (decision.delivered) {
      await deliverTelegramEvent({ event: input, cameraName: "Parking", config: CONFIG, telegram: sender });
    }
    expect(sender).not.toHaveBeenCalled();
  });

  it("uses the updated rule for the next event", async () => {
    const store = memoryEventStore();
    for (const seeded of store.rules()) store.deleteRule(seeded.id);
    store.saveRule(rule([PARKING], ["person"]));
    const sender = vi.fn(async () => OK);

    const first = event(PARKING);
    insert(store, first);
    let saved = store.rules()[0]!;
    let decision = recordNotificationDecisions({
      store,
      event: first,
      evaluation: evaluateRules([saved], first, new Date(first.timestamp)),
      priority: "HIGH",
    });
    let delivery = await deliverTelegramEvent({
      event: first,
      cameraName: "Parking",
      config: CONFIG,
      telegram: sender,
    });
    expect(decision.delivered).toBe(true);
    expect(delivery).toBe("sent");
    expect(sender).toHaveBeenCalledTimes(1);

    // Change the same rule to the other camera. The next event must use it.
    store.saveRule({ ...saved, cameraIds: [RIGHT_SIDE], cameraId: RIGHT_SIDE });
    saved = store.rules()[0]!;
    expect(saved.cameraIds).toEqual([RIGHT_SIDE]);

    const stillParking = event(PARKING);
    insert(store, stillParking);
    decision = recordNotificationDecisions({
      store,
      event: stillParking,
      evaluation: evaluateRules([saved], stillParking, new Date(stillParking.timestamp)),
      priority: "HIGH",
    });
    expect(decision.delivered).toBe(false);
    expect(sender).toHaveBeenCalledTimes(1);

    const rightSide = event(RIGHT_SIDE);
    insert(store, rightSide);
    decision = recordNotificationDecisions({
      store,
      event: rightSide,
      evaluation: evaluateRules([saved], rightSide, new Date(rightSide.timestamp)),
      priority: "HIGH",
    });
    expect(decision.delivered).toBe(true);
    delivery = await deliverTelegramEvent({
      event: rightSide,
      cameraName: "Right Side Outside Camera",
      config: CONFIG,
      telegram: sender,
    });
    expect(delivery).toBe("sent");
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it("does not send when the master switch or the rule-event flag is off", async () => {
    const sender = vi.fn(async () => OK);
    const input = event(PARKING);
    const disabledMaster = await deliverTelegramEvent({
      event: input,
      cameraName: "Parking",
      config: { ...CONFIG, telegramNotificationsEnabled: false },
      telegram: sender,
    });
    const disabledEvents = await deliverTelegramEvent({
      event: input,
      cameraName: "Parking",
      config: { ...CONFIG, telegramEventNotifications: false },
      telegram: sender,
    });
    expect(disabledMaster).toBe("disabled");
    expect(disabledEvents).toBe("disabled");
    expect(sender).not.toHaveBeenCalled();
  });

  it("keeps the face and rule channels independent", async () => {
    const sender = vi.fn(async () => OK);
    const result = await deliverTelegramEvent({
      event: event(PARKING),
      cameraName: "Parking",
      config: { ...CONFIG, telegramFaceNotifications: false },
      telegram: sender,
    });
    expect(result).toBe("sent");
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it("contains a failed or throwing sender without changing the recorded decision", async () => {
    const store = memoryEventStore();
    for (const seeded of store.rules()) store.deleteRule(seeded.id);
    store.saveRule(rule([PARKING], ["person"]));
    const saved = store.rules()[0]!;
    const input = event(PARKING);
    insert(store, input);
    const decision = recordNotificationDecisions({
      store,
      event: input,
      evaluation: evaluateRules([saved], input, new Date(input.timestamp)),
      priority: "HIGH",
    });
    expect(decision.delivered).toBe(true);
    // The existing ordering records the browser/rule decision before delivery.
    expect(store.notificationStats("2000-01-01T00:00:00+05:30", "2030-01-01T00:00:00+05:30").sent).toBe(1);

    const failed = await deliverTelegramEvent({
      event: input,
      cameraName: "Parking",
      config: CONFIG,
      telegram: async () => ({ ok: false, status: "http_error", detail: "HTTP 500" }),
    });
    const thrown = await deliverTelegramEvent({
      event: input,
      cameraName: "Parking",
      config: CONFIG,
      telegram: async () => {
        throw new Error("network down");
      },
    });
    expect(failed).toBe("failed");
    expect(thrown).toBe("failed");
    // The decision is unchanged; Telegram failure is delivery-only.
    expect(store.notificationStats("2000-01-01T00:00:00+05:30", "2030-01-01T00:00:00+05:30").sent).toBe(1);
  });

  it("sends no Telegram for a second event suppressed by cooldown or a duplicate", async () => {
    const sender = vi.fn(async () => OK);
    const store = memoryEventStore();
    for (const seeded of store.rules()) store.deleteRule(seeded.id);
    store.saveRule(rule([PARKING], ["person"]));
    const saved = store.rules()[0]!;

    const first = event(PARKING);
    insert(store, first);
    const firstDecision = recordNotificationDecisions({
      store,
      event: first,
      evaluation: evaluateRules([saved], first, new Date(first.timestamp)),
      priority: "HIGH",
    });
    expect(firstDecision.delivered).toBe(true);
    if (firstDecision.delivered) {
      await deliverTelegramEvent({ event: first, cameraName: "Parking", config: CONFIG, telegram: sender });
    }

    // Same event/rule again: duplicate protection returns no fresh decision.
    const duplicate = recordNotificationDecisions({
      store,
      event: first,
      evaluation: evaluateRules([saved], first, new Date(first.timestamp)),
      priority: "HIGH",
    });
    expect(duplicate.delivered).toBe(false);

    // A new event during cooldown is suppressed by the rule engine.
    const second = event(PARKING);
    insert(store, second);
    const cooldownDecision = recordNotificationDecisions({
      store,
      event: second,
      evaluation: evaluateRules([saved], second, new Date(second.timestamp), {
        cooldownActive: () => true,
      }),
      priority: "HIGH",
    });
    expect(cooldownDecision.delivered).toBe(false);
    expect(sender).toHaveBeenCalledTimes(1);
  });
});
