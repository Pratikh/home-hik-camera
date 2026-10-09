import type { EventClassification, EventType, NotificationRule, QuietHoursBehavior } from "@/lib/events";
import { inQuietHours, inSchedule, ruleMatches } from "@/lib/events";
import { atLeast, defaultPriority, isImportant, maxPriority, type EventPriority } from "@/lib/priority";

/**
 * A normalized event as the rule engine sees it. The DVR is the detector;
 * this is only what the hub already stored or is about to store.
 */
export type RuleInput = {
  id: string;
  cameraId: number;
  type: EventType;
  classification: EventClassification | null;
  timestamp: string;
  priority?: EventPriority;
};

export type RuleDecision = {
  ruleId: string;
  ruleName: string;
  priority: EventPriority;
  /** Whether a browser notification should be raised. */
  notify: boolean;
  status: "sent" | "suppressed";
  reason: string | null;
};

export type EvaluationResult = {
  /** Effective priority for the event after every matching rule is considered. */
  priority: EventPriority;
  decisions: RuleDecision[];
  /** True when at least one rule asks for a notification. */
  notify: boolean;
  /** Rules that matched but chose to store only, or were suppressed. */
  suppressedCount: number;
};

const REASON_QUIET = "Suppressed by quiet hours";
const REASON_STORE_ONLY = "Rule stores the event without notifying";
const REASON_PRIORITY = "Event priority is below the rule minimum";

/**
 * Pure evaluation of every enabled rule against one event.
 *
 * This decides *what should happen*; persistence and cooldown bookkeeping stay
 * in the caller so the same function can be unit tested with no database and
 * reused by the "test rule" endpoint.
 */
export function evaluateRules(
  rules: readonly NotificationRule[],
  event: RuleInput,
  at: Date,
  options?: { cooldownActive?: (rule: NotificationRule) => boolean },
): EvaluationResult {
  const basePriority = event.priority ?? defaultPriority(event.type, event.classification);
  let priority = basePriority;
  const decisions: RuleDecision[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!ruleMatches(rule, event)) continue;
    // A rule may raise the event's importance, never lower another rule's floor.
    if (rule.minimumPriority) priority = maxPriority(priority, rule.minimumPriority);
    if (!inSchedule(rule, at)) continue;
    if (rule.minimumPriority && !atLeast(basePriority, rule.minimumPriority)) {
      decisions.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: basePriority,
        notify: false,
        status: "suppressed",
        reason: REASON_PRIORITY,
      });
      continue;
    }

    const behavior = effectiveBehavior(rule, at);
    if (behavior === "store_only") {
      decisions.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: basePriority,
        notify: false,
        status: "suppressed",
        reason: REASON_STORE_ONLY,
      });
      continue;
    }
    if (behavior === "suppress") {
      decisions.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: basePriority,
        notify: false,
        status: "suppressed",
        reason: inQuietHours(rule.quietHoursStart, rule.quietHoursEnd, at) ? REASON_QUIET : REASON_STORE_ONLY,
      });
      continue;
    }
    if (options?.cooldownActive?.(rule)) {
      decisions.push({
        ruleId: rule.id,
        ruleName: rule.name,
        priority: basePriority,
        notify: false,
        status: "suppressed",
        reason: "Cooldown active for this rule",
      });
      continue;
    }
    decisions.push({
      ruleId: rule.id,
      ruleName: rule.name,
      priority: basePriority,
      notify: true,
      status: "sent",
      reason: null,
    });
  }

  const notify = decisions.some((decision) => decision.notify);
  return {
    priority,
    decisions,
    notify,
    suppressedCount: decisions.filter((decision) => !decision.notify).length,
  };
}

/**
 * Quiet hours only change the notification decision. The event is stored either
 * way, and a rule can opt to keep notifying, to suppress, or to store silently.
 */
function effectiveBehavior(rule: NotificationRule, at: Date): QuietHoursBehavior {
  if (!inQuietHours(rule.quietHoursStart, rule.quietHoursEnd, at)) return "notify";
  return rule.quietHoursBehavior;
}

/**
 * Cooldown gate. The caller supplies already-sent counts from
 * notification_history, so this stays pure and testable.
 */
export function cooldownBlocks(rule: NotificationRule, sentInWindow: number): boolean {
  if (rule.cooldownSeconds <= 0) return false;
  return sentInWindow > 0;
}

export function cooldownWindowStart(rule: NotificationRule, at: Date): Date {
  return new Date(at.getTime() - rule.cooldownSeconds * 1000);
}

export function shouldSurfaceOnDashboard(event: RuleInput, priority?: EventPriority): boolean {
  return isImportant(priority ?? event.priority ?? defaultPriority(event.type, event.classification));
}