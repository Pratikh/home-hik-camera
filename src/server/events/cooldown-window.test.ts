import { describe, expect, it } from "vitest";
import { memoryEventStore } from "@/server/events/event-store";

/**
 * Regression: notification_history.created_at is a UTC ISO string while the
 * cooldown window is formatted in IST (+05:30). Comparing them as strings made
 * the window empty across the offset boundary, so cooldown never fired. Compare
 * instants instead.
 */

function insertSent(store: ReturnType<typeof memoryEventStore>, ruleId: string, createdAt: string) {
  store.db
    .prepare(
      `INSERT INTO notification_history
         (id, event_id, rule_id, rule_name, camera_id, priority, status, reason, created_at, event_timestamp)
       VALUES (?, 'evt_x', ?, 'rule', 1, 'HIGH', 'sent', NULL, ?, '2026-10-23T17:30:00+05:30')`,
    )
    .run(`row-${ruleId}-${createdAt}`, ruleId, createdAt);
}

describe("countSentSince", () => {
  it("counts a sent decision created at 17:30 IST inside a window expressed in IST", () => {
    const store = memoryEventStore();
    // 12:00Z is 17:30 IST.
    insertSent(store, "rule-a", "2026-10-23T12:00:00.000Z");
    expect(store.countSentSince("rule-a", "2026-10-23T17:00:00+05:30")).toBe(1);
    expect(store.countSentSince("rule-a", "2026-10-23T17:31:00+05:30")).toBe(0);
  });

  it("does not count an older decision outside the window", () => {
    const store = memoryEventStore();
    insertSent(store, "rule-b", "2026-10-23T11:00:00.000Z"); // 16:30 IST
    expect(store.countSentSince("rule-b", "2026-10-23T17:00:00+05:30")).toBe(0);
  });
});
