import { describe, expect, it } from "vitest";
import { availabilityKey, nearestRecorded, shiftMonth, monthOf } from "@/components/hooks/useRecordingDates";

/**
 * Date-resolution rules for the playback calendar.
 *
 * These decide which day playback opens on after a camera switch or a month
 * change, so they must be deterministic: the selected date shown in the UI is
 * always the date that plays.
 */

describe("monthOf", () => {
  it("extracts the month from a calendar date", () => {
    expect(monthOf("2026-10-07")).toBe("2026-10");
    expect(monthOf("2026-01-31")).toBe("2026-01");
  });
});

describe("shiftMonth", () => {
  it("steps forward and back within a year", () => {
    expect(shiftMonth("2026-10", 1)).toBe("2026-11");
    expect(shiftMonth("2026-10", -1)).toBe("2026-09");
  });

  it("crosses year boundaries in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("handles a multi-month step", () => {
    expect(shiftMonth("2026-03", -6)).toBe("2025-09");
  });
});

describe("nearestRecorded", () => {
  const dates = ["2026-10-01", "2026-10-07", "2026-10-20"];

  it("prefers the same date when it has a recording", () => {
    expect(nearestRecorded(dates, "2026-10-07")).toBe("2026-10-07");
  });

  it("falls forward to the next available date", () => {
    expect(nearestRecorded(dates, "2026-10-04")).toBe("2026-10-07");
  });

  it("falls back to the previous date when none is later", () => {
    expect(nearestRecorded(dates, "2026-10-25")).toBe("2026-10-20");
  });

  it("returns null when the month has no recordings", () => {
    expect(nearestRecorded([], "2026-10-07")).toBeNull();
  });

  it("does not mutate the input order", () => {
    const input = ["2026-10-20", "2026-10-01"];
    expect(nearestRecorded(input, "2026-10-05")).toBe("2026-10-20");
    expect(input).toEqual(["2026-10-20", "2026-10-01"]);
  });

  it("never returns a date outside the supplied set", () => {
    const picked = nearestRecorded(dates, "2026-09-15");
    expect(dates).toContain(picked!);
  });
});

describe("availabilityKey", () => {
  it("is camera-specific so cameras never share availability", () => {
    expect(availabilityKey(1, "2026-10")).not.toBe(availabilityKey(2, "2026-10"));
  });

  it("is month-specific so months never share availability", () => {
    expect(availabilityKey(1, "2026-10")).not.toBe(availabilityKey(1, "2026-11"));
  });

  it("is stable for the same camera and month", () => {
    expect(availabilityKey(3, "2026-10")).toBe(availabilityKey(3, "2026-10"));
  });
});
