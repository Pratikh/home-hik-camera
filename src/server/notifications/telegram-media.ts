import "server-only";
import { readFile, unlink } from "node:fs/promises";
import type { AppConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import type { TelegramMediaStatusResponse } from "@/lib/api-types";
import { faceCropFile } from "@/lib/face-path";
import { snapshotFile } from "@/lib/snapshot-path";
import { openEventStore } from "@/server/events/event-store";
import {
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
 * Background delivery of the Telegram event snapshot and clip, for both the
 * face channel and ordinary rule notifications.
 *
 * The notification decision never waits for this: it enqueues a job and
 * returns. One worker drains the queue one job at a time, so a slow DVR search
 * or an FFmpeg transcode can never delay event ingestion, face detection, the
 * browser notification or another job's text message.
 *
 * The queue lives in SQLite (the additive `telegram_media_jobs` table), so a hub
 * restart no longer drops a pending clip: a job that was in flight is requeued at
 * startup, and the UNIQUE event_id keeps the queue idempotent per event. The text
 * notification is sent by the decision itself and never goes through this queue.
 */

export const TELEGRAM_MEDIA_INTERVAL_MS = 1500;
export const TELEGRAM_MEDIA_QUEUE_LIMIT = 50;
/** How long a clip waits before it retries for a busy DVR playback slot. */
export const TELEGRAM_MEDIA_RETRY_MS = 3 * 60 * 1000;
const CLEANUP_EVERY_MS = 10 * 60 * 1000;

export type TelegramMediaChannel = "face" | "event";

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
  /**
   * Stored face crop for this event, relative to DATA_DIR/face-crops. Resolved
   * by the worker when the job runs, because face detection may finish after the
   * notification was queued. Preferred over the full snapshot.
   */
  cropPath?: string | null;
  /**
   * 1 on the first pass. A retry continues where the first pass stopped, so the
   * snapshot is not uploaded twice.
   */
  attempts?: number;
  /**
   * Which Telegram channel accepted this event. Face jobs follow
   * TELEGRAM_FACE_NOTIFICATIONS; rule-event jobs follow
   * TELEGRAM_EVENT_NOTIFICATIONS, so disabling one never strands the other.
   */
  channel?: TelegramMediaChannel;
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

const QUEUE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
let started = false;
let running = false;
let lastMaintenance = 0;

/** Pending jobs, straight from the durable queue. */
export function telegramMediaQueueDepth(dataDir: string = getConfig().dataDir): number {
  try {
    return openEventStore(dataDir).telegramMediaQueueDepth();
  } catch {
    return 0;
  }
}

/**
 * Queue the media for one accepted notification. Never throws.
 *
 * Returns "queued" when the job is in the queue — including when an identical
 * event was already queued, since the UNIQUE event_id makes that a no-op.
 */
export function enqueueTelegramMedia(
  job: FaceMediaJob,
  config: AppConfig = getConfig(),
): "queued" | "disabled" | "full" {
  const state = telegramState(config);
  const ready = job.channel === "event" ? state.eventReady : state.faceReady;
  if (!state.enabled || !state.configured || !ready) return "disabled";
  try {
    const result = openEventStore(config.dataDir).enqueueTelegramMediaJob({
      ...job,
      now: new Date().toISOString(),
      limit: TELEGRAM_MEDIA_QUEUE_LIMIT,
    });
    if (result === "full") {
      console.warn("[telegram-media] queue full; dropped the oldest job");
      return "full";
    }
    return "queued";
  } catch (error) {
    console.error("[telegram-media] enqueue", error instanceof Error ? error.name : "error");
    return "disabled";
  }
}

/** Queue the snapshot and clip for an accepted face-test notification. */
export function enqueueFaceMedia(job: FaceMediaJob, config: AppConfig = getConfig()): "queued" | "disabled" | "full" {
  return enqueueTelegramMedia({ ...job, channel: "face" }, config);
}

/** Queue the snapshot and clip for an accepted general rule notification. */
export function enqueueEventMedia(job: FaceMediaJob, config: AppConfig = getConfig()): "queued" | "disabled" | "full" {
  return enqueueTelegramMedia({ ...job, channel: "event" }, config);
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
  const ready = job.channel === "event" ? state.eventReady : state.faceReady;
  if (!state.enabled || !state.configured || !ready) {
    return { eventId: job.eventId, image: "skipped", imageCount: 0, video: "skipped", videoReason: "disabled", detail: null };
  }

  /* ---- video first: a media-only notification prefers the clip ---------- */
  let video: MediaStep = "skipped";
  let videoReason: string | null = null;
  let image: MediaStep = "skipped";
  let imageCount = 0;
  let detail: string | null = null;

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
        // Media only: no caption, so the chat receives just the clip.
        const result = await sendVideo({
          video: { bytes, filename: "cctv-event.mp4", contentType: "video/mp4" },
          config,
        });
        if (result.ok) {
          video = "sent";
          log(
            `telegram-upload completed event=${job.eventId} video=sent seconds=${clip.durationSeconds} bytes=${clip.bytes}`,
          );
          return { eventId: job.eventId, image, imageCount, video, videoReason, detail };
        }
        video = "failed";
        videoReason = result.status;
        detail = result.detail ?? result.status;
        log(`telegram-upload completed event=${job.eventId} video=failed reason=${result.status}`);
        logVideoDiagnostics(clip.diagnostics, null, result, log);
      } catch (error) {
        video = "failed";
        videoReason = "read_failed";
        detail = error instanceof Error ? error.name : "read_failed";
        log(`ERROR stage=telegram-upload event=${job.eventId} error=read_failed`);
      } finally {
        // Temporary by definition: removed after a successful or failed upload.
        await unlinkImpl(clip.path).catch(() => undefined);
      }
    }
  }

  /* ---- image fallback: face crop first, then the full snapshot ---------- */
  if (config.telegramFaceImage && (job.attempts ?? 1) <= 1) {
    const cropFile = faceCropFile(dataDir, job.cropPath ?? null);
    const snapshot = cropFile ? null : snapshotFile(dataDir, job.snapshotPath);
    const file = cropFile ?? snapshot;
    let photo: TelegramFile | null = null;
    if (file) {
      try {
        const bytes = await readFileImpl(file);
        if (bytes.length > 0) {
          photo = { bytes, filename: cropFile ? "person.jpg" : "camera-snapshot.jpg", contentType: "image/jpeg" };
        }
      } catch {
        // Removed by retention: fall through to the next source, if any.
      }
    }

    if (!photo) {
      log(`event=${job.eventId} image=skipped reason=no_image`);
    } else {
      imageCount = 1;
      log(`event=${job.eventId} image-upload started bytes=${photo.bytes.length} source=${cropFile ? "face-crop" : "snapshot"}`);
      const sendPhoto = deps.sendPhoto ?? sendTelegramPhoto;
      // Media only: no caption.
      const result: TelegramResult = await sendPhoto({ photo, config });
      image = result.ok ? "sent" : "failed";
      if (!result.ok) detail = detail ?? result.detail ?? result.status;
      log(`event=${job.eventId} image-upload completed image=${image}`);
    }
  }

  if (image !== "sent") {
    // Deliberately no text fallback: the chat must not receive the old verbose
    // message when the event has no usable media.
    log(`event=${job.eventId} MEDIA_UNAVAILABLE`);
  }

  return { eventId: job.eventId, image, imageCount, video, videoReason, detail };
}

