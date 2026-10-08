import { describe, expect, it } from "vitest";
import { Messages } from "@/lib/messages";
import { mockRecordings, parseSearchParams, playbackMockAllowed, recordingLabel } from "@/lib/recording";
import { hikvisionPlaybackStamp, parseDvrTimestamp } from "@/lib/time-kolkata";

describe("playback query validation", () => {
  it("accepts a camera, a calendar date, and a clock range", () => {
    expect(parseSearchParams({ camera: "2", date: "2026-10-07", startTime: null, endTime: null })).toEqual({
      ok: true,
      query: { camera: 2, date: "2026-10-07", startTime: "00:00", endTime: "23:59" },
    });
  });

  it("rejects a bad camera, date, or reversed time", () => {
    expect(parseSearchParams({ camera: "9", date: "2026-10-07", startTime: "00:00", endTime: "23:59" })).toEqual({
      ok: false,
      message: Messages.invalidCamera,
    });
    expect(parseSearchParams({ camera: "1", date: "2026-02-31", startTime: "00:00", endTime: "23:59" })).toEqual({
      ok: false,
      message: Messages.invalidDate,
    });
    expect(parseSearchParams({ camera: "1", date: "2026-10-07", startTime: "18:00", endTime: "08:00" })).toEqual({
      ok: false,
      message: Messages.invalidTime,
    });
  });

  it("keeps mock recordings out of production", () => {
    expect(playbackMockAllowed({ NODE_ENV: "production", PLAYBACK_DEV_MOCK: "true" })).toBe(false);
    expect(playbackMockAllowed({ NODE_ENV: "development", PLAYBACK_DEV_MOCK: "false" })).toBe(false);
    expect(playbackMockAllowed({ NODE_ENV: "development", PLAYBACK_DEV_MOCK: "true" })).toBe(true);
    expect(mockRecordings(1, "2026-10-07")[0]?.label).toBe("Continuous");
    expect(recordingLabel(null)).toBe("Recording");
  });

  it("treats a trailing Z from this DVR as India local time", () => {
    const parsed = parseDvrTimestamp("2026-10-07T08:15:00Z");
    expect(parsed?.toISOString()).toBe("2026-10-07T02:45:00.000Z");
    expect(hikvisionPlaybackStamp(parsed!)).toBe("20261007T081500Z");
  });
});
