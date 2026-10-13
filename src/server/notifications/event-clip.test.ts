import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Recording } from "@/lib/recording";
import {
  cleanupStaleClips,
  clipDir,
  clipFileName,
  clipTotalSeconds,
  clipWindowForEvent,
  ffmpegArgs,
  generateEventClip,
  intersectWindow,
  isMp4,
  pickRecording,
  redactRtspCredentials,
  searchSpans,
  type FfmpegRunner,
} from "@/server/notifications/event-clip";

/**
 * TELEGRAM-MEDIA-005 … 010, 012, 013, 022, 023 — clip generation.
 *
 * The DVR search, the FFmpeg process and (where useful) the filesystem are
 * mocked, so no test touches the DVR or sends anything.
 */

/** A minimal but structurally valid MP4: size field + ftyp box. */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);

const EVENT_AT = new Date("2026-10-10T13:30:00+05:30");

function recording(startTime: string, endTime: string, camera = 1): Recording {
  return { id: `rec-${startTime}`, camera, startTime, endTime, type: "continuous", label: "Continuous" };
}

function configFor(dataDir: string) {
  return {
    dvrConfigured: true,
    dvrHost: "192.168.0.210",
    dvrHttpPort: 80,
    dvrRtspPort: 554,
    dvrUsername: "admin",
    dvrPassword: "dvr-secret",
    dataDir,
    ffmpegPath: "ffmpeg",
    telegramFaceVideo: true,
    telegramVideoPreSeconds: 5,
    telegramVideoPostSeconds: 5,
    telegramVideoMaxMb: 45,
    telegramVideoTimeoutSeconds: 30,
  };
}

/** Writes a valid MP4 to the output path the args point at. */
function fakeRunner(bytes: Buffer = MP4): FfmpegRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const runner = (async ({ args }: { bin: string; args: string[]; timeoutMs: number }) => {
    // The availability probe is `-version`: answer without writing anything.
    if (!args.includes("-i")) return { ok: true, code: 0, stderr: "", missing: false, timedOut: false };
    calls.push(args);
    const out = args[args.length - 1]!;
    await writeFile(out, bytes);
    return { ok: true, code: 0, stderr: "", missing: false, timedOut: false };
  }) as FfmpegRunner & { calls: string[][] };
  runner.calls = calls;
  return runner;
}

const tmpDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "clip-test-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  const { rm } = await import("node:fs/promises");
  for (const dir of tmpDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("TELEGRAM-MEDIA-005 / 006 / 007 — the target window", () => {
  it("TELEGRAM-MEDIA-005 builds a 10 second window by default", () => {
    const window = clipWindowForEvent(EVENT_AT, 5, 5);
    expect(window.end.getTime() - window.start.getTime()).toBe(10_000);
    expect(clipTotalSeconds(5, 5)).toBe(10);
  });

  it("TELEGRAM-MEDIA-006 requests 5 seconds before and 5 seconds after", () => {
    const window = clipWindowForEvent(EVENT_AT, 5, 5);
    expect(window.start.toISOString()).toBe("2026-10-10T07:59:55.000Z"); // 13:29:55 IST
    expect(window.end.toISOString()).toBe("2026-10-10T08:00:05.000Z"); // 13:30:05 IST
  });

  it("honours custom pre/post values", () => {
    const window = clipWindowForEvent(EVENT_AT, 2, 8);
    expect(window.end.getTime() - window.start.getTime()).toBe(10_000);
    expect(EVENT_AT.getTime() - window.start.getTime()).toBe(2000);
  });

  it("TELEGRAM-MEDIA-007 selects a recording that starts after the event, using what it has", () => {
    // Nothing covers the event; the next recording starts 30s later.
    const later = recording("2026-10-10T13:30:30+05:30", "2026-10-10T13:45:00+05:30");
    const picked = pickRecording([later], clipWindowForEvent(EVENT_AT, 5, 5));
    expect(picked).not.toBeNull();
    expect(picked!.window.start.toISOString()).toBe("2026-10-10T08:00:30.000Z");
    expect(picked!.window.end.getTime() - picked!.window.start.getTime()).toBe(10_000);
  });

  it("TELEGRAM-MEDIA-007 uses the overlap when only part of the window is recorded", () => {
    // Recording starts 2 seconds before the event, so only 7 of the 10s exist.
    const partial = recording("2026-10-10T13:29:58+05:30", "2026-10-10T13:40:00+05:30");
    const picked = pickRecording([partial], clipWindowForEvent(EVENT_AT, 5, 5));
    expect(picked!.window.start.toISOString()).toBe("2026-10-10T07:59:58.000Z");
    expect(picked!.window.end.toISOString()).toBe("2026-10-10T08:00:05.000Z");
  });

  it("prefers a recording that covers the whole window", () => {
    const full = recording("2026-10-10T13:00:00+05:30", "2026-10-10T14:00:00+05:30");
    const other = recording("2026-10-10T13:29:00+05:30", "2026-10-10T13:29:30+05:30");
    const picked = pickRecording([other, full], clipWindowForEvent(EVENT_AT, 5, 5));
    expect(picked!.recording.id).toBe(full.id);
    expect(picked!.window.start.toISOString()).toBe("2026-10-10T07:59:55.000Z");
  });

  it("TELEGRAM-MEDIA-009 returns nothing when no recording overlaps", () => {
    const far = recording("2026-10-10T09:00:00+05:30", "2026-10-10T09:10:00+05:30");
    expect(pickRecording([far], clipWindowForEvent(EVENT_AT, 5, 5))).toBeNull();
    expect(pickRecording([], clipWindowForEvent(EVENT_AT, 5, 5))).toBeNull();
    expect(intersectWindow(clipWindowForEvent(EVENT_AT, 5, 5), far)).toBeNull();
  });
});

describe("TELEGRAM-MEDIA-008 — midnight boundary", () => {
  it("keeps the window correct across midnight", () => {
    const eventAt = new Date("2026-10-11T00:00:02+05:30"); // 10 Oct 23:59:57Z .. 11 Oct 00:00:07 IST
    const window = clipWindowForEvent(eventAt, 5, 5);
    expect(window.start.toISOString()).toBe("2026-10-10T18:29:57.000Z");
    expect(window.end.toISOString()).toBe("2026-10-10T18:30:07.000Z");
  });

  it("searches both days when the window crosses midnight", () => {
    const window = clipWindowForEvent(new Date("2026-10-11T00:00:02+05:30"), 5, 5);
    const spans = searchSpans(window);
    expect(spans).toEqual([
      { date: "2026-10-10", startTime: "23:58", endTime: "23:59" },
      { date: "2026-10-11", startTime: "00:00", endTime: "00:01" },
    ]);
  });

  it("uses a single span inside one day, padded by a minute", () => {
    expect(searchSpans(clipWindowForEvent(EVENT_AT, 5, 5))).toEqual([
      { date: "2026-10-10", startTime: "13:28", endTime: "13:31" },
    ]);
  });

  it("asks for exactly the two days an 23:59 event touches, and no more", () => {
    const late = new Date("2026-10-10T23:59:58+05:30");
    const spans = searchSpans(clipWindowForEvent(late, 5, 5));
    expect(spans).toEqual([
      { date: "2026-10-10", startTime: "23:58", endTime: "23:59" },
      { date: "2026-10-11", startTime: "00:00", endTime: "00:01" },
    ]);
    // The last span ends one minute after the window, never a whole extra day.
    expect(spans[spans.length - 1]!.endTime).toBe("00:01");
  });
});

describe("TELEGRAM-MEDIA-010 — H.265 to H.264 MP4", () => {
  it("asks FFmpeg for an H.264 MP4 of the right length", () => {
    const args = ffmpegArgs({
      url: "rtsp://admin:secret@192.168.0.210:554/Streaming/tracks/101/?starttime=20261010T132955Z&endtime=20261010T133005Z",
      outPath: "/tmp/clip.mp4",
      durationSeconds: 10,
    });

    expect(args).toContain("libx264");
    expect(args).toContain("yuv420p");
    // Optional audio: present when the source has it, harmless when it does not.
    expect(args[args.indexOf("-map") + 1]).toBe("0:v:0");
    expect(args[args.indexOf("-t") + 1]).toBe("10");
    expect(args[args.indexOf("-rtsp_transport") + 1]).toBe("tcp");
    expect(args).toContain("+faststart");
    expect(args[args.length - 1]).toBe("/tmp/clip.mp4");
    // The scale filter never upscales and keeps even dimensions.
    expect(args[args.indexOf("-vf") + 1]).toBe("scale='min(1280,iw)':-2");
    // The input is the DVR playback URL, never a MediaMTX or WebRTC URL.
    const input = args[args.indexOf("-i") + 1]!;
    expect(input).toContain("/Streaming/tracks/101/");
    expect(input).not.toContain("8889");
    expect(input).not.toContain("/api/");
  });

  it("recognises a real MP4 header and rejects anything else", () => {
    expect(isMp4(MP4)).toBe(true);
    expect(isMp4(Buffer.from("not an mp4 at all"))).toBe(false);
    expect(isMp4(Buffer.alloc(4))).toBe(false);
  });
});

describe("TELEGRAM-MEDIA-013 — FFmpeg failure is contained", () => {
  it("reports ffmpeg_missing without throwing", async () => {
    const dataDir = tempDir();
    const result = await generateEventClip({
      eventId: "evt_111111111111111111111111",
      cameraId: 1,
      eventTimestamp: "2026-10-10T13:30:00+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T13:00:00+05:30", "2026-10-10T14:00:00+05:30")],
        runner: async () => ({ ok: false, code: null, stderr: "spawn ffmpeg ENOENT", missing: true, timedOut: false }),
        log: () => undefined,
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "ffmpeg_missing", detail: null });
  });

  it("reports ffmpeg_failed with redacted stderr", async () => {
    const dataDir = tempDir();
    const result = await generateEventClip({
      eventId: "evt_222222222222222222222222",
      cameraId: 1,
      eventTimestamp: "2026-10-10T13:30:00+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T13:00:00+05:30", "2026-10-10T14:00:00+05:30")],
        runner: async ({ args }: { bin: string; args: string[]; timeoutMs: number }) => {
          if (!args.includes("-i")) return { ok: true, code: 0, stderr: "", missing: false, timedOut: false };
          return {
            ok: false,
            code: 1,
            stderr: "rtsp://admin:dvr-secret@192.168.0.210:554/...: Invalid data found",
            missing: false,
            timedOut: false,
          };
        },
        log: () => undefined,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ffmpeg_failed");
      expect(result.detail).not.toContain("dvr-secret");
    }
  });

  it("skips the clip when the DVR is not configured", async () => {
    const result = await generateEventClip({
      eventId: "evt_333333333333333333333333",
      cameraId: 1,
      eventTimestamp: "2026-10-10T13:30:00+05:30",
      config: { ...configFor(tempDir()), dvrConfigured: false },
      deps: { log: () => undefined },
    });
    expect(result).toMatchObject({ ok: false, reason: "not_configured", detail: null });
  });

  it("TELEGRAM-MEDIA-009 reports no_recording and creates no file", async () => {
    const dataDir = tempDir();
    const result = await generateEventClip({
      eventId: "evt_444444444444444444444444",
      cameraId: 1,
      eventTimestamp: "2026-10-10T13:30:00+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [],
        runner: fakeRunner(),
        log: () => undefined,
      },
    });
    expect(result).toMatchObject({ ok: false, reason: "no_recording", detail: null });
    await expect(stat(clipDir(dataDir))).rejects.toThrow();
  });
});

