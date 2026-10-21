import { describe, expect, it } from "vitest";
import {
  DEFAULT_THUMBNAIL_INTERVAL_SECONDS,
  findThumbnail,
  THUMBNAIL_MATCH_TOLERANCE_FACTOR,
  offsetToThumbnailClock,
  quantizeToInterval,
  spriteBucketMs,
  spriteStartFor,
  THUMBNAIL_TILE,
  THUMBNAIL_TILES_PER_SPRITE,
  thumbnailIntervalMs,
  tilePosition,
  type ThumbnailIndex,
} from "@/lib/playback-thumbnail";

/**
 * A hover must resolve to a tile that is already on disk. These are the rules
 * that decide which tile that is, and they are shared with the generator, so a
 * mistake here shows up as the wrong frame rather than as a slow preview.
 */

const INTERVAL = DEFAULT_THUMBNAIL_INTERVAL_SECONDS; // 30 s
const CELL = thumbnailIntervalMs(INTERVAL); // 30_000
const BUCKET = spriteBucketMs(INTERVAL); // 720_000 (12 min, 24 tiles)
/** An aligned bucket start. */
const BASE = spriteStartFor(new Date("2026-10-21T07:00:00+05:30").getTime(), INTERVAL);

function indexWith(frames: number[], version = 1, interval = INTERVAL): ThumbnailIndex {
  return {
    camera: 1,
    date: "2026-10-21",
    interval,
    tile: { ...THUMBNAIL_TILE },
    buckets: [{ start: BASE, frames, version }],
    progress: { generated: frames.length, expected: frames.length, generating: false },
  };
}

describe("preview grid", () => {
  it("puts 24 tiles of 30 s into a 12 minute sheet", () => {
    expect(THUMBNAIL_TILES_PER_SPRITE).toBe(24);
    expect(BUCKET).toBe(12 * 60_000);
  });

  it("aligns sheet starts to the sheet length", () => {
    expect(spriteStartFor(BASE, INTERVAL)).toBe(BASE);
    expect(spriteStartFor(BASE + BUCKET - 1, INTERVAL)).toBe(BASE);
    expect(spriteStartFor(BASE + BUCKET, INTERVAL)).toBe(BASE + BUCKET);
  });

  it("maps a slot to a pixel offset and never leaves the sheet", () => {
    expect(tilePosition(0)).toEqual({ x: 0, y: 0 });
    expect(tilePosition(1)).toEqual({ x: THUMBNAIL_TILE.width, y: 0 });
    expect(tilePosition(THUMBNAIL_TILE.cols)).toEqual({ x: 0, y: THUMBNAIL_TILE.height });
    expect(tilePosition(23)).toEqual({
      x: (23 % THUMBNAIL_TILE.cols) * THUMBNAIL_TILE.width,
      y: Math.floor(23 / THUMBNAIL_TILE.cols) * THUMBNAIL_TILE.height,
    });
    // Out of range clamps instead of producing an offset outside the image.
    expect(tilePosition(999)).toEqual(tilePosition(THUMBNAIL_TILES_PER_SPRITE - 1));
    expect(tilePosition(-5)).toEqual({ x: 0, y: 0 });
  });

  it("snaps an instant down onto the generation grid", () => {
    expect(quantizeToInterval(BASE + 43_000, INTERVAL)).toBe(BASE + 30_000);
    expect(quantizeToInterval(BASE, INTERVAL)).toBe(BASE);
  });

  it("renders a pointer offset as a clock", () => {
    expect(offsetToThumbnailClock(7 * 3600_000 + 43 * 60_000 + 25_000)).toBe("07:43:25");
    expect(offsetToThumbnailClock(86_400_000)).toBe("23:59:59");
  });
});

