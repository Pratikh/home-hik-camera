import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readConfig } from "@/lib/config";
import { openEventStore } from "@/server/events/event-store";
import type { TelegramFile, TelegramResult } from "@/server/notifications/telegram";
import type { ClipDiagnostics } from "@/server/notifications/event-clip";
import {
  enqueueEventMedia,
  enqueueFaceMedia,
  logVideoDiagnostics,
  processFaceMediaJob,
  telegramMediaQueueDepth,
  type FaceMediaJob,
} from "@/server/notifications/telegram-media";

/**
 * TELEGRAM-MEDIA-002 … 006, 011, 014 … 018, 021, 022, 024, 030 — the background
 * media worker.
 *
 * Telegram, the clip generator and the filesystem are mocked, so no test sends a
 * message, contacts the DVR or runs FFmpeg.
 */

const FAKE_TOKEN = "333333:CCCfake-media-token-value";
const FAKE_CHAT = "-1001234567890";
const EVENT_ID = "evt_aaaaaaaaaaaaaaaaaaaaaaaa";
const SNAPSHOT = `2026/10/10/3-${EVENT_ID}.jpg`;
/** Only the general rule-event Telegram channel is on for these tests. */
const EVENT_ONLY = { TELEGRAM_FACE_NOTIFICATIONS: "false", TELEGRAM_EVENT_NOTIFICATIONS: "true" };

function config(dataDir: string, overrides: Record<string, string> = {}) {
  return readConfig({
    APP_USERNAME: "home",
    APP_PASSWORD: "app-password",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    DATA_DIR: dataDir,
    DVR_HOST: "192.168.0.210",
    DVR_USERNAME: "admin",
    DVR_PASSWORD: "dvr-secret",
    TELEGRAM_NOTIFICATIONS_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: FAKE_TOKEN,
    TELEGRAM_CHAT_ID: FAKE_CHAT,
    TELEGRAM_FACE_NOTIFICATIONS: "true",
    ...overrides,
  });
}

const JOB: FaceMediaJob = {
  eventId: EVENT_ID,
  cameraId: 3,
  cameraName: "First Floor Passage",
  faces: 3,
  maxConfidence: 0.66,
  eventTimestamp: "2026-10-10T14:35:20+05:30",
  snapshotPath: SNAPSHOT,
};

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);
/** The full camera view is a different, larger image than a face crop. */
const SNAPSHOT_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
const CROP_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0x01]);

const tempDirs: string[] = [];
async function dataDirWithSnapshot(withSnapshot = true): Promise<string> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "media-test-"));
  tempDirs.push(dir);
  const dirPath = path.join(dir, "events", "2026", "10", "10");
  await mkdir(dirPath, { recursive: true });
  if (withSnapshot) await writeFile(path.join(dirPath, `3-${EVENT_ID}.jpg`), SNAPSHOT_BYTES);
  // A face crop also exists on disk: it must never be uploaded.
  const crops = path.join(dir, "face-crops", "2026", "10");
  await mkdir(crops, { recursive: true });
  await writeFile(path.join(crops, `${EVENT_ID}-face-1.jpg`), CROP_BYTES);
  return dir;
}

function diagnostics(overrides: Partial<ClipDiagnostics> = {}): ClipDiagnostics {
  return {
    event: EVENT_ID,
    camera: 3,
    eventTime: JOB.eventTimestamp,
    recordingFound: true,
    recordingStart: "2026-10-10T14:00:00+05:30",
    recordingEnd: "2026-10-10T15:00:00+05:30",
    requestedStart: "2026-10-10T09:05:15.000Z",
    requestedEnd: "2026-10-10T09:05:25.000Z",
    actualStart: "2026-10-10T09:05:15.000Z",
    actualEnd: "2026-10-10T09:05:25.000Z",
    sourceFormat: "rtsp track 301, 10s window",
    ffmpegAvailable: true,
    ffmpegExitCode: 0,
    ffmpegAttempts: 1,
    outputExists: true,
    outputSize: MP4.length,
    outputDuration: 10,
    outputCodec: "h264",
    errorStage: null,
    ...overrides,
  };
}

