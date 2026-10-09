export const KOLKATA_OFFSET = "+05:30";
export const DAY_MS = 24 * 60 * 60 * 1000;

export type ClockParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

export function kolkataParts(date: Date): ClockParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  return {
    year: bag.year ?? "0000",
    month: bag.month ?? "01",
    day: bag.day ?? "01",
    hour: bag.hour === "24" ? "00" : (bag.hour ?? "00"),
    minute: bag.minute ?? "00",
    second: bag.second ?? "00",
  };
}

export function formatKolkataIso(date: Date): string {
  const parts = kolkataParts(date);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${KOLKATA_OFFSET}`;
}

export function formatKolkataClock(date: Date): string {
  const parts = kolkataParts(date);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatKolkataHourMinute(date: Date): string {
  const parts = kolkataParts(date);
  return `${parts.hour}:${parts.minute}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Human-readable India-time stamp, e.g. "09 Oct 2026, 10:40:59".
 *
 * Used wherever a full date and time is shown to a person, so a raw UTC ISO
 * string is never displayed as if it were local time.
 */
export function formatKolkataDateTime(date: Date): string {
  const parts = kolkataParts(date);
  const month = MONTHS[Number(parts.month) - 1] ?? parts.month;
  return `${parts.day} ${month} ${parts.year}, ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** Accepts an ISO string (including raw UTC from the database) and formats it. */
export function formatKolkataDateTimeFromIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatKolkataDateTime(date);
}

export function todayInKolkata(now = new Date()): string {
  const parts = kolkataParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

export function kolkataDayBounds(date: string): { start: Date; end: Date } | null {
  if (!isCalendarDate(date)) return null;
  const start = new Date(`${date}T00:00:00${KOLKATA_OFFSET}`);
  if (Number.isNaN(start.getTime())) return null;
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export function parseClock(value: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${match[1]}:${match[2]}`;
}

export function kolkataRange(date: string, startClock: string, endClock: string): { start: Date; end: Date } | null {
  if (!isCalendarDate(date) || !parseClock(startClock) || !parseClock(endClock)) return null;
  const start = new Date(`${date}T${startClock}:00${KOLKATA_OFFSET}`);
  const end = new Date(`${date}T${endClock}:59${KOLKATA_OFFSET}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return null;
  return { start, end };
}

/**
 * CMSearch on this DVR writes the device's local wall clock with a literal Z.
 * It is not UTC. `/ISAPI/System/time` is the call that carries a real offset.
 * A timestamp that already has an offset is parsed as that offset.
 */
export function parseDvrTimestamp(value: string): Date | null {
  const trimmed = value.trim();
  const localZulu = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})Z$/.exec(trimmed);
  const iso = localZulu ? `${localZulu[1]}${KOLKATA_OFFSET}` : trimmed;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Playback RTSP uses the same local wall clock plus a literal Z. */
export function hikvisionPlaybackStamp(date: Date): string {
  const parts = kolkataParts(date);
  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}Z`;
}

const CLIENT_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/;

export function parseKolkataIso(value: string): Date | null {
  if (!CLIENT_ISO.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
