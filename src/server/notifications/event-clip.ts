import "server-only";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { Recording } from "@/lib/recording";
import { kolkataParts } from "@/lib/time-kolkata";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import {
  buildPlaybackRtsp,
  dedupeRecordings,
  searchRecordings,
  type PlaybackTransport,
} from "@/server/hikvision/hikvision-playback";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

/**
 * Short CCTV clip for a face notification.
 *
 * The clip comes from the DVR's own recording track, using the playback search
 * and RTSP URL builders the browser playback already uses. It does NOT touch
 * MediaMTX, the live WebRTC pipeline or the browser playback path: FFmpeg pulls
 * the DVR playback stream directly, transcodes H.265 to H.264 and writes a
 * temporary MP4 that is uploaded to Telegram and then deleted.
 *
 * Nothing here is on the event ingestion path. Every failure is a structured
 * result, never a throw.
 */

export const CLIP_DIR_NAME = "telegram-clips";
export const CLIP_MAX_WIDTH = 1280;
export const CLIP_STALE_MS = 30 * 60 * 1000;
const FFMPEG_PROBE_TIMEOUT_MS = 5000;

export type ClipWindow = { start: Date; end: Date };

export type ClipFailure =
  | "disabled"
  | "not_configured"
  | "no_recording"
  | "ffmpeg_missing"
  | "ffmpeg_failed"
  | "invalid_output"
  | "too_large"
  | "dvr_error"
  | "invalid_event";

export type ClipResult =
  | {
      ok: true;
      path: string;
      bytes: number;
      durationSeconds: number;
      window: ClipWindow;
      recordingStart: string;
      recordingEnd: string;
      diagnostics: ClipDiagnostics;
    }
  | { ok: false; reason: ClipFailure; detail: string | null; diagnostics: ClipDiagnostics };

/* -------------------------------------------------------------------------- */
/* Window maths (pure)                                                        */
/* -------------------------------------------------------------------------- */

/** Target window: `pre` seconds before the event to `post` seconds after. */
export function clipWindowForEvent(eventAt: Date, preSeconds: number, postSeconds: number): ClipWindow {
  const pre = Math.max(0, Math.round(preSeconds)) * 1000;
  const post = Math.max(0, Math.round(postSeconds)) * 1000;
  return { start: new Date(eventAt.getTime() - pre), end: new Date(eventAt.getTime() + post) };
}

export function clipTotalSeconds(preSeconds: number, postSeconds: number): number {
  return Math.max(1, Math.round(preSeconds) + Math.round(postSeconds));
}

/**
 * Fallback when the DVR cannot give us the seconds before the event: start at
 * the event and take the whole clip length forwards.
 */
export function fallbackWindow(eventAt: Date, totalSeconds: number): ClipWindow {
  return { start: new Date(eventAt.getTime()), end: new Date(eventAt.getTime() + clipTotalSeconds(totalSeconds, 0) * 1000) };
}

/** Overlap of a window with one recording, or null when they do not touch. */
export function intersectWindow(
  window: ClipWindow,
  recording: Pick<Recording, "startTime" | "endTime">,
): ClipWindow | null {
  const recStart = new Date(recording.startTime).getTime();
  const recEnd = new Date(recording.endTime).getTime();
  if (!Number.isFinite(recStart) || !Number.isFinite(recEnd) || recEnd <= recStart) return null;
  const start = Math.max(window.start.getTime(), recStart);
  const end = Math.min(window.end.getTime(), recEnd);
  if (end <= start) return null;
  return { start: new Date(start), end: new Date(end) };
}

/**
 * Choose the footage for the window.
 *
 * Preference order, so a detection near a segment boundary still produces a
 * usable clip:
 *   1. a recording that covers the whole window;
 *   2. a recording that covers the event and runs forwards;
 *   3. the overlap with any recording that covers part of the window;
 *   4. a recording that starts after the event — use what it has.
 */
