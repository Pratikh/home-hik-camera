"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  findThumbnail,
  spriteBucketMs,
  spriteStartFor,
  THUMBNAIL_TILE,
  type ThumbnailIndex,
} from "@/lib/playback-thumbnail";

/**
 * Timeline previews, pre-generated.
 *
 * The browser never asks the DVR for a frame. It loads a small index of what has
 * already been generated plus the sprite sheets it needs, then a hover is a
 * lookup and a `background-position`: no network, no FFmpeg, no playback session.
 *
 * Sheets are cached privately and immutably, and version-tagged, so a revisit
 * renders without touching the server at all.
 */
export type HoverPreviewState =
  | { kind: "idle" }
  | { kind: "no-recording"; offsetMs: number }
  | { kind: "ready"; offsetMs: number; frameOffsetMs: number; url: string; x: number; y: number }
  | { kind: "generating"; offsetMs: number }
  | { kind: "unavailable"; offsetMs: number };

/** Decoded sheets are ~3 MB each; a handful is plenty for a scrubber. */
const SPRITE_CACHE_LIMIT = 6;
const INDEX_POLL_MS = 6_000;
const FOCUS_DEBOUNCE_MS = 500;
/** The playhead moves 4x/second while playing; only coarse moves matter. */
const FOCUS_GRANULARITY_MS = 5 * 60_000;

type LoadedSprite = { url: string; image: HTMLImageElement; version: number };

