import { describe, expect, it, vi } from "vitest";
import {
  checkNotificationFreshness,
  DEFAULT_DVR_NOTIFICATION_MAX_EVENT_AGE_SECONDS,
  formatFreshnessLog,
  sourceIsAgeChecked,
} from "@/lib/notification-freshness";

/**
 * DVR notification freshness.
 *
 * Regression guard for: after the hub was offline, the first poll re-read the
 * DVR's alarm log and every recovered event went to Telegram as if it had just
 * happened. All of these use a fixed clock — nothing waits in real time.
 */

const NOW = new Date("2026-11-13T18:00:00+05:30");
const MAX = DEFAULT_DVR_NOTIFICATION_MAX_EVENT_AGE_SECONDS; // 120

/** An IST timestamp that is `seconds` before NOW. */
function at(secondsAgo: number): string {
  const iso = new Date(NOW.getTime() - secondsAgo * 1000).toISOString();
  // The hub stores Kolkata-offset ISO; keep that shape.
  return new Date(iso).toISOString().replace("Z", "+00:00");
}

describe("checkNotificationFreshness", () => {
  it("1. a 30-second-old DVR event is eligible", () => {
    const r = checkNotificationFreshness({ eventTimestamp: at(30), maxAgeSeconds: MAX, now: NOW });
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeNull();
    expect(r.ageSeconds).toBe(30);
  });

  it("2. an event exactly at the boundary is still eligible (inclusive)", () => {
    const r = checkNotificationFreshness({ eventTimestamp: at(MAX), maxAgeSeconds: MAX, now: NOW });
    expect(r.ageSeconds).toBe(MAX);
    expect(r.eligible).toBe(true);
  });

  it("3. an event one second past the boundary is not eligible", () => {
    const r = checkNotificationFreshness({ eventTimestamp: at(MAX + 1), maxAgeSeconds: MAX, now: NOW });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("DVR_EVENT_TOO_OLD");
  });

  it("4. an event several hours old is not eligible", () => {
    const r = checkNotificationFreshness({ eventTimestamp: at(4 * 3600), maxAgeSeconds: MAX, now: NOW });
    expect(r.reason).toBe("DVR_EVENT_TOO_OLD");
    expect(r.ageSeconds).toBe(4 * 3600);
  });

  it("5. an event from the previous day is not eligible", () => {
    const r = checkNotificationFreshness({ eventTimestamp: at(26 * 3600), maxAgeSeconds: MAX, now: NOW });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("DVR_EVENT_TOO_OLD");
  });

  it("6. a historical event recovered at startup is not eligible", () => {
    // Server down 10:00 -> 18:00; the DVR replays 11:00, 13:00 and 15:00.
    for (const secondsAgo of [7 * 3600, 5 * 3600, 3 * 3600]) {
      const r = checkNotificationFreshness({ eventTimestamp: at(secondsAgo), maxAgeSeconds: MAX, now: NOW });
      expect(r.eligible, `event ${secondsAgo}s old must not notify`).toBe(false);
      expect(r.reason).toBe("DVR_EVENT_TOO_OLD");
    }
  });

  it("7. a recent event discovered at startup is eligible", () => {
    const r = checkNotificationFreshness({ eventTimestamp: at(20), maxAgeSeconds: MAX, now: NOW });
    expect(r.eligible).toBe(true);
  });

  it("8. a missing timestamp is not eligible", () => {
    for (const value of [null, undefined, ""]) {
      const r = checkNotificationFreshness({ eventTimestamp: value, maxAgeSeconds: MAX, now: NOW });
      expect(r.eligible).toBe(false);
      expect(r.reason).toBe("DVR_EVENT_TIMESTAMP_INVALID");
    }
  });

  it("9. an invalid timestamp is not eligible", () => {
    for (const value of ["not-a-date", "2026-13-45T99:99:99", "13/11/2026"]) {
      const r = checkNotificationFreshness({ eventTimestamp: value, maxAgeSeconds: MAX, now: NOW });
      expect(r.reason, `${value} must be rejected`).toBe("DVR_EVENT_TIMESTAMP_INVALID");
      expect(r.ageSeconds).toBeNull();
    }
  });

  it("10. a future timestamp is not eligible and is reported separately", () => {
    const r = checkNotificationFreshness({ eventTimestamp: at(-3600), maxAgeSeconds: MAX, now: NOW });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe("DVR_EVENT_TIMESTAMP_FUTURE");
    expect(r.ageSeconds).toBe(-3600);
  });

  it("tolerates normal clock skew between the DVR and the hub", () => {
    // 10 s ahead is not a fault: two independent clocks are never exact.
    const r = checkNotificationFreshness({ eventTimestamp: at(-10), maxAgeSeconds: MAX, now: NOW });
    expect(r.eligible).toBe(true);
  });

  it("fails closed when the configured window is missing or nonsense", () => {
    // age > undefined is NaN -> false, which would silently disable the policy.
    const missing = checkNotificationFreshness({
      eventTimestamp: at(3600),
      maxAgeSeconds: undefined as unknown as number,
      now: NOW,
    });
    expect(missing.eligible).toBe(false);
    expect(missing.maxAgeSeconds).toBe(MAX);

    const negative = checkNotificationFreshness({ eventTimestamp: at(3600), maxAgeSeconds: -5, now: NOW });
    expect(negative.eligible).toBe(false);
  });

  it("honours a custom window without a second hardcoded threshold", () => {
    const fiveMin = checkNotificationFreshness({ eventTimestamp: at(200), maxAgeSeconds: 300, now: NOW });
    expect(fiveMin.eligible).toBe(true);
    // A zero-second window admits only an event stamped "now" (age exactly 0).
    const strict = checkNotificationFreshness({ eventTimestamp: at(0), maxAgeSeconds: 0, now: NOW });
    expect(strict.ageSeconds).toBe(0);
    expect(strict.eligible).toBe(true);
    const strictOld = checkNotificationFreshness({ eventTimestamp: at(1), maxAgeSeconds: 0, now: NOW });
    expect(strictOld.eligible).toBe(false);
    expect(strictOld.reason).toBe("DVR_EVENT_TOO_OLD");
  });

  it("parses the stored Kolkata offset correctly (no timezone drift)", () => {
    // 18:00 IST == 12:30 UTC. An event at 17:59 IST is 60 s old, not 5h30m.
    const r = checkNotificationFreshness({
      eventTimestamp: "2026-11-13T17:59:00+05:30",
      maxAgeSeconds: MAX,
      now: NOW,
    });
    expect(r.ageSeconds).toBe(60);
    expect(r.eligible).toBe(true);
  });
});