/* -------------------------------------------------------------------------- */
/* Worker                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Start the drain loop once. Cheap and idle when Telegram is off.
 *
 * Any job left "running" by a previous process is requeued here: the queue is
 * idempotent per event, so a retry cannot duplicate a clip.
 */
export function ensureTelegramMediaWorker(): void {
  if (started) return;
  started = true;
  try {
    const config = getConfig();
    const requeued = openEventStore(config.dataDir).resetStaleTelegramMediaJobs(new Date().toISOString());
    if (requeued > 0) logLine(`requeued ${requeued} media job(s) left by a restart`);
  } catch (error) {
    console.error("[telegram-media] recovery", error instanceof Error ? error.name : "error");
  }
  setInterval(() => void mediaTick(), TELEGRAM_MEDIA_INTERVAL_MS);
}

async function mediaTick(): Promise<void> {
  if (running) return; // single flight: one clip at a time
  running = true;
  try {
    const config = getConfig();
    const store = openEventStore(config.dataDir);
    if (Date.now() - lastMaintenance > CLEANUP_EVERY_MS) {
      lastMaintenance = Date.now();
      const removed = await cleanupStaleClips(config.dataDir);
      if (removed > 0) logLine(`removed ${removed} stale clip(s)`);
      const pruned = store.pruneTelegramMediaJobs(new Date(Date.now() - QUEUE_RETENTION_MS).toISOString());
      if (pruned > 0) logLine(`pruned ${pruned} finished media job(s)`);
    }

    const claimed = store.claimNextTelegramMediaJob(new Date().toISOString());
    if (!claimed) return;
    const job: FaceMediaJob = {
      eventId: claimed.eventId,
      cameraId: claimed.cameraId,
      cameraName: claimed.cameraName,
      faces: claimed.faces,
      maxConfidence: claimed.maxConfidence,
      eventTimestamp: claimed.eventTimestamp,
      snapshotPath: claimed.snapshotPath,
      // Face detection can finish after the notification was queued, so the
      // crop is resolved here, when the job actually runs.
      cropPath: store.cropPathForEvent(claimed.eventId),
      channel: claimed.channel,
      attempts: claimed.attempts,
    };
    const outcome = await processFaceMediaJob(job, { config });
    const now = new Date().toISOString();

    /*
     * The DVR has a small number of playback slots. While someone is watching
     * live or scrub playback, the clip's FFmpeg run can time out. One delayed
     * retry lets that job use a free slot. It only applies when no image was
     * already sent: the accepted event must produce exactly one notification.
     */
    const retryableVideo =
      outcome.video === "skipped" &&
      outcome.image !== "sent" &&
      (outcome.videoReason === "ffmpeg_failed" || outcome.videoReason === "dvr_error") &&
      claimed.attempts < 2;
    if (retryableVideo) {
      store.retryTelegramMediaJob(
        claimed.id,
        new Date(Date.now() + TELEGRAM_MEDIA_RETRY_MS).toISOString(),
        outcome.videoReason,
        now,
      );
      logLine(`event=${claimed.eventId} video=retry scheduled in ${Math.round(TELEGRAM_MEDIA_RETRY_MS / 1000)}s`);
      return;
    }

    // A notification succeeded if either media leg reached the chat; the other
    // leg failing is recorded in the outcome, not as a failed notification.
    const delivered = outcome.image === "sent" || outcome.video === "sent";
    store.finishTelegramMediaJob(
      claimed.id,
      !delivered && (outcome.image === "failed" || outcome.video === "failed") ? "failed" : "done",
      outcome.detail,
      now,
    );
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
    eventNotifications: config.telegramEventNotifications,
    faceImage: config.telegramFaceImage,
    faceVideo: config.telegramFaceVideo,
    videoPreSeconds: config.telegramVideoPreSeconds,
    videoPostSeconds: config.telegramVideoPostSeconds,
    clipSeconds: config.telegramVideoPreSeconds + config.telegramVideoPostSeconds,
    ffmpeg: (await ffmpegAvailable(config.ffmpegPath)) ? "available" : "unavailable",
    queueDepth: telegramMediaQueueDepth(config.dataDir),
  };
}
