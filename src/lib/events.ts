import { KOLKATA_OFFSET, kolkataDayBounds, parseClock } from "@/lib/time-kolkata";

export const EVENT_TYPES = ["motion", "person", "vehicle", "alarm", "line_crossing", "intrusion", "video_loss", "storage_error"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type EventClassification = "person" | "vehicle";

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
};

export type EventStats = {
  date: string;
  total: number;
  person: number;
  vehicle: number;
  motion: number;
};

export type NotificationRule = {
  id: string;
  enabled: boolean;
  cameraId: number | null;
  eventType: EventType | null;
  classification: EventClassification | "" | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
};

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

export type EventListQuery = {
  cameraId: number | null;
  type: EventType | null;
  classification: EventClassification | "none" | null;
  start: string;
  end: string;
  page: number;
  pageSize: number;
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
  const page = Number(input.page ?? "1");
  const pageSize = Number(input.pageSize ?? "20");
  if (!Number.isInteger(page) || page < 1 || page > 1000) return { ok: false, message: "Invalid page" };
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return { ok: false, message: "Invalid page" };
  return { ok: true, query: { cameraId, type, classification, start: range.start, end: range.end, page, pageSize } };
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
