"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecordingType } from "@/lib/api-types";
import type { CctvEvent } from "@/lib/events";
import { eventTitle } from "@/lib/events";
import { priorityLabel } from "@/lib/priority";
import { DAY_MS, formatKolkataClock, formatKolkataHourMinute } from "@/lib/time-kolkata";
import { buildTimelineMarkers, markerGroupMsForZoom, type TimelineMarker } from "@/lib/timeline-markers";
import { clampLabelCenter, percentOf, resolveGroupMs } from "@/lib/timeline-density";
import { segmentPercents, tickStep, timelineTicks, type TimelineSegment, type TimelineWindow } from "@/lib/timeline";
import { useElementWidth } from "@/components/hooks/useElementWidth";
import { TimelineHoverPreview } from "@/components/playback/TimelineHoverPreview";
import { useHoverCapable, useTimelineThumbnails } from "@/components/playback/useTimelineThumbnails";

/** Recording bar height: thin enough that gaps read clearly. */
const TRACK_H = 20;

function barClass(type: RecordingType | null): string {
  // A single base colour keeps the track calm; the type is a subtle accent.
  if (type === "alarm") return "bg-offline/85";
  if (type === "motion") return "bg-online/75";
  return "bg-online";
}

function markerTone(priority: TimelineMarker["priority"]): { dot: string; ring: string } {
  if (priority === "CRITICAL") return { dot: "bg-offline", ring: "ring-offline/50" };
  if (priority === "HIGH") return { dot: "bg-warn", ring: "ring-warn/40" };
  return { dot: "bg-teal", ring: "ring-teal/30" };
}

function markerSize(marker: TimelineMarker): string {
  if (marker.count > 1) return "h-3.5 w-3.5";
  if (marker.priority === "CRITICAL") return "h-3.5 w-3.5";
  if (marker.priority === "HIGH") return "h-3 w-3";
  return "h-2.5 w-2.5";
}

function clock(dayStartMs: number, offsetMs: number): string {
  if (offsetMs >= DAY_MS) return "24:00";
  return formatKolkataHourMinute(new Date(dayStartMs + offsetMs));
}

function fullClock(dayStartMs: number, offsetMs: number): string {
  return formatKolkataClock(new Date(dayStartMs + offsetMs));
}

