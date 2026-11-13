import type { EventClassification, EventType } from "@/lib/events";

/**
 * Notification freshness policy for events recovered from the DVR.
 *
 * Why this exists: after a restart the hub re-reads part of the DVR's alarm log
 * so nothing is lost from the Events page. Those recovered events carry their
 * ORIGINAL DVR timestamp, which can be hours old. Notifying on them sends
 * "motion detected" for something that happened while the hub was down, which
 * reads as a live alarm and is wrong.
 *
 * The rule is deliberately narrow:
 *   - it applies to DVR-sourced events only (object-detection events are created
 *     from a live frame and are always current),
 *   - it uses the DVR event timestamp, never the time the hub received or stored
 *     the row,
 *   - it never suppresses storage: an old event is still ingested and visible.
 *
 * The decision is pure so the same logic is used by ingestion, by the queued
 * media revalidation, and by the tests.
 */

/**
 * Documented default window, duplicated here so the policy never depends on a
 * caller passing a value. Kept in sync with `src/lib/config.ts`.
 */
export const DEFAULT_DVR_NOTIFICATION_MAX_EVENT_AGE_SECONDS = 120;

/** Why a notification was suppressed. These codes are stable and logged. */
export const NOTIFICATION_SUPPRESS_REASONS = [
  "DVR_EVENT_TOO_OLD",
  "DVR_EVENT_TIMESTAMP_INVALID",
  "DVR_EVENT_TIMESTAMP_FUTURE",
] as const;

export type NotificationSuppressReason = (typeof NOTIFICATION_SUPPRESS_REASONS)[number];

/**
 * How far ahead of "now" a DVR timestamp may be before it is treated as a
 * clock/DVR fault. Small positive skew is normal (the DVR clock and the hub
 * clock are two independent clocks), so a few seconds of tolerance avoids
 * suppressing a genuinely current event.
 */
export const FUTURE_TOLERANCE_SECONDS = 30;

export type NotificationFreshness = {
  eligible: boolean;
  /** Present only when eligible is false. */
  reason: NotificationSuppressReason | null;
  /** eventTime - now, in seconds. Negative = in the past. null when unparsable. */
  ageSeconds: number | null;
  /** The DVR timestamp as stored, echoed for the audit line. */
  eventTimestamp: string;
  maxAgeSeconds: number;
};

/**
 * Which sources this policy governs.
 *
 * The DVR is the only source that can hand the hub an old event it has never
 * seen. Anchor/future AI sources are listed explicitly so adding a source is a
 * deliberate decision rather than an accidental bypass.
 */
const DVR_SOURCES = new Set(["hikvision"]);

export function isDvrSource(source: string): boolean {
  return DVR_SOURCES.has(source.toLowerCase());
}

/** True when this event's source is governed by the freshness policy. */
export function sourceIsAgeChecked(source: string): boolean {
  return isDvrSource(source);
}

/**
 * Decide whether an event may raise a notification, given the moment it is
 * being considered.
 *
 * @param input.eventTimestamp The event's own DVR timestamp (ISO with offset).
 * @param input.maxAgeSeconds   The configured window (DVR_NOTIFICATION_MAX_EVENT_AGE_SECONDS).
 * @param input.now             Evaluation instant; injected so tests are deterministic.
 */
export function checkNotificationFreshness(input: {
  eventTimestamp: string | null | undefined;
  maxAgeSeconds: number;
  now?: Date;
}): NotificationFreshness {
  const now = input.now ?? new Date();
  const raw = input.eventTimestamp;
  /*
   * Fail CLOSED on a missing/invalid window. Comparing an age against
   * `undefined` yields NaN and `NaN > x` is false, which would silently disable
   * the whole policy — the exact bug this module exists to prevent. An empty
   * window therefore falls back to the documented default.
   */
  const maxAgeSeconds =
    typeof input.maxAgeSeconds === "number" && Number.isFinite(input.maxAgeSeconds) && input.maxAgeSeconds >= 0
      ? input.maxAgeSeconds
      : DEFAULT_DVR_NOTIFICATION_MAX_EVENT_AGE_SECONDS;
  const base: NotificationFreshness = {
    eligible: false,
    reason: null,
    ageSeconds: null,
    eventTimestamp: raw ?? "",
    maxAgeSeconds,
  };

  if (!raw) return { ...base, reason: "DVR_EVENT_TIMESTAMP_INVALID" };
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { ...base, reason: "DVR_EVENT_TIMESTAMP_INVALID" };

  // Positive when the event is in the past, negative when it is ahead of now.
  const ageSeconds = Math.round((now.getTime() - parsed.getTime()) / 1000);

  // A timestamp meaningfully in the future means a DVR clock fault or a bad
  // parse; notifying would be confusing and the ordering is untrustworthy.
  if (ageSeconds < -FUTURE_TOLERANCE_SECONDS) {
    return { ...base, ageSeconds, reason: "DVR_EVENT_TIMESTAMP_FUTURE" };
  }

  // Boundary is inclusive: an event exactly maxAge old is still current enough
  // to represent what is on screen right now.
  if (ageSeconds > maxAgeSeconds) {
    return { ...base, ageSeconds, reason: "DVR_EVENT_TOO_OLD" };
  }

  return { ...base, eligible: true, ageSeconds };
}

/** One safe, greppable audit line. No secrets, no personal data. */
export function formatFreshnessLog(input: {
  eventId: string;
  cameraId: number;
  source: string;
  eventType: EventType;
  classification: EventClassification | null;
  eventTimestamp: string;
  receivedAt?: string | null;
  evaluation: NotificationFreshness;
}): string {
  const e = input.evaluation;
  return [
    `[events] notification-suppressed reason=${e.reason}`,
    `event=${input.eventId}`,
    `camera=${input.cameraId}`,
    `source=${input.source}`,
    `type=${input.eventType}`,
    `classification=${input.classification ?? "none"}`,
    `event=${e.eventTimestamp || "-"}`,
    `received=${input.receivedAt ?? "-"}`,
    `age=${e.ageSeconds ?? "unknown"}s`,
    `maxAge=${e.maxAgeSeconds}s`,
  ].join(" ");
}
