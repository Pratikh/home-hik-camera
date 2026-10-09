import { describe, expect, it } from "vitest";
import type { CctvEvent } from "@/lib/events";
import { kolkataDayBounds } from "@/lib/time-kolkata";
import { buildTimelineMarkers, MARKER_GROUP_MS, markerGroupMsForZoom, markerTitle } from "@/lib/timeline-markers";

function event(id: string, time: string, patch: Partial<CctvEvent> = {}): CctvEvent {
  return {
    id,
    cameraId: 1,
    type: "motion",
    classification: null,
    timestamp: `2026-10-07T${time}+05:30`,
    endTimestamp: null,
    confidence: null,
    hasSnapshot: false,
    recordingStart: null,
    recordingEnd: null,
    source: "hikvision",
    priority: "NORMAL",
    notified: false,
    readAt: null,
    ...patch,
  };
}

const dayStart = kolkataDayBounds("2026-10-07")!.start.getTime();

describe("playback timeline markers", () => {
  it("places an event at its offset from the start of the Kolkata day", () => {
    const markers = buildTimelineMarkers([event("evt_1", "18:42:13")], dayStart);
    expect(markers).toHaveLength(1);
    expect(markers[0]?.offsetMs).toBe(18 * 3600_000 + 42 * 60_000 + 13_000);
  });

  it("ignores an event outside the selected day", () => {
    const markers = buildTimelineMarkers([event("evt_1", "18:42:13", { timestamp: "2026-10-06T18:42:13+05:30" })], dayStart);
    expect(markers).toHaveLength(0);
  });

  it("groups nearby events into one marker and counts them", () => {
    const markers = buildTimelineMarkers(
      [event("a", "10:00:00"), event("b", "10:00:45"), event("c", "10:01:50")],
      dayStart,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]?.count).toBe(3);
    expect(markers[0]?.eventIds).toEqual(["a", "b", "c"]);
  });

  it("does not chain a steady stream into one ever-growing group", () => {
    // Every event is one minute after the previous, but the group is measured
    // from its first event, so a new marker starts once the window is passed.
    const markers = buildTimelineMarkers(
      [event("a", "10:00:00"), event("b", "10:01:00"), event("c", "10:02:00"), event("d", "10:03:00")],
      dayStart,
    );
    expect(markers.map((marker) => marker.count)).toEqual([3, 1]);
    expect(markers.map((marker) => marker.id)).toEqual(["a", "d"]);
  });

  it("keeps events further apart than the group window separate", () => {
    const markers = buildTimelineMarkers([event("a", "10:00:00"), event("b", "10:10:00")], dayStart);
    expect(markers).toHaveLength(2);
    expect(markers.every((marker) => marker.count === 1)).toBe(true);
  });

  it("keeps the strongest priority in a group", () => {
    const markers = buildTimelineMarkers(
      [
        event("a", "10:00:00", { priority: "NORMAL" }),
        event("b", "10:01:00", { priority: "CRITICAL" }),
        event("c", "10:02:00", { priority: "HIGH" }),
      ],
      dayStart,
    );
    expect(markers[0]?.priority).toBe("CRITICAL");
  });

  it("prefers a classified label for the group tooltip", () => {
    const markers = buildTimelineMarkers(
      [event("a", "10:00:00"), event("b", "10:01:00", { classification: "person", priority: "HIGH" })],
      dayStart,
    );
    expect(markers[0]?.classification).toBe("person");
    expect(markers[0]?.label).toBe("Person detected");
  });
  it("sorts markers chronologically regardless of input order", () => {
    const markers = buildTimelineMarkers([event("late", "20:00:00"), event("early", "06:00:00")], dayStart);
    expect(markers.map((marker) => marker.id)).toEqual(["early", "late"]);
  });

  it("describes a grouped marker in its tooltip", () => {
    const markers = buildTimelineMarkers([event("a", "10:00:00"), event("b", "10:01:00")], dayStart);
    const title = markerTitle(markers[0]!, "10:00");
    expect(title).toContain("2 events");
    expect(title).toContain("NORMAL");
  });

  it("uses a two-minute grouping window", () => {
    expect(MARKER_GROUP_MS).toBe(2 * 60 * 1000);
  });
});

describe("zoom-aware marker grouping", () => {
  it("groups more aggressively at the full-day zoom than when zoomed in", () => {
    // 24h view packs a ~340px bar, so the window must be wider than the 1h view.
    expect(markerGroupMsForZoom(24)).toBeGreaterThan(markerGroupMsForZoom(6));
    expect(markerGroupMsForZoom(6)).toBeGreaterThan(markerGroupMsForZoom(1));
  });

  it("collapses a dense day into far fewer markers at 24h", () => {
    // 20 events, one per minute: at 1h zoom they stay separate; at 24h they group.
    const many = Array.from({ length: 20 }, (_, index) =>
      event(`evt_${index}`, `10:${String(index).padStart(2, "0")}:00`),
    );
    const dayView = buildTimelineMarkers(many, dayStart, markerGroupMsForZoom(24));
    const hourView = buildTimelineMarkers(many, dayStart, markerGroupMsForZoom(1));
    expect(dayView.length).toBeLessThan(hourView.length);
    expect(dayView.length).toBeLessThanOrEqual(3);
  });

  it("keeps every event represented after grouping", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      event(`evt_${index}`, `10:${String(index).padStart(2, "0")}:00`),
    );
    const grouped = buildTimelineMarkers(many, dayStart, markerGroupMsForZoom(24));
    const total = grouped.reduce((sum, marker) => sum + marker.count, 0);
    expect(total).toBe(12);
  });
});
