import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { Messages } from "@/lib/messages";
import { isCalendarDate } from "@/lib/time-kolkata";
import { isCameraId } from "@/server/cameras/channels";
import { requireUser } from "@/server/http/require-user";
import { spriteFile } from "@/server/playback/thumbnail-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One pre-generated sprite sheet.
 *
 * Private CCTV footage, so it needs the same session as `/playback` and is only
 * ever cached privately. A sheet is immutable once published — the index bumps a
 * version and the browser requests a new URL — so this can be cached hard.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const camera = Number(url.searchParams.get("camera"));
  const date = (url.searchParams.get("date") ?? "").trim();
  const start = Number(url.searchParams.get("start"));
  const version = (url.searchParams.get("v") ?? "").trim();

  if (!isCameraId(camera)) {
    return NextResponse.json({ error: Messages.invalidCamera }, { status: 400 });
  }
  if (!isCalendarDate(date)) {
    return NextResponse.json({ error: Messages.invalidDate }, { status: 400 });
  }
  if (!Number.isInteger(start) || start < 0) {
    return NextResponse.json({ error: Messages.invalidTime }, { status: 400 });
  }

  let file: string;
  try {
    // Rejects an unaligned bucket and anything that would escape the data dir.
    file = spriteFile(camera, date, start);
  } catch {
    return NextResponse.json({ error: Messages.invalidTime }, { status: 400 });
  }

  const etag = `"${camera}-${date}-${start}-${version || "0"}"`;
  const headers = new Headers({
    "cache-control": "private, max-age=31536000, immutable",
    etag,
  });
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });

  let jpeg: Buffer;
  try {
    jpeg = await readFile(file);
  } catch {
    // Not generated yet. The index is what tells the UI it is still coming.
    return NextResponse.json({ error: Messages.previewUnavailable }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  headers.set("content-type", "image/jpeg");
  headers.set("content-length", String(jpeg.length));
  return new NextResponse(new Uint8Array(jpeg), { status: 200, headers });
}
