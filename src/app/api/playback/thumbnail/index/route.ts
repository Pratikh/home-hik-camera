import { NextResponse } from "next/server";
import { Messages } from "@/lib/messages";
import { isCalendarDate } from "@/lib/time-kolkata";
import { isCameraId } from "@/server/cameras/channels";
import { requireUser } from "@/server/http/require-user";
import { readIndex } from "@/server/playback/thumbnail-store";
import { requestThumbnails, thumbnailProgress } from "@/server/playback/thumbnail-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The generated-preview index for one camera and day.
 *
 * This is the only request the browser makes for previews, and it is a plain
 * JSON read from disk: it never opens a DVR session. Reporting the visible
 * window (`focus`) is how the background generator learns what to prioritise;
 * it is a hint, not a job the request waits for.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const camera = Number(url.searchParams.get("camera"));
  const date = (url.searchParams.get("date") ?? "").trim();
  const focusRaw = Number(url.searchParams.get("focus"));

  if (!isCameraId(camera)) {
    return NextResponse.json({ error: Messages.invalidCamera }, { status: 400 });
  }
  if (!isCalendarDate(date)) {
    return NextResponse.json({ error: Messages.invalidDate }, { status: 400 });
  }

  requestThumbnails({ camera, date, focusMs: Number.isFinite(focusRaw) ? focusRaw : undefined });

  const index = await readIndex(camera, date);
  return NextResponse.json(
    { ...index, progress: thumbnailProgress(camera, date, index) },
    { headers: { "cache-control": "private, no-store" } },
  );
}
