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
  it("uploads the full camera snapshot with sendPhoto, never the face crop", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async (input: { photo: TelegramFile; caption?: string }) => {
      void input;
      return ok();
    });
    const sendMediaGroup = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup,
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });

    expect(outcome.image).toBe("sent");
    expect(outcome.imageCount).toBe(1);
    // TELEGRAM-MEDIA-003: one photo, uploaded with sendPhoto.
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendMediaGroup).not.toHaveBeenCalled();

    const call = sendPhoto.mock.calls[0]![0];
    // TELEGRAM-MEDIA-002: the bytes are the full event snapshot…
    expect(Buffer.from(call.photo.bytes).equals(SNAPSHOT_BYTES)).toBe(true);
    // TELEGRAM-MEDIA-004: …and not the face crop that also exists on disk.
    expect(Buffer.from(call.photo.bytes).equals(CROP_BYTES)).toBe(false);
    expect(call.photo.bytes.length).toBe(SNAPSHOT_BYTES.length);
    expect(call.photo.filename).toBe("camera-snapshot.jpg");
    expect(call.photo.contentType).toBe("image/jpeg");
    // TELEGRAM-MEDIA-005: the event's camera, from the central mapping.
    expect(call.caption).toContain("First Floor Passage");
    // TELEGRAM-MEDIA-006: the event's timestamp, in India time.
    expect(call.caption).toContain("10 Oct 2026, 02:35 PM");
    expect(call.caption).toContain("Full camera snapshot");
  });

  it("sends nothing to Telegram when the job has no snapshot path", async () => {
    const dataDir = await dataDirWithSnapshot();
    const sendPhoto = vi.fn(async () => ok());

    const outcome = await processFaceMediaJob({ ...JOB, snapshotPath: null }, {
      config: config(dataDir),
      dataDir,
      sendPhoto,
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip: vi.fn(async () => clipFailed("no_recording")),
      log: () => undefined,
    });

    expect(outcome.image).toBe("skipped");
    expect(sendPhoto).not.toHaveBeenCalled();
  });

  it("TELEGRAM-MEDIA-016 a missing snapshot file does not stop the clip", async () => {
    const dataDir = await dataDirWithSnapshot(false);
    const generateClip = vi.fn(async () => clipFailed("no_recording"));
    const log = vi.fn();

    const outcome = await processFaceMediaJob(JOB, {
      config: config(dataDir),
      dataDir,
      sendPhoto: vi.fn(async () => ok()),
      sendMediaGroup: vi.fn(async () => ok()),
      sendVideo: vi.fn(async () => ok()),
      generateClip,
      log,
    });

    expect(outcome.image).toBe("skipped");
    expect(generateClip).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.join(" ")).toContain("reason=no_snapshot");
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
    expect(call.caption).toContain("CCTV video clip");
    expect(call.caption).toContain("First Floor Passage");
    expect(call.caption).not.toContain("rtsp");
    expect(call.caption).not.toContain(dataDir);
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

  it("TELEGRAM-MEDIA-021 three faces still produce one snapshot and one video", async () => {
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

    expect(outcome.imageCount).toBe(1);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(generateClip).toHaveBeenCalledTimes(1);
    expect(sendVideo).toHaveBeenCalledTimes(1);
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

  it("TELEGRAM-MEDIA-033 uploads the full snapshot and the clip for an event job", async () => {
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

    expect(outcome).toMatchObject({ image: "sent", video: "sent" });
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendVideo).toHaveBeenCalledTimes(1);
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
});