describe("sourceIsAgeChecked", () => {
  it("applies to DVR events only", () => {
    expect(sourceIsAgeChecked("hikvision")).toBe(true);
    expect(sourceIsAgeChecked("Hikvision")).toBe(true);
  });

  it("never suppresses object-detection person/vehicle events", () => {
    expect(sourceIsAgeChecked("object-detection-worker")).toBe(false);
  });
});

describe("formatFreshnessLog", () => {
  it("emits the diagnostic fields without secrets", () => {
    const evaluation = checkNotificationFreshness({
      eventTimestamp: at(3600),
      maxAgeSeconds: MAX,
      now: NOW,
    });
    const line = formatFreshnessLog({
      eventId: "evt_abc",
      cameraId: 2,
      source: "hikvision",
      eventType: "motion",
      classification: "person",
      eventTimestamp: at(3600),
      receivedAt: "2026-11-13T12:30:05.000Z",
      evaluation,
    });
    expect(line).toContain("reason=DVR_EVENT_TOO_OLD");
    expect(line).toContain("event=evt_abc");
    expect(line).toContain("camera=2");
    expect(line).toContain("source=hikvision");
    expect(line).toContain("age=3600s");
    expect(line).toContain("maxAge=120s");
    expect(line).not.toMatch(/token|password|secret|chat_id/i);
  });
});

describe("no real waiting", () => {
  it("uses the injected clock, not the system clock", () => {
    const spy = vi.spyOn(Date, "now");
    checkNotificationFreshness({ eventTimestamp: at(10), maxAgeSeconds: MAX, now: NOW });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
