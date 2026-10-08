"use client";

import type { RecordingType } from "@/lib/api-types";
import { DAY_MS, formatKolkataHourMinute } from "@/lib/time-kolkata";
import { segmentPercents, tickStep, timelineTicks, type TimelineSegment, type TimelineWindow } from "@/lib/timeline";

function barClass(type: RecordingType | null): string {
  if (type === "continuous") return "bg-online";
  if (type === "motion") return "bg-warn";
  if (type === "alarm") return "bg-offline";
  return "bg-teal";
}

function clock(dayStartMs: number, offsetMs: number): string {
  if (offsetMs >= DAY_MS) return "24:00";
  return formatKolkataHourMinute(new Date(dayStartMs + offsetMs));
}

export function PlaybackTimeline({
  dayStartMs,
  segments,
  window,
  positionMs,
  zoom,
  onZoom,
  onSeek,
  events = [],
}: {
  dayStartMs: number;
  segments: TimelineSegment[];
  window: TimelineWindow;
  positionMs: number | null;
  zoom: 24 | 6 | 1;
  onZoom: (zoom: 24 | 6 | 1) => void;
  onSeek: (offsetMs: number) => void;
  events?: { id: string; offsetMs: number; label: string; classification: string | null }[];
}) {
  const ticks = timelineTicks(window, tickStep(zoom));
  const playhead =
    positionMs === null ? null : segmentPercents({ startMs: positionMs, endMs: positionMs + 1 }, window);

  function seekFromPointer(clientX: number, target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    onSeek(Math.round(window.startMs + Math.min(1, Math.max(0, ratio)) * (window.endMs - window.startMs)));
  }

  return (
    <section className="min-w-0 rounded-xl border border-line bg-card p-3" aria-label="Timeline">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Timeline</h2>
        <div className="flex gap-1" role="group" aria-label="Timeline scale">
          {([24, 6, 1] as const).map((hours) => (
            <button
              key={hours}
              type="button"
              aria-pressed={zoom === hours}
              onClick={() => onZoom(hours)}
              className={`h-9 rounded-lg border px-3 text-xs ${zoom === hours ? "border-teal text-teal" : "border-line text-muted"}`}
            >
              {hours}h
            </button>
          ))}
        </div>
      </div>
      <div
        className="relative h-16 cursor-pointer overflow-hidden rounded-lg bg-black/50"
        role="slider"
        tabIndex={0}
        aria-label="Recording timeline"
        aria-valuemin={0}
        aria-valuemax={DAY_MS}
        aria-valuenow={positionMs ?? 0}
        aria-valuetext={positionMs === null ? "No position" : clock(dayStartMs, positionMs)}
        onClick={(event) => seekFromPointer(event.clientX, event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onSeek(Math.max(0, (positionMs ?? 0) - 15_000));
          if (event.key === "ArrowRight") onSeek(Math.min(DAY_MS - 1, (positionMs ?? 0) + 15_000));
        }}
      >
        {segments.map((segment) => {
          const box = segmentPercents(segment, window);
          if (!box) return null;
          return (
            <span
              key={segment.id}
              className={`absolute top-4 h-6 rounded-sm ${barClass(segment.type)}`}
              style={{ left: `${box.left}%`, width: `${Math.max(box.width, 0.35)}%` }}
              title={`${segment.label} ${clock(dayStartMs, segment.startMs)}–${clock(dayStartMs, segment.endMs)}`}
            />
          );
        })}
        {events.map((event) => {
          const box = segmentPercents({ startMs: event.offsetMs, endMs: event.offsetMs + 1 }, window);
          if (!box) return null;
          const color = event.classification === "person" ? "bg-offline" : event.classification === "vehicle" ? "bg-warn" : "bg-teal";
          return (
            <button
              key={event.id}
              type="button"
              title={event.label}
              aria-label={event.label}
              className={`absolute top-1 h-3 w-3 -translate-x-1/2 rounded-full ${color}`}
              style={{ left: `${box.left}%` }}
              onClick={(click) => {
                click.stopPropagation();
                onSeek(event.offsetMs);
              }}
            />
          );
        })}
        {playhead ? (
          <span className="absolute inset-y-1 w-0.5 bg-white" style={{ left: `${playhead.left}%` }} aria-hidden="true" />
        ) : null}
      </div>
      <div className="relative mt-2 h-4 text-[11px] text-muted">
        {ticks.map((tick) => {
          const box = segmentPercents({ startMs: tick, endMs: tick + 1 }, window);
          if (!box) return null;
          return (
            <span key={tick} className="absolute -translate-x-1/2" style={{ left: `${box.left}%` }}>
              {clock(dayStartMs, tick)}
            </span>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
        <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-online" /> Continuous</li>
        <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warn" /> Motion</li>
        <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-offline" /> Alarm</li>
        <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-teal" /> Recording</li>
      </ul>
    </section>
  );
}
