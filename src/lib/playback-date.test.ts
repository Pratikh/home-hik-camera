import { describe, expect, it } from "vitest";
import { recordingToAutoplay, resolvePlaybackDate } from "@/lib/playback-date";
import { todayInKolkata } from "@/lib/time-kolkata";

describe("playback default date", () => {
  it("opens on today's date in Asia/Kolkata", () => {
    expect(todayInKolkata(new Date("2026-10-07T20:30:00Z"))).toBe("2026-10-08");
    expect(todayInKolkata(new Date("2026-10-06T18:00:00Z"))).toBe("2026-10-06");
    expect(resolvePlaybackDate({ today: "2026-10-07", selected: null, userChoseDate: false })).toBe("2026-10-07");
  });

  it("keeps a date the user chose instead of jumping back to today", () => {
    expect(resolvePlaybackDate({ today: "2026-10-07", selected: "2026-10-06", userChoseDate: true })).toBe("2026-10-06");
    expect(resolvePlaybackDate({ today: "2026-10-08", selected: "2026-10-06", userChoseDate: true })).toBe("2026-10-06");
  });

  it("autoplays the latest recording and leaves an empty day idle", () => {
    const older = { id: "a", startTime: "2026-10-07T08:15:00+05:30" };
    const newer = { id: "b", startTime: "2026-10-07T16:03:00+05:30" };
    expect(recordingToAutoplay([older, newer])?.id).toBe("b");
    expect(recordingToAutoplay([newer, older])?.id).toBe("b");
    expect(recordingToAutoplay([])).toBeNull();
  });
});