function clipOk(dir: string, overrides: Partial<ClipDiagnostics> = {}) {
  return {
    ok: true as const,
    path: path.join(dir, "telegram-clips", `clip-${EVENT_ID}-1.mp4`),
    bytes: MP4.length,
    durationSeconds: 10,
    window: { start: new Date("2026-10-10T14:35:15+05:30"), end: new Date("2026-10-10T14:35:25+05:30") },
    recordingStart: "2026-10-10T14:00:00+05:30",
    recordingEnd: "2026-10-10T15:00:00+05:30",
    diagnostics: diagnostics(overrides),
  };
}

function clipFailed(reason: "no_recording" | "ffmpeg_missing" | "ffmpeg_failed" | "too_large") {
  return {
    ok: false as const,
    reason,
    detail: null,
    diagnostics: diagnostics({ recordingFound: false, outputExists: false }),
  };
}

function ok(): TelegramResult {
  return { ok: true, status: "sent" };
}
function failed(status: "http_error" | "timeout" | "network_error" = "http_error"): TelegramResult {
  return { ok: false, status, detail: "HTTP 400: bad request" };
}

async function prepareClip(dir: string): Promise<string> {
  const file = path.join(dir, "telegram-clips", `clip-${EVENT_ID}-1.mp4`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, MP4);
  return file;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("TELEGRAM-MEDIA-002 / 003 / 004 — the full snapshot replaces the crop", () => {
  it("TELEGRAM-MEDIA-002 / 003 falls back to the full snapshot when the clip is unavailable", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    const sendMediaGroup = vi.fn(async () => ok());
    const sendVideo = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup,
      sendVideo,
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });

    expect(outcome.image).toBe("sent");
    expect(outcome.imageCount).toBe(1);
    expect(outcome.video).toBe("skipped");
    // Media only: one image, no video, and no caption.
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendVideo).not.toHaveBeenCalled();
    expect(sendMediaGroup).not.toHaveBeenCalled();

    const call = sendPhoto.mock.calls[0]![0];
    // No crop was supplied on the job, so the full snapshot is used.
    expect(Buffer.from(call.photo.bytes).equals(SNAPSHOT_BYTES)).toBe(true);
    expect(Buffer.from(call.photo.bytes).equals(CROP_BYTES)).toBe(false);
    expect(call.photo.filename).toBe("camera-snapshot.jpg");
    expect(call.photo.contentType).toBe("image/jpeg");
    // Media only: the image carries the face caption, never a separate text.
    expect(call.caption).toBe(["👤 <b>Face detected</b>", "", "📹 Camera: First Floor Passage", "🕐 Time: 10 Oct 2026, 02:35 PM", "🎯 Confidence: 66%"].join("\n"));
  });

  it("TELEGRAM-MEDIA-035 sends no text and logs MEDIA_UNAVAILABLE when there is no media", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async () => ok());
    const sendVideo = vi.fn(async () => ok());
    const log = vi.fn();

    const outcome = await processFaceMediaJob({ ...JOB, snapshotPath: null, cropPath: null }, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo,
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log,
    });

    expect(outcome.image).toBe("skipped");
    expect(outcome.video).toBe("skipped");
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendVideo).not.toHaveBeenCalled();
    expect(log.mock.calls.join("\n")).toContain("MEDIA_UNAVAILABLE");
  });

  it("TELEGRAM-MEDIA-016 a missing snapshot file does not stop the clip", async () => {
    const dataDir = await dataDirWithSnapshot(false);
    await prepareClip(dataDir);
    const generateClip = vi.fn(async () => clipOk(dataDir));
    const sendVideo = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto: vi.fn(async () => ok()),
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo,
      generateClip,
      unlinkImpl: vi.fn(async () => undefined),
      log: () => undefined,
    });

    expect(outcome.video).toBe("sent");
    expect(sendVideo).toHaveBeenCalledTimes(1);
    expect(generateClip).toHaveBeenCalledTimes(1);
  });
});

