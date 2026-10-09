import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaybackTimeline } from "@/components/playback/PlaybackTimeline";
import type { CctvEvent } from "@/lib/events";
import { kolkataDayBounds } from "@/lib/time-kolkata";
import { toTimelineSegment, zoomWindow, type TimelineSegment } from "@/lib/timeline";

/**
 * The redesigned timeline.
 *
 * Rendered to static markup so the layer structure, the derived legend and the
 * accessible labels can be asserted without a browser. React DayPicker-style
 * behaviour (drag, hover) still needs a real browser, but everything structural
 * is pinned here.
 */

const DAY = "2026-10-09";
const bounds = kolkataDayBounds(DAY)!;
const DAY_START = bounds.start.getTime();
const DAY_END = bounds.end.getTime();

function recording(id: string, startClock: string, endClock: string, type: "continuous" | "motion" | "alarm" | null = "continuous") {
  return {
    id,
    camera: 1,
    startTime: `${DAY}T${startClock}+05:30`,
    endTime: `${DAY}T${endClock}+05:30`,
    type,
    label: type ?? "Recording",
  };
}

function segmentsFrom(recordings: ReturnType<typeof recording>[]): TimelineSegment[] {
  return recordings
    .map((item) => toTimelineSegment(item, DAY_START, DAY_END))
    .filter((item): item is TimelineSegment => item !== null);
}

