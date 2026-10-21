import "server-only";
import { spawn } from "node:child_process";
import { getConfig } from "@/lib/config";
import { THUMBNAIL_TILE, THUMBNAIL_TILES_PER_SPRITE, thumbnailIntervalMs } from "@/lib/playback-thumbnail";
import { playbackTrack } from "@/server/cameras/channels";
import { buildPlaybackRtsp } from "@/server/hikvision/hikvision-playback";

/**
 * Low-level frame work for timeline previews.
 *
 * This is the same server-side playback path the player and the Telegram clip
 * use — `buildPlaybackRtsp()` against the DVR's H.264 sub track, decoded by the
 * FFmpeg already in the image. Nothing here is reachable from the browser: the
 * only caller is the background generator.
 */

export type FrameResult = "ok" | "busy" | "empty" | "failed";

const FRAME_TIMEOUT_MS = 15_000;
const COMPOSE_TIMEOUT_MS = 20_000;

type Run = { code: number | null; stderr: string };

function run(bin: string, args: string[], timeoutMs: number): Promise<Run> {
  return new Promise<Run>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      resolve({ code: null, stderr: error instanceof Error ? error.message : "spawn failed" });
      return;
    }
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finish = (result: Run) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      /*
       * SIGTERM first: FFmpeg sends RTSP TEARDOWN on it. Killing it outright is
       * what leaves a playback session open on this DVR, and that session is the
       * whole budget.
       */
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500);
    }, timeoutMs);
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish({ code: null, stderr: error.message }));
    child.on("close", (code) =>
      finish({ code: timedOut ? 124 : code, stderr: stderr.replace(/(\w+:\/\/)[^/@\s]+@/g, "$1[redacted]@") }),
    );
  });
}

/** True while the player is holding the DVR's single playback stream. */
export async function isPlayerStreaming(): Promise<boolean> {
  const config = getConfig();
  try {
    const response = await fetch(`${config.mediamtxApiUrl}/v3/paths/get/playback`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { ready?: boolean; source?: { type?: string } | null };
    return body.ready === true && body.source?.type === "rtspSource";
  } catch {
    return false;
  }
}

/**
 * One 198x162 JPEG taken from the recording at `atMs`.
 *
 * The DVR seeks to the nearest keyframe, so the frame can be a few seconds
 * earlier than asked; the metadata records the requested instant, which is what
 * the timeline shows.
 */
export async function extractFrame(atMs: number, camera: number, outPath: string): Promise<FrameResult> {
  const config = getConfig();
  if (!config.dvrConfigured) return "failed";

  let url: string;
  try {
    url = buildPlaybackRtsp({
      host: config.dvrHost,
      port: config.dvrRtspPort,
      username: config.dvrUsername,
      password: config.dvrPassword,
      track: playbackTrack(camera),
      start: new Date(atMs),
      end: new Date(atMs + thumbnailIntervalMs(config.thumbnailIntervalSeconds)),
    });
  } catch {
    return "failed";
  }

  const result = await run(
    config.ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-rtsp_transport",
      "tcp",
      "-probesize",
      "32k",
      "-analyzeduration",
      "0",
      "-i",
      url,
      "-frames:v",
      "1",
      "-an",
      "-vf",
      `scale=${THUMBNAIL_TILE.width}:${THUMBNAIL_TILE.height}:flags=lanczos`,
      "-q:v",
      "6",
      "-y",
      outPath,
    ],
    FRAME_TIMEOUT_MS,
  );

  if (result.code === 0) return "ok";
  if (result.code === 124) return "failed";
  /*
   * FFmpeg reports a refused DESCRIBE as "4XX ... but not one of 40{0,1,3,4}",
   * which on this DVR is 453 Not Enough Bandwidth: something else owns the
   * playback stream. A plain 400 means the instant holds no recording.
   */
  if (/not one of 40\{0,1,3,4\}/.test(result.stderr)) return "busy";
  if (/\b400\b|Bad Request/.test(result.stderr)) return "empty";
  return "failed";
}

/**
 * Tile the numbered frames in `tileDir` into one sprite sheet.
 *
 * Recomposed after every new frame so a partly built region is already usable:
 * the browser always fetches a whole sheet, so partial does not mean broken.
 */
export async function composeSprite(tileDir: string, outPath: string): Promise<boolean> {
  const config = getConfig();
  const result = await run(
    config.ffmpegPath,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-framerate",
      "1",
      "-start_number",
      "0",
      "-i",
      `${tileDir}/%04d.jpg`,
      "-vf",
      `tile=${THUMBNAIL_TILE.cols}x${THUMBNAIL_TILE.rows}:padding=0`,
      "-frames:v",
      "1",
      "-q:v",
      "6",
      // Explicit, because the staged file has an extra suffix while it is written.
      "-f",
      "image2",
      "-y",
      outPath,
    ],
    COMPOSE_TIMEOUT_MS,
  );
  return result.code === 0;
}

export const THUMBNAIL_SLOTS = THUMBNAIL_TILES_PER_SPRITE;