describe("TELEGRAM-MEDIA-011 / 013 / 014 / 015 / 030 — the clip upload", () => {
  it("TELEGRAM-MEDIA-011 uploads the generated MP4 as a binary file with the event's camera and time", async () => {
    const dataDir = await dataDirWithSnapshot();
    await prepareClip(dataDir);
    const sendVideo = vi.fn(async (input: { video: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    const generateClip = vi.fn(async (input: { eventId: string; cameraId: number; eventTimestamp: string }) => {
      void input;
      return clipOk(dataDir);
    });

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto: vi.fn(async () => ok()),
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo,
      generateClip,
      unlinkImpl: vi.fn(async () => undefined),
      log: () => undefined,
    });

    expect(outcome.video).toBe("sent");
    expect(sendVideo).toHaveBeenCalledTimes(1);
    const call = sendVideo.mock.calls[0]![0];
    // Real bytes, not a path or a URL.
    expect(Buffer.from(call.video.bytes).equals(MP4)).toBe(true);
    expect(call.video.contentType).toBe("video/mp4");
    expect(call.video.filename).toBe("cctv-event.mp4");
    // Media only: the video carries the face caption.
    expect(call.caption).toBe(["👤 <b>Face detected</b>", "", "📹 Camera: First Floor Passage", "🕐 Time: 10 Oct 2026, 02:35 PM", "🎯 Confidence: 66%"].join("\n"));
    // The clip used the event's camera and timestamp.
    expect(generateClip.mock.calls[0]![0]).toMatchObject({
      eventId: EVENT_ID,
      cameraId: 3,
      eventTimestamp: "2026-10-10T14:35:20+05:30",
    });
  });

  it("TELEGRAM-MEDIA-013 a rejected upload is reported as failed, with the safe reason", async () => {
    const dataDir = await dataDirWithSnapshot();
    await prepareClip(dataDir);
    const log = vi.fn();

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto: vi.fn(async () => ok()),
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => failed("http_error")),
      generateClip: vi.fn(async () => clipOk(dataDir)),
      unlinkImpl: vi.fn(async () => undefined),
      log,
    });

    expect(outcome.video).toBe("failed");
    expect(outcome.videoReason).toBe("http_error");
    // A failed upload falls back to the image, so one media notification still
    // reaches the chat.
    expect(outcome.image).toBe("sent");
    // The full diagnostic block is printed, with no secret in it.
    const printed = log.mock.calls.join("\n");
    expect(printed).toContain("[telegram-video]");
    expect(printed).toContain(`event: ${EVENT_ID}`);
    expect(printed).toContain("telegramOk: false");
    expect(printed).toContain("telegramError: HTTP 400");
    expect(printed).not.toContain(FAKE_TOKEN);
    expect(printed).not.toContain(FAKE_CHAT);
  });

  it("TELEGRAM-MEDIA-014 a missing recording skips the video and keeps the snapshot", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async () => ok());
    const sendVideo = vi.fn(async () => ok());
    const log = vi.fn();

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo,
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log,
    });

    expect(outcome.video).toBe("skipped");
    expect(outcome.videoReason).toBe("no_recording");
    expect(sendVideo).not.toHaveBeenCalled();
    expect(outcome.image).toBe("sent");
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.join("\n")).toContain("[telegram-video]");
  });

  it("TELEGRAM-MEDIA-030 text and snapshot still succeed when the video fails", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => failed("timeout")),
      generateClip: vi.fn(async () => {
        await prepareClip(dataDir);
        return clipOk(dataDir);
      }),
      unlinkImpl: vi.fn(async () => undefined),
      log: () => undefined,
    });

    // The image already went out; only the video leg failed.
    expect(outcome.image).toBe("sent");
    expect(outcome.video).toBe("failed");
    expect(sendPhoto).toHaveBeenCalledTimes(1);
  });

  it("TELEGRAM-MEDIA-015 an ffmpeg failure does not break the notification", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("ffmpeg_failed")),
      log: () => undefined,
    });

    expect(outcome.image).toBe("sent");
    expect(outcome.video).toBe("skipped");
    expect(outcome.videoReason).toBe("ffmpeg_failed");
  });
});

