/**
 * Timeline density rules.
 *
 * Event markers collide when they are closer together on screen than the marker
 * is wide. A fixed time window cannot solve that on its own: the same 10 minutes
 * is about 7px on a wide desktop bar and about 29px on a phone, so the grouping
 * window has to be derived from the pixels actually available.
 */

/** Minimum on-screen gap between two separate markers, in CSS pixels. */
export const MIN_MARKER_GAP_PX = 16;

/** Duration that, at this width, occupies a given number of pixels. */
export function msPerPixel(spanMs: number, widthPx: number): number {
  if (!(widthPx > 0) || !(spanMs > 0)) return 0;
  return spanMs / widthPx;
}

/**
 * The smallest time window worth grouping within, so that two markers placed
 * `minGapPx` apart are visually distinct.
 *
 * Returns 0 when the width is unknown, which tells the caller to fall back to a
 * duration-based window rather than grouping everything or nothing.
 */
export function groupWindowMs(
  spanMs: number,
  widthPx: number,
  minGapPx = MIN_MARKER_GAP_PX,
): number {
  const perPixel = msPerPixel(spanMs, widthPx);
  if (perPixel <= 0) return 0;
  return perPixel * minGapPx;
}

/**
 * Choose the grouping window for a zoom level.
 *
 * Uses the measured width when available; otherwise falls back to a
 * duration-based default so the timeline still behaves sensibly before the first
 * measurement (and during server rendering).
 */
export function resolveGroupMs(
  spanMs: number,
  widthPx: number,
  fallbackMs: number,
  minGapPx = MIN_MARKER_GAP_PX,
): number {
  const measured = groupWindowMs(spanMs, widthPx, minGapPx);
  if (measured <= 0) return fallbackMs;
  // Never group so aggressively that it hides real activity, and never so
  // tightly that markers still touch.
  return Math.min(Math.max(measured, 15_000), 60 * 60 * 1000);
}

/**
 * Percent position of an instant inside the window, clamped to [0, 100].
 * Used for the playhead and its label so neither can escape the track.
 */
export function percentOf(offsetMs: number, window: { startMs: number; endMs: number }): number {
  const span = window.endMs - window.startMs;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((offsetMs - window.startMs) / span) * 100));
}

/**
 * Keep a floating label inside its container.
 *
 * The playhead label is centred on the playhead, so at the extreme left or right
 * half of it would be clipped. This shifts the centre back by however much is
 * needed, given the label's width as a percentage of the container.
 */
export function clampLabelCenter(centerPercent: number, labelWidthPercent: number): number {
  const half = Math.max(0, labelWidthPercent) / 2;
  return Math.min(100 - half, Math.max(half, centerPercent));
}
