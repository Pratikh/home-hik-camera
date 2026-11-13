import { describe, expect, it } from "vitest";
import { availableFilters } from "@/components/playback/PlaybackTimelineFilters";
import type { CctvEvent } from "@/lib/events";
import type { TimelineSegment } from "@/lib/timeline";

/**
 * Timeline filter options.
 *
 * The filter chips are derived from the day's real recording segments and
 * events, so a category can never be advertised when the DVR produced nothing
 * for it. "All" is always present.
 */

function segment(type: TimelineSegment["type"], startMs: number): TimelineSegment {
  return {
    id: `seg-${type}-${startMs}`,
    startMs,
    endMs: startMs + 60_000,
    type,
    label: type === "motion" ? "Motion" : type === "alarm" ? "Alarm" : "Continuous",
  } as TimelineSegment;
}

function event(classification: "person" | "vehicle" | null): CctvEvent {
  return {
    id: `evt_${classification ?? "motion"}_${Math.random().toString(16).slice(2)}`,
    cameraId: 1,
    type: "motion",
    classification,
    timestamp: "2026-11-13T10:00:00+05:30",
    endTimestamp: null,
    snapshotPath: null,
    hasSnapshot: false,
    priority: "NORMAL",
    notified: false,
  } as unknown as CctvEvent;
}

describe("availableFilters", () => {
  it("always offers All", () => {
    expect(availableFilters([], [])).toEqual(["all"]);
  });

  it("offers Recording only when the day has a segment", () => {
    expect(availableFilters([segment("continuous", 0)], [])).toContain("recording");
    expect(availableFilters([], [])).not.toContain("recording");
  });

  it("offers Event only when the day has events", () => {
    expect(availableFilters([], [event(null)])).toContain("event");
    expect(availableFilters([], [])).not.toContain("event");
  });

  it("offers Person only when a person event exists", () => {
    expect(availableFilters([], [event("person")])).toContain("person");
    expect(availableFilters([], [event("vehicle")])).not.toContain("person");
  });

  it("offers Vehicle only when a vehicle event exists", () => {
    expect(availableFilters([], [event("vehicle")])).toContain("vehicle");
    expect(availableFilters([], [event("person")])).not.toContain("vehicle");
  });

  it("does not invent a category from a plain motion event", () => {
    const options = availableFilters([], [event(null)]);
    expect(options).toEqual(["all", "event"]);
  });
});
