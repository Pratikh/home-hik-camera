import { describe, expect, it } from "vitest";
import { datesFromRecordings, isMonth, monthBounds, RecordingDatesCache } from "@/server/hikvision/hikvision-recording-dates";

describe("monthBounds", () => {
  it("builds the first and last moment of a month in DVR time", () => {
    const bounds = monthBounds("2026-10");
    expect(bounds?.start.toISOString()).toBe(new Date("2026-10-01T00:00:00+05:30").toISOString());
    expect(bounds?.end.toISOString()).toBe(new Date("2026-10-31T23:59:59+05:30").toISOString());
  });

  it("handles a 30-day month", () => {
    expect(monthBounds("2026-11")?.end.toISOString()).toBe(new Date("2026-11-30T23:59:59+05:30").toISOString());
  });

  it("handles February in a leap year and a non-leap year", () => {
    expect(monthBounds("2028-02")?.end.toISOString()).toBe(new Date("2028-02-29T23:59:59+05:30").toISOString());
    expect(monthBounds("2027-02")?.end.toISOString()).toBe(new Date("2027-02-28T23:59:59+05:30").toISOString());
  });

  it("rejects a malformed month", () => {
    expect(monthBounds("2026-13")).toBeNull();
    expect(monthBounds("2026-00")).toBeNull();
    expect(monthBounds("2026-1")).toBeNull();
    expect(monthBounds("October")).toBeNull();
    expect(monthBounds("")).toBeNull();
  });

  it("accepts only YYYY-MM", () => {
    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-12")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-10-07")).toBe(false);
  });
});

describe("datesFromRecordings", () => {
  it("collapses several segments on one day to a single date", () => {
    const dates = datesFromRecordings([
      { startTime: "2026-10-07T00:10:00+05:30" },
      { startTime: "2026-10-07T04:15:00+05:30" },
      { startTime: "2026-10-07T18:00:00+05:30" },
    ]);
    expect(dates).toEqual(["2026-10-07"]);
  });

  it("returns each day once, sorted", () => {
    const dates = datesFromRecordings([
      { startTime: "2026-10-04T10:00:00+05:30" },
      { startTime: "2026-10-01T10:00:00+05:30" },
      { startTime: "2026-10-01T20:00:00+05:30" },
    ]);
    expect(dates).toEqual(["2026-10-01", "2026-10-04"]);
  });

  it("keeps a late-evening DVR recording on its own DVR date", () => {
    // 23:30 DVR time must stay on the 7th, whatever the browser timezone is.
    expect(datesFromRecordings([{ startTime: "2026-10-07T23:30:00+05:30" }])).toEqual(["2026-10-07"]);
  });

  it("excludes recordings that fall outside the requested month", () => {
    const dates = datesFromRecordings(
      [{ startTime: "2026-09-30T23:00:00+05:30" }, { startTime: "2026-10-01T00:30:00+05:30" }],
      "2026-10",
    );
    expect(dates).toEqual(["2026-10-01"]);
  });

  it("returns an empty list when there are no recordings", () => {
    expect(datesFromRecordings([])).toEqual([]);
  });

  it("ignores a recording with an unusable timestamp", () => {
    expect(datesFromRecordings([{ startTime: "not-a-date" }])).toEqual([]);
  });
});

describe("RecordingDatesCache", () => {
  it("caches a successful result and does not refetch", async () => {
    const cache = new RecordingDatesCache(60_000);
    let calls = 0;
    const fetchDates = async () => {
      calls += 1;
      return ["2026-10-01"];
    };
    await cache.load(1, "2026-10", fetchDates);
    await cache.load(1, "2026-10", fetchDates);
    expect(calls).toBe(1);
  });

  it("keys by camera and month, so cameras do not share availability", async () => {
    const cache = new RecordingDatesCache(60_000);
    await cache.load(1, "2026-10", async () => ["2026-10-01"]);
    await cache.load(2, "2026-10", async () => ["2026-10-07"]);
    expect(cache.get(1, "2026-10")).toEqual(["2026-10-01"]);
    expect(cache.get(2, "2026-10")).toEqual(["2026-10-07"]);
  });

  it("keys by month, so months do not share availability", async () => {
    const cache = new RecordingDatesCache(60_000);
    await cache.load(1, "2026-10", async () => ["2026-10-01"]);
    await cache.load(1, "2026-11", async () => ["2026-11-05"]);
    expect(cache.get(1, "2026-10")).toEqual(["2026-10-01"]);
    expect(cache.get(1, "2026-11")).toEqual(["2026-11-05"]);
  });

  it("expires after the TTL", () => {
    const cache = new RecordingDatesCache(1000);
    // Store against a fixed clock so the expiry check is deterministic.
    cache.set(1, "2026-10", ["2026-10-01"], 10_000);
    expect(cache.get(1, "2026-10", 10_500)).toEqual(["2026-10-01"]);
    expect(cache.get(1, "2026-10", 11_500)).toBeNull();
  });

  it("does not cache a failure, so a later attempt can succeed", async () => {
    const cache = new RecordingDatesCache(60_000);
    let calls = 0;
    const failing = async () => {
      calls += 1;
      throw new Error("dvr down");
    };
    await expect(cache.load(1, "2026-10", failing)).rejects.toThrow();
    expect(cache.get(1, "2026-10")).toBeNull();
    await expect(cache.load(1, "2026-10", failing)).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("deduplicates concurrent requests for the same key", async () => {
    const cache = new RecordingDatesCache(60_000);
    let calls = 0;
    const fetchDates = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return ["2026-10-01"];
    };
    await Promise.all([cache.load(1, "2026-10", fetchDates), cache.load(1, "2026-10", fetchDates)]);
    expect(calls).toBe(1);
  });
});
