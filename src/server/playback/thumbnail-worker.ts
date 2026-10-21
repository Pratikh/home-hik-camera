import "server-only";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { thumbnailIntervalMs, type ThumbnailProgress } from "@/lib/playback-thumbnail";
import { openEventStore } from "@/server/events/event-store";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { playbackClientFrom } from "@/server/hikvision/hikvision-playback";
import { isPlayerStreaming, extractFrame } from "@/server/playback/thumbnail-extract";
import { addFrame, pruneExpired, readIndex } from "@/server/playback/thumbnail-store";

/**
 * Background preview generator.
 *
 * This is the piece that makes hovering instant: frames are pulled from the DVR
 * ahead of time and written into sprite sheets, so a hover never opens a DVR
 * session. It runs inside the existing web process (no extra service, no new
 * container) and is deliberately conservative:
 *
 *  - one extraction at a time, because this DVR serves a single playback stream;
 *  - it stands down entirely while the player holds that stream, and waits out a
 *    refusal instead of retrying;
 *  - it only generates over spans the DVR says were recorded, so gaps cost
 *    nothing;
 *  - it works outward from whatever the user is actually looking at.
 *
 * At the measured ~2.3 s per frame a full day is hours of work, so coverage is
 * built progressively across sessions rather than promised immediately. What it
 * has generated survives restarts, so revisits are instant.
 */

type Span = { start: number; end: number };
type Job = { camera: number; date: string; focusMs: number; updatedAt: number };

const jobs = new Map<string, Job>();
const plans = new Map<string, { spans: Span[]; expected: number; at: number }>();
const attempts = new Map<string, number>();

const PLAN_TTL_MS = 10 * 60_000;
const BUSY_BACKOFF_MS = 20_000;
const ERROR_BACKOFF_MS = 60_000;
const MAX_ATTEMPTS = 3;

let started = false;
let working = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let retryAt = 0;
let lastPrune = 0;
let lastError: string | null = null;
let lastRunAt: string | null = null;
let lastPersistedAt = 0;

function keyOf(camera: number, date: string): string {
  return `${camera}|${date}`;
}

/** Test seam: stop the loop and forget the queue. */
export function resetThumbnailWorker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  jobs.clear();
  plans.clear();
  attempts.clear();
  started = false;
  working = false;
  retryAt = 0;
  lastPrune = 0;
  lastError = null;
  lastRunAt = null;
  lastPersistedAt = 0;
}

/**
 * Tell the generator which camera and day matter right now.
 *
 * Called from the index route with the window the timeline is showing, so the
 * work follows the viewer instead of starting at midnight.
 */
export function requestThumbnails(input: { camera: number; date: string; focusMs?: number }): void {
  const config = getConfig();
  if (!config.thumbnailEnabled) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return;

  const key = keyOf(input.camera, input.date);
  const focusMs = Number.isFinite(input.focusMs) ? (input.focusMs as number) : Date.now();
  const existing = jobs.get(key);
  jobs.set(key, { camera: input.camera, date: input.date, focusMs, updatedAt: Date.now() });
  if (!existing) {
    // A new day starts at the front of the queue.
    retryAt = 0;
  }
  ensureThumbnailWorker();
}

/** Start the loop once per process. Safe to call repeatedly. */
export function ensureThumbnailWorker(): void {
  if (started) return;
  started = true;
  schedule(250);
}

function schedule(delayMs: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void tick();
  }, delayMs);
  // Never hold the process open for previews alone.
  timer.unref?.();
}

/**
 * Record the worker state outside this module.
 *
 * Instrumentation and route handlers can run in separate module instances, so
 * the in-memory flags above are not a reliable source for the admin health
 * page. The database is. Writes are throttled while work is queued and forced
 * when the queue empties, which costs almost nothing.
 */
function persistWorkerState(force: boolean): void {
  if (process.env.NODE_ENV === "test") return;
  const now = Date.now();
  if (!force && now - lastPersistedAt < 30_000) return;
  lastPersistedAt = now;
  try {
    const store = openEventStore(getConfig().dataDir);
    store.setSetting("thumbnail_worker_last_run", new Date(now).toISOString());
    store.setSetting("thumbnail_worker_queued", String(jobs.size));
    store.setSetting("thumbnail_worker_status", jobs.size > 0 || working ? "running" : "idle");
    store.setSetting("thumbnail_worker_last_error", lastError ?? "");
  } catch {
    // Diagnostics must never break preview generation.
  }
}

