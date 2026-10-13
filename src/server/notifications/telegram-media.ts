import "server-only";
import { readFile, unlink } from "node:fs/promises";
import type { AppConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { TelegramMediaStatusResponse } from "@/lib/api-types";
import { snapshotFile } from "@/lib/snapshot-path";
import {
  buildTelegramPhotoCaption,
  buildTelegramVideoCaption,
  sendTelegramMediaGroup,
  sendTelegramPhoto,
  sendTelegramVideo,
  telegramState,
  type TelegramFile,
  type TelegramResult,
} from "@/server/notifications/telegram";
import {
  cleanupStaleClips,
  ffmpegAvailable,
  generateEventClip,
  type ClipDiagnostics,
  type ClipResult,
} from "@/server/notifications/event-clip";

/**
 * Background delivery of the Telegram face image and event clip.
 *
 * The face notification decision never waits for this: it enqueues a job and
 * returns. One worker drains the queue one job at a time, so a slow DVR search
 * or an FFmpeg transcode can never delay event ingestion, face detection, the
 * browser notification or another job's text message.
 *
 * The queue is in memory by design: media is best-effort enrichment, and a hub
 * restart dropping a pending clip is preferable to a new database table. The
 * text notification is sent by the decision itself and is unaffected.
 */

export const TELEGRAM_MEDIA_INTERVAL_MS = 1500;
export const TELEGRAM_MEDIA_QUEUE_LIMIT = 50;
const CLEANUP_EVERY_MS = 10 * 60 * 1000;

export type FaceMediaJob = {
  eventId: string;
  cameraId: number;
  cameraName: string;
  faces: number;
  maxConfidence: number;
  /** Stored event timestamp, ISO with the +05:30 offset. */
  eventTimestamp: string;
  /**
   * Full camera snapshot for the event, relative to DATA_DIR/events, exactly as
   * stored on `events.snapshot_path`. The face crop is never sent to Telegram.
   */
  snapshotPath: string | null;
};

export type MediaStep = "sent" | "skipped" | "failed";

export type FaceMediaOutcome = {
  eventId: string;
  image: MediaStep;
  imageCount: number;
  video: MediaStep;
  videoReason: string | null;
  detail: string | null;
};

export type FaceMediaDeps = {
  config?: AppConfig;
  dataDir?: string;
  readFileImpl?: (file: string) => Promise<Buffer>;
  unlinkImpl?: (file: string) => Promise<void>;
  sendPhoto?: typeof sendTelegramPhoto;
  sendMediaGroup?: typeof sendTelegramMediaGroup;
  sendVideo?: typeof sendTelegramVideo;
  generateClip?: typeof generateEventClip;
  log?: (line: string) => void;
};

const queue: FaceMediaJob[] = [];
let started = false;
let running = false;
let lastCleanup = 0;

export function telegramMediaQueueDepth(): number {
  return queue.length;
}

/** Queue the media for one accepted notification. Never throws. */
export function enqueueFaceMedia(job: FaceMediaJob, config: AppConfig = getConfig()): "queued" | "disabled" | "full" {
  const state = telegramState(config);
  if (!state.enabled || !state.configured || !state.faceReady) return "disabled";
  if (queue.length >= TELEGRAM_MEDIA_QUEUE_LIMIT) {
    queue.shift();
    console.warn("[telegram-media] queue full; dropped the oldest job");
    return "full";
  }
  queue.push(job);
  return "queued";
}

function logLine(message: string): void {
  console.info(`[telegram-media] ${message}`);
}

/**
 * Print the whole video pipeline in one block when the clip does not reach
 * Telegram. Every field is safe: no token, no chat id, no DVR URL, no path.
 */
export function logVideoDiagnostics(
  diagnostics: ClipDiagnostics,
  httpStatus: number | null,
  telegram: TelegramResult | null,
  log: (line: string) => void = logLine,
): void {
  const lines = [
    "[telegram-video]",
    `event: ${diagnostics.event}`,
    `camera: ${diagnostics.camera}`,
    `eventTime: ${diagnostics.eventTime}`,
    `recordingFound: ${diagnostics.recordingFound}`,
    `recordingStart: ${diagnostics.recordingStart ?? "-"}`,
    `recordingEnd: ${diagnostics.recordingEnd ?? "-"}`,
    `requestedStart: ${diagnostics.requestedStart}`,
    `requestedEnd: ${diagnostics.requestedEnd}`,
    `actualStart: ${diagnostics.actualStart ?? "-"}`,
    `actualEnd: ${diagnostics.actualEnd ?? "-"}`,
    `sourceFormat: ${diagnostics.sourceFormat ?? "-"}`,
    `ffmpegAvailable: ${diagnostics.ffmpegAvailable}`,
    `ffmpegExitCode: ${diagnostics.ffmpegExitCode ?? "-"}`,
    `ffmpegAttempts: ${diagnostics.ffmpegAttempts}`,
    `outputExists: ${diagnostics.outputExists}`,
    `outputSize: ${diagnostics.outputSize}`,
    `outputDuration: ${diagnostics.outputDuration ?? "-"}`,
    `outputCodec: ${diagnostics.outputCodec ?? "-"}`,
    `errorStage: ${diagnostics.errorStage ?? "-"}`,
    `telegramHttpStatus: ${httpStatus ?? "-"}`,
    `telegramOk: ${telegram ? telegram.ok : "-"}`,
    `telegramError: ${telegram && !telegram.ok ? (telegram.detail ?? telegram.status) : "-"}`,
  ];
  for (const line of lines) log(line);
}

/**
 * Deliver the image(s) and the clip for one event.
 *
 * Each step is independent: a missing crop does not stop the clip, and a failed
 * clip does not undo the image or the text.
 */
export async function processFaceMediaJob(job: FaceMediaJob, deps: FaceMediaDeps = {}): Promise<FaceMediaOutcome> {
  const config = deps.config ?? getConfig();
  const dataDir = deps.dataDir ?? config.dataDir;
  const log = deps.log ?? logLine;
  const readFileImpl = deps.readFileImpl ?? readFile;
  const unlinkImpl = deps.unlinkImpl ?? unlink;

  const state = telegramState(config);
  if (!state.enabled || !state.configured || !state.faceReady) {
    return { eventId: job.eventId, image: "skipped", imageCount: 0, video: "skipped", videoReason: "disabled", detail: null };
  }

  /* ---- face crop(s) ---------------------------------------------------- */
  let image: MediaStep = "skipped";
  let imageCount = 0;
  let detail: string | null = null;

  if (config.telegramFaceImage) {
    const file = snapshotFile(dataDir, job.snapshotPath);
    let snapshot: TelegramFile | null = null;
    if (file) {
      try {
        const bytes = await readFileImpl(file);
        if (bytes.length > 0) {
          snapshot = { bytes, filename: "camera-snapshot.jpg", contentType: "image/jpeg" };
        }
      } catch {
        // Snapshot already removed by retention: skip the image only.
      }
    }

    if (!snapshot) {
      log(`event=${job.eventId} image=skipped reason=no_snapshot`);
    } else {
      imageCount = 1;
      log(`event=${job.eventId} image-upload started bytes=${snapshot.bytes.length}`);
      const sendPhoto = deps.sendPhoto ?? sendTelegramPhoto;
      const result: TelegramResult = await sendPhoto({
        photo: snapshot,
        caption: buildTelegramPhotoCaption({ cameraName: job.cameraName, eventTimestamp: job.eventTimestamp }),
        config,
      });
      image = result.ok ? "sent" : "failed";
      if (!result.ok) detail = result.detail ?? result.status;
      log(`event=${job.eventId} image-upload completed image=${image}`);
    }
  }

  /* ---- one clip per event ---------------------------------------------- */
  let video: MediaStep = "skipped";
  let videoReason: string | null = null;

  if (config.telegramFaceVideo) {
    const generate = deps.generateClip ?? generateEventClip;
    const clip: ClipResult = await generate({
      eventId: job.eventId,
      cameraId: job.cameraId,
      eventTimestamp: job.eventTimestamp,
      config,
    });

    if (!clip.ok) {
      video = "skipped";
      videoReason = clip.reason;
      log(`event=${job.eventId} video=skipped reason=${clip.reason}`);
      logVideoDiagnostics(clip.diagnostics, null, null, log);
    } else {
      try {
        const bytes = await readFileImpl(clip.path);
        const sendVideo = deps.sendVideo ?? sendTelegramVideo;
        log(`telegram-upload started event=${job.eventId} bytes=${bytes.length}`);
        const result = await sendVideo({
          video: { bytes, filename: "cctv-event.mp4", contentType: "video/mp4" },
          caption: buildTelegramVideoCaption({ cameraName: job.cameraName, eventTimestamp: job.eventTimestamp }),
          config,
        });
        video = result.ok ? "sent" : "failed";
        if (!result.ok) {
          videoReason = result.status;
          detail = detail ?? result.detail ?? result.status;
        }
        log(
          `telegram-upload completed event=${job.eventId} video=${video} seconds=${clip.durationSeconds} bytes=${clip.bytes}` +
            (result.ok ? "" : ` reason=${result.status}`),
        );
        if (!result.ok) logVideoDiagnostics(clip.diagnostics, null, result, log);
      } catch (error) {
        video = "failed";
        videoReason = "read_failed";
        detail = detail ?? (error instanceof Error ? error.name : "read_failed");
        log(`ERROR stage=telegram-upload event=${job.eventId} error=read_failed`);
      } finally {
        // Temporary by definition: removed after a successful or failed upload.
        await unlinkImpl(clip.path).catch(() => undefined);
      }
    }
  }

  return { eventId: job.eventId, image, imageCount, video, videoReason, detail };
}

/* -------------------------------------------------------------------------- */
/* Worker                                                                     */
/* -------------------------------------------------------------------------- */

/** Start the drain loop once. Cheap and idle when Telegram is off. */
export function ensureTelegramMediaWorker(): void {
  if (started) return;
  started = true;
  setInterval(() => void mediaTick(), TELEGRAM_MEDIA_INTERVAL_MS);
}

async function mediaTick(): Promise<void> {
  if (running) return; // single flight: one clip at a time
  running = true;
  try {
    const config = getConfig();
    if (Date.now() - lastCleanup > CLEANUP_EVERY_MS) {
      lastCleanup = Date.now();
      const removed = await cleanupStaleClips(config.dataDir);
      if (removed > 0) logLine(`removed ${removed} stale clip(s)`);
    }
    const job = queue.shift();
    if (!job) return;
    await processFaceMediaJob(job, { config });
  } catch (error) {
    console.error("[telegram-media] tick", error instanceof Error ? error.name : "error");
  } finally {
    running = false;
  }
}

/* -------------------------------------------------------------------------- */
/* Status (read-only, no secrets)                                             */
/* -------------------------------------------------------------------------- */

export type TelegramMediaStatus = TelegramMediaStatusResponse;

/** Status for the settings page. Contains no token, chat id or DVR detail. */
export async function telegramMediaStatus(config: AppConfig = getConfig()): Promise<TelegramMediaStatus> {
  const state = telegramState(config);
  return {
    enabled: state.enabled,
    configured: state.configured,
    faceNotifications: config.telegramFaceNotifications,
    faceImage: config.telegramFaceImage,
    faceVideo: config.telegramFaceVideo,
    videoPreSeconds: config.telegramVideoPreSeconds,
    videoPostSeconds: config.telegramVideoPostSeconds,
    clipSeconds: config.telegramVideoPreSeconds + config.telegramVideoPostSeconds,
    ffmpeg: (await ffmpegAvailable(config.ffmpegPath)) ? "available" : "unavailable",
    queueDepth: telegramMediaQueueDepth(),
  };
}
