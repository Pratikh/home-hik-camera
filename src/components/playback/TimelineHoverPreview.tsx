"use client";

import { Messages } from "@/lib/messages";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { THUMBNAIL_TILE } from "@/lib/playback-thumbnail";
import type { TimelineSegment } from "@/lib/timeline";
import type { HoverPreviewState } from "@/components/playback/useTimelineThumbnails";

/**
 * The frame under the pointer, above the timeline.
 *
 * The picture is a window onto a pre-generated sprite sheet: one element, one
 * `background-position`, no per-frame request and no image decode on hover. The
 * tile is 11:9 at exactly the size it is drawn, so the CCTV image is never
 * stretched or upscaled. Near an edge the card is clamped while the arrow keeps
 * pointing at the real cursor.
 */

const CARD_WIDTH = THUMBNAIL_TILE.width;
const CARD_HEIGHT = THUMBNAIL_TILE.height;
const EDGE_MARGIN = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function TimelineHoverPreview({
  state,
  cursorPercent,
  containerWidth,
  dayStartMs,
  segment,
  cameraName,
  eventLabel,
  placement,
}: {
  state: HoverPreviewState;
  cursorPercent: number;
  containerWidth: number;
  dayStartMs: number;
  segment: TimelineSegment | null;
  cameraName?: string;
  eventLabel?: string | null;
  placement: "above" | "below";
}) {
  if (state.kind === "idle") return null;
  // A card wider than the track would be clamped into meaninglessness.
  if (containerWidth < CARD_WIDTH + EDGE_MARGIN * 2) return null;

  const shownOffset = state.kind === "ready" ? state.frameOffsetMs : state.offsetMs;
  const time = formatKolkataClock(new Date(dayStartMs + shownOffset));
  const halfPercent = ((CARD_WIDTH / 2 + EDGE_MARGIN) / containerWidth) * 100;
  const centerPercent = clamp(cursorPercent, halfPercent, 100 - halfPercent);

  const note =
    state.kind === "generating"
      ? Messages.previewGenerating
      : state.kind === "no-recording"
        ? Messages.previewNoRecording
        : Messages.previewUnavailable;

  const anchor = placement === "above" ? "bottom-full mb-3" : "top-full mt-3";
  const arrowAnchor = placement === "above" ? "bottom-full mb-[10px]" : "top-full mt-[10px]";

  return (
    <>
      <div
        className={`pointer-events-none absolute z-30 -translate-x-1/2 ${anchor}`}
        style={{ left: `${centerPercent}%`, width: CARD_WIDTH }}
        role="tooltip"
        aria-label={`Preview at ${time}`}
      >
        <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-xl shadow-black/70">
          {state.kind === "ready" ? (
            <div
              className="bg-black"
              style={{
                width: CARD_WIDTH,
                height: CARD_HEIGHT,
                backgroundImage: `url(${state.url})`,
                backgroundPosition: `-${state.x}px -${state.y}px`,
                backgroundRepeat: "no-repeat",
              }}
              role="img"
              aria-label={`Recorded frame at ${time}`}
            />
          ) : (
            <div
              className="grid place-items-center bg-black/70 px-3 text-center"
              style={{ width: CARD_WIDTH, height: CARD_HEIGHT }}
            >
              {state.kind === "generating" ? (
                <span className="flex flex-col items-center gap-2">
                  <span className="h-1.5 w-16 animate-pulse rounded-full bg-white/20" aria-hidden="true" />
                  <span className="text-[11px] leading-tight text-white/70">{note}</span>
                </span>
              ) : (
                <span className="text-[11px] leading-tight text-white/70">{note}</span>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
            <span className="font-mono text-xs tabular-nums text-ink">{time}</span>
            {eventLabel ? (
              <span className="shrink-0 rounded bg-teal/15 px-1.5 py-0.5 text-[10px] font-medium text-teal">{eventLabel}</span>
            ) : segment ? (
              <span className="shrink-0 truncate text-[10px] text-muted">{segment.label}</span>
            ) : null}
          </div>
          {cameraName && state.kind === "ready" ? (
            <p className="truncate border-t border-line/60 px-2 py-1 text-[10px] text-muted">{cameraName}</p>
          ) : null}
        </div>
      </div>
      {/* Keeps the card visually attached to the cursor even when it was clamped. */}
      <span
        className={`pointer-events-none absolute z-30 h-2 w-2 -translate-x-1/2 rotate-45 border-line bg-panel ${arrowAnchor} ${
          placement === "above" ? "border-b border-r" : "border-l border-t"
        }`}
        style={{ left: `${cursorPercent}%` }}
        aria-hidden="true"
      />
    </>
  );
}
