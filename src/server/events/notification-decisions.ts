import type { EventPriority } from "@/lib/priority";
import type { EventStore } from "@/server/events/event-store";
import type { EvaluationResult } from "@/server/events/rule-engine";

/**
 * Persist the rule-engine decisions for one stored event.
 *
 * This is the pipeline step after `evaluateRules`: every decision becomes one
 * `notification_history` row, the unique (event_id, rule_id) index is the
 * duplicate guard, and `events.notified` marks that at least one target was
 * asked to deliver. Keeping it here makes the real pipeline callable from tests
 * without polling the DVR or sending a browser/Telegram notification.
 */
export function recordNotificationDecisions(input: {
  store: EventStore;
  event: { id: string; cameraId: number; timestamp: string };
  evaluation: EvaluationResult;
  /** Base priority, used for the "no rule matched" row. */
  priority: EventPriority;
}): { delivered: boolean; recorded: number; deliveredRuleNames: string[] } {
  const { store, event, evaluation, priority } = input;
  let delivered = false;
  let recorded = 0;
  const deliveredRuleNames: string[] = [];

  for (const decision of evaluation.decisions) {
    const fresh = store.recordNotification({
      eventId: event.id,
      ruleId: decision.ruleId,
      ruleName: decision.ruleName,
      cameraId: event.cameraId,
      priority: decision.priority,
      status: decision.notify ? "sent" : "suppressed",
      reason: decision.reason,
      eventTimestamp: event.timestamp,
    });
    if (!fresh) continue;
    recorded += 1;
    if (decision.notify) {
      delivered = true;
      deliveredRuleNames.push(decision.ruleName);
      console.info("[events] Notification rule matched");
    } else if (decision.reason) {
      console.info("[events] Notification suppressed", decision.reason);
    }
  }

  if (evaluation.decisions.length === 0) {
    store.recordNotification({
      eventId: event.id,
      ruleId: null,
      ruleName: null,
      cameraId: event.cameraId,
      priority,
      status: "suppressed",
      reason: "No notification rule matched",
      eventTimestamp: event.timestamp,
    });
    recorded += 1;
  }
  if (delivered) store.markNotified(event.id);
  return { delivered, recorded, deliveredRuleNames };
}