describe("TELEGRAM-MEDIA-022 — no DVR or RTSP detail leaks", () => {
  it("redacts credentials from FFmpeg output", () => {
    expect(redactRtspCredentials("rtsp://admin:dvr-secret@192.168.0.210:554/x")).toBe(
      "rtsp://[redacted]@192.168.0.210:554/x",
    );
    expect(redactRtspCredentials("no url here")).toBe("no url here");
  });

  it("never logs the playback URL, even on success", async () => {
    const dataDir = tempDir();
    const lines: string[] = [];
    const result = await generateEventClip({
      eventId: "evt_555555555555555555555555",
      cameraId: 1,
      eventTimestamp: "2026-10-10T13:30:00+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T13:00:00+05:30", "2026-10-10T14:00:00+05:30")],
        runner: fakeRunner(),
        log: (line) => lines.push(line),
      },
    });

    expect(result.ok).toBe(true);
    const joined = lines.join(" ");
    expect(joined).not.toContain("rtsp://");
    expect(joined).not.toContain("dvr-secret");
    expect(joined).not.toContain("192.168.0.210");
    expect(joined).not.toContain("admin");
  });
});

describe("TELEGRAM-MEDIA-012 / 023 — temporary clips", () => {
  it("TELEGRAM-MEDIA-012 writes the clip outside public/ and under DATA_DIR", () => {
    const dir = clipDir("/app/data");
    expect(dir).toBe(path.resolve("/app/data/telegram-clips"));
    expect(dir).not.toContain(`${path.sep}public`);
    expect(dir).not.toContain(".next");
  });

  it("names the file from a validated event id only", () => {
    const name = clipFileName("evt_666666666666666666666666", 1_700_000_000_000);
    expect(name).toBe("clip-evt_666666666666666666666666-1700000000000.mp4");
    // Anything that is not a real event id cannot reach the path.
    const hostile = clipFileName("../../etc/passwd", 1_700_000_000_000);
    expect(hostile).not.toContain("..");
    expect(hostile).not.toContain("/");
    expect(hostile.endsWith(".mp4")).toBe(true);
  });

  it("deletes stale clips and keeps fresh ones", async () => {
    const dataDir = tempDir();
    const dir = clipDir(dataDir);
    await mkdir(dir, { recursive: true });
    const stale = path.join(dir, "clip-evt_777777777777777777777777-1.mp4");
    const fresh = path.join(dir, "clip-evt_888888888888888888888888-2.mp4");
    const other = path.join(dir, "notes.txt");
    await writeFile(stale, MP4);
    await writeFile(fresh, MP4);
    await writeFile(other, "keep me");

    const now = Date.now();
    const { utimes } = await import("node:fs/promises");
    const old = (now - 60 * 60 * 1000) / 1000;
    await utimes(stale, old, old);

    const removed = await cleanupStaleClips(dataDir, 30 * 60 * 1000, now);

    expect(removed).toBe(1);
    await expect(stat(stale)).rejects.toThrow();
    expect((await stat(fresh)).isFile()).toBe(true);
    expect((await stat(other)).isFile()).toBe(true);
  });

  it("tolerates a missing clip directory", async () => {
    await expect(cleanupStaleClips(tempDir())).resolves.toBe(0);
  });
});

