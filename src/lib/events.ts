import { atLeast, isEventPriority, type EventPriority } from "@/lib/priority";
import { KOLKATA_OFFSET, formatKolkataIso, kolkataDayBounds, kolkataParts, parseClock } from "@/lib/time-kolkata";

export const EVENT_TYPES = ["motion", "person", "vehicle", "alarm", "line_crossing", "intrusion", "video_loss", "storage_error"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type EventClassification = "person" | "vehicle";

/**
 * Event types this DVR actually produces.
 *
 * The DS-7104HGHI-K1 alarm log contains motion only. Person and vehicle are not
 * separate event types; they are a *classification* label the DVR attaches to
 * a motion event (`additionInformation` of "Human"/"Vehicle"). The remaining
 * types (alarm, line_crossing, intrusion, video_loss, storage_error) are
 * represented in the model for DVRs that report them, but this unit does not,
 * so they are not offered in the UI.
 *
 * Keep the UI and the rule editor on this list so they never claim a feature
 * the DVR does not provide.
 */
export const SUPPORTED_EVENT_TYPES = ["motion"] as const satisfies readonly EventType[];

export type CctvEvent = {
  id: string;
  cameraId: number;
  type: EventType;
  classification: EventClassification | null;
  timestamp: string;
  endTimestamp: string | null;
  confidence: number | null;
  hasSnapshot: boolean;
  recordingStart: string | null;
  recordingEnd: string | null;
  source: string;
  priority: EventPriority;
  notified: boolean;
  readAt: string | null;
};

export type EventStats = {
  date: string;
  total: number;
  person: number;
  vehicle: number;
  motion: number;
  critical: number;
  high: number;
  cameras: { cameraId: number; total: number }[];
};

export type NotificationStatus = "sent" | "suppressed" | "failed";

export type NotificationRecord = {
  id: string;
  eventId: string;
  ruleId: string | null;
  ruleName: string | null;
  cameraId: number;
  priority: EventPriority;
  status: NotificationStatus;
  reason: string | null;
  createdAt: string;
  eventType?: EventType;
  classification?: EventClassification | null;
  eventTimestamp?: string;
};

/** What a rule does when its schedule overlaps quiet hours. */
export const QUIET_BEHAVIORS = ["notify", "suppress", "store_only"] as const;
export type QuietHoursBehavior = (typeof QUIET_BEHAVIORS)[number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type NotificationRule = {
  id: string;
  name: string;
  enabled: boolean;
  cameraId: number | null;
  eventType: EventType | null;
  classification: EventClassification | "" | null;
  minimumPriority: EventPriority | null;
  /** Rule window, Asia/Kolkata. Overnight when start > end. */
  scheduleStart: string | null;
  scheduleEnd: string | null;
  /** Empty array means every day. */
  daysOfWeek: Weekday[];
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  quietHoursBehavior: QuietHoursBehavior;
  cooldownSeconds: number;
};

export const MAX_COOLDOWN_SECONDS = 86400;
export const DEFAULT_COOLDOWN_SECONDS = 300;

export function eventLabel(type: EventType, classification: EventClassification | null): string {
  if (classification === "person") return "Person";
  if (classification === "vehicle") return "Vehicle";
  if (type === "motion") return "Motion";
  if (type === "line_crossing") return "Line crossing";
  if (type === "intrusion") return "Intrusion";
  if (type === "video_loss") return "Video loss";
  if (type === "storage_error") return "Storage";
  if (type === "alarm") return "Alarm";
  return "Event";
}

export function eventTitle(type: EventType, classification: EventClassification | null): string {
  const label = eventLabel(type, classification);
  if (classification || type === "motion") return `${label} detected`;
  return label;
}

export function eventPlaybackHref(event: { cameraId: number; timestamp: string }): string {
  const date = event.timestamp.slice(0, 10);
  const time = event.timestamp.slice(11, 19);
  return `/playback?camera=${event.cameraId}&date=${date}&time=${time}`;
}

export function eventDurationSeconds(timestamp: string, endTimestamp: string | null): number | null {
  if (!endTimestamp) return null;
  const ms = new Date(endTimestamp).getTime() - new Date(timestamp).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

export function eventOffsetMs(dayStartMs: number, timestamp: string): number | null {
  const time = new Date(timestamp).getTime();
  if (!Number.isFinite(time)) return null;
  const offset = time - dayStartMs;
  if (offset < 0 || offset >= 24 * 60 * 60 * 1000) return null;
  return offset;
}

export function minutesOfDay(clock: string): number | null {
  const parsed = parseClock(clock);
  if (!parsed) return null;
  const [hour, minute] = parsed.split(":").map(Number);
  return hour * 60 + minute;
}

export function inQuietHours(start: string | null, end: string | null, at: Date): boolean {
  if (!start || !end) return false;
  const startMin = minutesOfDay(start);
  const endMin = minutesOfDay(end);
  if (startMin === null || endMin === null || startMin === endMin) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const bag: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") bag[part.type] = part.value;
  const hour = bag.hour === "24" ? 0 : Number(bag.hour);
  const now = hour * 60 + Number(bag.minute);
  if (startMin < endMin) return now >= startMin && now < endMin;
  return now >= startMin || now < endMin;
}

/** Weekday in Asia/Kolkata, so schedule evaluation never uses the server's local zone. */
export function weekdayInKolkata(at: Date): Weekday {
  const name = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short" })
    .format(at)
    .toLowerCase()
    .slice(0, 3);
  const found = WEEKDAYS.find((day) => day === name);
  return found ?? "mon";
}

/**
 * True when the wall clock in Asia/Kolkata falls inside a window.
 * An overnight window (start > end) spans midnight, e.g. 23:00-06:00.
 */
export function inClockWindow(start: string | null, end: string | null, at: Date): boolean {
  if (!start || !end) return false;
  const startMin = minutesOfDay(start);
  const endMin = minutesOfDay(end);
  if (startMin === null || endMin === null || startMin === endMin) return false;
  const parts = kolkataParts(at);
  const now = Number(parts.hour) * 60 + Number(parts.minute);
  if (startMin < endMin) return now >= startMin && now < endMin;
  return now >= startMin || now < endMin;
}

/**
 * A rule window for an overnight range belongs to the day it started on.
 * 23:00-06:00 on Friday therefore also covers 02:00 on Saturday.
 */
export function scheduleDayMatches(rule: NotificationRule, at: Date): boolean {
  if (rule.daysOfWeek.length === 0) return true;
  const current = weekdayInKolkata(at);
  if (rule.daysOfWeek.includes(current)) return true;
  const startMin = rule.scheduleStart ? minutesOfDay(rule.scheduleStart) : null;
  const endMin = rule.scheduleEnd ? minutesOfDay(rule.scheduleEnd) : null;
  if (startMin === null || endMin === null || startMin <= endMin) return false;
  const parts = kolkataParts(at);
  const now = Number(parts.hour) * 60 + Number(parts.minute);
  if (now >= endMin) return false;
  const previous = WEEKDAYS[(WEEKDAYS.indexOf(current) + WEEKDAYS.length - 1) % WEEKDAYS.length];
  return previous ? rule.daysOfWeek.includes(previous) : false;
}

export function inSchedule(rule: NotificationRule, at: Date): boolean {
  if (!rule.scheduleStart || !rule.scheduleEnd) {
    // No time window: the rule is active all day, but only on the chosen days.
    if (rule.daysOfWeek.length === 0) return true;
    return rule.daysOfWeek.includes(weekdayInKolkata(at));
  }
  if (!scheduleDayMatches(rule, at)) return false;
  return inClockWindow(rule.scheduleStart, rule.scheduleEnd, at);
}

export function ruleMatches(
  rule: NotificationRule,
  event: { cameraId: number; type: EventType; classification: EventClassification | null },
): boolean {
  if (!rule.enabled) return false;
  if (rule.cameraId !== null && rule.cameraId !== event.cameraId) return false;
  if (rule.eventType && rule.eventType !== event.type) return false;
  if (rule.classification === "") return event.classification === null;
  if (rule.classification) return rule.classification === event.classification;
  return true;
}

/** Full condition check: identity, priority floor, weekday, and schedule. */
export function ruleMatchesAt(
  rule: NotificationRule,
  event: { cameraId: number; type: EventType; classification: EventClassification | null; priority: EventPriority },
  at: Date,
): boolean {
  if (!ruleMatches(rule, event)) return false;
  if (rule.minimumPriority && !atLeast(event.priority, rule.minimumPriority)) return false;
  return inSchedule(rule, at);
}

export function shouldNotify(
  rules: NotificationRule[],
  event: { cameraId: number; type: EventType; classification: EventClassification | null },
  at: Date,
): { matched: boolean; quiet: boolean; notify: boolean } {
  const matching = rules.filter((rule) => ruleMatches(rule, event));
  if (matching.length === 0) return { matched: false, quiet: false, notify: false };
  const quiet = matching.every((rule) => inQuietHours(rule.quietHoursStart, rule.quietHoursEnd, at));
  return { matched: true, quiet, notify: !quiet };
}

export function retentionCutoff(now: Date, days: number): Date | null {
  if (!Number.isInteger(days) || days <= 0) return null;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function dedupeKey(input: {
  cameraId: number;
  type: string;
  timestamp: string;
  classification: string | null;
}): string {
  return `${input.cameraId}|${input.type}|${input.timestamp}|${input.classification ?? ""}`;
}

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** True only for an event type this DVR actually produces. */
export function isSupportedEventType(value: string): value is (typeof SUPPORTED_EVENT_TYPES)[number] {
  return (SUPPORTED_EVENT_TYPES as readonly string[]).includes(value);
}

export type EventListQuery = {
  cameraId: number | null;
  type: EventType | null;
  classification: EventClassification | "none" | null;
  start: string;
  end: string;
  page: number;
  pageSize: number;
  importantOnly: boolean;
  notified: boolean | null;
  read: boolean | null;
  priority: EventPriority | null;
};

export function parseEventListQuery(input: {
  camera: string | null;
  type: string | null;
  classification: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  page: string | null;
  pageSize: string | null;
  important?: string | null;
  notified?: string | null;
  read?: string | null;
  priority?: string | null;
}): { ok: true; query: EventListQuery } | { ok: false; message: string } {
  const date = (input.date ?? "").trim();
  const range = dayRangeIso(date, (input.startTime ?? "").trim() || "00:00", (input.endTime ?? "").trim() || "23:59");
  if (!range) return { ok: false, message: "Invalid date" };
  let cameraId: number | null = null;
  if (input.camera && input.camera !== "all") {
    if (!/^[1-4]$/.test(input.camera)) return { ok: false, message: "Invalid camera" };
    cameraId = Number(input.camera);
  }
  let type: EventType | null = null;
  if (input.type && input.type !== "all") {
    if (!isEventType(input.type)) return { ok: false, message: "Invalid event type" };
    type = input.type;
  }
  let classification: EventClassification | "none" | null = null;
  if (input.classification === "person" || input.classification === "vehicle" || input.classification === "none") {
    classification = input.classification;
  } else if (input.classification && input.classification !== "all") {
    return { ok: false, message: "Invalid classification" };
  }
  let priority: EventPriority | null = null;
  if (input.priority && input.priority !== "all") {
    if (!isEventPriority(input.priority)) return { ok: false, message: "Invalid priority" };
    priority = input.priority;
  }
  const page = Number(input.page ?? "1");
  const pageSize = Number(input.pageSize ?? "20");
  if (!Number.isInteger(page) || page < 1 || page > 1000) return { ok: false, message: "Invalid page" };
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return { ok: false, message: "Invalid page" };
  return {
    ok: true,
    query: {
      cameraId,
      type,
      classification,
      start: range.start,
      end: range.end,
      page,
      pageSize,
      importantOnly: input.important === "true" || input.important === "1",
      notified: triState(input.notified),
      read: triState(input.read),
      priority,
    },
  };
}

/** "true" | "false" | anything else means no filter. */
function triState(value: string | null | undefined): boolean | null {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

export function dayRangeIso(date: string, startTime: string, endTime: string): { start: string; end: string } | null {
  const bounds = kolkataDayBounds(date);
  const startClock = parseClock(startTime);
  const endClock = parseClock(endTime);
  if (!bounds || !startClock || !endClock || endClock <= startClock) return null;
  return {
    start: `${date}T${startClock}:00${KOLKATA_OFFSET}`,
    end: `${date}T${endClock}:59${KOLKATA_OFFSET}`,
  };
}

export const STAT_RANGES = ["today", "yesterday", "7d", "30d"] as const;
export type StatRange = (typeof STAT_RANGES)[number];

export function isStatRange(value: string): value is StatRange {
  return (STAT_RANGES as readonly string[]).includes(value);
}

export function rangeDays(range: StatRange): number {
  if (range === "7d") return 7;
  if (range === "30d") return 30;
  return 1;
}

/**
 * Stats window in Asia/Kolkata. A range covers whole calendar days in that zone:
 * "today" is 00:00 today through 23:59:59 today, "yesterday" the day before, and
 * the multi-day ranges inclusive of today. Never a sliding UTC window, which
 * would shift counts across midnight.
 */
export function statRangeIso(range: StatRange, now = new Date()): { start: string; end: string; days: number } | null {
  const today = todayInKolkataParts(now);
  const todayBounds = kolkataDayBounds(today);
  if (!todayBounds) return null;
  const days = rangeDays(range);
  const end = new Date(todayBounds.start.getTime() + DAY_MS - 1000);
  const start = new Date(todayBounds.start.getTime() - (days - 1) * DAY_MS);
  return { start: formatKolkataIso(start), end: formatKolkataIso(end), days };
}

function todayInKolkataParts(now: Date): string {
  const parts = kolkataParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
