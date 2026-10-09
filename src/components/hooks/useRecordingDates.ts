"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/client-api";

export type RecordingDatesResponse = {
  camera: number;
  month: string;
  dates: string[];
  source?: string;
};

export type AvailabilityState = {
  /** "idle" before the first load, then the result of the last attempt. */
  status: "idle" | "loading" | "ready" | "error";
  dates: string[];
  error: string | null;
};

/**
 * Per-session cache of already-loaded months, keyed by camera + month.
 *
 * Revisiting a month the user already opened is instant and issues no request.
 * The server also caches, but keeping a browser-side copy avoids even the round
 * trip while the user pages back and forth.
 */
const sessionCache = new Map<string, string[]>();

export function availabilityKey(camera: number, month: string): string {
  return `${camera}:${month}`;
}

/** Test helper: forget everything cached in this browser session. */
export function clearAvailabilityCache(): void {
  sessionCache.clear();
}

/**
 * Loads recording availability for one camera and month.
 *
 * A DVR failure is surfaced as an error, never as "no recordings", so the UI can
 * tell an empty month apart from a failed query.
 */
export function useRecordingDates(camera: number, month: string): AvailabilityState & { reload: () => void } {
  /*
   * The result is tagged with the key it belongs to. "Loading" is then derived:
   * if the stored result is not for the key currently on screen, we are waiting
   * on a fetch. That avoids setting state synchronously inside the effect (which
   * causes a cascading render) while still showing an immediate loading state.
   */
  const [result, setResult] = useState<{ key: string; dates: string[]; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestSeq = useRef(0);
  const key = availabilityKey(camera, month);

  useEffect(() => {
    if (!month) return;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    let cancelled = false;

    const run = async () => {
      const cached = sessionCache.get(key);
      if (cached) {
        // Refresh the cached copy when the user explicitly asks to retry.
        if (nonce === 0) {
          if (!cancelled) setResult({ key, dates: cached, error: null });
          return;
        }
      }
      try {
        const body = await api<RecordingDatesResponse>(
          `/api/playback/recording-dates?camera=${camera}&month=${encodeURIComponent(month)}`,
        );
        if (cancelled || seq !== requestSeq.current) return;
        sessionCache.set(key, body.dates);
        setResult({ key, dates: body.dates, error: null });
      } catch (caught) {
        if (cancelled || seq !== requestSeq.current) return;
        if (caught instanceof ApiError && caught.status === 401) return;
        setResult({
          key,
          dates: [],
          error: caught instanceof Error ? caught.message : "Unable to check recording availability.",
        });
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [camera, key, month, nonce]);

  const current = result?.key === key ? result : null;
  const state: AvailabilityState = current
    ? current.error
      ? { status: "error", dates: [], error: current.error }
      : { status: "ready", dates: current.dates, error: null }
    : { status: month ? "loading" : "idle", dates: [], error: null };

  return { ...state, reload: () => setNonce((value) => value + 1) };
}

/** The YYYY-MM a YYYY-MM-DD date string belongs to. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Shift a YYYY-MM by a number of months. */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) return month;
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Pick the nearest date with a recording.
 *
 * Preference order: the same date, then the next available date, then the
 * previous one — so choosing a camera lands on something sensible instead of
 * silently playing a different day than the one shown.
 */
export function nearestRecorded(dates: string[], preferred: string): string | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  if (sorted.includes(preferred)) return preferred;
  const next = sorted.find((date) => date > preferred);
  if (next) return next;
  return sorted[sorted.length - 1] ?? null;
}

/** Fetch one month's dates, reusing the session cache. */
export async function fetchMonthDates(camera: number, month: string): Promise<string[]> {
  const key = availabilityKey(camera, month);
  const cached = sessionCache.get(key);
  if (cached) return cached;
  const body = await api<RecordingDatesResponse>(
    `/api/playback/recording-dates?camera=${camera}&month=${encodeURIComponent(month)}`,
  );
  sessionCache.set(key, body.dates);
  return body.dates;
}

/**
 * The most recent date with a recording, at or before `fromDate`.
 *
 * Used on first open: if today has nothing, fall back to the nearest earlier
 * day that does, looking back through previous months as needed. Returns null
 * when nothing is found, so the caller can show an empty state rather than
 * starting playback on a day with no recording.
 */
export async function findNearestAvailableDate(
  camera: number,
  fromDate: string,
  maxMonthsBack = 6,
): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return null;
  let month = monthOf(fromDate);
  for (let step = 0; step <= maxMonthsBack; step += 1) {
    let dates: string[];
    try {
      dates = await fetchMonthDates(camera, month);
    } catch {
      // A failed month must not be mistaken for an empty one; stop and let the
      // caller surface the availability error instead of jumping dates.
      return null;
    }
    const usable = dates.filter((date) => date <= fromDate);
    if (usable.length > 0) return usable[usable.length - 1] ?? null;
    month = shiftMonth(month, -1);
  }
  return null;
}
