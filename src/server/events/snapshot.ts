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
}): Promise<string | null> {
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