describe("TELEGRAM-MEDIA-017 / 018 / 021 / 022 — lifecycle", () => {
  it("TELEGRAM-MEDIA-017 deletes the temporary clip after a successful upload", async () => {
    const dataDir = await dataDirWithSnapshot();
    const clip = await prepareClip(dataDir);
    const unlinkImpl = vi.fn(async () => undefined);

    await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto: vi.fn(async () => ok()),
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipOk(dataDir)),
      unlinkImpl,
      log: () => undefined,
    });

    expect(unlinkImpl).toHaveBeenCalledWith(clip);
  });

  it("TELEGRAM-MEDIA-018 deletes the temporary clip after a failed upload", async () => {
    const dataDir = await dataDirWithSnapshot();
    const clip = await prepareClip(dataDir);
    const unlinkImpl = vi.fn(async () => undefined);

    await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto: vi.fn(async () => ok()),
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => failed()),
      generateClip: vi.fn(async () => clipOk(dataDir)),
      unlinkImpl,
      log: () => undefined,
    });

    expect(unlinkImpl).toHaveBeenCalledWith(clip);
  });

  it("TELEGRAM-MEDIA-021 one accepted event produces exactly one media notification", async () => {
    const dataDir = await dataDirWithSnapshot();
    await prepareClip(dataDir);
    const sendPhoto = vi.fn(async () => ok());
    const sendVideo = vi.fn(async () => ok());
    const generateClip = vi.fn(async () => clipOk(dataDir));

    const outcome = await processFaceMediaJob({ ...JOB, faces: 3 }, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo,
      generateClip,
      unlinkImpl: vi.fn(async () => undefined),
      log: () => undefined,
    });

    expect(generateClip).toHaveBeenCalledTimes(1);
    expect(sendVideo).toHaveBeenCalledTimes(1);
    // Video preferred: the image is not sent as a second notification.
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(outcome.image).toBe("skipped");
  });

  it("TELEGRAM-MEDIA-022 sends no media at all while Telegram is disabled", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async () => ok());
    const sendVideo = vi.fn(async () => ok());
    const generateClip = vi.fn(async () => clipOk(dataDir));

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir, { TELEGRAM_NOTIFICATIONS_ENABLED: "false" }),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo,
      generateClip,
      log: () => undefined,
    });

    expect(outcome).toMatchObject({ image: "skipped", video: "skipped", videoReason: "disabled" });
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendVideo).not.toHaveBeenCalled();
    expect(generateClip).not.toHaveBeenCalled();
  });

  it("refuses to queue when Telegram is off, and queues when it is on", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "media-queue-"));
    tempDirs.push(dataDir);
    expect(enqueueFaceMedia(JOB, config(dataDir, { TELEGRAM_NOTIFICATIONS_ENABLED: "false" }))).toBe("disabled");
    expect(enqueueFaceMedia(JOB, config(dataDir, { TELEGRAM_FACE_NOTIFICATIONS: "false" }))).toBe("disabled");
    expect(telegramMediaQueueDepth(dataDir)).toBe(0);
    expect(enqueueFaceMedia(JOB, config(dataDir))).toBe("queued");
    expect(telegramMediaQueueDepth(dataDir)).toBe(1);
    // Idempotent per event: a duplicate decision cannot queue a second clip.
    expect(enqueueFaceMedia(JOB, config(dataDir))).toBe("queued");
    expect(telegramMediaQueueDepth(dataDir)).toBe(1);
  });
});

describe("TELEGRAM-MEDIA-024 — no secrets in the logs", () => {
  it("keeps the token, the chat id and the DVR source out of every line", async () => {
    const dataDir = await dataDirWithSnapshot();
    await prepareClip(dataDir);
    const lines: string[] = [];

    await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto: vi.fn(async () => ok()),
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => failed()),
      generateClip: vi.fn(async () => clipOk(dataDir)),
      unlinkImpl: vi.fn(async () => undefined),
      log: (line) => lines.push(line),
    });

    const joined = lines.join("\n");
    expect(joined).not.toContain(FAKE_TOKEN);
    expect(joined).not.toContain(FAKE_CHAT);
    expect(joined).not.toContain("api.telegram.org");
    expect(joined).not.toContain("dvr-secret");
    expect(joined).not.toContain("rtsp://");
    expect(joined).not.toContain(dataDir);
    // It does log the stages and the event.
    expect(joined).toContain("image-upload started");
    expect(joined).toContain("telegram-upload started");
    expect(joined).toContain(EVENT_ID);
  });

  it("renders the diagnostic block with no secret, even for a bare failure", () => {
    const lines: string[] = [];
    logVideoDiagnostics(diagnostics({ errorStage: "ffmpeg-check", ffmpegAvailable: false }), null, null, (line) =>
      lines.push(line),
    );
    const joined = lines.join("\n");
    expect(joined).toContain("ffmpegAvailable: false");
    expect(joined).toContain("errorStage: ffmpeg-check");
    expect(joined).not.toContain(FAKE_TOKEN);
    expect(joined).not.toContain("dvr-secret");
  });
});

