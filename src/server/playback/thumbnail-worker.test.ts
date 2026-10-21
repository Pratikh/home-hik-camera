import { afterEach, describe, expect, it } from "vitest";
import { frameGrid, requestThumbnails, resetThumbnailWorker, thumbnailWorkerState } from "@/server/playback/thumbnail-worker";

/**
 * Planning rules for the background generator.
 *
 * The DVR bills every extraction, so what must never be true is "we asked it for
 * a moment that was not recorded", or "we asked for the segment it is still
 * writing". These tests pin both.
 */

const CELL_SECONDS = 30;
const CELL = CELL_SECONDS * 1000;
const T0 = new Date("2026-10-21T07:00:00+05:30").getTime();

afterEach(() => {
  resetThumbnailWorker();
});

describe("frame grid", () => {
  it("generates only inside recorded spans", () => {
    // 07:00-07:02 recorded, 07:02-07:05 not, 07:05-07:06 recorded.
    const spans = [
      { start: T0, end: T0 + 2 * 60_000 },
      { start: T0 + 5 * 60_000, end: T0 + 6 * 60_000 },
    ];
    const grid = frameGrid(spans, CELL_SECONDS, T0 + 60 * 60_000);
    const minutes = grid.map((at) => (at - T0) / 60_000);
    // 07:00:00 .. 07:01:30 (four cells) and nothing in the gap.
    expect(minutes).toEqual([0, 0.5, 1, 1.5, 5, 5.5]);
  });

  it("aligns frames to the interval and drops a cell that would overhang", () => {
    const spans = [{ start: T0 + 7_000, end: T0 + 60_000 }];
    const grid = frameGrid(spans, CELL_SECONDS, T0 + 60 * 60_000);
    // The 07:00:30 cell needs 30 s of span; only 23 s remain before 07:01:00.
    expect(grid).toEqual([T0 + CELL]);
  });

  it("never asks for a segment the DVR is still writing", () => {
    const now = T0 + 90_000;
    const spans = [{ start: T0, end: T0 + 10 * 60_000 }];
    const grid = frameGrid(spans, CELL_SECONDS, now);
    const last = grid[grid.length - 1]!;
    // Only closed cells: the newest frame is at least one interval old, and its
    // own interval has elapsed.
    expect(last + CELL).toBeLessThanOrEqual(now);
    expect(grid).toEqual([T0, T0 + CELL, T0 + 2 * CELL]);
  });

  it("returns nothing for a day with no recording", () => {
    expect(frameGrid([], CELL_SECONDS)).toEqual([]);
  });

  it("handles many spans without duplicating a boundary cell", () => {
    const spans = [
      { start: T0, end: T0 + 60_000 },
      { start: T0 + 60_000, end: T0 + 120_000 },
    ];
    const grid = frameGrid(spans, CELL_SECONDS, T0 + 60 * 60_000);
    expect(grid).toEqual([T0, T0 + CELL, T0 + 2 * CELL, T0 + 3 * CELL]);
    expect(new Set(grid).size).toBe(grid.length);
  });
});

describe("queue", () => {
  it("does nothing when previews are switched off", () => {
    process.env.PLAYBACK_THUMBNAIL_ENABLED = "false";
    requestThumbnails({ camera: 1, date: "2026-10-21", focusMs: T0 });
    expect(thumbnailWorkerState().queued).toBe(0);
    delete process.env.PLAYBACK_THUMBNAIL_ENABLED;
  });

  it("ignores a malformed date", () => {
    requestThumbnails({ camera: 1, date: "../../etc", focusMs: T0 });
    expect(thumbnailWorkerState().queued).toBe(0);
  });

  it("queues at most one job per camera and day", () => {
    requestThumbnails({ camera: 1, date: "2026-10-21", focusMs: T0 });
    requestThumbnails({ camera: 1, date: "2026-10-21", focusMs: T0 + 60_000 });
    requestThumbnails({ camera: 2, date: "2026-10-21", focusMs: T0 });
    expect(thumbnailWorkerState().queued).toBe(2);
  });
});
