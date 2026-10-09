import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaybackPlayer } from "@/components/playback/PlaybackPlayer";
import { PageIntro } from "@/components/ui/States";

/**
 * Playback page layout.
 *
 * Regression guard for the defect where the player frame carried an
 * unconditional `aspect-video`. That derived a 16:9 height from the WIDTH, so at
 * a 1920px window the frame was ~929px tall and pushed the timeline below the
 * fold. The sub streams are also 704x576 (~1.22:1), so a 16:9 box additionally
 * produced large black bars.
 */

function renderPlayer() {
  return renderToStaticMarkup(
    createElement(PlaybackPlayer, {
      camera: 1,
      bounds: { start: "2026-10-09T08:00:00+05:30", end: "2026-10-09T12:00:00+05:30" },
      playFrom: "2026-10-09T08:00:00+05:30",
      playNonce: 1,
      onPosition: () => undefined,
    }),
  );
}

describe("playback player - frame sizing", () => {
  it("does not force a width-derived 16:9 height on desktop", () => {
    const html = renderPlayer();
    // The aspect ratio may apply on mobile, but must be released at md and up.
    expect(html).toContain("md:aspect-auto");
  });

  it("lets the frame flex into the height left by the timeline", () => {
    const html = renderPlayer();
    expect(html).toContain("md:flex-1");
    expect(html).toContain("md:min-h-0");
  });

  it("keeps the player section able to shrink", () => {
    const html = renderPlayer();
    expect(html).toContain("flex min-w-0 flex-col md:min-h-0 md:flex-1");
  });

  it("centres a stage that can take the stream's own ratio", () => {
    const html = renderPlayer();
    expect(html).toContain("relative h-full max-h-full w-full max-w-full");
    expect(html).toContain("items-center justify-center");
  });
});

describe("playback player - picture fidelity", () => {
  it("uses object-contain so the picture is never stretched", () => {
    const html = renderPlayer();
    expect(html).toContain("object-contain");
  });

  it("never uses object-fill, which would distort the camera image", () => {
    expect(renderPlayer()).not.toContain("object-fill");
  });

  it("never uses object-cover, which would crop the camera image", () => {
    expect(renderPlayer()).not.toContain("object-cover");
  });
});

describe("playback player - vertical economy", () => {
  it("keeps the clock compact rather than a large block", () => {
    const html = renderPlayer();
    // Was mt-3 text-lg; tightened to save vertical space.
    expect(html).toContain("mt-2 font-mono text-base");
    expect(html).not.toContain("mt-3 font-mono text-lg");
  });

  it("keeps the control row tight against the video", () => {
    expect(renderPlayer()).toContain('<div class="mt-2">');
  });
});

describe("page intro - compact variant", () => {
  it("drops the bottom margin when the parent already applies a gap", () => {
    const compact = renderToStaticMarkup(
      createElement(PageIntro, { title: "CCTV Playback", detail: "detail", compact: true }),
    );
    expect(compact).not.toContain("mb-4");
    expect(compact).toContain("text-base font-semibold");
  });

  it("keeps the original spacing by default so other pages are unchanged", () => {
    const normal = renderToStaticMarkup(createElement(PageIntro, { title: "Events", detail: "detail" }));
    expect(normal).toContain("mb-4");
    expect(normal).toContain("text-lg");
  });
});