/* ---------------------------------------------------------------------------
 * TELEGRAM-MEDIA-031 — the media queue is durable.
 *
 * The queue used to be an in-memory array, so a hub restart dropped a pending
 * clip. It now lives in the additive `telegram_media_jobs` table: a claimed job
 * is requeued at startup, and the UNIQUE event_id keeps it idempotent.
 * ------------------------------------------------------------------------- */

describe("TELEGRAM-MEDIA-031 — the queue survives a restart", () => {
  it("keeps the job in SQLite and hands it back after a restart", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "media-durable-"));
    tempDirs.push(dataDir);

    expect(enqueueFaceMedia(JOB, config(dataDir))).toBe("queued");
    expect(telegramMediaQueueDepth(dataDir)).toBe(1);

    const store = openEventStore(dataDir);
    // The worker claims it; the row stays in the table while it runs.
    const claimed = store.claimNextTelegramMediaJob(new Date().toISOString());
    expect(claimed).toMatchObject({
      eventId: EVENT_ID,
      cameraId: 3,
      cameraName: "First Floor Passage",
      snapshotPath: SNAPSHOT,
      faces: 3,
    });
    expect(telegramMediaQueueDepth(dataDir)).toBe(0);

    // A crash/restart requeues whatever was in flight.
    expect(store.resetStaleTelegramMediaJobs(new Date().toISOString())).toBe(1);
    expect(telegramMediaQueueDepth(dataDir)).toBe(1);
    expect(store.claimNextTelegramMediaJob(new Date().toISOString())?.eventId).toBe(EVENT_ID);
  });

  it("TELEGRAM-MEDIA-034 holds a retried job until its next attempt time", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "media-retry-"));
    tempDirs.push(dataDir);
    const store = openEventStore(dataDir);

    enqueueEventMedia({ ...JOB, channel: "event" }, config(dataDir, { TELEGRAM_FACE_NOTIFICATIONS: "false", TELEGRAM_EVENT_NOTIFICATIONS: "true" }));
    const first = store.claimNextTelegramMediaJob("2026-10-22T10:00:00.000Z")!;
    expect(first).toMatchObject({ attempts: 1, channel: "event" });
    store.retryTelegramMediaJob(first.id, "2026-10-22T10:03:00.000Z", "ffmpeg_failed", "2026-10-22T10:00:30.000Z");

    // Before the scheduled time the worker sees nothing to do.
    expect(store.claimNextTelegramMediaJob("2026-10-22T10:02:59.000Z")).toBeNull();
    // After it, the same job is claimed again and the attempt count grows.
    const second = store.claimNextTelegramMediaJob("2026-10-22T10:03:01.000Z")!;
    expect(second).toMatchObject({ eventId: EVENT_ID, attempts: 2, channel: "event" });
  });

  it("counts a finished job as done and prunes only finished jobs", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "media-prune-"));
    tempDirs.push(dataDir);
    const store = openEventStore(dataDir);

    enqueueFaceMedia(JOB, config(dataDir));
    const claimed = store.claimNextTelegramMediaJob(new Date().toISOString())!;
    store.finishTelegramMediaJob(claimed.id, "done", null, new Date(0).toISOString());

    // A second, still-pending event.
    enqueueFaceMedia({ ...JOB, eventId: "evt_bbbbbbbbbbbbbbbbbbbbbbbb" }, config(dataDir));

    expect(store.telegramMediaJobsByStatus()).toMatchObject({ done: 1, pending: 1 });
    expect(store.pruneTelegramMediaJobs(new Date().toISOString())).toBe(1);
    expect(store.telegramMediaJobsByStatus()).toEqual({ pending: 1 });
  });

  it("keeps the queue bounded by dropping the oldest pending job", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "media-limit-"));
    tempDirs.push(dataDir);
    const store = openEventStore(dataDir);
    const now = new Date().toISOString();

    for (let index = 0; index < 3; index += 1) {
      store.enqueueTelegramMediaJob({
        eventId: `evt_${String(index).padStart(24, "0")}`,
        cameraId: 1,
        cameraName: "Parking",
        faces: 1,
        maxConfidence: 0.8,
        eventTimestamp: JOB.eventTimestamp,
        snapshotPath: null,
        now,
        limit: 2,
      });
    }
    // Two kept, the oldest dropped.
    expect(store.telegramMediaQueueDepth()).toBe(2);
    expect(store.claimNextTelegramMediaJob(now)?.eventId).toBe(`evt_${String(1).padStart(24, "0")}`);
  });
});

