/**
 * Timeline preview geometry, shared by the browser and the background generator.
 *
 * A preview is no longer extracted when the pointer moves: frames are generated
 * ahead of time into sprite sheets, so a hover is a lookup plus a CSS
 * background-position. Both sides must therefore agree, to the millisecond, on
 * which sprite and which tile a timestamp maps to — that agreement lives here.
 */

/** Preview tile. 11:9, the same ratio as the 704x576 sub stream, so never stretched. */
export const THUMBNAIL_TILE = { width: 198, height: 162, cols: 6, rows: 4 } as const;
export const THUMBNAIL_TILES_PER_SPRITE = THUMBNAIL_TILE.cols * THUMBNAIL_TILE.rows;

/** Default distance between generated frames. Overridable per install. */
export const DEFAULT_THUMBNAIL_INTERVAL_SECONDS = 30;

export function thumbnailIntervalMs(seconds: number): number {
  const safe = Number.isFinite(seconds) ? Math.floor(seconds) : DEFAULT_THUMBNAIL_INTERVAL_SECONDS;
  return Math.min(3600, Math.max(1, safe)) * 1000;
}

/** Length of one sprite sheet. 24 tiles x 30 s = 12 minutes. */
export function spriteBucketMs(intervalSeconds: number): number {
  return thumbnailIntervalMs(intervalSeconds) * THUMBNAIL_TILES_PER_SPRITE;
}

/** Start of the sprite bucket that contains an instant. */
export function spriteStartFor(epochMs: number, intervalSeconds: number): number {
  const bucket = spriteBucketMs(intervalSeconds);
  if (!Number.isFinite(epochMs)) return 0;
  return Math.floor(epochMs / bucket) * bucket;
}

/** Top-left corner of a tile inside a sprite sheet. */
export function tilePosition(slot: number): { x: number; y: number } {
  const safe = Math.max(0, Math.min(THUMBNAIL_TILES_PER_SPRITE - 1, Math.floor(slot)));
  return {
    x: (safe % THUMBNAIL_TILE.cols) * THUMBNAIL_TILE.width,
    y: Math.floor(safe / THUMBNAIL_TILE.cols) * THUMBNAIL_TILE.height,
  };
}

/** One sprite sheet's worth of generated frames, in packing order. */
export type ThumbnailBucket = {
  /** Bucket start, epoch ms. */
  start: number;
  /** Frame instants, ascending. Tile N is at tilePosition(N). */
  frames: number[];
  /** Bumped on every rewrite so the browser never reuses a stale sheet. */
  version: number;
};

export type ThumbnailProgress = { generated: number; expected: number; generating: boolean };

export type ThumbnailIndex = {
  camera: number;
  date: string;
  /** Seconds between frames. */
  interval: number;
  tile: { width: number; height: number; cols: number; rows: number };
  buckets: ThumbnailBucket[];
  progress: ThumbnailProgress;
};

export type ThumbnailLookup = {
  frameMs: number;
  bucketStart: number;
  version: number;
  x: number;
  y: number;
  /** True when the hit is not the exact grid cell the pointer is over. */
  approximate: boolean;
};

/**
 * How far a generated frame may sit from the pointer and still be shown.
 *
 * Frames are generated on the interval above, so a hover inside a generated
 * stretch is never more than half an interval from a frame; one and a half
 * intervals therefore accepts the neighbouring cell and rejects everything else.
 * This bound is the whole point: without it a hover in an ungenerated stretch
 * would resolve to whatever frame happened to exist hours away, and the preview
 * would show one frozen image (and that frame's clock) for the entire timeline.
 */
export const THUMBNAIL_MATCH_TOLERANCE_FACTOR = 1.5;

/** Nearest generated frame to `targetMs`, or null when there is none near it. */
export function findThumbnail(index: ThumbnailIndex, targetMs: number): ThumbnailLookup | null {
  if (!Number.isFinite(targetMs) || index.buckets.length === 0) return null;
  const cell = thumbnailIntervalMs(index.interval);
  const tolerance = cell * THUMBNAIL_MATCH_TOLERANCE_FACTOR;
  const bucketMs = spriteBucketMs(index.interval) || 1;

  let bestFrame = 0;
  let bestBucket: ThumbnailBucket | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const bucket of index.buckets) {
    // The sheet's own span is a cheap reject before scanning its frames.
    const spanEnd = bucket.start + bucketMs;
    const spanDistance = targetMs < bucket.start ? bucket.start - targetMs : targetMs >= spanEnd ? targetMs - spanEnd : 0;
    if (spanDistance > tolerance) continue;
    for (const frame of bucket.frames) {
      const distance = Math.abs(frame - targetMs);
      if (distance <= tolerance && distance < bestDistance) {
        bestDistance = distance;
        bestFrame = frame;
        bestBucket = bucket;
      }
    }
  }

  if (!bestBucket) return null;

  const slot = bestBucket.frames.indexOf(bestFrame);
  if (slot < 0) return null;
  const { x, y } = tilePosition(slot);
  return {
    frameMs: bestFrame,
    bucketStart: bestBucket.start,
    version: bestBucket.version,
    x,
    y,
    approximate: bestDistance > cell / 2,
  };
}

/** Snap an instant down onto the generation grid. */
export function quantizeToInterval(epochMs: number, intervalSeconds: number): number {
  const cell = thumbnailIntervalMs(intervalSeconds);
  if (!Number.isFinite(epochMs)) return 0;
  return Math.floor(epochMs / cell) * cell;
}

/** `HH:MM:SS` for a pointer offset inside a Kolkata day. */
export function offsetToThumbnailClock(offsetMs: number): string {
  const clamped = Math.min(24 * 60 * 60 * 1000 - 1000, Math.max(0, Math.round(offsetMs)));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(clamped / 3_600_000))}:${pad(Math.floor((clamped % 3_600_000) / 60_000))}:${pad(
    Math.floor((clamped % 60_000) / 1000),
  )}`;
}