describe("a generated clip is a usable file", () => {
  it("returns the path, size, duration and the window actually used", async () => {
    const dataDir = tempDir();
    const runner = fakeRunner();
    const result = await generateEventClip({
      eventId: "evt_999999999999999999999999",
      cameraId: 2,
      eventTimestamp: "2026-10-10T13:30:00+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T13:25:00+05:30", "2026-10-10T13:35:00+05:30", 2)],
        runner,
        log: () => undefined,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.durationSeconds).toBe(10);
    expect(result.bytes).toBe(MP4.length);
    expect(result.path.startsWith(clipDir(dataDir))).toBe(true);
    expect(result.recordingStart).toBe("2026-10-10T13:25:00+05:30");
    expect(Buffer.from(await readFile(result.path))).toEqual(MP4);
    // The DVR playback URL carried the camera's main track.
    expect(runner.calls[0]!.join(" ")).toContain("/Streaming/tracks/201/");
  });
});

/* ---------------------------------------------------------------------------
 * TELEGRAM-MEDIA-009 / 010 / 025 / 027 / 028 / 029 — conversion details.
 * ------------------------------------------------------------------------- */

describe("TELEGRAM-MEDIA-009 / 010 — the conversion produces H.264 MP4", () => {
  it("requests video with optional AAC audio, then validates the container", async () => {
    const dataDir = tempDir();
    const runner = fakeRunner();
    const prober = vi.fn(async () => ({ codec: "h264", durationSeconds: 10, width: 704, height: 576 }));

    const result = await generateEventClip({
      eventId: "evt_b1b1b1b1b1b1b1b1b1b1b1b1",
      cameraId: 1,
      eventTimestamp: "2026-10-10T14:35:20+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T14:00:00+05:30", "2026-10-10T15:00:00+05:30")],
        runner,
        prober,
        log: () => undefined,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.durationSeconds).toBe(10);
    expect(result.diagnostics.outputCodec).toBe("h264");
    expect(result.diagnostics.ffmpegAttempts).toBe(1);
    expect(result.diagnostics.recordingFound).toBe(true);

    const args = runner.calls[0]!;
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264");
    expect(args[args.indexOf("-crf") + 1]).toBe("28");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuv420p");
    // Explicit stream mapping, with audio optional so a silent source still works.
    expect(args[args.indexOf("-map") + 1]).toBe("0:v:0");
    expect(args).toContain("-map");
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
    expect(args[args.join(" ").indexOf("0:a:0?") > -1 ? args.indexOf("-map", args.indexOf("-map") + 1) + 1 : -1]).toBe("0:a:0?");
    expect(args).toContain("+faststart");
  });

  it("falls back to video-only when the audio attempt fails", async () => {
    const dataDir = tempDir();
    const calls: string[][] = [];
    const runner = (async ({ args }: { bin: string; args: string[]; timeoutMs: number }) => {
      if (!args.includes("-i")) return { ok: true, code: 0, stderr: "", missing: false, timedOut: false };
      calls.push(args);
      if (args.includes("-c:a")) {
        return { ok: false, code: 1, stderr: "audio codec not supported", missing: false, timedOut: false };
      }
      await writeFile(args[args.length - 1]!, MP4);
      return { ok: true, code: 0, stderr: "", missing: false, timedOut: false };
    }) as FfmpegRunner;
    const logs: string[] = [];

    const result = await generateEventClip({
      eventId: "evt_b2b2b2b2b2b2b2b2b2b2b2b2",
      cameraId: 1,
      eventTimestamp: "2026-10-10T14:35:20+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T14:00:00+05:30", "2026-10-10T15:00:00+05:30")],
        runner,
        prober: async () => null,
        log: (line) => logs.push(line),
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("-c:a");
    expect(calls[1]).toContain("-an");
    expect(logs.join(" ")).toContain("attempt=2");
  });

  it("rejects an output whose probed codec is not H.264", async () => {
    const dataDir = tempDir();
    const result = await generateEventClip({
      eventId: "evt_b3b3b3b3b3b3b3b3b3b3b3b3",
      cameraId: 1,
      eventTimestamp: "2026-10-10T14:35:20+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T14:00:00+05:30", "2026-10-10T15:00:00+05:30")],
        runner: fakeRunner(),
        prober: async () => ({ codec: "hevc", durationSeconds: 10, width: 704, height: 576 }),
        log: () => undefined,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_output");
      expect(result.diagnostics.outputCodec).toBe("hevc");
    }
  });

  it("TELEGRAM-MEDIA-027 refuses an oversized clip and retries smaller first", async () => {
    const dataDir = tempDir();
    const big = Buffer.concat([MP4, Buffer.alloc(2 * 1024 * 1024)]);
    const calls: string[][] = [];
    // First attempt returns something too large; the smaller retry is fine.
    const runner = (async ({ args }: { bin: string; args: string[]; timeoutMs: number }) => {
      if (!args.includes("-i")) return { ok: true, code: 0, stderr: "", missing: false, timedOut: false };
      calls.push(args);
      const crf = args[args.indexOf("-crf") + 1];
      await writeFile(args[args.length - 1]!, crf === "32" ? MP4 : big);
      return { ok: true, code: 0, stderr: "", missing: false, timedOut: false };
    }) as FfmpegRunner;

    const result = await generateEventClip({
      eventId: "evt_b4b4b4b4b4b4b4b4b4b4b4b4",
      cameraId: 1,
      eventTimestamp: "2026-10-10T14:35:20+05:30",
      config: { ...configFor(dataDir), telegramVideoMaxMb: 1 },
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T14:00:00+05:30", "2026-10-10T15:00:00+05:30")],
        runner,
        prober: async () => null,
        log: () => undefined,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bytes).toBe(MP4.length);
    expect(calls.some((args) => args.includes("32"))).toBe(true);
  });

  it("TELEGRAM-MEDIA-027 gives up when even the smaller retry is too large", async () => {
    const dataDir = tempDir();
    const huge = Buffer.concat([MP4, Buffer.alloc(2 * 1024 * 1024)]);
    const result = await generateEventClip({
      eventId: "evt_b5b5b5b5b5b5b5b5b5b5b5b5",
      cameraId: 1,
      eventTimestamp: "2026-10-10T14:35:20+05:30",
      config: { ...configFor(dataDir), telegramVideoMaxMb: 1 },
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T14:00:00+05:30", "2026-10-10T15:00:00+05:30")],
        runner: fakeRunner(huge),
        prober: async () => null,
        log: () => undefined,
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("too_large");
  });
});

describe("TELEGRAM-MEDIA-028 / 029 — time and boundaries", () => {
  it("TELEGRAM-MEDIA-028 keeps the window in India time, with no double conversion", () => {
    // 14:35:20 IST is 09:05:20 UTC. The window must stay 14:35:15..14:35:25 IST.
    const eventAt = new Date("2026-10-10T14:35:20+05:30");
    const window = clipWindowForEvent(eventAt, 5, 5);
    expect(window.start.toISOString()).toBe("2026-10-10T09:05:15.000Z");
    expect(window.end.toISOString()).toBe("2026-10-10T09:05:25.000Z");
    // The DVR search spans use the local wall clock, not UTC.
    expect(searchSpans(window)).toEqual([{ date: "2026-10-10", startTime: "14:34", endTime: "14:36" }]);
  });

  it("TELEGRAM-MEDIA-029 clips to the recording boundary when the event is at the end of a segment", () => {
    // The recording ends 3 seconds after the event, so only 8 of the 10 seconds exist.
    const eventAt = new Date("2026-10-10T14:35:20+05:30");
    const rec = recording("2026-10-10T14:00:00+05:30", "2026-10-10T14:35:23+05:30");
    const picked = pickRecording([rec], clipWindowForEvent(eventAt, 5, 5));
    expect(picked).not.toBeNull();
    expect(picked!.window.start.toISOString()).toBe("2026-10-10T09:05:15.000Z");
    expect(picked!.window.end.toISOString()).toBe("2026-10-10T09:05:23.000Z");
    // 8 seconds of footage: use what exists rather than failing.
    expect(Math.round((picked!.window.end.getTime() - picked!.window.start.getTime()) / 1000)).toBe(8);
  });

  it("handles an event that crosses a recording boundary by using the overlapping segment", () => {
    const eventAt = new Date("2026-10-10T14:35:20+05:30");
    const before = recording("2026-10-10T14:00:00+05:30", "2026-10-10T14:35:18+05:30");
    const after = recording("2026-10-10T14:35:18+05:30", "2026-10-10T15:00:00+05:30");
    const picked = pickRecording([before, after], clipWindowForEvent(eventAt, 5, 5));
    // The later segment covers the event and runs forwards: no huge download.
    expect(picked!.recording.id).toBe(after.id);
    expect(picked!.window.start.toISOString()).toBe("2026-10-10T09:05:18.000Z");
    expect(picked!.window.end.toISOString()).toBe("2026-10-10T09:05:25.000Z");
  });
});

describe("TELEGRAM-MEDIA-025 — the DVR URL never reaches Telegram", () => {
  it("logs stages without the URL or the credentials", async () => {
    const dataDir = tempDir();
    const lines: string[] = [];
    await generateEventClip({
      eventId: "evt_b6b6b6b6b6b6b6b6b6b6b6b6",
      cameraId: 1,
      eventTimestamp: "2026-10-10T14:35:20+05:30",
      config: configFor(dataDir),
      deps: {
        transport: { postXml: async () => "" },
        search: async () => [recording("2026-10-10T14:00:00+05:30", "2026-10-10T15:00:00+05:30")],
        runner: fakeRunner(),
        prober: async () => null,
        log: (line) => lines.push(line),
      },
    });

    const joined = lines.join("\n");
    // The stages are all present…
    for (const stage of ["recording-search started", "recording-found", "source-acquisition started", "source-acquired", "ffmpeg started", "ffmpeg completed", "output=", "clip ready"]) {
      expect(joined).toContain(stage);
    }
    // …and none of them leak the source.
    expect(joined).not.toContain("rtsp://");
    expect(joined).not.toContain("dvr-secret");
    expect(joined).not.toContain("192.168.0.210");
    expect(joined).not.toContain("Streaming/tracks");
  });
});
