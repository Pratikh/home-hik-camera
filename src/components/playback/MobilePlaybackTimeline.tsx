"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecordingType } from "@/lib/api-types";
import type { CctvEvent } from "@/lib/events";
import { eventTitle } from "@/lib/events";
import { DAY_MS, formatKolkataClock, formatKolkataHourMinute } from "@/lib/time-kolkata";
import { buildTimelineMarkers, markerGroupMsForZoom, type TimelineMarker } from "@/lib/timeline-markers";
import { percentOf } from "@/lib/timeline-density";
import { timelineTicks, type TimelineSegment } from "@/lib/timeline";

/**
 * Touch-first playback timeline for phones.
 *
 * The desktop timeline squeezes a whole day into the viewport width, which makes
 * every marker a few pixels wide on a phone. This one instead renders the same
 * window at a fixed, readable pixels-per-hour scale inside a horizontally
 * scrollable track, so a finger has real targets and the labels stay legible.
 *
 * Only existing data is drawn: recording segments come from the same search
 * result, markers from the same day's events, and the playhead from the same
 * position the player reports. Nothing here seeks or fetches on its own — a
 * gesture calls back once on release, exactly like the desktop track.
 */

/** Readable scale: 24h → 150px/h (3600px track); 6h → 240; 1h → 420. */
function pxPerHour(zoom: 24 | 6 | 1): number {
  if (zoom === 24) return 150;
  if (zoom === 6) return 240;
  return 420;
}

const TRACK_H = 56;

export type MobileTimelineFilter = "all" | "recording" | "event" | "person" | "vehicle";