/* ---------------------------------------------------------------------------
 * TELEGRAM-MEDIA-032 / 033 — rule events use the same durable media queue.
 *
 * The face channel is deliberately off in these tests: a rule-event job must
 * still attach the snapshot and the clip, and vice versa.
 * ------------------------------------------------------------------------- */

describe("TELEGRAM-MEDIA-032 / 033 — rule events queue the snapshot and the clip", () => {
  const EVENT_CONFIG = { TELEGRAM_FACE_NOTIFICATIONS: "false", TELEGRAM_EVENT_NOTIFICATIONS: "true" };

  it("TELEGRAM-MEDIA-032 queues with only the event channel on, and the worker remembers the channel", () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), "media-event-"));
    tempDirs.push(dataDir);
    const cfg = config(dataDir, EVENT_CONFIG);
    const job: FaceMediaJob = { ...JOB, channel: "event" };

    expect(enqueueFaceMedia(job, cfg)).toBe("disabled");
    expect(telegramMediaQueueDepth(dataDir)).toBe(0);

    expect(enqueueEventMedia(job, cfg)).toBe("queued");
    expect(telegramMediaQueueDepth(dataDir)).toBe(1);

    const claimed = openEventStore(dataDir).claimNextTelegramMediaJob(new Date().toISOString());
    expect(claimed).toMatchObject({ eventId: EVENT_ID, channel: "event" });
  });

  it("TELEGRAM-MEDIA-033 sends the clip only for an event job", async () => {
    const dataDir = await dataDirWithSnapshot();
    await prepareClip(dataDir);
    const sendPhoto = vi.fn(async () => ok());
    const sendVideo = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob(
      { ...JOB, channel: "event" },
      {
        config: config(dataDir, EVENT_CONFIG),
        dataDir,
        sendPhoto,
        sendMediaGroup: vi.fn(async () => ok()),
        sendVideo,
        generateClip: vi.fn(async () => clipOk(dataDir)),
        unlinkImpl: vi.fn(async () => undefined),
        log: () => undefined,
      },
    );

    expect(outcome).toMatchObject({ image: "skipped", video: "sent" });
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendVideo).toHaveBeenCalledTimes(1);
  });

  it("TELEGRAM-MEDIA-034 a retry only uploads the clip, never the snapshot twice", async () => {
    const dataDir = await dataDirWithSnapshot();
    await prepareClip(dataDir);
    const sendPhoto = vi.fn(async () => ok());
    const sendVideo = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob(
      { ...JOB, channel: "event", attempts: 2 },
      {
        config: config(dataDir, EVENT_CONFIG),
        dataDir,
        sendPhoto,
        sendMediaGroup: vi.fn(async () => ok()),
        sendVideo,
        generateClip: vi.fn(async () => clipOk(dataDir)),
        unlinkImpl: vi.fn(async () => undefined),
        log: () => undefined,
      },
    );

    expect(sendPhoto).not.toHaveBeenCalled();
    expect(sendVideo).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ image: "skipped", video: "sent" });
  });

  it("TELEGRAM-MEDIA-033 stops an event job when the event channel is switched off", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async () => ok());
    const generateClip = vi.fn(async () => clipOk(dataDir));

    const outcome = await processFaceMediaJob(
      { ...JOB, channel: "event" },
      {
        config: config(dataDir, { TELEGRAM_FACE_NOTIFICATIONS: "true", TELEGRAM_EVENT_NOTIFICATIONS: "false" }),
        dataDir,
        sendPhoto,
        sendMediaGroup: vi.fn(async () => ok()),
        sendVideo: vi.fn(async () => ok()),
        generateClip,
        log: () => undefined,
      },
    );

    expect(outcome).toMatchObject({ image: "skipped", video: "skipped", videoReason: "disabled" });
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(generateClip).not.toHaveBeenCalled();
  });
  it("TELEGRAM-MEDIA-036 prefers the stored face crop over the full snapshot", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile }) => {
      void input;
      return ok();
    });
    const log = vi.fn();

    const outcome = await processFaceMediaJob(
      { ...JOB, cropPath: `2026/10/${EVENT_ID}-face-1.jpg` },
      {
        config: config(dataDir),
        dataDir,
        sendPhoto,
        sendMediaGroup: vi.fn(async () => ok()),
        sendVideo: vi.fn(async () => ok()),
        generateClip: vi.fn(async () => clipFailed("no_recording")),
        log,
      },
    );

    expect(outcome.image).toBe("sent");
    const photo = sendPhoto.mock.calls[0]![0].photo;
    expect(Buffer.from(photo.bytes).equals(CROP_BYTES)).toBe(true);
    expect(photo.filename).toBe("person.jpg");
    expect(log.mock.calls.join("\n")).toContain("source=face-crop");
  });

  it("TELEGRAM-MEDIA-037 a retry never re-queues media when a clip was already sent", async () => {
    const dataDir = await dataDirWithSnapshot();
    await prepareClip(dataDir);
    const sendPhoto = vi.fn(async () => ok());
    const sendVideo = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob(
      { ...JOB, attempts: 2, channel: "event" },
      {
        config: config(dataDir, EVENT_CONFIG),
        dataDir,
        sendPhoto,
        sendMediaGroup: vi.fn(async () => ok()),
        sendVideo,
        generateClip: vi.fn(async () => clipOk(dataDir)),
        unlinkImpl: vi.fn(async () => undefined),
        log: () => undefined,
      },
    );

    expect(sendVideo).toHaveBeenCalledTimes(1);
    expect(sendPhoto).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ image: "skipped", video: "sent" });
  });

});