describe("nearest generated frame", () => {
  const frames = [BASE, BASE + CELL, BASE + 2 * CELL, BASE + 5 * CELL];

  it("returns the exact frame when the pointer is on a generated instant", () => {
    const hit = findThumbnail(indexWith(frames), BASE + CELL)!;
    expect(hit.frameMs).toBe(BASE + CELL);
    expect(hit.bucketStart).toBe(BASE);
    expect(hit.approximate).toBe(false);
    expect(hit.x).toBe(THUMBNAIL_TILE.width);
    expect(hit.y).toBe(0);
  });

  it("uses the nearest frame instead of asking for an exact one", () => {
    // 07:43:37 style hover, with frames on the 30 second grid.
    const target = BASE + 2 * CELL + 7_000;
    const hit = findThumbnail(indexWith(frames), target)!;
    expect(hit.frameMs).toBe(BASE + 2 * CELL);
    expect(hit.approximate).toBe(false); // within half a cell
  });

  it("rounds to the closer neighbour and flags a real gap", () => {
    // A hole between 60 s and 150 s: 100 s is closer to 60 s, 120 s to 150 s.
    expect(findThumbnail(indexWith(frames), BASE + 100_000)!.frameMs).toBe(BASE + 2 * CELL);
    // Deep inside the hole the hit is not the cell under the pointer, which is
    // what `approximate` reports to the UI.
    const far = findThumbnail(indexWith(frames), BASE + 120_000)!;
    expect(far.frameMs).toBe(BASE + 5 * CELL);
    expect(far.approximate).toBe(true);
  });

  it("looks into the neighbouring sheet at a sheet boundary", () => {
    const next = BASE + BUCKET;
    const index = indexWith(frames);
    index.buckets.push({ start: next, frames: [next], version: 4 });
    const hit = findThumbnail(index, next + 2_000)!;
    expect(hit.bucketStart).toBe(next);
    expect(hit.version).toBe(4);
  });

  it("returns nothing when nothing has been generated", () => {
    expect(findThumbnail(indexWith([]), BASE)).toBeNull();
    expect(findThumbnail({ ...indexWith(frames), buckets: [] }, BASE)).toBeNull();
  });

  it("never shows a frame from a different part of the day", () => {
    /*
     * The bug this pins: with frames generated only around 11:52, hovering at
     * 02:17 used to fall back to "the nearest bucket" and return the 11:52 frame
     * at crop 0,0 — so every hover on the timeline showed one frozen image and
     * its 11:52 clock. A hover with no nearby frame must return nothing.
     */
    const noon = BASE + 4 * 3600_000;
    const lateBucket = spriteStartFor(noon, INTERVAL);
    const index = indexWith([]);
    index.buckets = [{ start: lateBucket, frames: [noon, noon + CELL, noon + 2 * CELL], version: 3 }];

    expect(findThumbnail(index, BASE + 17 * 60_000)).toBeNull(); // 02:17-ish, hours earlier
    expect(findThumbnail(index, BASE + 2 * 3600_000)).toBeNull();
    expect(findThumbnail(index, noon + 10 * 3600_000)).toBeNull();

    // And the frame that *is* there still resolves.
    expect(findThumbnail(index, noon + 5_000)!.frameMs).toBe(noon);
  });

  it("accepts a neighbouring cell but nothing beyond the tolerance", () => {
    const frames = [BASE + 10 * CELL];
    const index = indexWith(frames);
    const tolerance = CELL * THUMBNAIL_MATCH_TOLERANCE_FACTOR;
    expect(findThumbnail(index, BASE + 10 * CELL + tolerance - 1)!.frameMs).toBe(BASE + 10 * CELL);
    expect(findThumbnail(index, BASE + 10 * CELL + tolerance + 1)).toBeNull();
  });

  it("resolves across a sheet boundary when the frame is close", () => {
    const edge = BASE + BUCKET; // start of the next sheet
    const index = indexWith([BASE + 23 * CELL]); // last cell of the first sheet
    index.buckets.push({ start: edge, frames: [edge, edge + CELL], version: 2 });
    // 2 s before the boundary is closer to `edge` than to the previous frame.
    expect(findThumbnail(index, edge - 2_000)!.frameMs).toBe(edge);
    expect(findThumbnail(index, edge + 2_000)!.frameMs).toBe(edge);
  });

  it("returns different frames, buckets and crops for different instants", () => {
    const edge = BASE + BUCKET;
    const index = indexWith([BASE, BASE + CELL, BASE + 2 * CELL]);
    index.buckets.push({ start: edge, frames: [edge, edge + CELL], version: 2 });

    const a = findThumbnail(index, BASE + 5_000)!;
    const b = findThumbnail(index, edge + 5_000)!;
    // TEST 1/2/3: A and B are genuinely different images, not one cached frame.
    // Two different sheets are different URLs (their crops are sheet-relative,
    // so both can legitimately be 0,0 — the bucket is what separates them).
    expect(a.frameMs).not.toBe(b.frameMs);
    expect(a.bucketStart).not.toBe(b.bucketStart);

    // Within one sheet the crop itself must move, or the sheet is being ignored.
    const withinSheet = findThumbnail(index, BASE + 2 * CELL + 2_000)!;
    expect(withinSheet.bucketStart).toBe(a.bucketStart);
    expect({ x: withinSheet.x, y: withinSheet.y }).not.toEqual({ x: a.x, y: a.y });
  });

  it("is deterministic for the same instant (cache hit, no drift)", () => {
    const index = indexWith([BASE, BASE + CELL, BASE + 2 * CELL]);
    const first = findThumbnail(index, BASE + CELL + 3_000)!;
    const second = findThumbnail(index, BASE + CELL + 3_000)!;
    expect(second).toEqual(first);
  });

  it("points at the tile the frame is actually stored in, after gaps", () => {
    // Only the 4th frame exists; it must be tile 0, not tile 3.
    const hit = findThumbnail(indexWith([BASE + 5 * CELL]), BASE + 5 * CELL)!;
    expect(hit.x).toBe(0);
    expect(hit.y).toBe(0);
    // And the version travels with the hit so the browser can bust its cache.
    expect(hit.version).toBe(1);
  });
});
