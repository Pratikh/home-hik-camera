import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/lib/config";
import { kolkataParts } from "@/lib/time-kolkata";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_BYTES = 4 * 1024 * 1024;

/** Sub-stream channel for a camera, used for the still-picture endpoint. */
function subChannel(cameraId: number): number {
  return cameraId * 100 + 2;
}

export function snapshotRelativePath(cameraId: number, eventId: string, at: Date): string {
  const parts = kolkataParts(at);
  return path.posix.join(parts.year, parts.month, parts.day, `${cameraId}-${eventId}.jpg`);
}

/**
 * Fetch a still picture from the DVR for one event and store it under
 * DATA_DIR/events/<yyyy>/<mm>/<dd>/. Returns the stored relative path, or null
 * when the DVR does not serve a picture for this channel.
 *
 * This DVR's alarm log carries no snapshot, so the still is requested from the
 * streaming picture endpoint at the moment the event is ingested. Nothing is
 * fabricated: on any failure the event simply has no snapshot.
 */
export async function captureEventSnapshot(input: {
  cameraId: number;
  eventId: string;
  at: Date;
  client: HikvisionClient;
  /**
   * False for events discovered by the startup backfill. The ISAPI picture
   * endpoint only ever returns the *current* live frame, so capturing one for an
   * event that happened hours ago would attach an unrelated image. Historical
   * events keep no snapshot; their clip (cut from the recording at the event
   * timestamp) is still accurate.
   */
  liveAllowed?: boolean;
}): Promise<string | null> {
  if (input.liveAllowed === false) return null;
  const config = getConfig();
  const relative = snapshotRelativePath(input.cameraId, input.eventId, input.at);
  const root = path.resolve(config.dataDir, "events");
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`)) return null;

  let bytes: Buffer;
  try {
    bytes = await fetchPicture(input.client, subChannel(input.cameraId));
  } catch (error) {
    // A DVR that refuses or lacks the endpoint is expected here; keep it quiet
    // but never invent an image.
    if (error instanceof HikvisionError) return null;
    console.error("[events] snapshot", error instanceof Error ? error.name : "error");
    return null;
  }
  if (!bytes.length || bytes.length > MAX_BYTES) return null;
  if (!bytes.subarray(0, 3).equals(JPEG_MAGIC)) return null;

  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { mode: 0o600 });
  } catch (error) {
    console.error("[events] snapshot write", error instanceof Error ? error.name : "error");
    return null;
  }
  return relative;
}

/**
 * The newest an event may be for its live still to still represent it.
 *
 * The DVR's picture endpoint returns the current frame, never the alarm frame.
 * The hub has a poll interval and the DVR clock can run a little behind the
 * host, so a genuinely live event arrives a few seconds "old" (measured: ~5 s
 * poll + ~18 s DVR clock offset). Anything older than a minute is a different
 * moment: the person may have walked away, or the frame belongs to another
 * event entirely.
 */
export const LIVE_SNAPSHOT_MAX_AGE_MS = 60_000;

/**
 * Decide whether an ingested event may receive a still.
 *
 * Two cases are refused:
 * - the startup backfill, which re-reads the whole day and would otherwise give
 *   hours-old events a "now" picture;
 * - any event already older than LIVE_SNAPSHOT_MAX_AGE_MS at ingestion (for
 *   example an event found after the hub was down for several minutes).
 *
 * The rule lives here so it is testable without a running DVR.
 */
export async function captureEventSnapshotForPoll(
  input: Parameters<typeof captureEventSnapshot>[0] & {
    backfill: boolean;
    /** The event's own timestamp; defaults to `at`. */
    eventTimestamp?: string;
    /** Injected in tests. */
    now?: Date;
  },
): Promise<string | null> {
  if (input.backfill) return null;
  const eventAt = new Date(input.eventTimestamp ?? input.at);
  if (Number.isNaN(eventAt.getTime())) return null;
  const age = (input.now ?? new Date()).getTime() - eventAt.getTime();
  if (age > LIVE_SNAPSHOT_MAX_AGE_MS) return null;
  return captureEventSnapshot(input);
}

async function fetchPicture(client: HikvisionClient, channel: number): Promise<Buffer> {
  const candidates = [
    `/ISAPI/Streaming/channels/${channel}/picture`,
    `/ISAPI/Streaming/channels/${channel}/picture?videoResolutionWidth=1280&videoResolutionHeight=720`,
  ];
  let lastError: unknown = null;
  for (const endpoint of candidates) {
    try {
      return await client.getBinary(endpoint);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new HikvisionError("http_error", "Snapshot unavailable");
}