export function PlaybackTimeline({
  dayStartMs,
  segments,
  window: visible,
  positionMs,
  zoom,
  onZoom,
  onSeek,
  events = [],
  cameraName,
  camera,
  date,
}: {
  dayStartMs: number;
  segments: TimelineSegment[];
  window: TimelineWindow;
  positionMs: number | null;
  zoom: 24 | 6 | 1;
  onZoom: (zoom: 24 | 6 | 1) => void;
  /**
   * Called once per gesture, with the offset the user settled on. Dragging
   * previews locally and only fires this on release, so the player is never
   * flooded with seeks.
   */
  onSeek: (offsetMs: number) => void;
  events?: CctvEvent[];
  /** DVR camera name, shown in the event tooltip. */
  cameraName?: string;
  /** Which recording the hover preview should frame. */
  camera: number;
  /** The Kolkata day on screen; part of the preview cache identity. */
  date: string;
}) {
  const { ref: trackRef, width } = useElementWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<TimelineMarker | null>(null);
  /*
   * Dragging only moves a local preview. The player is told once, on release, so
   * scrubbing never floods it with seek requests and the playhead never fights
   * the position the player is reporting.
   */
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  /* Hovering the recording track shows the segment's details and the exact
     timestamp under the pointer, so a click is predictable. */
  const [hoverSegment, setHoverSegment] = useState<{ segment: TimelineSegment; offsetMs: number } | null>(null);
  /*
   * The preview needs a position even over a gap, where there is no segment to
   * describe; that position is also what the card is anchored to.
   */
  const [hoverPoint, setHoverPoint] = useState<{ offsetMs: number; percent: number } | null>(null);
  /*
   * The marker detail only opens after the pointer rests on a marker. Sweeping
   * across a cluster otherwise pops a popover for every marker crossed, and the
   * user is scrubbing, not inspecting.
   */
  const markerTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (markerTimer.current !== null) window.clearTimeout(markerTimer.current);
    },
    [],
  );
  const [hoverEventLabel, setHoverEventLabel] = useState<string | null>(null);
  const [previewPlacement, setPreviewPlacement] = useState<"above" | "below">("above");
  const hoverCapable = useHoverCapable();
  /*
   * Previews come from sprite sheets the server has already generated. The hook
   * only reports where the viewer is looking, so the background generator can
   * prioritise that region; the hover itself is a lookup.
   */
  const previewFocusMs = dayStartMs + (positionMs ?? Math.round((visible.startMs + visible.endMs) / 2));
  const {
    state: previewState,
    hover: hoverPreview,
    clear: clearPreview,
  } = useTimelineThumbnails({
    camera,
    date,
    dayStartMs,
    focusMs: previewFocusMs,
    enabled: hoverCapable,
  });

  /*
   * Grouping is width-aware: markers are merged only when they would otherwise
   * sit closer than a marker's width, so density is right on a phone and on a
   * wide monitor alike.
   */
  const span = visible.endMs - visible.startMs;
  const markers = useMemo(() => {
    const groupMs = resolveGroupMs(span, width, markerGroupMsForZoom(zoom));
    return buildTimelineMarkers(events, dayStartMs, groupMs);
  }, [events, dayStartMs, span, width, zoom]);

  const byId = useMemo(() => new Map(events.map((event) => [event.id, event])), [events]);
  const ticks = timelineTicks(visible, tickStep(zoom));
  const shownMs = dragOffset ?? positionMs;
  const playheadPercent = shownMs === null ? null : percentOf(shownMs, visible);
  const commit = onSeek;

  const offsetFromPointer = useCallback(
    (clientX: number, node: HTMLElement): number | null => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const ratio = (clientX - rect.left) / rect.width;
      return Math.round(visible.startMs + Math.min(1, Math.max(0, ratio)) * span);
    },
    [visible.startMs, span],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Markers handle their own clicks and stop propagation before this runs.
    const offset = offsetFromPointer(event.clientX, event.currentTarget);
    if (offset === null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    setHoverSegment(null);
    setHoverPoint(null);
    setHoverEventLabel(null);
    // A gesture is a seek, so the preview must not linger over the drag.
    clearPreview();
    setDragOffset(offset);
    setDragLabel(fullClock(dayStartMs, offset));
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const offset = offsetFromPointer(event.clientX, event.currentTarget);
    if (offset === null) return;
    if (!dragging) {
      // Report the segment under the cursor, or nothing when over a gap.
      const segment = segments.find((item) => offset >= item.startMs && offset < item.endMs) ?? null;
      setHoverSegment(segment ? { segment, offsetMs: offset } : null);
      setHoverEventLabel(null);
      setHoverPoint({ offsetMs: offset, percent: percentOf(offset, visible) });
      /*
       * The preview card sits above the track, but flips below it when the
       * timeline is near the top of the window and there is no room.
       */
      setPreviewPlacement(event.currentTarget.getBoundingClientRect().top > 240 ? "above" : "below");
      // Hovering a gap is free: no frame can exist there, so nothing is asked for.
      hoverPreview(offset, { recording: segment !== null });
      return;
    }
    setDragOffset(offset);
    setDragLabel(fullClock(dayStartMs, offset));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const offset = offsetFromPointer(event.clientX, event.currentTarget);
    setDragging(false);
    setDragLabel(null);
    setDragOffset(null);
    if (offset === null) return;
    // One seek for the whole gesture, at the position the user let go.
    commit(offset);
  }

  const labelPercent = playheadPercent === null ? null : clampLabelCenter(playheadPercent, 12);

  return (
    <section className="min-w-0 shrink-0 rounded-xl border border-line bg-card p-3" aria-label="Timeline">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Timeline</h2>
        <div className="flex gap-1" role="group" aria-label="Timeline scale">
          {([24, 6, 1] as const).map((hours) => (
            <button
              key={hours}
              type="button"
              aria-pressed={zoom === hours}
              onClick={() => onZoom(hours)}
              className={`h-8 rounded-lg border px-2.5 text-xs ${
                zoom === hours ? "border-teal bg-teal/10 text-teal" : "border-line text-muted hover:text-ink"
              }`}
            >
              {hours}h
            </button>
          ))}
        </div>
      </div>

      <div
        ref={trackRef}
        className={`relative touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-pointer"}`}
        role="slider"
        tabIndex={0}
        aria-label="Recording timeline. Use the arrow keys to seek."
        aria-valuemin={0}
        aria-valuemax={DAY_MS}
        aria-valuenow={positionMs ?? 0}
        aria-valuetext={positionMs === null ? "No position" : fullClock(dayStartMs, positionMs)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          setHoverSegment(null);
          setHoverPoint(null);
          setHoverEventLabel(null);
          clearPreview();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            commit(Math.max(0, (positionMs ?? 0) - 15_000));
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            commit(Math.min(DAY_MS - 1, (positionMs ?? 0) + 15_000));
          }
        }}
      >
        {/*
          Marker detail. It floats beside the preview rather than sitting in the
          flow: rendered inline it grew this section by its own height, which
          shrank the player and moved the whole timeline by ~225 px the moment a
          marker was crossed. It is inert, so it cannot steal the pointer.
        */}
        {hovered && hoverPoint ? (() => {
          const CARD = 198;
          const TIP = 232;
          const GAP = 10;
          const halfCard = ((CARD / 2 + 6) / width) * 100;
          const cardCenter = Math.min(100 - halfCard, Math.max(halfCard, hoverPoint.percent));
          const cardRight = (cardCenter / 100) * width + CARD / 2;
          const cardLeft = (cardCenter / 100) * width - CARD / 2;
          const roomRight = width - cardRight - GAP;
          const roomLeft = cardLeft - GAP;
          const left =
            roomRight >= TIP || roomLeft < TIP
              ? Math.min(width - TIP - 4, cardRight + GAP)
              : Math.max(4, cardLeft - GAP - TIP);
          return (
            <div className="pointer-events-none absolute bottom-full z-20 mb-3" style={{ left }}>
              <MarkerTooltip marker={hovered} byId={byId} dayStartMs={dayStartMs} cameraName={cameraName} />
            </div>
          );
        })() : null}

        {/*
          Hover preview: the recorded frame under the pointer, above the track.
          It overlays the ruler so it never shifts the layout, and it is inert so
          it can never intercept the click that seeks.
        */}
        {hoverPoint ? (
          <TimelineHoverPreview
            state={previewState}
            cursorPercent={hoverPoint.percent}
            containerWidth={width}
            dayStartMs={dayStartMs}
            segment={hoverSegment?.segment ?? null}
            cameraName={cameraName}
            eventLabel={hoverEventLabel}
            placement={previewPlacement}
          />
        ) : null}

        {/* Row 1: the playhead's floating time label. */}
        <div className="relative h-6">
          {playheadPercent !== null && labelPercent !== null ? (
            <span
              className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded bg-teal px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#08110f]"
              style={{ left: `${labelPercent}%` }}
            >
              {fullClock(dayStartMs, shownMs ?? 0)}
            </span>
          ) : null}
          {dragLabel ? (
            <span
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] text-white"
              role="status"
            >
              {dragLabel}
            </span>
          ) : null}
        </div>

        {/* Row 2: time ruler. */}
        <div className="relative h-4 border-b border-line/60 text-[10px] text-muted">
          {ticks.map((tick) => {
            const box = segmentPercents({ startMs: tick, endMs: tick + 1 }, visible);
            if (!box) return null;
            return (
              <span key={tick} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${box.left}%` }}>
                {clock(dayStartMs, tick)}
              </span>
            );
          })}
        </div>

        {/*
          Row 3: the recording track. The darker background IS the gap: anywhere
          without a segment means "no recording", and is never filled in.
        */}
        <div className="relative mt-1.5 overflow-hidden rounded" style={{ height: TRACK_H }}>
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
          {segments.map((segment) => {
            const box = segmentPercents(segment, visible);
            if (!box) return null;
            return (
              <span
                key={segment.id}
                className={`absolute inset-y-0 ${barClass(segment.type)}`}
                /* A hairline right edge keeps adjacent segments readable. */
                style={{ left: `${box.left}%`, width: `${Math.max(box.width, 0.25)}%`, boxShadow: "inset -1px 0 0 rgba(0,0,0,0.55)" }}
                title={`${segment.label} ${clock(dayStartMs, segment.startMs)}–${clock(dayStartMs, segment.endMs)}`}
              />
            );
          })}
        </div>

        {/* Row 4: the event track, separate from recording so the two never blur. */}
        <div className="relative mt-1 h-8">
          {markers.map((marker) => {
            const box = segmentPercents({ startMs: marker.offsetMs, endMs: marker.offsetMs + 1 }, visible);
            if (!box) return null;
            const tone = markerTone(marker.priority);
            const label = `${marker.label}, ${fullClock(dayStartMs, marker.offsetMs)}, ${priorityLabel(marker.priority)} priority${
              marker.count > 1 ? `, ${marker.count} events` : ""
            }`;
            return (
              <button
                key={marker.id}
                type="button"
                aria-label={label}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal"
                style={{ left: `${box.left}%` }}
                onPointerDown={(click) => click.stopPropagation()}
                onPointerUp={(click) => click.stopPropagation()}
                onClick={(click) => {
                  click.stopPropagation();
                  /*
                   * A click is a seek. The marker swallows pointerdown so pressing
                   * here does not start a drag, which also means the timeline never
                   * gets its own "gesture clears the preview" pass — do it here.
                   */
                  setHoverPoint(null);
                  setHoverEventLabel(null);
                  clearPreview();
                  commit(marker.offsetMs);
                }}
                /*
                 * The marker only decorates the timeline: it adds the event label
                 * and its own detail popover. It must never own the preview.
                 *
                 * It used to call hoverPreview() on enter and clearPreview() +
                 * setHoverPoint(null) on leave. Because a pointermove still bubbles
                 * from the button to the timeline, crossing a marker produced two
                 * competing writers: the timeline set the preview from the pointer
                 * x, the marker reset it to the event's own instant, and leaving
                 * deleted it outright until the next move. That is the flicker.
                 * Now the timeline is the only thing that positions the preview;
                 * the marker just labels it.
                 */
                onMouseEnter={() => {
                  if (markerTimer.current !== null) window.clearTimeout(markerTimer.current);
                  markerTimer.current = window.setTimeout(() => {
                    markerTimer.current = null;
                    setHovered(marker);
                    setHoverEventLabel(marker.count > 1 ? `${marker.count} events` : marker.label);
                  }, 150);
                }}
                onMouseLeave={() => {
                  if (markerTimer.current !== null) {
                    window.clearTimeout(markerTimer.current);
                    markerTimer.current = null;
                  }
                  setHovered((current) => (current?.id === marker.id ? null : current));
                  setHoverEventLabel(null);
                }}
                onFocus={() => setHovered(marker)}
                onBlur={() => setHovered((current) => (current?.id === marker.id ? null : current))}
              >
                <span
                  aria-hidden="true"
                  className={`block rounded-full ring-1 ${tone.dot} ${tone.ring} ${markerSize(marker)}`}
                />
                {marker.count > 1 ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-black/80 px-1 text-[9px] font-semibold leading-4 text-white"
                  >
                    {marker.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Playhead spans the ruler and both tracks, so it reads as one position. */}
        {playheadPercent !== null ? (
          <span
            className="pointer-events-none absolute bottom-0 top-6 w-0.5 -translate-x-1/2 bg-teal shadow-[0_0_6px_rgba(62,224,199,0.8)]"
            style={{ left: `${playheadPercent}%` }}
            aria-hidden="true"
          >
            <span className="absolute -left-[5px] -top-[5px] h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent border-t-teal" />
          </span>
        ) : null}
      </div>


      <Legend segments={segments} events={events} />
    </section>
  );
}

/**
 * Event detail for a marker. Built from the events already on the page, so no
 * extra request and no second event model.
 */
function MarkerTooltip({
  marker,
  byId,
  dayStartMs,
  cameraName,
}: {
  marker: TimelineMarker;
  byId: Map<string, CctvEvent>;
  dayStartMs: number;
  cameraName?: string;
}) {
  const group = marker.eventIds.map((id) => byId.get(id)).filter((event): event is CctvEvent => Boolean(event));
  const title = eventTitle(
    group[0]?.type ?? "motion",
    marker.classification ?? group[0]?.classification ?? null,
  );
  const at = fullClock(dayStartMs, marker.offsetMs);

  return (
    <div
      className="pointer-events-none w-[232px] rounded-lg border border-line bg-panel px-3 py-2 text-xs shadow-xl shadow-black/50"
      role="tooltip"
    >
      <p className="font-semibold">{title}</p>
      {cameraName ? <p className="text-muted">Camera: {cameraName}</p> : null}
      <p className="text-muted">
        Time: <span className="font-mono">{at}</span>
      </p>
      <p className="text-muted">Priority: {priorityLabel(marker.priority)}</p>
      {marker.count > 1 ? (
        <>
          <p className="mt-1 text-muted">Events around {at}:</p>
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {group.slice(0, 5).map((event) => (
              <li key={event.id} className="flex gap-2 font-mono text-[11px] text-muted">
                <span>{formatKolkataClock(new Date(event.timestamp))}</span>
                <span>{eventTitle(event.type, event.classification)}</span>
              </li>
            ))}
            {group.length > 5 ? <li className="text-[11px] text-muted">+{group.length - 5} more</li> : null}
          </ul>
        </>
      ) : null}
      <p className="mt-1 text-[11px] text-teal">Click to jump to event</p>
    </div>
  );
}

/**
 * Only the categories this day actually contains are shown, so the legend never
 * advertises something the DVR did not record.
 */
function Legend({ segments, events }: { segments: TimelineSegment[]; events: CctvEvent[] }) {
  const items: Array<{ key: string; label: string; swatch: string }> = [];
  if (segments.length > 0) {
    items.push({ key: "rec", label: "Recording", swatch: "h-2 w-4 rounded-sm bg-online" });
    if (segments.some((segment) => segment.type === "motion")) {
      items.push({ key: "motion", label: "Motion recording", swatch: "h-2 w-4 rounded-sm bg-online/75" });
    }
    if (segments.some((segment) => segment.type === "alarm")) {
      items.push({ key: "alarm", label: "Alarm recording", swatch: "h-2 w-4 rounded-sm bg-offline/85" });
    }
  }
  if (events.some((event) => event.priority === "CRITICAL")) {
    items.push({ key: "critical", label: "Critical event", swatch: "h-2.5 w-2.5 rounded-full bg-offline" });
  }
  if (events.length > 0) {
    items.push({ key: "event", label: "Event", swatch: "h-2.5 w-2.5 rounded-full bg-warn" });
  }

  if (items.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-[11px] text-muted">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className={`inline-block ${item.swatch}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
