import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { isEventType, type EventClassification } from "@/lib/events";
import { defaultPriority, isEventPriority, type EventPriority } from "@/lib/priority";
import { parseClock, todayInKolkata } from "@/lib/time-kolkata";
import { openEventStore } from "@/server/events/event-store";
import { evaluateRules } from "@/server/events/rule-engine";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Dry-run the rule engine. ADMIN-only. This never inserts an event and never
 * records a notification: it answers "would a rule match this event?" so a rule
 * can be checked before it is trusted.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "Invalid test input" }, { status: 400 });
  }

  const cameraId = raw.cameraId === 1 || raw.cameraId === 2 || raw.cameraId === 3 || raw.cameraId === 4
    ? raw.cameraId
    : 1;
  const type = typeof raw.type === "string" && isEventType(raw.type) ? raw.type : "motion";
  const classification: EventClassification | null =
    raw.classification === "person" || raw.classification === "vehicle" ? raw.classification : null;
  const priority: EventPriority =
    typeof raw.priority === "string" && isEventPriority(raw.priority)
      ? raw.priority
      : defaultPriority(type, classification);

  // Default to "now", but accept a HH:MM clock so overnight and quiet-hour
  // behaviour can be checked without waiting for the clock.
  let at = new Date();
  if (typeof raw.time === "string") {
    const clock = parseClock(raw.time);
    if (!clock) return NextResponse.json({ error: "Invalid time" }, { status: 400 });
    const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : todayInKolkata();
    const parsed = new Date(`${date}T${clock}:00+05:30`);
    if (Number.isNaN(parsed.getTime())) return NextResponse.json({ error: "Invalid time" }, { status: 400 });
    at = parsed;
  }

  const store = openEventStore(getConfig().dataDir);
  const rules = store.rules();
  const result = evaluateRules(
    rules,
    { id: "test", cameraId, type, classification, timestamp: at.toISOString(), priority },
    at,
  );

  const noMatch = result.decisions.length === 0;
  return NextResponse.json({
    evaluatedAt: at.toISOString(),
    matched: !noMatch,
    priority: result.priority,
    notify: result.notify,
    message: noMatch
      ? "No enabled rule matches this event. The event would still be stored."
      : result.notify
        ? "A browser notification would be raised."
        : "The event would be stored without a notification.",
    decisions: result.decisions.map((decision) => ({
      ruleId: decision.ruleId,
      ruleName: decision.ruleName,
      notify: decision.notify,
      reason: decision.reason,
    })),
    ruleCount: rules.length,
  });
}