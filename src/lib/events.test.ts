import { describe, expect, it } from "vitest";
import {
  dedupeKey,
  eventOffsetMs,
  eventPlaybackHref,
  inQuietHours,
  retentionCutoff,
  ruleMatches,
  shouldNotify,
  type NotificationRule,
} from "@/lib/events";
import { kolkataDayBounds } from "@/lib/time-kolkata";
import { memoryEventStore } from "@/server/events/event-store";
import { snapshotFile } from "@/app/api/events/[id]/snapshot/route";

const personRule: NotificationRule = {
  id: "rule-person",
  name: "Person anywhere",
  enabled: true,
  cameraId: null,
  eventType: null,
  classification: "person",
  minimumPriority: null,
  scheduleStart: null,
  scheduleEnd: null,
  daysOfWeek: [],
  quietHoursStart: "23:00",
  quietHoursEnd: "07:00",
  quietHoursBehavior: "suppress",
  cooldownSeconds: 300,
};

describe("events", () => {
  it("builds a playback link at the event time", () => {
    expect(eventPlaybackHref({ cameraId: 1, timestamp: "2026-10-07T18:42:13+05:30" })).toBe(
      "/playback?camera=1&date=2026-10-07&time=18:42:13",
    );
  });

  it("places 18:42 on the playback timeline", () => {
    const day = kolkataDayBounds("2026-10-07");
    expect(day).not.toBeNull();
    expect(eventOffsetMs(day!.start.getTime(), "2026-10-07T18:42:00+05:30")).toBe(18 * 60 * 60 * 1000 + 42 * 60 * 1000);
  });

  it("stores an event during quiet hours and suppresses the notification", () => {
    const store = memoryEventStore();
    const key = dedupeKey({ cameraId: 1, type: "motion", timestamp: "2026-10-07T23:30:00+05:30", classification: "person" });
    expect(store.insertEvent({
      id: "evt_quiet",
      dedupeKey: key,
      cameraId: 1,
      type: "motion",
      classification: "person",
      timestamp: "2026-10-07T23:30:00+05:30",
      endTimestamp: null,
      source: "hikvision",
      metaId: "log.hikvision.com/Alarm/motionStart/1",
    })).toBe(true);
    expect(store.count()).toBe(1);
    const atQuiet = new Date("2026-10-07T18:00:00Z");
    const atMorning = new Date("2026-10-07T02:00:00Z");
    expect(inQuietHours("23:00", "07:00", atQuiet)).toBe(true);
    expect(inQuietHours("23:00", "07:00", atMorning)).toBe(false);
    expect(inQuietHours("23:00", "07:00", new Date("2026-10-07T01:30:00Z"))).toBe(false);
    expect(shouldNotify([personRule], { cameraId: 1, type: "motion", classification: "person" }, atQuiet)).toEqual({
      matched: true,
      quiet: true,
      notify: false,
    });
    expect(shouldNotify([personRule], { cameraId: 1, type: "motion", classification: "person" }, atMorning).notify).toBe(true);
  });

  it("filters by camera and does not treat motion as a person", () => {
    const cameraRule = { ...personRule, cameraId: 2 };
    expect(ruleMatches(cameraRule, { cameraId: 1, type: "motion", classification: "person" })).toBe(false);
    expect(ruleMatches(personRule, { cameraId: 1, type: "motion", classification: null })).toBe(false);
    expect(ruleMatches({ ...personRule, classification: "" }, { cameraId: 1, type: "motion", classification: null })).toBe(true);
    const motionRule: NotificationRule = { ...personRule, id: "motion", classification: "", eventType: "motion" };
    expect(ruleMatches(motionRule, { cameraId: 1, type: "motion", classification: null })).toBe(true);
    expect(ruleMatches(motionRule, { cameraId: 1, type: "motion", classification: "person" })).toBe(false);
  });

  it("drops events older than the retention window and keeps forever when days are zero", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(retentionCutoff(now, 30)?.toISOString()).toBe(new Date(now.getTime() - 30 * 86400000).toISOString());
    expect(retentionCutoff(now, 0)).toBeNull();
    const store = memoryEventStore();
    store.insertEvent({
      id: "evt_old",
      dedupeKey: "old",
      cameraId: 1,
      type: "motion",
      classification: null,
      timestamp: "2026-09-01T00:00:00+05:30",
      endTimestamp: null,
      source: "hikvision",
      metaId: "motion",
    });
    expect(store.deleteOlderThan("2026-10-01T00:00:00+05:30")).toBe(1);
    expect(store.count()).toBe(0);
  });

  it("refuses snapshot paths that leave the events directory", () => {
    expect(snapshotFile("/data", "../secret.jpg")).toBeNull();
    expect(snapshotFile("/data", "/etc/passwd")).toBeNull();
    expect(snapshotFile("/data", "2026/10/07/evt_abc.jpg")).toContain("/data/events/");
  });
});
