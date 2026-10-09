import { describe, expect, it } from "vitest";
import { eventPlaybackHref, statRangeIso, weekdayInKolkata } from "@/lib/events";
import { defaultPriority, isImportant } from "@/lib/priority";
import { snapshotFile } from "@/lib/snapshot-path";
import { snapshotRelativePath } from "@/server/events/snapshot";
import { parseRuleBody } from "@/server/events/rule-input";

describe("event to playback", () => {
  it("builds the correct camera, date, and timestamp for an event", () => {
    expect(eventPlaybackHref({ cameraId: 2, timestamp: "2026-10-07T23:42:13+05:30" })).toBe(
      "/playback?camera=2&date=2026-10-07&time=23:42:13",
    );
  });

  it("keeps the Kolkata calendar date for a late-evening event", () => {
    // 23:42 IST is still 2026-10-07, not the next UTC day.
    expect(eventPlaybackHref({ cameraId: 4, timestamp: "2026-10-07T23:42:13+05:30" })).toContain("date=2026-10-07");
  });

  it("keeps the Kolkata calendar date for an early-morning event", () => {
    // 00:30 IST on the 8th must not resolve back to the 7th.
    expect(eventPlaybackHref({ cameraId: 1, timestamp: "2026-10-08T00:30:00+05:30" })).toBe(
      "/playback?camera=1&date=2026-10-08&time=00:30:00",
    );
  });
});

describe("snapshot storage and access", () => {
  it("stores snapshots under a date tree inside the events directory", () => {
    const relative = snapshotRelativePath(2, "evt_abc", new Date("2026-10-07T23:42:13+05:30"));
    expect(relative).toBe("2026/10/07/2-evt_abc.jpg");
  });

  it("accepts a path inside the events directory", () => {
    expect(snapshotFile("/data", "2026/10/07/2-evt_abc.jpg")).toContain("/data/events/");
  });

  it("rejects traversal, absolute paths, and missing snapshots", () => {
    expect(snapshotFile("/data", "../secret.jpg")).toBeNull();
    expect(snapshotFile("/data", "/etc/passwd")).toBeNull();
    expect(snapshotFile("/data", "2026/../../etc/passwd")).toBeNull();
    expect(snapshotFile("/data", null)).toBeNull();
  });
});

describe("timezone handling", () => {
  it("resolves the weekday in Asia/Kolkata, not the server zone", () => {
    // 2026-10-07T18:12:13Z is 23:42 IST on Wednesday.
    expect(weekdayInKolkata(new Date("2026-10-07T18:12:13Z"))).toBe("wed");
    // 2026-10-07T20:30:00Z is 02:00 IST on Thursday.
    expect(weekdayInKolkata(new Date("2026-10-07T20:30:00Z"))).toBe("thu");
  });

  it("covers whole Kolkata days for each statistics range", () => {
    const today = statRangeIso("today", new Date("2026-10-07T18:12:13Z"));
    expect(today?.start).toBe("2026-10-07T00:00:00+05:30");
    expect(today?.end).toBe("2026-10-07T23:59:59+05:30");
    expect(today?.days).toBe(1);
  });

  it("spans seven inclusive days for the 7d range", () => {
    const range = statRangeIso("7d", new Date("2026-10-07T18:12:13Z"));
    expect(range?.start).toBe("2026-10-01T00:00:00+05:30");
    expect(range?.end).toBe("2026-10-07T23:59:59+05:30");
    expect(range?.days).toBe(7);
  });

  it("spans thirty inclusive days for the 30d range", () => {
    const range = statRangeIso("30d", new Date("2026-10-07T18:12:13Z"));
    expect(range?.start).toBe("2026-09-08T00:00:00+05:30");
    expect(range?.days).toBe(30);
  });

  it("handles a month boundary without drifting a day", () => {
    const range = statRangeIso("7d", new Date("2026-11-03T18:12:13Z"));
    expect(range?.start).toBe("2026-10-28T00:00:00+05:30");
    expect(range?.end).toBe("2026-11-03T23:59:59+05:30");
  });
});

describe("event priority defaults", () => {
  it("ranks person and intrusion above plain motion", () => {
    expect(defaultPriority("motion", "person")).toBe("HIGH");
    expect(defaultPriority("intrusion", null)).toBe("CRITICAL");
    expect(defaultPriority("motion", null)).toBe("NORMAL");
    expect(defaultPriority("motion", "vehicle")).toBe("NORMAL");
  });

  it("treats only high and critical as important", () => {
    expect(isImportant("CRITICAL")).toBe(true);
    expect(isImportant("HIGH")).toBe(true);
    expect(isImportant("NORMAL")).toBe(false);
    expect(isImportant("LOW")).toBe(false);
  });
});

describe("rule input validation", () => {
  const valid = {
    name: "Camera 2 Person Night Alert",
    enabled: true,
    cameraId: 2,
    eventType: "motion",
    classification: "person",
    minimumPriority: "HIGH",
    scheduleStart: "22:00",
    scheduleEnd: "06:00",
    daysOfWeek: ["mon", "tue"],
    quietHoursStart: "23:00",
    quietHoursEnd: "07:00",
    quietHoursBehavior: "notify",
    cooldownSeconds: 300,
  };

  it("accepts a well-formed rule", () => {
    const parsed = parseRuleBody(valid, "rule-1");
    expect(parsed).not.toBeNull();
    expect(parsed?.cameraId).toBe(2);
    expect(parsed?.daysOfWeek).toEqual(["mon", "tue"]);
    expect(parsed?.cooldownSeconds).toBe(300);
  });

  it("rejects an unknown camera id", () => {
    expect(parseRuleBody({ ...valid, cameraId: 9 }, "rule-1")).toBeNull();
  });

  it("rejects an unknown event type, classification, priority, or behaviour", () => {
    expect(parseRuleBody({ ...valid, eventType: "explosion" }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, classification: "animal" }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, minimumPriority: "URGENT" }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, quietHoursBehavior: "ignore" }, "rule-1")).toBeNull();
  });

  it("rejects event types the DVR does not actually produce", () => {
    // The model can represent intrusion/store errors for other DVRs, but this
    // unit only emits motion, so a rule must not target a phantom type.
    expect(parseRuleBody({ ...valid, eventType: "intrusion" }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, eventType: "storage_error" }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, eventType: "motion" }, "rule-1")).not.toBeNull();
  });

  it("rejects a malformed clock, unknown weekday, and out-of-range cooldown", () => {
    expect(parseRuleBody({ ...valid, scheduleStart: "25:00" }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, quietHoursStart: "9pm" }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, daysOfWeek: ["funday"] }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, cooldownSeconds: -1 }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...valid, cooldownSeconds: 999999 }, "rule-1")).toBeNull();
  });

  it("requires an explicit enabled flag", () => {
    expect(parseRuleBody({ ...valid, enabled: undefined }, "rule-1")).toBeNull();
  });

  it("derives a readable name when none is given", () => {
    const parsed = parseRuleBody({ ...valid, name: "" }, "rule-1");
    expect(parsed?.name).toBe("Person - Camera 2");
  });

  it("defaults the cooldown rather than trusting an absent value", () => {
    const parsed = parseRuleBody({ ...valid, cooldownSeconds: undefined }, "rule-1");
    expect(parsed?.cooldownSeconds).toBe(300);
  });
});
