import { describe, expect, it } from "vitest";
import { clampLabelCenter, groupWindowMs, msPerPixel, percentOf, resolveGroupMs } from "@/lib/timeline-density";

/**
 * Timeline density rules.
 *
 * A fixed time window cannot keep event markers apart: the same duration covers
 * far fewer pixels on a phone than on a wide monitor. These rules derive the
 * grouping window from the pixels actually available.
 */

describe("msPerPixel", () => {
  it("scales with the span", () => {
    expect(msPerPixel(86_400_000, 1000)).toBe(86_400);
  });

  it("returns 0 for an unmeasurable width or span, so callers can fall back", () => {
    expect(msPerPixel(86_400_000, 0)).toBe(0);
    expect(msPerPixel(0, 1000)).toBe(0);
    expect(msPerPixel(-1, 1000)).toBe(0);
  });
});

describe("groupWindowMs", () => {
  it("groups more aggressively on a narrow bar than a wide one", () => {
    const wide = groupWindowMs(86_400_000, 1200);
    const narrow = groupWindowMs(86_400_000, 350);
    expect(narrow).toBeGreaterThan(wide);
  });

  it("is the duration of the minimum on-screen gap", () => {
    // 1 hour per 1000px -> a 16px gap is 57.6s.
    const hour = 3_600_000;
    expect(groupWindowMs(hour, 1000, 16)).toBeCloseTo((hour / 1000) * 16, 5);
  });

  it("returns 0 when the width is not yet known", () => {
    expect(groupWindowMs(86_400_000, 0)).toBe(0);
  });

  it("keeps 24h on a wide desktop coarser than 1h on the same bar", () => {
    const day = groupWindowMs(86_400_000, 1200);
    const hour = groupWindowMs(3_600_000, 1200);
    expect(day).toBeGreaterThan(hour);
  });
});

describe("resolveGroupMs", () => {
  it("uses the measurement once a width is available", () => {
    const measured = resolveGroupMs(86_400_000, 1000, 600_000);
    expect(measured).toBeCloseTo(groupWindowMs(86_400_000, 1000), 0);
  });

  it("falls back before the first measurement", () => {
    expect(resolveGroupMs(86_400_000, 0, 600_000)).toBe(600_000);
  });

  it("never groups tighter than a short floor, so markers cannot touch", () => {
    expect(resolveGroupMs(3_600_000, 100_000, 120_000)).toBeGreaterThanOrEqual(15_000);
  });

  it("never groups so widely that activity disappears", () => {
    expect(resolveGroupMs(86_400_000, 1, 600_000)).toBeLessThanOrEqual(3_600_000);
  });
});

describe("percentOf", () => {
  const window = { startMs: 1000, endMs: 2000 };

  it("maps the window edges to 0 and 100", () => {
    expect(percentOf(1000, window)).toBe(0);
    expect(percentOf(2000, window)).toBe(100);
  });

  it("clamps values outside the window", () => {
    expect(percentOf(0, window)).toBe(0);
    expect(percentOf(5000, window)).toBe(100);
  });

  it("returns 0 for a degenerate window", () => {
    expect(percentOf(1500, { startMs: 1000, endMs: 1000 })).toBe(0);
  });
});

describe("clampLabelCenter", () => {
  it("leaves a label in the middle untouched", () => {
    expect(clampLabelCenter(50, 10)).toBe(50);
  });

  it("holds the label against the left edge", () => {
    expect(clampLabelCenter(0, 10)).toBe(5);
    expect(clampLabelCenter(2, 10)).toBe(5);
  });

  it("holds the label against the right edge", () => {
    expect(clampLabelCenter(100, 10)).toBe(95);
  });

  it("keeps the whole label inside at both extremes", () => {
    const half = 6;
    for (const centre of [0, 1, 50, 99, 100]) {
      const clamped = clampLabelCenter(centre, half * 2);
      expect(clamped - half).toBeGreaterThanOrEqual(-0.001);
      expect(clamped + half).toBeLessThanOrEqual(100.001);
    }
  });
});

describe("timeline zoom levels", () => {
  /**
   * Zoom must change the visible time RANGE, not just rescale the same 24 hours.
   * 6h and 1h centre on the playhead so the position stays in view.
   */
  const DAY_MS = 24 * 60 * 60 * 1000;

  function zoomWindow(zoomHours: number, focusMs: number) {
    const span = Math.min(DAY_MS, Math.max(1, zoomHours) * 60 * 60 * 1000);
    let startMs = focusMs - span / 2;
    if (startMs < 0) startMs = 0;
    if (startMs + span > DAY_MS) startMs = DAY_MS - span;
    return { startMs, endMs: startMs + span };
  }

  const focus = 15 * 3_600_000 + 28 * 60_000;

  it("24h shows the whole day", () => {
    const w = zoomWindow(24, focus);
    expect(w.startMs).toBe(0);
    expect(w.endMs).toBe(DAY_MS);
  });

  it("6h shows a six-hour window", () => {
    const w = zoomWindow(6, focus);
    expect(w.endMs - w.startMs).toBe(6 * 3_600_000);
  });

  it("1h shows a one-hour window", () => {
    const w = zoomWindow(1, focus);
    expect(w.endMs - w.startMs).toBe(3_600_000);
  });

  it("zoomed windows centre the playhead once away from the day edges", () => {
    for (const hours of [6, 1]) {
      const w = zoomWindow(hours, focus);
      expect(percentOf(focus, w)).toBeCloseTo(50, 1);
    }
  });

  it("clamps to the start of the day instead of showing negative time", () => {
    const w = zoomWindow(6, 60_000);
    expect(w.startMs).toBe(0);
    expect(w.endMs).toBe(6 * 3_600_000);
  });

  it("clamps to the end of the day", () => {
    const w = zoomWindow(1, DAY_MS - 60_000);
    expect(w.endMs).toBe(DAY_MS);
    expect(w.startMs).toBe(DAY_MS - 3_600_000);
  });

  it("each zoom level narrows the range", () => {
    const ranges = [24, 6, 1].map((h) => {
      const w = zoomWindow(h, focus);
      return w.endMs - w.startMs;
    });
    expect(ranges[0]).toBeGreaterThan(ranges[1]!);
    expect(ranges[1]).toBeGreaterThan(ranges[2]!);
  });
});