export function pickRecording(
  recordings: Recording[],
  window: ClipWindow,
): { window: ClipWindow; recording: Recording } | null {
  const eventMs = window.start.getTime() + (window.end.getTime() - window.start.getTime()) / 2;
  const usable = recordings
    .map((recording) => ({ recording, recStart: new Date(recording.startTime).getTime(), recEnd: new Date(recording.endTime).getTime() }))
    .filter((item) => Number.isFinite(item.recStart) && Number.isFinite(item.recEnd) && item.recEnd > item.recStart)
    .sort((left, right) => left.recStart - right.recStart);
  if (usable.length === 0) return null;

  const covers = usable.find((item) => item.recStart <= window.start.getTime() && item.recEnd >= window.end.getTime());
  if (covers) return { window, recording: covers.recording };

  const forwards = usable.find((item) => item.recStart <= eventMs && item.recEnd > eventMs);
  if (forwards) {
    const start = Math.max(window.start.getTime(), forwards.recStart);
    const end = Math.min(window.end.getTime(), forwards.recEnd);
    if (end > start) return { window: { start: new Date(start), end: new Date(end) }, recording: forwards.recording };
  }

  const overlapping = usable
    .map((item) => ({ item, overlap: intersectWindow(window, item.recording) }))
    .filter((entry): entry is { item: (typeof usable)[number]; overlap: ClipWindow } => entry.overlap !== null);
  if (overlapping.length > 0) {
    const best = overlapping.reduce((left, right) =>
      right.overlap.end.getTime() - right.overlap.start.getTime() >
      left.overlap.end.getTime() - left.overlap.start.getTime()
        ? right
        : left,
    );
    return { window: best.overlap, recording: best.item.recording };
  }

  // Only a recording that starts after the event is available.
  const later = usable.find((item) => item.recStart >= eventMs);
  if (later) {
    const total = window.end.getTime() - window.start.getTime();
    const end = Math.min(later.recEnd, later.recStart + total);
    if (end > later.recStart) {
      return { window: { start: new Date(later.recStart), end: new Date(end) }, recording: later.recording };
    }
  }
  return null;
}

function stamp(date: Date, deltaMinutes = 0): { date: string; clock: string } {
  const parts = kolkataParts(new Date(date.getTime() + deltaMinutes * 60_000));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, clock: `${parts.hour}:${parts.minute}` };
}

/**
 * Minute-resolution search spans (India time) covering the window, padded by a
 * minute. A window that crosses midnight produces two spans, one per day.
 */
export function searchSpans(window: ClipWindow): Array<{ date: string; startTime: string; endTime: string }> {
  const from = stamp(window.start, -1);
  const to = stamp(window.end, 1);
  if (from.date === to.date) {
    if (from.clock === to.clock) return [{ date: from.date, startTime: from.clock, endTime: "23:59" }];
    return [{ date: from.date, startTime: from.clock, endTime: to.clock }];
  }
  return [
    { date: from.date, startTime: from.clock, endTime: "23:59" },
    { date: to.date, startTime: "00:00", endTime: to.clock },
  ];
}

/* -------------------------------------------------------------------------- */
/* FFmpeg                                                                     */
/* -------------------------------------------------------------------------- */

export type FfmpegRun = { ok: boolean; code: number | null; stderr: string; missing: boolean; timedOut: boolean };
export type FfmpegRunner = (input: { bin: string; args: string[]; timeoutMs: number }) => Promise<FfmpegRun>;

/** Strip `user:password@` from anything we might log. */
export function redactRtspCredentials(text: string): string {
  return String(text ?? "").replace(/(\w+:\/\/)[^/@\s]+@/g, "$1[redacted]@");
}

/** Quality profile for one conversion attempt. */
export type FfmpegProfile = { crf: number; maxWidth: number; audio: boolean };

/**
 * The DVR records H.265; Telegram clients need H.264 MP4. Audio is offered as
 * AAC when the playback stream carries it (`-map 0:a:0?` keeps a silent source
 * working), and the caller retries video-only if that upsets the source.
 */
