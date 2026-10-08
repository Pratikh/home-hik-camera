import type { Recording, RecordingType } from "@/lib/recording";
import { DAY_MS } from "@/lib/time-kolkata";

export type TimelineSegment = {
  id: string;
  camera: number;
  type: RecordingType | null;
  label: string;
  startTime: string;
  endTime: string;
  startMs: number;
  endMs: number;
};

export type TimelineWindow = {
  startMs: number;
  endMs: number;
};

export function toTimelineSegment(recording: Recording, dayStartMs: number, dayEndMs: number): TimelineSegment | null {
  const start = new Date(recording.startTime).getTime();
  const end = new Date(recording.endTime).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const clipStart = Math.max(start, dayStartMs);
  const clipEnd = Math.min(end, dayEndMs);
  if (clipEnd <= clipStart) return null;
  return {
    id: recording.id,
    camera: recording.camera,
    type: recording.type,
    label: recording.label,
    startTime: recording.startTime,
    endTime: recording.endTime,
    startMs: clipStart - dayStartMs,
    endMs: clipEnd - dayStartMs,
  };
}

export function segmentPercents(
  segment: Pick<TimelineSegment, "startMs" | "endMs">,
  window: TimelineWindow,
): { left: number; width: number } | null {
  const span = window.endMs - window.startMs;
  if (span <= 0) return null;
  const start = Math.max(segment.startMs, window.startMs);
  const end = Math.min(segment.endMs, window.endMs);
  if (end <= start) return null;
  return {
    left: ((start - window.startMs) / span) * 100,
    width: ((end - start) / span) * 100,
  };
}

export function adjacency(leftEndMs: number, rightStartMs: number): "overlap" | "touch" | "gap" {
  if (rightStartMs < leftEndMs) return "overlap";
  if (rightStartMs === leftEndMs) return "touch";
  return "gap";
}

export function assignLanes(segments: Array<Pick<TimelineSegment, "startMs" | "endMs">>): number[] {
  const laneEnds = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  return segments.map((segment) => {
    const lane = segment.startMs < laneEnds[0] ? 1 : 0;
    laneEnds[lane] = Math.max(laneEnds[lane] ?? segment.endMs, segment.endMs);
    return lane;
  });
}

export function zoomWindow(zoomHours: number, focusMs: number): TimelineWindow {
  const span = Math.min(DAY_MS, Math.max(1, zoomHours) * 60 * 60 * 1000);
  let startMs = focusMs - span / 2;
  if (startMs < 0) startMs = 0;
  if (startMs + span > DAY_MS) startMs = DAY_MS - span;
  return { startMs, endMs: startMs + span };
}

export function timeAtRatio(ratio: number, window: TimelineWindow): number {
  const clamped = Math.min(1, Math.max(0, ratio));
  return window.startMs + clamped * (window.endMs - window.startMs);
}

export function timelineTicks(window: TimelineWindow, stepMs: number): number[] {
  if (stepMs <= 0) return [];
  const ticks: number[] = [];
  const first = Math.ceil(window.startMs / stepMs) * stepMs;
  for (let ms = first; ms <= window.endMs; ms += stepMs) ticks.push(ms);
  return ticks;
}

export function tickStep(zoomHours: number): number {
  if (zoomHours <= 1) return 10 * 60 * 1000;
  if (zoomHours <= 6) return 60 * 60 * 1000;
  return 4 * 60 * 60 * 1000;
}

export function recordingAt(recordings: Recording[], instantMs: number): Recording | null {
  return (
    recordings.find((recording) => {
      const start = new Date(recording.startTime).getTime();
      const end = new Date(recording.endTime).getTime();
      return Number.isFinite(start) && Number.isFinite(end) && instantMs >= start && instantMs < end;
    }) ?? null
  );
}