/* ---------------------------------------------------------------------------
 * TELEGRAM-MEDIA-038/039 — frame association.
 *
 * The media worker never looks up "the latest snapshot": it reads the path
 * stored on the job. These tests pin that so a delayed or concurrent job can
 * never attach another event's frame.
 * ------------------------------------------------------------------------- */

describe("TELEGRAM-MEDIA-038/039 — each job attaches its own event frame", () => {
  const OTHER_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.alloc(300, 9)]);

  it("TELEGRAM-MEDIA-038 keeps the event's frame even when a newer snapshot exists", async () => {
    const dataDir = await dataDirWithSnapshot();
    const otherEvent = "evt_fedcba9876543210fedcba98";
    const otherDir = path.join(dataDir, "events", "2026", "10", "10");
    await writeFile(path.join(otherDir, `3-${otherEvent}.jpg`), OTHER_BYTES);

    const sendPhoto = vi.fn(async (input: { photo: TelegramFile }) => {
      void input;
      return ok();
    });
    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });

    expect(outcome.image).toBe("sent");
    // Exactly the event's own bytes, never the newer file on disk.
    const photo = sendPhoto.mock.calls[0]![0].photo;
    expect(Buffer.from(photo.bytes).equals(SNAPSHOT_BYTES)).toBe(true);
    expect(Buffer.from(photo.bytes).equals(OTHER_BYTES)).toBe(false);
  });

  it("TELEGRAM-MEDIA-039 keeps concurrent jobs on different cameras apart", async () => {
    const dataDir = await dataDirWithSnapshot();
    const secondEvent = "evt_1234567890abcdef12345678";
    const secondBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe2]), Buffer.alloc(222, 3)]);
    await writeFile(path.join(dataDir, "events", "2026", "10", "10", `2-${secondEvent}.jpg`), secondBytes);

    const sent: Buffer[] = [];
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile }) => {
      sent.push(Buffer.from(input.photo.bytes));
      return ok();
    });
    const processOne = (job: FaceMediaJob) =>
      processFaceMediaJob(job, {
        config: config(dataDir),
        dataDir,
        sendPhoto,
        sendMediaGroup: vi.fn(async () => ok()),
        sendVideo: vi.fn(async () => ok()),
        generateClip: vi.fn(async () => clipFailed("no_recording")),
        log: () => undefined,
      });

    await processOne(JOB);
    await processOne({
      ...JOB,
      eventId: secondEvent,
      cameraId: 2,
      cameraName: "Right Side Outside Camera",
      snapshotPath: `2026/10/10/2-${secondEvent}.jpg`,
    });

    expect(sent).toHaveLength(2);
    expect(sent[0]!.equals(SNAPSHOT_BYTES)).toBe(true);
    expect(sent[1]!.equals(secondBytes)).toBe(true);
  });
});