export const FFMPEG_PROFILE_DEFAULT: FfmpegProfile = { crf: 28, maxWidth: CLIP_MAX_WIDTH, audio: true };
export const FFMPEG_PROFILE_VIDEO_ONLY: FfmpegProfile = { crf: 28, maxWidth: CLIP_MAX_WIDTH, audio: false };
export const FFMPEG_PROFILE_SMALL: FfmpegProfile = { crf: 32, maxWidth: 640, audio: false };

/**
 * Built as an argument array, never a shell string, so nothing in a URL or a
 * path can be interpreted by a shell.
 */
export function ffmpegArgs(input: {
  url: string;
  outPath: string;
  durationSeconds: number;
  profile?: FfmpegProfile;
}): string[] {
  const profile = input.profile ?? FFMPEG_PROFILE_DEFAULT;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-rtsp_transport",
    "tcp",
    "-i",
    input.url,
    "-t",
    String(Math.max(1, Math.round(input.durationSeconds))),
    "-map",
    "0:v:0",
  ];
  if (profile.audio) {
    // Optional audio: absent audio must not fail the whole conversion.
    args.push("-map", "0:a:0?", "-c:a", "aac", "-b:a", "64k");
  } else {
    args.push("-an");
  }
  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(profile.crf),
    "-pix_fmt",
    "yuv420p",
    "-vf",
    `scale='min(${profile.maxWidth},iw)':-2`,
    "-movflags",
    "+faststart",
    "-y",
    input.outPath,
  );
  return args;
}

/** `ffmpeg` → `ffprobe`, keeping the directory. */
export function ffprobePathFor(ffmpegPath: string): string {
  const base = path.basename(ffmpegPath);
  if (base.includes("ffmpeg")) return path.join(path.dirname(ffmpegPath), base.replace("ffmpeg", "ffprobe"));
  return "ffprobe";
}

export type ProbeResult = {
  codec: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
};

export type FfmpegProber = (input: { bin: string; file: string; timeoutMs: number }) => Promise<ProbeResult | null>;

/** Reads the container with ffprobe. Returns null when ffprobe is unavailable. */
export const defaultFfmpegProber: FfmpegProber = async ({ bin, file, timeoutMs }) => {
  const run = await new Promise<{ ok: boolean; stdout: string }>((resolve) => {
    let stdout = "";
    let settled = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        bin,
        ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-show_entries", "format=duration", "-of", "json", file],
        { stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      resolve({ ok: false, stdout: "" });
      return;
    }
    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.length < 8000) stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout: "" });
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout });
    });
  });
  if (!run.ok) return null;
  try {
    const parsed = JSON.parse(run.stdout) as {
      streams?: Array<{ codec_name?: string; width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.find((item) => typeof item.codec_name === "string") ?? parsed.streams?.[0];
    const duration = Number(parsed.format?.duration);
    return {
      codec: stream?.codec_name ?? null,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      width: stream?.width ?? null,
      height: stream?.height ?? null,
    };
  } catch {
    return null;
  }
};

export const defaultFfmpegRunner: FfmpegRunner = ({ bin, args, timeoutMs }) =>
  new Promise<FfmpegRun>((resolve) => {
    let stderr = "";
    let settled = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      resolve({
        ok: false,
        code: null,
        stderr: redactRtspCredentials(error instanceof Error ? error.message : "spawn failed"),
        missing: true,
        timedOut: false,
      });
      return;
    }
    const timer = setTimeout(() => {
      if (!settled) child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        stderr: redactRtspCredentials(error.message),
        missing: error.code === "ENOENT",
        timedOut: false,
      });
    });
    child.on("close", (code) => {
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stderr: redactRtspCredentials(stderr), missing: false, timedOut: false });
    });
  });

const availabilityCache = new Map<string, { available: boolean; checkedAt: number }>();
const AVAILABILITY_TTL_MS = 5 * 60 * 1000;