export function MobilePlaybackTimeline({
  dayStartMs,
  segments,
  window: visible,
  positionMs,
  zoom,
  onZoom,
  onSeek,
  events = [],
  filter = "all",
}: {
  dayStartMs: number;
  segments: TimelineSegment[];
  window: { startMs: number; endMs: number };
  positionMs: number | null;
  zoom: 24 | 6 | 1;
  onZoom: (zoom: 24 | 6 | 1) => void;
  onSeek: (offsetMs: number) => void;
  events?: CctvEvent[];
  /** Which categories to draw; never removes underlying data. */
  filter?: MobileTimelineFilter;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  /*
   * A gesture that starts on the track is BOTH a candidate seek and a candidate
   * horizontal pan. We only commit a seek when the finger moved enough to be a
   * deliberate scrub; a flick is left to the browser's horizontal scrolling.
   * This is what stops "any tap seeks" and keeps the band pannable.
   */
  const gesture = useRef<{ x: number; offset: number; moved: number } | null>(null);
  /*
   * Width of the rendered window in pixels. The track is wider than the screen
   * so it can scroll; every percent therefore maps to real pixels, not to the
   * viewport.
   */
  const spanMs = Math.max(1, visible.endMs - visible.startMs);
  const trackPx = Math.max(1, Math.round((spanMs / 3_600_000) * pxPerHour(zoom)));

  /*
   * Classification filters narrow the EVENTS but keep the recording band: an
   * operator filtering to "Person" must still see what the DVR recorded. Only
   * "Event" hides the band. A dimmed band reads as "filtered, not absent".
   */
  const classificationFilter = filter === "person" || filter === "vehicle";
  const selectedSegments = useMemo(
    () => (filter === "event" ? [] : segments),
    [segments, filter],
  );
  const showEvents = filter !== "recording";
  const eventFilterPredicate = useCallback(
    (event: CctvEvent) => {
      if (filter === "person") return event.classification === "person";
      if (filter === "vehicle") return event.classification === "vehicle";
      if (filter === "recording") return false;
      return true;
    },
    [filter],
  );
  const filteredEvents = useMemo(() => events.filter(eventFilterPredicate), [events, eventFilterPredicate]);

  const markers = useMemo(() => {
    if (!showEvents) return [];
    const groupMs = markerGroupMsForZoom(zoom);
    return buildTimelineMarkers(filteredEvents, dayStartMs, groupMs);
  }, [showEvents, filteredEvents, dayStartMs, zoom]);

  /*
   * The desktop tick step is tuned for a full-width ruler. A phone scroller is
   * 340px wide, so we use a finer step that guarantees several legible labels
   * inside one screen (roughly every 150px of track).
   */
  /*
   * ~150 px per hour at 24h means a 1-hour step puts a label every 150px, so a
   * 340px viewport shows 2–3 legible times. 2h steps left a single lonely tick.
   */
  const mobileTickStep = zoom === 24 ? 3_600_000 : zoom === 6 ? 15 * 60_000 : 5 * 60_000;
  const ticks = timelineTicks(visible, mobileTickStep);
  const shownMs = positionMs;
  const playheadPct = shownMs === null ? null : percentOf(shownMs, visible);

  /*
   * Keep the playhead in view when the position changes from outside (a claim
   * from the player, a filter change). This runs only when the reported position
   * moves, so it does not fight a user's own scroll.
   */
  /*
   * Auto-follow the playhead, but NEVER overrule the user. During playback the
   * position updates every 250 ms; without this guard the effect would snap the
   * strip back to the playhead on the next tick and make the rest of the day
   * unreachable while the video runs. A scroll the user performed suspends
   * auto-follow until they seek again.
   */
  const lastAutoScroll = useRef<number | null>(null);
  const userScrolled = useRef(false);
  const lastSeekPosition = useRef<number | null>(null);
  /* Live scroll offset, so a ruler label that would be cut by the viewport
     edge can simply not be drawn (it showed "18:0"). */
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportW, setViewportW] = useState(0);
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const onScroll = () => {
      userScrolled.current = true;
      setScrollLeft(node.scrollLeft);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    setScrollLeft(node.scrollLeft);
    setViewportW(node.clientWidth);
    const resize = () => setViewportW(node.clientWidth);
    window.addEventListener("resize", resize);
    return () => {
      node.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", resize);
    };
  }, []);
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || positionMs === null) return;
    // A jump this large is a seek/recording change, not the ticking clock:
    // re-enable auto-follow for it.
    const previous = lastSeekPosition.current;
    if (previous === null || Math.abs(positionMs - previous) > 5_000) {
      userScrolled.current = false;
    }
    lastSeekPosition.current = positionMs;
    if (userScrolled.current) return;
    if (lastAutoScroll.current === positionMs) return;
    if (node.clientWidth <= 0) return;
    lastAutoScroll.current = positionMs;
    const target = (percentOf(positionMs, visible) / 100) * trackPx;
    const half = node.clientWidth / 2;
    if (target < node.scrollLeft + 24 || target > node.scrollLeft + node.clientWidth - 24) {
      node.scrollTo({ left: Math.max(0, target - half), behavior: "smooth" });
    }
  }, [positionMs, visible, trackPx]);

  const offsetFromPointer = useCallback(
    (clientX: number): number | null => {
      const node = scrollerRef.current;
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const x = clientX - rect.left + node.scrollLeft;
      if (rect.width <= 0) return null;
      const ratio = Math.min(1, Math.max(0, x / trackPx));
      return Math.round(visible.startMs + ratio * spanMs);
    },
    [visible.startMs, spanMs, trackPx],
  );

  /**
   * Touch gestures on a scrollable timeline:
   *
   * - **Horizontal drag → pan.** The finger scrolls the track; it never seeks.
   *   That is what makes a 24-hour day browsable on a 340px-wide screen, and it
   *   is the interaction the mobile reference uses.
   * - **Tap → seek** to that instant. One deliberate tap is the "scrub here"
   *   gesture, so a tap that lands where the user wants does not require a
   *   precision drag.
   *
   * Everything below the slop threshold is a tap; anything above it is a pan.
   */
  const TAP_SLOP_PX = 8;

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    const offset = offsetFromPointer(event.clientX);
    if (offset === null) return;
    // No pointer capture: capturing would steal the horizontal pan the browser
    // needs to scroll the track.
    gesture.current = { x: event.clientX, offset, moved: 0 };
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g) return;
    g.moved = Math.max(g.moved, Math.abs(event.clientX - g.x));
  }

  function endDrag(event: React.PointerEvent<HTMLElement>) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    // A drag was a pan: the browser moved the scroll position. Do not seek.
    if (g.moved > TAP_SLOP_PX) return;
    // A tap seeks to the tapped instant.
    const offset = offsetFromPointer(event.clientX);
    if (offset !== null) onSeek(offset);
  }

  const label = shownMs === null ? "--:--:--" : formatKolkataClock(new Date(dayStartMs + shownMs));

  return (
    <section
      className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-line bg-card p-3 lg:hidden"
      aria-label="Timeline"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-2">Timeline</h2>
        <div className="flex gap-1" role="group" aria-label="Timeline scale">
          {([24, 6, 1] as const).map((hours) => (
            <button
              key={hours}
              type="button"
              aria-pressed={zoom === hours}
              onClick={() => onZoom(hours)}
              className={`grid h-9 min-w-11 place-items-center rounded-lg border px-2 text-xs ${
                zoom === hours ? "border-teal bg-teal/10 text-teal" : "border-line text-muted"
              }`}
            >
              {hours}h
            </button>
          ))}
        </div>
      </div>

      {/* The selected instant, shown large: the number the user is hunting for. */}
      <p className="mb-2 font-mono text-xl font-semibold tabular-nums" aria-live="polite" data-testid="mobile-timeline-clock">
        {label}
      </p>

      {/*
        min-w-0 + w-full: a scroll container only clips its child if it is itself
        allowed to shrink inside the grid/flex parent. Without this the wide
        track pushed the whole page sideways on a phone.
      */}
      <div
        ref={scrollerRef}
        /*
          The scroller must be as wide as its PARENT, not as wide as the track.
          Without an explicit max-width it sized to its 3600px content, so there
          was nothing to scroll and a swipe could not pan.
        */
        className="w-full min-w-0 max-w-full touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain [-webkit-overflow-scrolling:touch]"
        style={{ touchAction: "pan-x" }}
      >
        <div
          className="relative cursor-pointer select-none"
          style={{ width: trackPx, touchAction: "pan-x" }}
          role="slider"
          aria-orientation="horizontal"
          tabIndex={0}
          aria-label="Recording timeline. Drag to seek, or use the arrow keys."
          aria-valuemin={0}
          aria-valuemax={DAY_MS}
          aria-valuenow={positionMs ?? 0}
          aria-valuetext={positionMs === null ? "No position" : formatKolkataClock(new Date(dayStartMs + positionMs))}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              onSeek(Math.max(0, (positionMs ?? 0) - 15_000));
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              onSeek(Math.min(DAY_MS - 1, (positionMs ?? 0) + 15_000));
            }
          }}
        >
          {/* Ruler */}
          <div className="relative mb-1 h-6 text-[11px] text-muted">
            {ticks.map((tick) => {
              const pct = percentOf(tick, visible);
              if (pct < 0 || pct > 100) return null;
              /*
               * A label centred within ~18px of either end of the TRACK would be
               * clipped mid-string by the scroller (it showed "18:0"). At the
               * very ends we align it inward instead of centring it.
               */
              const px = (pct / 100) * trackPx;
              /*
               * Clip risk is against the SCROLL VIEWPORT, not the track: a label
               * centred just inside the track edge is still cut when the scroller
               * is only ~340px wide. Reserve half a label (~20px) at both ends.
               */
              /*
               * Skip a label whose centred text would be cut by the current
               * scroll viewport — a half-drawn "18:0" reads as a wrong time.
               * ~22px is half a "HH:MM" label.
               */
              if (viewportW > 0) {
                const screenX = px - scrollLeft;
                if (screenX < 22 || screenX > viewportW - 22) return null;
              }
              const align = "-translate-x-1/2";
              return (
                <span key={tick} className={`absolute ${align} tabular-nums`} style={{ left: `${pct}%` }}>
                  {tick >= DAY_MS ? "24:00" : formatKolkataHourMinute(new Date(dayStartMs + tick))}
                </span>
              );
            })}
          </div>

          {/* Recording track: the dark background is the gap. */}
          <div className={`relative overflow-hidden rounded-lg ${classificationFilter ? "opacity-40" : ""}`} style={{ height: TRACK_H }}>
            <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
            {selectedSegments.map((segment) => {
              const startPct = percentOf(segment.startMs, visible);
              const endPct = percentOf(segment.endMs, visible);
              const left = Math.max(0, startPct);
              const right = Math.min(100, endPct);
              if (right <= left) return null;
              return (
                <span
                  key={segment.id}
                  className={`absolute inset-y-0 ${barClass(segment.type)}`}
                  style={{ left: `${left}%`, width: `${right - left}%` }}
                  title={`${segment.label} ${formatKolkataTime(dayStartMs, segment.startMs)}–${formatKolkataTime(dayStartMs, segment.endMs)}`}
                />
              );
            })}

            {/* Event markers ride on top of the recording band. */}
            {markers.map((marker) => {
              const pct = percentOf(marker.offsetMs, visible);
              if (pct < 0 || pct > 100) return null;
              return (
                <button
                  key={marker.id}
                  type="button"
                  aria-label={markerAccessibleLabel(marker, dayStartMs)}
                  className="absolute top-1/2 grid h-11 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
                  style={{ left: `${pct}%` }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSeek(marker.offsetMs);
                  }}
                >
                  <span aria-hidden="true" className={`block rounded-full ring-2 ring-black/50 ${markerTone(marker)} ${markerSize(marker)}`} />
                </button>
              );
            })}
          </div>

          {/* Playhead */}
          {playheadPct !== null ? (
            <span
              className="pointer-events-none absolute bottom-0 top-0 w-0.5 -translate-x-1/2 bg-teal shadow-[0_0_8px_rgba(62,224,199,0.9)]"
              style={{ left: `${playheadPct}%` }}
              aria-hidden="true"
            >
              <span className="absolute -left-[6px] -top-1 h-3 w-3.5 rounded-sm bg-teal" />
              {/*
                The instant rides the playhead handle itself. It is drawn inside
                the track (not above the ruler) so the section's overflow clip
                cannot cut it off — the earlier position was invisible.
              */}
              <span className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded bg-teal px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#08110f] shadow">
                {label}
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <Legend segments={selectedSegments} markers={markers} showEvents={showEvents} />
    </section>
  );
}

