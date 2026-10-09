import { describe, expect, it } from "vitest";
import { EDGE_GAP, POPOVER_WIDTH, popoverLeft, popoverWidth, shouldAlignRight } from "@/lib/date-popover";

/**
 * The date popover must never leave the viewport, on any screen, however close
 * the Date field sits to an edge. These are the rules that guarantee it.
 */

const VIEWPORTS = [1920, 1440, 1366, 1280, 1024, 768, 390];

describe("popoverWidth", () => {
  it("uses the preferred width when there is room", () => {
    for (const width of [1920, 1440, 1366, 1280, 1024, 768]) {
      expect(popoverWidth(width)).toBe(POPOVER_WIDTH);
    }
  });

  it("shrinks only when the preferred width would not fit", () => {
    // 390px still has room for the preferred 340px plus margins.
    expect(popoverWidth(390)).toBe(POPOVER_WIDTH);
    // Below 340 + margins it must shrink to the available space.
    expect(popoverWidth(320)).toBe(320 - EDGE_GAP * 2);
    expect(popoverWidth(320)).toBeLessThan(POPOVER_WIDTH);
  });

  it("never returns a negative width on an absurdly small viewport", () => {
    expect(popoverWidth(10)).toBeGreaterThanOrEqual(0);
  });

  it("keeps the whole popover inside every tested viewport", () => {
    for (const viewport of VIEWPORTS) {
      expect(popoverWidth(viewport)).toBeLessThanOrEqual(viewport - EDGE_GAP * 2);
    }
  });
});

describe("shouldAlignRight", () => {
  it("aligns left when the field is near the left edge", () => {
    expect(shouldAlignRight(0, 1440)).toBe(false);
    expect(shouldAlignRight(200, 1440)).toBe(false);
  });

  it("flips to right-alignment when the field is near the right edge", () => {
    // A 340px popover from x=1200 would run to 1540, past a 1440 viewport.
    expect(shouldAlignRight(1200, 1440)).toBe(true);
  });

  it("flips on a phone where the field is in the right-hand column", () => {
    // Grid puts the Date field at the halfway point on a narrow screen.
    expect(shouldAlignRight(195, 390)).toBe(true);
  });

  it("does not flip when the field leaves exactly enough room", () => {
    const viewport = 1440;
    const fits = viewport - EDGE_GAP - POPOVER_WIDTH;
    expect(shouldAlignRight(fits, viewport)).toBe(false);
    expect(shouldAlignRight(fits + 1, viewport)).toBe(true);
  });
});

describe("popoverLeft", () => {
  it("keeps the popover inside the viewport for every field position", () => {
    for (const viewport of VIEWPORTS) {
      for (const triggerLeft of [0, 50, 150, 200, 400, viewport / 2, viewport - 120]) {
        if (triggerLeft < 0 || triggerLeft > viewport) continue;
        const alignRight = shouldAlignRight(triggerLeft, viewport);
        const left = popoverLeft(triggerLeft, 120, viewport, alignRight);
        const width = popoverWidth(viewport);
        expect(left, `viewport ${viewport} at ${triggerLeft}`).toBeGreaterThanOrEqual(EDGE_GAP - 0.001);
        expect(left + width, `viewport ${viewport} at ${triggerLeft}`).toBeLessThanOrEqual(viewport - EDGE_GAP + 0.001);
      }
    }
  });

  it("prefers the field's left edge when aligning left", () => {
    expect(popoverLeft(300, 120, 1920, false)).toBe(300);
  });

  it("prefers the field's right edge when aligning right", () => {
    // Field right edge is 1320; popover width 340 -> left 980.
    expect(popoverLeft(1200, 120, 1440, true)).toBe(980);
  });

  it("clamps rather than overflowing when the field is at the very edge", () => {
    const left = popoverLeft(1439, 1, 1440, true);
    expect(left).toBeLessThanOrEqual(1440 - EDGE_GAP - popoverWidth(1440));
    expect(left).toBeGreaterThanOrEqual(EDGE_GAP);
  });
});
