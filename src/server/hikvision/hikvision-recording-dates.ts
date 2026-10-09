import "server-only";
import { randomUUID } from "node:crypto";
import type { Recording } from "@/lib/recording";
import { isCalendarDate } from "@/lib/time-kolkata";
import { searchDescription, dedupeRecordings, type PlaybackTransport } from "@/server/hikvision/hikvision-playback";
import { parseSearchPage } from "@/server/hikvision/hikvision-playback-parse";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

const SEARCH_PATH = "/ISAPI/ContentMgmt/search";
/**
 * Availability only needs to know which days contain *any* recording, but the
 * DVR paginates and does not report a date list, so we page until it says there
 * is no more. The cap stops a pathological month from looping forever.
 */
const MAX_PAGES = 40;

export type RecordingDates = {
  camera: number;
  month: string;
  /** Distinct Kolkata calendar dates (YYYY-MM-DD) with at least one recording. */
  dates: string[];
};

/** True for a strict YYYY-MM month string. */
export function isMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/**
 * First and last moment of a month in the application's DVR timezone.
 *
 * The bounds are constructed with the +05:30 offset (the same convention the
 * rest of the playback code uses), so a recording made late on the last day of
 * the month still belongs to that month regardless of the browser's timezone.
 */
export function monthBounds(month: string): { start: Date; end: Date } | null {
  if (!isMonth(month)) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return null;
  // `month` is "YYYY-MM", so the day suffix must be appended with a separator.
  const start = new Date(`${month}-01T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) return null;
  // Day 0 of the next month is the last day of this one (handles leap years).
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const end = new Date(`${month}-${String(lastDay).padStart(2, "0")}T23:59:59+05:30`);
  if (Number.isNaN(end.getTime())) return null;
  return { start, end };
}

/** The Kolkata calendar date (YYYY-MM-DD) a recording starts on. */
function dateOf(isoTimestamp: string): string | null {
  const date = isoTimestamp.slice(0, 10);
  return isCalendarDate(date) ? date : null;
}

/**
 * Distinct recording dates from a set of recordings.
 *
 * Several segments on one day collapse to a single date, which is the whole
 * point of the availability view.
 */
export function datesFromRecordings(recordings: Array<{ startTime: string }>, month?: string): string[] {
  const dates = new Set<string>();
  for (const recording of recordings) {
    const date = dateOf(recording.startTime);
    if (!date) continue;
    if (month && !date.startsWith(month)) continue;
    dates.add(date);
  }
  return [...dates].sort();
}

/**
 * Merge adjacent segments that cross midnight.
 *
 * A segment that starts on the previous day but is still running at 00:00 does
 * not, by itself, mean the DVR has a recording *starting* on this day. Dates are
 * taken from the segment start, so nothing extra is needed here — this helper
 * exists to document that decision and is covered by tests.
 */
export function normalizeDates(dates: Iterable<string>): string[] {
  return [...new Set(dates)].sort();
}

/**
 * Query the DVR for every recording in a month and return the distinct dates.
 *
 * This is one DVR search per camera + month (with paging), not one per day.
 */
export async function fetchRecordingDates(
  transport: PlaybackTransport,
  camera: number,
  month: string,
): Promise<string[]> {
  const bounds = monthBounds(month);
  if (!bounds) throw new HikvisionError("bad_response", "Invalid month");
  const track = camera * 100 + 1;
  const searchId = randomUUID();
  const collected: Recording[] = [];
  let position = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const xml = await transport.postXml(
      SEARCH_PATH,
      searchDescription({ searchId, track, start: bounds.start, end: bounds.end, position }),
    );
    const parsed = parseSearchPage(xml, camera);
    collected.push(...parsed.recordings);
    if (!parsed.more || parsed.recordings.length === 0) break;
    position += parsed.recordings.length;
  }
  // The DVR may repeat a segment across pages; dedupe before reading dates.
  return datesFromRecordings(dedupeRecordings(collected), month);
}

/**
 * Server-side cache keyed by camera + month.
 *
 * Availability changes only when the DVR writes new recordings, so a short TTL
 * is enough and keeps navigation between months cheap without permanently
 * caching a stale answer.
 */
type CacheEntry = { at: number; dates: string[] };

const TTL_MS = 60_000;
const MAX_ENTRIES = 64;

export class RecordingDatesCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<string[]>>();

  constructor(private readonly ttlMs = TTL_MS) {}

  key(camera: number, month: string): string {
    return `recording-dates:camera-${camera}:${month}`;
  }

  get(camera: number, month: string, now = Date.now()): string[] | null {
    const entry = this.entries.get(this.key(camera, month));
    if (!entry) return null;
    if (now - entry.at >= this.ttlMs) {
      this.entries.delete(this.key(camera, month));
      return null;
    }
    return entry.dates;
  }

  set(camera: number, month: string, dates: string[], now = Date.now()): void {
    // Bound memory: drop the oldest entry when at capacity.
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(this.key(camera, month))) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.entries.delete(oldest[0]);
    }
    this.entries.set(this.key(camera, month), { at: now, dates });
  }

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  /** Only successful results are cached; a failure is never remembered. */
  async load(camera: number, month: string, fetchDates: () => Promise<string[]>): Promise<string[]> {
    const cached = this.get(camera, month);
    if (cached) return cached;
    const key = this.key(camera, month);
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const run = fetchDates()
      .then((dates) => {
        this.set(camera, month, dates);
        return dates;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, run);
    return run;
  }
}

export const recordingDatesCache = new RecordingDatesCache();
