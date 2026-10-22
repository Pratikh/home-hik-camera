import { CAMERA_IDS, isValidCameraId } from "@/lib/cameras";
import {
  DEFAULT_COOLDOWN_SECONDS,
  RULE_EVENT_TYPE_LABELS,
  cameraIdsFromLegacy,
  isRuleEventType,
  isSupportedEventType,
  legacyRuleFields,
  MAX_COOLDOWN_SECONDS,
  QUIET_BEHAVIORS,
  ruleEventTypesFromLegacy,
  WEEKDAYS,
  type EventClassification,
  type NotificationRule,
  type QuietHoursBehavior,
  type RuleEventType,
  type Weekday,
} from "@/lib/events";
import { isEventPriority, type EventPriority } from "@/lib/priority";
import { parseClock } from "@/lib/time-kolkata";

/**
 * Parse an untrusted rule body into a NotificationRule.
 *
 * Every field that reaches the database is validated here; nothing is trusted
 * from the browser, including camera ids, event filters and the rule id itself.
 * Both the V5.2 array form and the older single-value form are accepted, so an
 * existing rule or an older client keeps working.
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
      : isValidCameraId(body.cameraId)
        ? body.cameraId
        : undefined;
  if (cameraId === undefined) return null;

  /*
   * Multi-select fields. This is the form the current UI sends. When present it
   * wins over the legacy single values; it must never be empty and every id /
   * token must be one the server knows.
   *
   * `null` is accepted as "not supplied" for compatibility, but an explicit
   * empty array is rejected — it can never mean all cameras or all events.
   */
  let cameraIds: number[] | null = null;
  if (body.cameraIds !== undefined && body.cameraIds !== null) {
    const parsed = readCameraIds(body.cameraIds);
    if (!parsed) return null;
    cameraIds = parsed;
  }

  let eventTypes: RuleEventType[] | null = null;
  if (body.eventTypes !== undefined && body.eventTypes !== null) {
    const parsed = readEventTypes(body.eventTypes);
    if (!parsed) return null;
    eventTypes = parsed;
  }

  // Legacy rule bodies omit the arrays; convert their single values to arrays.
  const resolvedCameraIds = cameraIds ?? cameraIdsFromLegacy(cameraId);
  if (!resolvedCameraIds || resolvedCameraIds.length === 0) return null;

  const resolvedEventTypes = eventTypes ?? ruleEventTypesFromLegacy(eventType, classification);
  if (!resolvedEventTypes || resolvedEventTypes.length === 0) return null;

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

  const legacy = legacyRuleFields({
    cameraIds: resolvedCameraIds,
    eventTypes: resolvedEventTypes,
    fallback: { cameraId, eventType, classification },
  });

  return {
    id,
    name: name || defaultName(resolvedCameraIds, resolvedEventTypes),
    enabled: body.enabled,
    cameraIds: resolvedCameraIds,
    eventTypes: resolvedEventTypes,
    ...legacy,
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

/** Validate a multi-select camera array. Unknown or duplicate ids are rejected. */
function readCameraIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: number[] = [];
  for (const item of value) {
    if (!isValidCameraId(item)) return null;
    if (!ids.includes(item)) ids.push(item);
  }
  return ids;
}

/** Validate a multi-select event array against the filters this DVR supports. */
function readEventTypes(value: unknown): RuleEventType[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const types: RuleEventType[] = [];
  for (const item of value) {
    if (!isRuleEventType(item)) return null;
    if (!types.includes(item)) types.push(item);
  }
  return types;
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

function defaultName(cameraIds: number[], eventTypes: RuleEventType[]): string {
  const what = eventTypes.map((type) => RULE_EVENT_TYPE_LABELS[type]).join(", ");
  const where =
    cameraIds.length === CAMERA_IDS.length
      ? "All cameras"
      : cameraIds.length === 1
        ? `Camera ${cameraIds[0]}`
        : `Cameras ${cameraIds.join(", ")}`;
  return `${what} - ${where}`;
}
