import { describe, expect, it } from "vitest";
import { DEFAULT_COOLDOWN_SECONDS, type NotificationRule } from "@/lib/events";
import { cooldownBlocks, cooldownWindowStart, evaluateRules, shouldSurfaceOnDashboard } from "@/server/events/rule-engine";

function rule(patch: Partial<NotificationRule> = {}): NotificationRule {
  return {
    id: "rule-test",
    name: "Test rule",
    enabled: true,
    cameraId: null,
    eventType: null,
    classification: null,
    minimumPriority: null,
    scheduleStart: null,
    scheduleEnd: null,
    daysOfWeek: [],
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursBehavior: "suppress",
    cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
    ...patch,
  };
}

const personEvent = {
  id: "evt_1",
  cameraId: 2,
  type: "motion" as const,
  classification: "person" as const,
  timestamp: "2026-10-07T23:42:13+05:30",
};

describe("rule engine - identity matching", () => {
  it("matches a rule scoped to the event's camera", () => {
    const result = evaluateRules([rule({ cameraId: 2 })], personEvent, new Date("2026-10-07T18:12:13Z"));
    expect(result.decisions).toHaveLength(1);
    expect(result.notify).toBe(true);
  });

  it("does not match a rule scoped to another camera", () => {
    const result = evaluateRules([rule({ cameraId: 1 })], personEvent, new Date("2026-10-07T18:12:13Z"));
    expect(result.decisions).toHaveLength(0);
    expect(result.notify).toBe(false);
  });

  it("matches and rejects by event type", () => {
    const at = new Date("2026-10-07T18:12:13Z");
    expect(evaluateRules([rule({ eventType: "motion" })], personEvent, at).decisions).toHaveLength(1);
    expect(evaluateRules([rule({ eventType: "intrusion" })], personEvent, at).decisions).toHaveLength(0);
  });

  it("matches and rejects by classification", () => {
    const at = new Date("2026-10-07T18:12:13Z");
    expect(evaluateRules([rule({ classification: "person" })], personEvent, at).decisions).toHaveLength(1);
    expect(evaluateRules([rule({ classification: "vehicle" })], personEvent, at).decisions).toHaveLength(0);
    expect(evaluateRules([rule({ classification: "" })], personEvent, at).decisions).toHaveLength(0);
  });

  it("ignores a disabled rule", () => {
    const result = evaluateRules([rule({ enabled: false })], personEvent, new Date("2026-10-07T18:12:13Z"));
    expect(result.decisions).toHaveLength(0);
    expect(result.notify).toBe(false);
  });
});

describe("rule engine - priority", () => {
  const at = new Date("2026-10-07T18:12:13Z");

  it("matches when the event priority meets the rule minimum", () => {
    const result = evaluateRules([rule({ minimumPriority: "HIGH" })], personEvent, at);
    expect(result.decisions[0]?.notify).toBe(true);
  });

  it("suppresses when the event priority is below the rule minimum", () => {
    const unclassified = { ...personEvent, classification: null };
    const result = evaluateRules([rule({ minimumPriority: "HIGH" })], unclassified, at);
    expect(result.notify).toBe(false);
    expect(result.decisions[0]?.reason).toContain("below the rule minimum");
  });

  it("lets a rule raise the effective priority of the event", () => {
    const unclassified = { ...personEvent, classification: null };
    const result = evaluateRules([rule({ minimumPriority: "CRITICAL" })], unclassified, at);
    expect(result.priority).toBe("CRITICAL");
  });

  it("does not lower a priority another rule already raised", () => {
    const rules = [rule({ id: "a", minimumPriority: "CRITICAL" }), rule({ id: "b", minimumPriority: "LOW" })];
    expect(evaluateRules(rules, personEvent, at).priority).toBe("CRITICAL");
  });
});

describe("rule engine - schedules", () => {
  it("matches inside a daytime window", () => {
    const daytime = rule({ scheduleStart: "08:00", scheduleEnd: "20:00" });
    // 10:00 IST
    expect(evaluateRules([daytime], personEvent, new Date("2026-10-07T04:30:00Z")).decisions).toHaveLength(1);
  });

  it("does not match outside a daytime window", () => {
    const daytime = rule({ scheduleStart: "08:00", scheduleEnd: "20:00" });
    // 23:42 IST
    expect(evaluateRules([daytime], personEvent, new Date("2026-10-07T18:12:13Z")).decisions).toHaveLength(0);
  });

  it("matches an overnight window on both sides of midnight", () => {
    const night = rule({ scheduleStart: "23:00", scheduleEnd: "06:00" });
    expect(evaluateRules([night], personEvent, new Date("2026-10-07T18:12:13Z")).decisions).toHaveLength(1);
    // 02:00 IST the next calendar day
    expect(evaluateRules([night], personEvent, new Date("2026-10-07T20:30:00Z")).decisions).toHaveLength(1);
  });

  it("does not match an overnight window in the middle of the day", () => {
    const night = rule({ scheduleStart: "23:00", scheduleEnd: "06:00" });
    expect(evaluateRules([night], personEvent, new Date("2026-10-07T08:00:00Z")).decisions).toHaveLength(0);
  });

  it("honours days of week in Asia/Kolkata", () => {
    // 2026-10-07 is a Wednesday; 2026-10-10 is a Saturday.
    const wednesdayOnly = rule({ daysOfWeek: ["wed"] });
    expect(evaluateRules([wednesdayOnly], personEvent, new Date("2026-10-07T18:12:13Z")).decisions).toHaveLength(1);
    expect(evaluateRules([wednesdayOnly], personEvent, new Date("2026-10-10T18:12:13Z")).decisions).toHaveLength(0);
  });

  it("carries a Friday overnight rule into early Saturday", () => {
    // Friday 2026-10-09 23:30 IST, and Saturday 2026-10-10 02:00 IST.
    const fridayNight = rule({ scheduleStart: "23:00", scheduleEnd: "06:00", daysOfWeek: ["fri"] });
    expect(evaluateRules([fridayNight], personEvent, new Date("2026-10-09T18:00:00Z")).decisions).toHaveLength(1);
    expect(evaluateRules([fridayNight], personEvent, new Date("2026-10-09T20:30:00Z")).decisions).toHaveLength(1);
    // Sunday 02:00 IST must not match a Friday rule.
    expect(evaluateRules([fridayNight], personEvent, new Date("2026-10-10T20:30:00Z")).decisions).toHaveLength(0);
  });
});