/** Is the FFmpeg binary usable? Cached, so a status request does not spawn it often. */
export async function ffmpegAvailable(
  bin = getConfig().ffmpegPath,
  runner: FfmpegRunner = defaultFfmpegRunner,
  now = Date.now(),
): Promise<boolean> {
  const cached = availabilityCache.get(bin);
  if (cached && now - cached.checkedAt < AVAILABILITY_TTL_MS) return cached.available;
  const run = await runner({ bin, args: ["-version"], timeoutMs: FFMPEG_PROBE_TIMEOUT_MS });
  availabilityCache.set(bin, { available: run.ok, checkedAt: now });
  return run.ok;
}

/** An MP4 starts with a size field and the `ftyp` box. */
export function isMp4(bytes: Uint8Array): boolean {
  return (
    bytes.length > 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

/* -------------------------------------------------------------------------- */
/* Temporary files                                                            */
/* -------------------------------------------------------------------------- */

export function clipDir(dataDir: string): string {
  return path.resolve(dataDir, CLIP_DIR_NAME);
}

/** `clip-<eventId>-<time>.mp4`; the event id is validated, never trusted. */
export function clipFileName(eventId: string, now: number): string {
  const safe = /^evt_[a-f0-9]{24}$/.test(eventId) ? eventId : `event-${now.toString(36)}`;
  return `clip-${safe}-${now}.mp4`;
}

/** Delete clips left behind by a crash or a killed process. */
export async function cleanupStaleClips(
  dataDir: string,
  maxAgeMs = CLIP_STALE_MS,
  now = Date.now(),
): Promise<number> {
  const dir = clipDir(dataDir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith(".mp4") && !entry.endsWith(".part")) continue;
    const target = path.join(dir, entry);
    try {
      const info = await stat(target);
      if (now - info.mtimeMs < maxAgeMs) continue;
      await unlink(target);
      removed += 1;
    } catch {
      // Already gone, or not removable. Never fatal.
    }
  }
  return removed;
}

/* -------------------------------------------------------------------------- */
/* Clip generation                                                            */
/* -------------------------------------------------------------------------- */

export type ClipDeps = {
  transport?: PlaybackTransport;
  search?: typeof searchRecordings;
  runner?: FfmpegRunner;
  prober?: FfmpegProber;
  readFileImpl?: (file: string) => Promise<Buffer>;
  unlinkImpl?: (file: string) => Promise<void>;
  mkdirImpl?: (dir: string) => Promise<void>;
  now?: number;
  log?: (message: string) => void;
};

export type ClipInput = {
  eventId: string;
  cameraId: number;
  /** Stored event timestamp, ISO with the +05:30 offset. */
  eventTimestamp: string;
  config?: Pick<
    AppConfig,
    | "dvrConfigured"
    | "dvrHost"
    | "dvrHttpPort"
    | "dvrRtspPort"
    | "dvrUsername"
    | "dvrPassword"
    | "dataDir"
    | "ffmpegPath"
    | "telegramFaceVideo"
    | "telegramVideoPreSeconds"
    | "telegramVideoPostSeconds"
    | "telegramVideoMaxMb"
    | "telegramVideoTimeoutSeconds"
  >;
  deps?: ClipDeps;
};

/** Everything a support request needs, with no secret in it. */
export type ClipDiagnostics = {
  event: string;
  camera: number;
  eventTime: string;
  recordingFound: boolean;
  recordingStart: string | null;
  recordingEnd: string | null;
  requestedStart: string;
  requestedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  sourceFormat: string | null;
  ffmpegAvailable: boolean;
  ffmpegExitCode: number | null;
  ffmpegAttempts: number;
  outputExists: boolean;
  outputSize: number;
  outputDuration: number | null;
  outputCodec: string | null;
  errorStage: string | null;
};

function logVideo(message: string): void {
  console.info(`[telegram-video] ${message}`);
}

function emptyDiagnostics(input: ClipInput, eventAt: Date, window: ClipWindow): ClipDiagnostics {
  return {
    event: input.eventId,
    camera: input.cameraId,
    eventTime: input.eventTimestamp,
    recordingFound: false,
    recordingStart: null,
    recordingEnd: null,
    requestedStart: window.start.toISOString(),
    requestedEnd: window.end.toISOString(),
    actualStart: null,
    actualEnd: null,
    sourceFormat: null,
    ffmpegAvailable: false,
    ffmpegExitCode: null,
    ffmpegAttempts: 0,
    outputExists: false,
    outputSize: 0,
    outputDuration: null,
    outputCodec: null,
    errorStage: null,
  };
}

/**
 * Produce one MP4 for the event.
 *
 * Never throws. The result always carries the diagnostics, so the caller can
 * print a complete report when the clip does not make it to Telegram.
 */
export async function generateEventClip(input: ClipInput): Promise<ClipResult> {
  const config = input.config ?? getConfig();
  const deps = input.deps ?? {};
  const logger = deps.log ?? logVideo;
  const eventAt = new Date(input.eventTimestamp);
  const target = clipWindowForEvent(
    Number.isNaN(eventAt.getTime()) ? new Date(0) : eventAt,
    config.telegramVideoPreSeconds,
    config.telegramVideoPostSeconds,
  );
  const diagnostics = emptyDiagnostics(input, eventAt, target);
  const fail = (reason: ClipFailure, detail: string | null, stage: string): ClipResult => {
    diagnostics.errorStage = stage;
    logger(`ERROR stage=${stage} event=${input.eventId} error=${reason}`);
    return { ok: false, reason, detail, diagnostics };
  };

  logger(`event=${input.eventId} camera=${input.cameraId}`);
  if (!config.telegramFaceVideo) return fail("disabled", null, "disabled");
  if (Number.isNaN(eventAt.getTime())) return fail("invalid_event", null, "event-timestamp");
  if (!config.dvrConfigured) return fail("not_configured", null, "dvr-config");
  if (!Number.isInteger(input.cameraId) || input.cameraId < 1 || input.cameraId > 4) {
    return fail("invalid_event", null, "camera");
  }

  const totalSeconds = clipTotalSeconds(config.telegramVideoPreSeconds, config.telegramVideoPostSeconds);
  const maxBytes = Math.max(1, config.telegramVideoMaxMb) * 1024 * 1024;

  const transport =
    deps.transport ??
    new HikvisionClient({
      host: config.dvrHost,
      port: config.dvrHttpPort ?? 80,
      username: config.dvrUsername,
      password: config.dvrPassword,
    });
  const search = deps.search ?? searchRecordings;

  /* ---- recording search ------------------------------------------------- */
  logger("recording-search started");
  let recordings: Recording[] = [];
  try {
    for (const span of searchSpans(target)) {
      recordings.push(
        ...(await search(transport, {
          camera: input.cameraId,
          date: span.date,
          startTime: span.startTime,
          endTime: span.endTime,
        })),
      );
    }
  } catch (error) {
    const code = error instanceof HikvisionError ? error.code : "error";
    return fail("dvr_error", code, "recording-search");
  }
  recordings = dedupeRecordings(recordings);

  let picked = pickRecording(recordings, target);
  if (!picked) {
    // Nothing covers the event: fall back to event + total, as documented.
    const fallback = fallbackWindow(eventAt, totalSeconds);
    try {
      const extra: Recording[] = [];
      for (const span of searchSpans(fallback)) {
        extra.push(
          ...(await search(transport, {
            camera: input.cameraId,
            date: span.date,
            startTime: span.startTime,
            endTime: span.endTime,
          })),
        );
      }
      recordings = dedupeRecordings([...recordings, ...extra]);
      picked = pickRecording(recordings, fallback);
    } catch (error) {
      const code = error instanceof HikvisionError ? error.code : "error";
      return fail("dvr_error", code, "recording-search-fallback");
    }
  }
  if (!picked) {
    logger(`recording-search completed found=0 event=${input.eventId}`);
    return fail("no_recording", null, "recording-search");
  }

  diagnostics.recordingFound = true;
  diagnostics.recordingStart = picked.recording.startTime;
  diagnostics.recordingEnd = picked.recording.endTime;
  diagnostics.actualStart = picked.window.start.toISOString();
  diagnostics.actualEnd = picked.window.end.toISOString();
  logger(
    `recording-found start=${picked.recording.startTime} end=${picked.recording.endTime} ` +
      `actual=${diagnostics.actualStart}..${diagnostics.actualEnd}`,
  );

  const durationSeconds = Math.max(
    1,
    Math.round((picked.window.end.getTime() - picked.window.start.getTime()) / 1000),
  );

  /* ---- source acquisition ----------------------------------------------- */
  logger("source-acquisition started");
  let url: string;
  try {
    url = buildPlaybackRtsp({
      host: config.dvrHost,
      port: config.dvrRtspPort,
      username: config.dvrUsername,
      password: config.dvrPassword,
      track: input.cameraId * 100 + 1,
      start: picked.window.start,
      end: picked.window.end,
    });
  } catch (error) {
    const code = error instanceof HikvisionError ? error.code : "error";
    return fail("dvr_error", code, "source-acquisition");
  }
  // The URL carries the DVR credentials: report only its shape, never the URL.
  diagnostics.sourceFormat = `rtsp track ${input.cameraId * 100 + 1}, ${durationSeconds}s window`;
  logger(`source-acquired format="${diagnostics.sourceFormat}"`);

  /* ---- ffmpeg ----------------------------------------------------------- */
  const runner = deps.runner ?? defaultFfmpegRunner;
  const prober = deps.prober ?? defaultFfmpegProber;
  const dir = clipDir(config.dataDir);
  const outPath = path.join(dir, clipFileName(input.eventId, deps.now ?? Date.now()));
  const mkdirImpl = deps.mkdirImpl ?? (async (value: string) => void (await mkdir(value, { recursive: true })));
  await mkdirImpl(dir);

  const readFileImpl = deps.readFileImpl ?? readFile;
  const unlinkImpl = deps.unlinkImpl ?? unlink;
  const timeoutMs = Math.max(5, config.telegramVideoTimeoutSeconds) * 1000;
  const ffmpegBin = config.ffmpegPath;

  /*
   * With the real runner the answer is cached for a few minutes; with an injected
   * runner (tests, or an embedding host) ask that runner directly, because the
   * cache cannot tell two runners apart.
   */
  const available = deps.runner
    ? (await deps.runner({ bin: ffmpegBin, args: ["-version"], timeoutMs: FFMPEG_PROBE_TIMEOUT_MS })).ok
    : await ffmpegAvailable(ffmpegBin);
  if (!available) {
    diagnostics.ffmpegAvailable = false;
    logger(`ffmpeg check failed bin=${path.basename(ffmpegBin)}`);
    return fail("ffmpeg_missing", null, "ffmpeg-check");
  }
  diagnostics.ffmpegAvailable = true;

  /*
   * Three attempts, in order of preference:
   *   1. video + optional AAC audio (the `?` keeps a silent source working);
   *   2. video only, if the audio path upsets the source;
   *   3. smaller/lower quality, only if the result exceeded the size limit.
   */
  const attempts = [
    FFMPEG_PROFILE_DEFAULT,
    FFMPEG_PROFILE_VIDEO_ONLY,
    ...(maxBytes > 0 ? [] : []),
  ];

  let bytes: Buffer | null = null;
  let usedProfile = FFMPEG_PROFILE_DEFAULT;
  for (const [index, profile] of attempts.entries()) {
    diagnostics.ffmpegAttempts = index + 1;
    logger(`ffmpeg started attempt=${index + 1} audio=${profile.audio} crf=${profile.crf}`);
    const run = await runner({
      bin: ffmpegBin,
      args: ffmpegArgs({ url, outPath, durationSeconds, profile }),
      timeoutMs,
    });
    diagnostics.ffmpegExitCode = run.code;
    if (!run.ok) {
      const detail = redactRtspCredentials(run.stderr).slice(0, 200) || null;
      if (run.missing) {
        logger("ffmpeg is not installed; skipping the clip");
        return fail("ffmpeg_missing", null, "ffmpeg-run");
      }
      logger(`ffmpeg failed attempt=${index + 1} code=${run.code ?? "none"}`);
      if (profile.audio) continue; // retry video-only
      return fail("ffmpeg_failed", detail, "ffmpeg-run");
    }
    logger(`ffmpeg completed attempt=${index + 1} code=${run.code ?? 0}`);

    let candidate: Buffer;
    try {
      candidate = await readFileImpl(outPath);
    } catch {
      return fail("invalid_output", null, "output-read");
    }
    diagnostics.outputExists = true;
    diagnostics.outputSize = candidate.length;
    logger(`output=${candidate.length} bytes`);

    if (candidate.length === 0 || !isMp4(candidate)) {
      await unlinkImpl(outPath).catch(() => undefined);
      diagnostics.outputExists = false;
      return fail("invalid_output", null, "output-validate");
    }

    if (candidate.length > maxBytes) {
      // One retry at a lower quality before giving up on the video.
      if (profile !== FFMPEG_PROFILE_SMALL) {
        logger(`output exceeds ${config.telegramVideoMaxMb} MB; retrying smaller`);
        await unlinkImpl(outPath).catch(() => undefined);
        diagnostics.outputExists = false;
        const small = await runner({
          bin: ffmpegBin,
          args: ffmpegArgs({ url, outPath, durationSeconds, profile: FFMPEG_PROFILE_SMALL }),
          timeoutMs,
        });
        diagnostics.ffmpegAttempts += 1;
        diagnostics.ffmpegExitCode = small.code;
        if (!small.ok) {
          return fail("ffmpeg_failed", redactRtspCredentials(small.stderr).slice(0, 200) || null, "ffmpeg-retry");
        }
        candidate = await readFileImpl(outPath).catch(() => Buffer.alloc(0));
        diagnostics.outputExists = candidate.length > 0;
        diagnostics.outputSize = candidate.length;
      }
      if (candidate.length > maxBytes) {
        await unlinkImpl(outPath).catch(() => undefined);
        diagnostics.outputExists = false;
        logger(`output still exceeds ${config.telegramVideoMaxMb} MB; skipping the clip`);
        return fail("too_large", `${candidate.length} bytes`, "output-size");
      }
    }

    bytes = candidate;
    usedProfile = profile;
    break;
  }

  if (!bytes) return fail("ffmpeg_failed", null, "ffmpeg-run");

  /* ---- container validation (ffprobe when it is available) -------------- */
  const probed = await prober({ bin: ffprobePathFor(ffmpegBin), file: outPath, timeoutMs: 10_000 });
  if (probed) {
    diagnostics.outputCodec = probed.codec;
    diagnostics.outputDuration = probed.durationSeconds;
    if (probed.codec && probed.codec !== "h264") {
      await unlinkImpl(outPath).catch(() => undefined);
      diagnostics.outputExists = false;
      return fail("invalid_output", `codec ${probed.codec}`, "output-probe");
    }
  }

  logger(
    `clip ready event=${input.eventId} seconds=${durationSeconds} bytes=${bytes.length} ` +
      `codec=${diagnostics.outputCodec ?? "h264"} audio=${usedProfile.audio}`,
  );

  return {
    ok: true,
    path: outPath,
    bytes: bytes.length,
    durationSeconds,
    window: picked.window,
    recordingStart: picked.recording.startTime,
    recordingEnd: picked.recording.endTime,
    diagnostics,
  };
}