/** Touch and other coarse pointers have no hover state; they keep tap-to-seek. */
export function useHoverCapable(): boolean {
  const [capable, setCapable] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCapable(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return capable;
}

function spriteUrl(camera: number, date: string, start: number, version: number): string {
  return (
    `/api/playback/thumbnail/sprite?camera=${encodeURIComponent(String(camera))}` +
    `&date=${encodeURIComponent(date)}&start=${start}&v=${version}`
  );
}

export function useTimelineThumbnails({
  camera,
  date,
  dayStartMs,
  focusMs,
  enabled,
}: {
  camera: number;
  date: string;
  dayStartMs: number;
  /** Where the viewer is looking; the generator prioritises this. */
  focusMs: number;
  enabled: boolean;
}) {
  /*
   * The index and the preview carry the camera/day they belong to. A change of
   * either therefore reads as "nothing yet" during render, with no reset effect
   * and no cascading update.
   */
  const identity = `${camera}|${date}`;
  const [store, setStore] = useState<{ identity: string; index: ThumbnailIndex | null; preview: HoverPreviewState }>(
    () => ({ identity, index: null, preview: { kind: "idle" } }),
  );
  const sameIdentity = store.identity === identity;
  const index = sameIdentity ? store.index : null;
  const state: HoverPreviewState = sameIdentity ? store.preview : { kind: "idle" };
  const [, setTick] = useState(0);

  const indexRef = useRef<ThumbnailIndex | null>(null);
  const spritesRef = useRef<Map<string, LoadedSprite>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const hoverTargetRef = useRef<{ offsetMs: number; recording: boolean } | null>(null);
  const focusRef = useRef(focusMs);
  const applyHoverRef = useRef<(offsetMs: number, recording: boolean) => void>(() => undefined);
  const focusTimer = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    focusRef.current = focusMs;
  }, [focusMs]);

  const setPreview = useCallback(
    (preview: HoverPreviewState) => {
      setStore((current) => ({
        identity,
        index: current.identity === identity ? current.index : null,
        preview,
      }));
    },
    [identity],
  );

  /** Load one sprite sheet, keeping the most recent few decoded. */
  const loadSprite = useCallback(
    (bucketStart: number, version: number) => {
      const key = `${bucketStart}|${version}`;
      if (spritesRef.current.has(key) || pendingRef.current.has(key)) return;
      pendingRef.current.add(key);
      const url = spriteUrl(camera, date, bucketStart, version);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        pendingRef.current.delete(key);
        const cache = spritesRef.current;
        cache.set(key, { url, image, version });
        // Evict oldest beyond the limit; the map preserves insertion order.
        while (cache.size > SPRITE_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        setTick((value) => value + 1);
        // A hover waiting on this sheet becomes ready the moment it decodes.
        const target = hoverTargetRef.current;
        if (target) applyHoverRef.current(target.offsetMs, target.recording);
      };
      image.onerror = () => {
        pendingRef.current.delete(key);
      };
      image.src = url;
    },
    [camera, date],
  );

  /** Resolve a pointer position against what is already generated. */
  const applyHover = useCallback(
    (offsetMs: number, recording: boolean) => {
      hoverTargetRef.current = { offsetMs, recording };
      if (!recording) {
        setPreview({ kind: "no-recording", offsetMs });
        return;
      }
      const current = indexRef.current;
      const lookup = current ? findThumbnail(current, dayStartMs + offsetMs) : null;
      if (process.env.NODE_ENV !== "production") {
        // Development only: makes the layer that picked the frame obvious.
        const clock = (ms: number) =>
          new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });
        console.debug(
          "[thumbnail-preview]",
          `requested=${clock(dayStartMs + offsetMs)}`,
          lookup ? `selected=${clock(lookup.frameMs)}` : "selected=none",
          lookup ? `source=sprite@${lookup.bucketStart}/v${lookup.version}` : "source=none",
          lookup ? `crop=${lookup.x},${lookup.y}` : "crop=none",
          lookup ? `approx=${lookup.approximate}` : "",
        );
      }
      if (!current || !lookup) {
        // Nothing generated here yet. The background worker will get to it; the
        // hover deliberately does not ask the DVR.
        setPreview(
          current && !current.progress.generating
            ? { kind: "unavailable", offsetMs }
            : { kind: "generating", offsetMs },
        );
        return;
      }

      const key = `${lookup.bucketStart}|${lookup.version}`;
      const sprite = spritesRef.current.get(key);
      if (sprite) {
        setPreview({
          kind: "ready",
          offsetMs,
          frameOffsetMs: lookup.frameMs - dayStartMs,
          url: sprite.url,
          x: lookup.x,
          y: lookup.y,
        });
        return;
      }

      // Not on screen yet: show the nearest generated time while the one sheet
      // it lives in decodes. This is a same-origin image, not a DVR session.
      setPreview({ kind: "generating", offsetMs: lookup.frameMs - dayStartMs });
      loadSprite(lookup.bucketStart, lookup.version);
    },
    [dayStartMs, loadSprite, setPreview],
  );

  // The load callback may fire long after render, so it reaches applyHover here.
  useEffect(() => {
    applyHoverRef.current = applyHover;
  }, [applyHover]);

  const hover = useCallback(
    (offsetMs: number | null, options?: { recording?: boolean }) => {
      if (!enabled || offsetMs === null) {
        hoverTargetRef.current = null;
        setPreview({ kind: "idle" });
        return;
      }
      applyHover(offsetMs, options?.recording !== false);
    },
    [applyHover, enabled, setPreview],
  );

  const clear = useCallback(() => {
    hoverTargetRef.current = null;
    setPreview({ kind: "idle" });
  }, [setPreview]);

  /* ---------------------------------------------------------------- index -- */

  const fetchIndex = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const focus = Math.round(focusRef.current);
      const response = await fetch(
        `/api/playback/thumbnail/index?camera=${encodeURIComponent(String(camera))}` +
          `&date=${encodeURIComponent(date)}&focus=${focus}`,
        { credentials: "same-origin", signal: controller.signal },
      );
      if (!response.ok) return;
      const body = (await response.json()) as ThumbnailIndex;
      indexRef.current = body;
      setStore((current) => ({
        identity,
        preview: current.identity === identity ? current.preview : { kind: "idle" },
        index: body,
      }));

      // Warm the sheets nearest the viewer, so the first hover there is instant.
      const bucketMs = spriteBucketMs(body.interval);
      const centre = spriteStartFor(focusRef.current, body.interval);
      for (const bucketStart of [centre, centre + bucketMs, centre - bucketMs]) {
        const bucket = body.buckets.find((item) => item.start === bucketStart);
        if (bucket && bucket.frames.length > 0) loadSprite(bucket.start, bucket.version);
      }
    } catch {
      // A failed index fetch leaves the previous one in place; previews degrade.
    }
  }, [camera, date, identity, loadSprite]);

  // First load, and again whenever the day or camera changes.
  useEffect(() => {
    indexRef.current = null;
    spritesRef.current.clear();
    pendingRef.current.clear();
    hoverTargetRef.current = null;
    if (!enabled) return;
    void fetchIndex();
  }, [identity, enabled, fetchIndex]);

  // Keep the index warm while generation is still running.
  useEffect(() => {
    if (!enabled || !index?.progress.generating) return;
    pollTimer.current = window.setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void fetchIndex();
    }, INDEX_POLL_MS);
    return () => {
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    };
  }, [enabled, index, fetchIndex]);

  // A coarse focus change (seek, date, zoom) is reported to the generator.
  const focusKey = Math.floor(focusMs / FOCUS_GRANULARITY_MS);
  useEffect(() => {
    if (!enabled) return;
    if (focusTimer.current) window.clearTimeout(focusTimer.current);
    focusTimer.current = window.setTimeout(() => {
      void fetchIndex();
    }, FOCUS_DEBOUNCE_MS);
    return () => {
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
      focusTimer.current = null;
    };
  }, [enabled, focusKey, fetchIndex]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (focusTimer.current) window.clearTimeout(focusTimer.current);
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
    },
    [],
  );

  return { state, hover, clear, tile: THUMBNAIL_TILE, progress: index?.progress ?? null };
}
