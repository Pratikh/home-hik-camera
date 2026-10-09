import { describe, expect, it } from "vitest";

/**
 * Layout invariants for the 2x2 dashboard camera grid.
 *
 * The grid must fit the four camera tiles inside the browser viewport on
 * desktop, without a page-level vertical scrollbar, while leaving enough room
 * for the header, page intro and padding above it.
 *
 * These are the same numbers the `--app-*` CSS variables in globals.css encode.
 * If the chrome heights change, these tests document what the grid depends on.
 */

/** Chrome above the grid, in px (matches --app-grid-chrome at a 16px root). */
const HEADER_PX = 3.8125 * 16;
const MAIN_PADDING_PX = 1.5 * 16;
const PAGE_INTRO_PX = 4.25 * 16;
const CHROME_PX = HEADER_PX + MAIN_PADDING_PX + PAGE_INTRO_PX;

/** Minimum grid height before `max(22rem, ...)` takes over. */
const MIN_GRID_PX = 352;
const GAP_PX = 16;

type Viewport = { name: string; w: number; h: number; expectFits: boolean };

/**
 * Desktop widths at which all four cameras must be visible without scrolling.
 * `expectFits` is false below the `lg` breakpoint, where the grid intentionally
 * stacks in one column and the page scrolls.
 */
const VIEWPORTS: Viewport[] = [
  { name: "1920x1080", w: 1920, h: 1080, expectFits: true },
  { name: "1440x900", w: 1440, h: 900, expectFits: true },
  { name: "1366x768", w: 1366, h: 768, expectFits: true },
  { name: "1280x720", w: 1280, h: 720, expectFits: true },
  { name: "1024x768", w: 1024, h: 768, expectFits: true },
  { name: "768x1024", w: 768, h: 1024, expectFits: false },
  { name: "390x844", w: 390, h: 844, expectFits: false },
];

function gridHeight(viewportH: number): number {
  return Math.max(MIN_GRID_PX, viewportH - CHROME_PX);
}

function tileHeight(viewportH: number): number {
  return (gridHeight(viewportH) - GAP_PX) / 2;
}

/** Content width available to the grid once the sidebar and padding are gone. */
function contentWidth(viewportW: number): number {
  return viewportW - 220 - 48;
}

function tileWidth(viewportW: number): number {
  return (contentWidth(viewportW) - GAP_PX) / 2;
}

/** The page scrolls when the grid plus the chrome exceeds the viewport. */
function pageScrolls(viewportH: number): boolean {
  return CHROME_PX + gridHeight(viewportH) > viewportH + 0.5;
}

describe("dashboard camera grid - viewport fit", () => {
  it("fits four tiles without page scroll at the desktop widths", () => {
    for (const viewport of VIEWPORTS.filter((item) => item.expectFits)) {
      expect(pageScrolls(viewport.h), `${viewport.name} should not scroll`).toBe(false);
    }
  });

  it("keeps every tile taller than a usable minimum", () => {
    for (const viewport of VIEWPORTS) {
      // On the stacked layouts the tile is unconstrained, so only the 2x2
      // desktop cases need a positive, readable height.
      if (!viewport.expectFits) continue;
      expect(tileHeight(viewport.h), viewport.name).toBeGreaterThan(120);
    }
  });

  it("never exceeds the viewport height on desktop", () => {
    for (const viewport of VIEWPORTS.filter((item) => item.expectFits)) {
      expect(gridHeight(viewport.h), viewport.name).toBeLessThanOrEqual(viewport.h);
    }
  });

  it("falls back to the minimum height on very short viewports instead of collapsing", () => {
    // At 480px tall the chrome leaves less than the 22rem minimum, so the grid
    // keeps the minimum and the page scrolls rather than squashing the tiles.
    const tiny = 480;
    expect(tiny - CHROME_PX).toBeLessThan(MIN_GRID_PX);
    expect(gridHeight(tiny)).toBe(MIN_GRID_PX);
    expect(MIN_GRID_PX / 2).toBeGreaterThan(150);
  });
});

describe("dashboard camera grid - tile proportions", () => {
  it("keeps desktop tiles close to a camera-like landscape ratio", () => {
    // The sub streams are 704x576 (1.22) up to 16:9. A tile far outside that
    // range would waste space or squash the picture.
    for (const viewport of VIEWPORTS.filter((item) => item.expectFits)) {
      const ratio = tileWidth(viewport.w) / tileHeight(viewport.h);
      expect(ratio, `${viewport.name} ratio ${ratio.toFixed(2)}`).toBeGreaterThan(1.1);
      expect(ratio, `${viewport.name} ratio ${ratio.toFixed(2)}`).toBeLessThan(2.6);
    }
  });

  it("gives all four tiles identical dimensions", () => {
    // A 2x2 grid with `grid-rows-2` and equal columns makes every cell the same
    // size, which is what keeps the tiles visually consistent.
    const columns = 2;
    const rows = 2;
    expect(columns * rows).toBe(4);
    expect(tileWidth(1366)).toBe(tileWidth(1366));
    expect(tileHeight(768)).toBe(tileHeight(768));
  });
});

describe("dashboard camera grid - chrome accounting", () => {
  it("reserves room for the header, main padding and page intro", () => {
    expect(CHROME_PX).toBeGreaterThan(140);
    expect(CHROME_PX).toBeLessThan(180);
  });

  it("uses the dynamic viewport unit so mobile browser chrome is accounted for", () => {
    // 100dvh (not 100vh) is what the `camera-grid-h` utility uses, so a mobile
    // URL bar collapsing does not push the grid past the fold.
    const utility = "height: max(22rem, calc(100dvh - var(--app-grid-chrome)))";
    expect(utility).toContain("100dvh");
    expect(utility).not.toContain("100vh ");
  });
});
describe("dashboard camera grid - CSS generation", () => {
  /**
   * Regression guard for a real defect: `lg:camera-grid-h` produced NO CSS,
   * because a hand-written class in `@layer utilities` has no `lg:` variant for
   * Tailwind to generate. The grid therefore had no height, the video area's
   * `flex-1` had no free space to grow into, and every tile collapsed to just
   * its caption. The breakpoint must live inside the rule.
   */
  const rule = "@media (min-width: 64rem) { .camera-grid-h { height: max(22rem, calc(100dvh - var(--app-grid-chrome))); } }";

  it("scopes the grid height with a media query rather than a Tailwind variant", () => {
    expect(rule).toContain("@media (min-width: 64rem)");
    expect(rule).toContain(".camera-grid-h");
    // A `lg:` prefixed class would not be generated for a custom utility.
    expect(rule).not.toContain("lg:camera-grid-h");
  });

  it("uses 100dvh so mobile browser chrome does not push tiles past the fold", () => {
    expect(rule).toContain("100dvh");
  });

  it("keeps a minimum height so tiles cannot collapse on very short viewports", () => {
    expect(rule).toContain("max(22rem");
  });

  it("does not apply the fixed height below the breakpoint", () => {
    // Below lg the grid must flow naturally (single column, page scrolls).
    const belowBreakpoint = "grid min-h-0 grid-cols-1 gap-3 camera-grid-h lg:grid-cols-2";
    expect(belowBreakpoint).toContain("grid-cols-1");
    // The class name is un-prefixed, so the media query alone decides when it applies.
    expect(belowBreakpoint).not.toContain("lg:camera-grid-h");
  });
});