/* ---------------------------------------------------------------------------
 * TELEGRAM-CAPTION — media-only notifications carry exactly safe metadata.
 *
 * The caption comes from the event (camera name, event time, detector
 * confidence) and travels in Telegram's `caption` field. No text message is sent.
 * ------------------------------------------------------------------------- */

describe("TELEGRAM-CAPTION — media captions", () => {
  const eventJob = (classification: "person" | "vehicle", confidence: number | null) => ({
    ...JOB,
    channel: "event" as const,
    classification,
    confidence,
    maxConfidence: 0,
  });

  it("TELEGRAM-CAPTION-001 a person image uses sendPhoto with the caption", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    const outcome = await processFaceMediaJob(eventJob("person", 0.87), {
      config: config(dataDir, EVENT_ONLY),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });
    expect(outcome.image).toBe("sent");
    expect(sendPhoto.mock.calls[0]![0].caption).toBe(
      [
        "🚨 <b>Person detected</b>",
        "",
        "📹 Camera: First Floor Passage",
        "🕐 Time: 10 Oct 2026, 02:35 PM",
        "🎯 Confidence: 87%",
      ].join("\n"),
    );
  });

  it("TELEGRAM-CAPTION-002 a person video uses sendVideo with the caption", async () => {
    const dataDir = await dataDirWithSnapshot();
    await prepareClip(dataDir);
    const sendVideo = vi.fn(async (input: { video: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    const outcome = await processFaceMediaJob(eventJob("person", 0.73), {
      config: config(dataDir, EVENT_ONLY),
      dataDir,
      sendPhoto: vi.fn(async () => ok()),
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo,
      generateClip: vi.fn(async () => clipOk(dataDir)),
      unlinkImpl: vi.fn(async () => undefined),
      log: () => undefined,
    });
    expect(outcome.video).toBe("sent");
    expect(sendVideo.mock.calls[0]![0].caption).toBe(
      [
        "🚨 <b>Person detected</b>",
        "",
        "📹 Camera: First Floor Passage",
        "🕐 Time: 10 Oct 2026, 02:35 PM",
        "🎯 Confidence: 73%",
      ].join("\n"),
    );
  });

  it("TELEGRAM-CAPTION-003 a vehicle notification uses the vehicle caption", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    await processFaceMediaJob(eventJob("vehicle", 0.7), {
      config: config(dataDir, EVENT_ONLY),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });
    expect(sendPhoto.mock.calls[0]![0].caption).toContain("🚗 <b>Vehicle detected</b>");
    expect(sendPhoto.mock.calls[0]![0].caption).toContain("🎯 Confidence: 70%");
  });

  it("TELEGRAM-CAPTION-004 a face notification uses the face caption and face confidence", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    await processFaceMediaJob({ ...JOB, maxConfidence: 0.82 }, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });
    expect(sendPhoto.mock.calls[0]![0].caption).toBe(
      [
        "👤 <b>Face detected</b>",
        "",
        "📹 Camera: First Floor Passage",
        "🕐 Time: 10 Oct 2026, 02:35 PM",
        "🎯 Confidence: 82%",
      ].join("\n"),
    );
  });

  it("TELEGRAM-CAPTION-005 uses the event timestamp, never the send time", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    await processFaceMediaJob({ ...eventJob("person", 0.9), eventTimestamp: "2021-03-04T09:05:00+05:30" }, {
      config: config(dataDir, EVENT_ONLY),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });
    const caption = sendPhoto.mock.calls[0]![0].caption ?? "";
    expect(caption).toContain("🕐 Time: 04 Mar 2021, 09:05 AM");
    expect(caption).not.toContain(String(new Date().getFullYear()) + " PM");
  });

  it("TELEGRAM-CAPTION-006 omits confidence when the source has none (no invented value)", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    await processFaceMediaJob(eventJob("person", null), {
      config: config(dataDir, EVENT_ONLY),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });
    const caption = sendPhoto.mock.calls[0]![0].caption ?? "";
    expect(caption).toContain("🚨 <b>Person detected</b>");
    expect(caption).not.toContain("Confidence");
  });

  it("TELEGRAM-CAPTION-007 the media worker never calls a text sender", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./telegram-media.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/sendTelegramMessage\s*\(/);
    expect(source).not.toMatch(/notifyTelegram/);
  });
});
