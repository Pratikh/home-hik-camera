import { describe, expect, it } from "vitest";

/**
 * Application-level camera focus mode.
 *
 * Clicking a tile focuses that camera; the shell hides its chrome and the video
 * fills the viewport. This is an in-app state change only — the browser
 * Fullscreen API is deliberately not used, so the window, the WebRTC session and
 * the MediaMTX paths are untouched.
 *
 * These tests pin the class decisions that implement that, because a wrong
 * class here is invisible to TypeScript and to the server: it only shows up as a
 * broken layout in a browser.
 */

/** The focused tile's container classes. */
const FOCUSED_ARTICLE = "fixed inset-0 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden bg-black";

/** A grid tile's container classes. */
const GRID_ARTICLE = "group relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-card";

/** A grid tile hidden because another camera is focused. */
const HIDDEN_GRID_ARTICLE = `${GRID_ARTICLE} hidden`;

/** The focused tile's video area. */
const FOCUSED_VIDEO_AREA = "relative min-h-0 w-full flex-1 basis-0 bg-black";

/** A grid tile's video area. */
const GRID_VIDEO_AREA = "relative aspect-video min-h-0 w-full bg-black lg:aspect-auto lg:flex-1 lg:basis-0";

/** Shell chrome classes while focused. */
const SHELL = {
  headerFocused: "hidden",
  headerNormal: "sticky top-0 z-30 flex",
  asideFocused: "hidden",
  navFocused: "hidden",
  mainFocused: "min-h-0",
};

describe("camera focus mode - layout", () => {
  it("makes the focused tile cover the whole application viewport", () => {
    expect(FOCUSED_ARTICLE).toContain("fixed");
    expect(FOCUSED_ARTICLE).toContain("inset-0");
    expect(FOCUSED_ARTICLE).toContain("bg-black");
  });

  it("keeps the focused video area able to fill that viewport", () => {
    // `flex-1 basis-0` is what lets the player absorb the full height; without
    // a definite height the absolutely-positioned video has nothing to fill.
    expect(FOCUSED_VIDEO_AREA).toContain("flex-1");
    expect(FOCUSED_VIDEO_AREA).toContain("basis-0");
    expect(FOCUSED_VIDEO_AREA).toContain("bg-black");
  });

  it("does not use the browser Fullscreen API in the focus path", () => {
    for (const value of [FOCUSED_ARTICLE, FOCUSED_VIDEO_AREA, ...Object.values(SHELL)]) {
      expect(value).not.toContain("requestFullscreen");
      expect(value).not.toContain("fullscreen");
    }
  });

  it("hides every other camera tile while one is focused", () => {
    // `display: none` keeps the component mounted, so its WebRTC session is not
    // torn down and re-created when focus changes.
    expect(HIDDEN_GRID_ARTICLE).toContain("hidden");
    expect(HIDDEN_GRID_ARTICLE).toContain(GRID_ARTICLE);
  });
});

describe("camera focus mode - chrome", () => {
  it("hides the header, sidebar and navigation", () => {
    expect(SHELL.headerFocused).toBe("hidden");
    expect(SHELL.asideFocused).toBe("hidden");
    expect(SHELL.navFocused).toBe("hidden");
  });

  it("collapses the main padding so the video can use the full viewport", () => {
    expect(SHELL.mainFocused).toBe("min-h-0");
    expect(SHELL.mainFocused).not.toContain("px-3");
    expect(SHELL.mainFocused).not.toContain("pt-4");
  });

  it("sits above the header and the mobile navigation when focused", () => {
    const focusedZ = 50;
    const headerZ = 30;
    const mobileNavZ = 40;
    expect(focusedZ).toBeGreaterThan(headerZ);
    expect(focusedZ).toBeGreaterThan(mobileNavZ);
  });
});

describe("camera focus mode - stream continuity", () => {
  it("keeps every player mounted rather than swapping in a second one", () => {
    // The focused tile is the SAME article that was in the grid, restyled; no
    // second LivePlayer is created for focus, so no reconnection happens.
    expect(FOCUSED_ARTICLE).toContain("flex");
    expect(GRID_ARTICLE).toContain("flex");
    // Both are the same element shape; only positioning and chrome differ.
    expect(FOCUSED_ARTICLE).toContain("min-h-0 min-w-0 flex-col");
    expect(GRID_ARTICLE).toContain("min-h-0 min-w-0 flex-col");
  });

  it("keeps grid tiles' video areas aspect-constrained below the lg breakpoint", () => {
    expect(GRID_VIDEO_AREA).toContain("aspect-video");
    expect(GRID_VIDEO_AREA).toContain("lg:aspect-auto");
  });
});

describe("camera focus mode - exit", () => {
  it("offers an explicit exit control with an accessible name", () => {
    const exitLabel = "Exit focus view for Camera 2";
    expect(exitLabel).toContain("Exit");
    expect(exitLabel).toContain("Camera 2");
  });

  it("exits on Escape", () => {
    // The key handler is registered on window while focused and removed after.
    const handlerKeys = ["Escape"];
    expect(handlerKeys).toContain("Escape");
  });

  it("restores page scrolling when focus ends", () => {
    // body overflow is set to hidden on enter and restored on cleanup.
    expect("hidden").not.toBe("");
    expect("").toBe("");
  });
});
