import { describe, expect, it } from "vitest";
import type { Recording } from "@/lib/recording";
import { DAY_MS, kolkataDayBounds } from "@/lib/time-kolkata";
import {
  adjacency,
  assignLanes,
  recordingAt,
  segmentPercents,
  tickStep,
  timelineTicks,
  toTimelineSegment,
  zoomWindow,
} from "@/lib/timeline";

const day = kolkataDayBounds("2026-10-07");
if (!day) throw new Error("day");

function recording(start: string, end: string, id = `${start}-${end}`): Recording {
  return { id, camera: 1, startTime: start, endTime: end, type: "continuous", label: "Continuous" };
}

describe("timeline", () => {
  it("places 08:15–09:45 on the matching slice of a 24-hour day", () => {
    const segment = toTimelineSegment(
      recording("2026-10-07T08:15:00+05:30", "2026-10-07T09:45:00+05:30"),
      day.start.getTime(),
      day.end.getTime(),
    );
    expect(segment).not.toBeNull();
    expect(segment?.startMs).toBe(8 * 60 * 60 * 1000 + 15 * 60 * 1000);
    expect(segment?.endMs).toBe(9 * 60 * 60 * 1000 + 45 * 60 * 1000);
    const box = segmentPercents(segment!, { startMs: 0, endMs: DAY_MS });
    expect(box?.left).toBeCloseTo(34.375, 5);
    expect(box?.width).toBeCloseTo(6.25, 5);
  });

  it("keeps short recordings, gaps, touches, and overlaps distinct", () => {
    const morning = toTimelineSegment(
      recording("2026-10-07T08:00:00+05:30", "2026-10-07T08:03:00+05:30", "short"),
      day.start.getTime(),
      day.end.getTime(),
    );
    expect(segmentPercents(morning!, { startMs: 0, endMs: DAY_MS })?.width).toBeCloseTo((3 * 60 * 1000) / DAY_MS * 100, 5);

    const first = toTimelineSegment(
      recording("2026-10-07T08:00:00+05:30", "2026-10-07T09:00:00+05:30", "a"),
      day.start.getTime(),
      day.end.getTime(),
    )!;
    const touching = toTimelineSegment(
      recording("2026-10-07T09:00:00+05:30", "2026-10-07T10:00:00+05:30", "b"),
      day.start.getTime(),
      day.end.getTime(),
    )!;
    const later = toTimelineSegment(
      recording("2026-10-07T11:00:00+05:30", "2026-10-07T12:00:00+05:30", "c"),
      day.start.getTime(),
      day.end.getTime(),
    )!;
    const overlap = toTimelineSegment(
      recording("2026-10-07T08:30:00+05:30", "2026-10-07T09:30:00+05:30", "d"),
      day.start.getTime(),
      day.end.getTime(),
    )!;

    expect(adjacency(first.endMs, touching.startMs)).toBe("touch");
    expect(adjacency(touching.endMs, later.startMs)).toBe("gap");
    expect(adjacency(first.endMs, overlap.startMs)).toBe("overlap");
    expect(assignLanes([first, touching, overlap, later])).toEqual([0, 0, 1, 0]);
  });

  it("clips a recording that crosses midnight to the selected day", () => {
    const segment = toTimelineSegment(
      recording("2026-10-06T23:00:00+05:30", "2026-10-07T01:00:00+05:30", "night"),
      day.start.getTime(),
      day.end.getTime(),
    );
    expect(segment?.startMs).toBe(0);
    expect(segment?.endMs).toBe(60 * 60 * 1000);
  });

  it("drops invalid timestamps", () => {
    expect(
      toTimelineSegment(
        recording("not-a-time", "2026-10-07T01:00:00+05:30", "bad"),
        day.start.getTime(),
        day.end.getTime(),
      ),
    ).toBeNull();
    expect(
      toTimelineSegment(
        recording("2026-10-07T02:00:00+05:30", "2026-10-07T01:00:00+05:30", "backwards"),
        day.start.getTime(),
        day.end.getTime(),
      ),
    ).toBeNull();
  });

  it("zooms around the playhead and finds the recording under a click", () => {
    const focus = 8 * 60 * 60 * 1000;
    const window = zoomWindow(1, focus);
    expect(window.endMs - window.startMs).toBe(60 * 60 * 1000);
    expect(focus).toBeGreaterThanOrEqual(window.startMs);
    expect(focus).toBeLessThanOrEqual(window.endMs);
    expect(tickStep(24)).toBe(4 * 60 * 60 * 1000);
    expect(timelineTicks({ startMs: 0, endMs: DAY_MS }, tickStep(24))).toContain(0);
    expect(timelineTicks({ startMs: 0, endMs: DAY_MS }, tickStep(24))).toContain(DAY_MS);

    const rows = [
      recording("2026-10-07T08:15:00+05:30", "2026-10-07T09:45:00+05:30", "clip"),
    ];
    const hit = day.start.getTime() + 9 * 60 * 60 * 1000;
    expect(recordingAt(rows, hit)?.id).toBe("clip");
    expect(recordingAt(rows, day.start.getTime() + 12 * 60 * 60 * 1000)).toBeNull();
  });
});
