/**
 * Positioning rules for the playback date popover.
 *
 * Kept pure so the viewport-safety behaviour can be tested without a browser:
 * the popover must stay fully on screen and flip its anchor near the right edge.
 */

/** Width the popover aims for. */
export const POPOVER_WIDTH = 340;
/** Minimum gap kept between the popover and the viewport edge. */
export const EDGE_GAP = 12;

/** Popover width, shrunk so it never exceeds the viewport. */
export function popoverWidth(viewportWidth: number, preferred = POPOVER_WIDTH, gap = EDGE_GAP): number {
  return Math.min(preferred, Math.max(0, viewportWidth - gap * 2));
}

/**
 * True when the popover should hang from the field's right edge instead of its
 * left, which keeps it inside the viewport when the field is near the right side.
 */
export function shouldAlignRight(
  triggerLeft: number,
  viewportWidth: number,
  preferred = POPOVER_WIDTH,
  gap = EDGE_GAP,
): boolean {
  const width = popoverWidth(viewportWidth, preferred, gap);
  return triggerLeft + width > viewportWidth - gap;
}

/** Where the popover's left edge lands, for a sanity check that it is visible. */
export function popoverLeft(
  triggerLeft: number,
  triggerWidth: number,
  viewportWidth: number,
  alignRight: boolean,
  preferred = POPOVER_WIDTH,
  gap = EDGE_GAP,
): number {
  const width = popoverWidth(viewportWidth, preferred, gap);
  const raw = alignRight ? triggerLeft + triggerWidth - width : triggerLeft;
  // Clamp so rounding or a resize mid-flight cannot push it off screen.
  return Math.min(Math.max(raw, gap), Math.max(gap, viewportWidth - gap - width));
}
