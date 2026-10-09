import {
  DEFAULT_COOLDOWN_SECONDS,
  isSupportedEventType,
  MAX_COOLDOWN_SECONDS,
  QUIET_BEHAVIORS,
  WEEKDAYS,
  type EventClassification,
  type NotificationRule,
  type QuietHoursBehavior,
  type Weekday,
} from "@/lib/events";
import { isEventPriority, type EventPriority } from "@/lib/priority";
import { parseClock } from "@/lib/time-kolkata";

/**
 * Parse an untrusted rule body into a NotificationRule.
 * Every field that reaches the database is validated here; nothing is trusted
 * from the browser, including camera ids and the rule id itself.
 */
export function parseRuleBody(value: unknown, id: string): NotificationRule | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (body.name !== undefined && typeof body.name !== "string") return null;

  // A rule may only target an event type this DVR actually produces. Other types
// in the model (alarm, intrusion, …) are not offered and are rejected so a rule
// can never silently match nothing.
  const eventType =
    body.eventType === null || body.eventType === undefined || body.eventType === ""
      ? null
      : typeof body.eventType === "string" && isSupportedEventType(body.eventType)
        ? body.eventType
        : undefined;
  if (eventType === undefined) return null;

  const classification: EventClassification | "" | null | undefined =
    body.classification === null || body.classification === undefined
      ? null
      : body.classification === "" || body.classification === "person" || body.classification === "vehicle"
        ? body.classification
        : undefined;
  if (classification === undefined) return null;

  const cameraId =
    body.cameraId === null || body.cameraId === undefined
      ? null
      : body.cameraId === 1 || body.cameraId === 2 || body.cameraId === 3 || body.cameraId === 4
        ? body.cameraId
        : undefined;
  if (cameraId === undefined) return null;

  const minimumPriority: EventPriority | null | undefined =
    body.minimumPriority === null || body.minimumPriority === undefined || body.minimumPriority === ""
      ? null
      : typeof body.minimumPriority === "string" && isEventPriority(body.minimumPriority)
        ? body.minimumPriority
        : undefined;
  if (minimumPriority === undefined) return null;

  const quietHoursStart = readClock(body.quietHoursStart);
  const quietHoursEnd = readClock(body.quietHoursEnd);
  if (quietHoursStart === undefined || quietHoursEnd === undefined) return null;
  const scheduleStart = readClock(body.scheduleStart);
  const scheduleEnd = readClock(body.scheduleEnd);
  if (scheduleStart === undefined || scheduleEnd === undefined) return null;

  const daysOfWeek = readDays(body.daysOfWeek);
  if (daysOfWeek === null) return null;

  const behavior = readBehavior(body.quietHoursBehavior);
  if (behavior === null) return null;

  const cooldownSeconds = readCooldown(body.cooldownSeconds);
  if (cooldownSeconds === null) return null;

  if (typeof body.enabled !== "boolean") return null;

  return {
    id,
    name: name || defaultName({ eventType, classification, cameraId }),
    enabled: body.enabled,
    cameraId,
    eventType,
    classification,
    minimumPriority,
    scheduleStart,
    scheduleEnd,
    daysOfWeek,
    quietHoursStart,
    quietHoursEnd,
    quietHoursBehavior: behavior,
    cooldownSeconds,
  };
}

/** A clock is either absent, or a valid HH:MM. Anything else is rejected. */
function readClock(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const clock = parseClock(value);
  return clock ?? undefined;
}

function readDays(value: unknown): Weekday[] | null {
  if (value === null || value === undefined || value === "") return [];
  if (!Array.isArray(value)) return null;
  const days: Weekday[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const day = item.trim().toLowerCase();
    if (!(WEEKDAYS as readonly string[]).includes(day)) return null;
    if (!days.includes(day as Weekday)) days.push(day as Weekday);
  }
  return days;
}

function readBehavior(value: unknown): QuietHoursBehavior | null {
  if (value === null || value === undefined || value === "") return "suppress";
  if (typeof value !== "string") return null;
  return (QUIET_BEHAVIORS as readonly string[]).includes(value) ? (value as QuietHoursBehavior) : null;
}

function readCooldown(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return DEFAULT_COOLDOWN_SECONDS;
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_COOLDOWN_SECONDS) return null;
  return seconds;
}

function defaultName(input: {
  eventType: string | null;
  classification: string | null;
  cameraId: number | null;
}): string {
  const what =
    input.classification === "person"
      ? "Person"
      : input.classification === "vehicle"
        ? "Vehicle"
        : input.classification === ""
          ? "Motion"
          : input.eventType
            ? input.eventType.replace(/_/g, " ")
            : "Any event";
  const where = input.cameraId ? `Camera ${input.cameraId}` : "All cameras";
  return `${what} - ${where}`;
}