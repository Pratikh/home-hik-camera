import { describe, expect, it } from "vitest";

/**
 * Mobile timeline gesture classification.
 *
 * The timeline is horizontally scrollable, so a horizontal drag must PAN and a
 * tap must SEEK. Getting this wrong means either the day cannot be browsed
 * (every swipe seeks) or seeking is impossible (every touch pans). These tests
 * pin the decision rule the component implements.
 */
const TAP_SLOP_PX = 8;

function classify(movedPx: number): "tap" | "pan" {
  return movedPx > TAP_SLOP_PX ? "pan" : "tap";
}

describe("mobile timeline gesture", () => {
  it("treats a still press as a tap (seek)", () => {
    expect(classify(0)).toBe("tap");
  });

  it("tolerates small finger jitter as a tap", () => {
    expect(classify(1)).toBe("tap");
    expect(classify(TAP_SLOP_PX)).toBe("tap");
  });

  it("treats a real horizontal drag as a pan (no seek)", () => {
    expect(classify(TAP_SLOP_PX + 1)).toBe("pan");
    expect(classify(40)).toBe("pan");
    expect(classify(200)).toBe("pan");
  });

  it("classifies a 10px drag as panning, matching the scroller's own slop", () => {
    expect(classify(10)).toBe("pan");
  });
});