function event(id: string, clock: string, patch: Partial<CctvEvent> = {}): CctvEvent {
  return {
    id,
    cameraId: 1,
    type: "motion",
    classification: null,
    timestamp: `${DAY}T${clock}+05:30`,
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

function render(props: {
  segments?: TimelineSegment[];
  events?: CctvEvent[];
  positionMs?: number | null;
  zoom?: 24 | 6 | 1;
  cameraName?: string;
}) {
  const zoom = props.zoom ?? 24;
  return renderToStaticMarkup(
    createElement(PlaybackTimeline, {
      dayStartMs: DAY_START,
      segments: props.segments ?? [],
      window: zoomWindow(zoom, props.positionMs ?? 12 * 3600_000),
      positionMs: props.positionMs ?? null,
      zoom,
      onZoom: () => undefined,
      onSeek: () => undefined,
      events: props.events ?? [],
      cameraName: props.cameraName ?? "Parking",
    }),
  );
}

describe("playback timeline - layers", () => {
  it("renders a recording track with a distinct background for gaps", () => {
    const html = render({ segments: segmentsFrom([recording("a", "08:00:00", "09:00:00")]) });
    // The dark track behind the segments is what makes a gap visible.
    expect(html).toContain("bg-black/50");
  });

  it("renders recording segments separately from the event track", () => {
    const html = render({
      segments: segmentsFrom([recording("a", "08:00:00", "09:00:00")]),
      events: [event("e1", "08:30:00")],
    });
    expect(html).toContain("bg-online");
    // An event marker renders as a button with an accessible label.
    expect(html).toContain("08:30:00");
  });

  it("does not fill a gap between two recordings", () => {
    const html = render({
      segments: segmentsFrom([recording("a", "08:00:00", "09:00:00"), recording("b", "12:00:00", "13:00:00")]),
    });
    // Two segments, and only two — nothing spanning the 09:00–12:00 gap.
    expect((html.match(/bg-online/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("09:00:00–12:00:00");
  });

  it("keeps the track thin rather than a huge block", () => {
    const html = render({ segments: segmentsFrom([recording("a", "08:00:00", "09:00:00")]) });
    expect(html).toContain("height:20px");
  });
});

describe("playback timeline - legend", () => {
  it("omits the legend entirely when there is nothing to show", () => {
    const html = render({});
    expect(html).not.toContain("Motion recording");
    expect(html).not.toContain("Critical event");
  });

  it("shows Recording when segments exist", () => {
    const html = render({ segments: segmentsFrom([recording("a", "08:00:00", "09:00:00")]) });
    expect(html).toContain("Recording");
  });

  it("does not advertise a recording type the day does not contain", () => {
    const html = render({ segments: segmentsFrom([recording("a", "08:00:00", "09:00:00", "continuous")]) });
    expect(html).not.toContain("Motion recording");
    expect(html).not.toContain("Alarm recording");
  });

  it("shows Motion recording only when a motion segment is present", () => {
    const html = render({ segments: segmentsFrom([recording("a", "08:00:00", "09:00:00", "motion")]) });
    expect(html).toContain("Motion recording");
  });

  it("shows Critical event only when a critical event is present", () => {
    const plain = render({ events: [event("e1", "08:30:00", { priority: "HIGH" })] });
    expect(plain).not.toContain("Critical event");
    const critical = render({ events: [event("e1", "08:30:00", { priority: "CRITICAL" })] });
    expect(critical).toContain("Critical event");
  });

  it("no longer shows implementation concepts as legend categories", () => {
    const html = render({
      segments: segmentsFrom([recording("a", "08:00:00", "09:00:00")]),
      events: [event("e1", "08:30:00")],
    });
    expect(html).not.toContain("Grouped");
    expect(html).not.toContain("Event (high)");
  });
});

describe("playback timeline - accessibility", () => {
  it("is an operable slider with a value in clock time", () => {
    const html = render({ positionMs: 15 * 3600_000 + 28 * 60_000, segments: [] });
    expect(html).toContain('role="slider"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-valuetext="15:28:00"');
  });

  it("labels an event marker with type, time and priority", () => {
    const html = render({
      events: [event("e1", "15:28:25", { priority: "HIGH", classification: "person" })],
    });
    expect(html).toContain("Person detected, 15:28:25, High priority");
  });

  it("says when a marker stands for several events", () => {
    const html = render({
      events: [event("e1", "15:28:05"), event("e2", "15:28:12"), event("e3", "15:28:18")],
    });
    expect(html).toMatch(/3 events|2 events/);
  });

  it("gives the zoom controls a group label", () => {
    const html = render({});
    expect(html).toContain('aria-label="Timeline scale"');
  });

  it("marks the active zoom for assistive technology", () => {
    const html = render({ zoom: 6 });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });
});

describe("playback timeline - playhead", () => {
  it("renders no playhead without a position", () => {
    const html = render({ positionMs: null });
    expect(html).not.toContain("shadow-[0_0_6px_rgba(62,224,199,0.8)]");
  });

  it("renders a playhead and its time label when a position is known", () => {
    const html = render({ positionMs: 15 * 3600_000 + 28 * 60_000 + 25_000 });
    expect(html).toContain("shadow-[0_0_6px_rgba(62,224,199,0.8)]");
    expect(html).toContain("15:28:25");
  });

  it("clamps the time label so it cannot leave the track", () => {
    // A position at the very start of the day would otherwise clip the label.
    const html = render({ positionMs: 0 });
    const match = /style="left:([0-9.]+)%"/.exec(html);
    expect(match).not.toBeNull();
    const left = Number(match![1]);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(100);
  });
});

describe("playback timeline - primary navigation", () => {
  /**
   * The timeline is now the only recording navigation on the page: no recording
   * cards, no second list. These assertions describe what the timeline itself
   * must expose for that to hold.
   */
  it("renders one segment element per recording, so nothing is summarised away", () => {
    const segments = segmentsFrom([
      recording("a", "00:00:00", "02:00:00"),
      recording("b", "02:00:00", "04:00:00"),
      recording("c", "08:00:00", "12:00:00"),
    ]);
    const html = render({ segments });
    expect((html.match(/inset -1px 0 0/g) ?? []).length).toBe(3);
  });

  it("carries the segment time range on the element for hover context", () => {
    const html = render({ segments: segmentsFrom([recording("a", "08:00:00", "12:00:00")]) });
    expect(html).toContain("08:00");
    expect(html).toContain("12:00");
  });

  it("exposes the whole track as the seek surface", () => {
    const html = render({ segments: segmentsFrom([recording("a", "08:00:00", "12:00:00")]) });
    expect(html).toContain('role="slider"');
    expect(html).toContain("cursor-pointer");
  });

  it("gives every segment a text description for non-hover clients", () => {
    // The rich tooltip is hover-only, so the plain title is the fallback that
    // still describes the segment without a pointer.
    const html = render({ segments: segmentsFrom([recording("a", "08:00:00", "12:00:00")]) });
    expect(html).toMatch(/title="[^"]*08:00[^"]*12:00[^"]*"/);
  });
});