async function tick(): Promise<void> {
  if (working) return;
  working = true;
  let nextDelay = 500;
  try {
    if (Date.now() < retryAt) {
      nextDelay = Math.min(BUSY_BACKOFF_MS, Math.max(500, retryAt - Date.now()));
    } else {
      const outcome = await step();
      nextDelay = outcome.delayMs;
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : "error";
    // One line, never the URL: this is the only place a stall shows up.
    console.error("[thumbnail] worker", lastError);
    nextDelay = ERROR_BACKOFF_MS;
  } finally {
    working = false;
    lastRunAt = new Date().toISOString();
    persistWorkerState(jobs.size === 0);
    if (jobs.size > 0) schedule(nextDelay);
    else started = false;
  }
}

/** Recorded spans for one camera/day, from the existing ISAPI search (cached). */
async function progressPlan(camera: number, date: string): Promise<{ spans: Span[]; expected: number }> {
  const key = keyOf(camera, date);
  const cached = plans.get(key);
  if (cached && Date.now() - cached.at < PLAN_TTL_MS) return cached;

  const config = getConfig();
  const client = playbackClientFrom(
    new HikvisionClient({
      host: config.dvrHost,
      port: config.dvrHttpPort,
      username: config.dvrUsername,
      password: config.dvrPassword,
      timeoutMs: 12_000,
    }),
    {
      host: config.dvrHost,
      port: config.dvrRtspPort,
      username: config.dvrUsername,
      password: config.dvrPassword,
    },
  );
  const recordings = await client.searchRecordings({ camera, date, startTime: "00:00", endTime: "23:59" });

  const spans: Span[] = recordings
    .map((recording) => ({
      start: new Date(recording.startTime).getTime(),
      end: new Date(recording.endTime).getTime(),
    }))
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((left, right) => left.start - right.start);

  const expected = frameGrid(spans, getConfig().thumbnailIntervalSeconds).length;
  const plan = { spans, expected, at: Date.now() };
  plans.set(key, plan);
  return plan;
}

/** Every instant this day should eventually have a frame at, over recorded spans only. */
export function frameGrid(spans: Span[], intervalSeconds: number, now = Date.now()): number[] {
  const cell = thumbnailIntervalMs(intervalSeconds);
  // Only closed cells: the segment being written right now cannot be extracted.
  const ceiling = Math.floor((now - cell) / cell) * cell;
  const out: number[] = [];
  for (const span of spans) {
    let at = Math.ceil(span.start / cell) * cell;
    for (; at + cell <= span.end && at <= ceiling; at += cell) out.push(at);
  }
  return out;
}

async function step(): Promise<{ delayMs: number }> {
  const job = pickJob();
  if (!job) return { delayMs: 60_000 };

  const key = keyOf(job.camera, job.date);
  const plan = await progressPlan(job.camera, job.date);
  if (plan.spans.length === 0) {
    jobs.delete(key);
    return { delayMs: 1_000 };
  }

  const index = await readIndex(job.camera, job.date);
  const have = new Set<number>();
  for (const bucket of index.buckets) for (const frame of bucket.frames) have.add(frame);

  const grid = frameGrid(plan.spans, index.interval);
  const missing = grid.filter((at) => !have.has(at) && (attempts.get(`${key}|${at}`) ?? 0) < MAX_ATTEMPTS);
  if (missing.length === 0) {
    jobs.delete(key);
    return { delayMs: 1_000 };
  }

  // Closest to what the viewer is looking at first, then earliest.
  missing.sort((left, right) => Math.abs(left - job.focusMs) - Math.abs(right - job.focusMs) || left - right);
  const at = missing[0]!;

  if (await isPlayerStreaming()) {
    // The player owns the DVR's only playback stream. Never contend with it.
    return { delayMs: 5_000 };
  }

  const temp = path.join(os.tmpdir(), `thumb-${randomUUID()}.jpg`);
  const result = await extractFrame(at, job.camera, temp);

  if (result === "ok") {
    const stored = await addFrame(job.camera, job.date, at, temp);
    if (!stored) {
      await rm(temp, { force: true });
      attempts.set(`${key}|${at}`, (attempts.get(`${key}|${at}`) ?? 0) + 1);
      return { delayMs: 1_000 };
    }
    maybePrune();
    lastError = null;
    // Straight on to the next frame: the DVR handshake is the slow part, not us.
    return { delayMs: 120 };
  }

  await rm(temp, { force: true });
  attempts.set(`${key}|${at}`, (attempts.get(`${key}|${at}`) ?? 0) + 1);

  if (result === "busy") {
    // Something else owns the playback slot; stand down rather than knock again.
    lastError = "dvr_busy";
    retryAt = Date.now() + BUSY_BACKOFF_MS;
    return { delayMs: BUSY_BACKOFF_MS };
  }
  if (result === "empty") {
    // No recording at this instant is a normal answer, not a worker failure.
    lastError = null;
    return { delayMs: 150 };
  }
  lastError = "extract_failed";
  retryAt = Date.now() + ERROR_BACKOFF_MS;
  return { delayMs: ERROR_BACKOFF_MS };
}

function pickJob(): Job | null {
  let best: Job | null = null;
  for (const job of jobs.values()) {
    if (!best || job.updatedAt > best.updatedAt) best = job;
  }
  return best;
}

function maybePrune(): void {
  if (Date.now() - lastPrune < 60 * 60_000) return;
  lastPrune = Date.now();
  void pruneExpired().catch(() => undefined);
}

/** Generated vs expected frames for one camera/day. Never triggers DVR work. */
export function thumbnailProgress(camera: number, date: string, index: { buckets: { frames: number[] }[] } | null): ThumbnailProgress {
  const generated = index ? index.buckets.reduce((total, bucket) => total + bucket.frames.length, 0) : 0;
  const plan = plans.get(keyOf(camera, date));
  const expected = plan?.expected ?? 0;
  const queued = jobs.has(keyOf(camera, date));
  return {
    generated,
    expected,
    // "Still working" also covers "queued but the plan is not known yet".
    generating: queued && (expected === 0 || generated < expected),
  };
}

/**
 * Diagnostics for the admin status surface.
 *
 * `running` means the loop is scheduled or a frame is being extracted. When the
 * queue is empty the worker parks and reports `idle`, which is healthy rather
 * than stopped. `lastRunAt` distinguishes "has never run" from "ran, then
 * parked".
 */
export function thumbnailWorkerState(): {
  queued: number;
  lastError: string | null;
  concurrency: number;
  running: boolean;
  lastRunAt: string | null;
} {
  return {
    queued: jobs.size,
    lastError,
    concurrency: Math.min(getConfig().thumbnailWorkers, 1),
    running: started || working,
    lastRunAt,
  };
}