function formatKolkataTime(dayStartMs: number, offsetMs: number): string {
  if (offsetMs >= DAY_MS) return "24:00";
  return formatKolkataHourMinute(new Date(dayStartMs + offsetMs));
}

function barClass(type: RecordingType | null): string {
  if (type === "alarm") return "bg-offline/85";
  if (type === "motion") return "bg-online/75";
  return "bg-online";
}

function markerTone(marker: TimelineMarker): string {
  if (marker.priority === "CRITICAL") return "bg-offline";
  if (marker.priority === "HIGH") return "bg-warn";
  return "bg-teal";
}

function markerSize(marker: TimelineMarker): string {
  if (marker.count > 1 || marker.priority === "CRITICAL") return "h-3.5 w-3.5";
  if (marker.priority === "HIGH") return "h-3 w-3";
  return "h-2.5 w-2.5";
}

function markerAccessibleLabel(marker: TimelineMarker, dayStartMs: number): string {
  const time = formatKolkataClock(new Date(dayStartMs + marker.offsetMs));
  const count = marker.count > 1 ? `, ${marker.count} events` : "";
  return `${eventTitle("motion", marker.classification)}, ${time}, ${marker.priority} priority${count}. Seek here.`;
}

/** Categories present in the data only — never advertises an empty class. */
function Legend({
  segments,
  markers,
  showEvents,
}: {
  segments: TimelineSegment[];
  markers: TimelineMarker[];
  showEvents: boolean;
}) {
  const items: Array<{ key: string; label: string; swatch: string }> = [];
  if (segments.length > 0) {
    items.push({ key: "rec", label: "Recording", swatch: "bg-online" });
    if (segments.some((segment) => segment.type === "motion")) {
      items.push({ key: "motion", label: "Motion", swatch: "bg-online/75" });
    }
    if (segments.some((segment) => segment.type === "alarm")) {
      items.push({ key: "alarm", label: "Alarm", swatch: "bg-offline/85" });
    }
  }
  if (showEvents && markers.length > 0) {
    items.push({ key: "event", label: "Event", swatch: "bg-warn rounded-full" });
  }
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-sm ${item.swatch}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