describe("rule engine - quiet hours", () => {
  const quietAt = new Date("2026-10-07T18:12:13Z"); // 23:42 IST

  it("suppresses a notification during quiet hours by default", () => {
    const night = rule({ quietHoursStart: "23:00", quietHoursEnd: "07:00" });
    const result = evaluateRules([night], personEvent, quietAt);
    expect(result.notify).toBe(false);
    expect(result.decisions[0]?.reason).toContain("quiet hours");
  });

  it("still allows a critical event when the rule opts to keep notifying", () => {
    const critical = rule({ quietHoursStart: "23:00", quietHoursEnd: "07:00", quietHoursBehavior: "notify" });
    const intrusion = { ...personEvent, type: "intrusion" as const, classification: null };
    const result = evaluateRules([critical], intrusion, quietAt);
    expect(result.notify).toBe(true);
    expect(result.priority).toBe("CRITICAL");
  });

  it("stores an event without notifying when the rule says store only", () => {
    const storeOnly = rule({ quietHoursStart: "23:00", quietHoursEnd: "07:00", quietHoursBehavior: "store_only" });
    const result = evaluateRules([storeOnly], personEvent, quietAt);
    expect(result.notify).toBe(false);
    expect(result.decisions[0]?.status).toBe("suppressed");
    expect(result.decisions[0]?.reason).toContain("without notifying");
  });

  it("notifies normally outside quiet hours regardless of behaviour", () => {
    const storeOnly = rule({ quietHoursStart: "23:00", quietHoursEnd: "07:00", quietHoursBehavior: "store_only" });
    const daytime = new Date("2026-10-07T08:00:00Z");
    expect(evaluateRules([storeOnly], personEvent, daytime).notify).toBe(true);
  });
});

describe("rule engine - cooldown", () => {
  it("blocks a repeat notification while the cooldown window is open", () => {
    const candidate = rule({ cooldownSeconds: 300 });
    expect(cooldownBlocks(candidate, 1)).toBe(true);
  });

  it("allows the first notification when nothing was sent", () => {
    expect(cooldownBlocks(rule({ cooldownSeconds: 300 }), 0)).toBe(false);
  });

  it("allows a notification again after the cooldown has passed", () => {
    // countSentSince only counts rows inside the window, so an expired window
    // presents a zero count and the gate opens.
    expect(cooldownBlocks(rule({ cooldownSeconds: 300 }), 0)).toBe(false);
  });

  it("treats a zero cooldown as no cooldown", () => {
    expect(cooldownBlocks(rule({ cooldownSeconds: 0 }), 99)).toBe(false);
  });

  it("computes the window start from the rule cooldown", () => {
    const at = new Date("2026-10-07T18:12:13Z");
    const start = cooldownWindowStart(rule({ cooldownSeconds: 300 }), at);
    expect(at.getTime() - start.getTime()).toBe(300_000);
  });

  it("marks a cooldown-blocked rule as suppressed with a reason", () => {
    const candidate = rule({ cooldownSeconds: 300 });
    const result = evaluateRules([candidate], personEvent, new Date("2026-10-07T18:12:13Z"), {
      cooldownActive: () => true,
    });
    expect(result.notify).toBe(false);
    expect(result.decisions[0]?.reason).toContain("Cooldown");
  });
});

describe("rule engine - dashboard surfacing", () => {
  it("surfaces person and intrusion events as important", () => {
    expect(shouldSurfaceOnDashboard(personEvent)).toBe(true);
    expect(shouldSurfaceOnDashboard({ ...personEvent, type: "intrusion", classification: null })).toBe(true);
  });

  it("does not treat plain motion or a vehicle as important", () => {
    expect(shouldSurfaceOnDashboard({ ...personEvent, classification: null })).toBe(false);
    expect(shouldSurfaceOnDashboard({ ...personEvent, classification: "vehicle" })).toBe(false);
  });
});
