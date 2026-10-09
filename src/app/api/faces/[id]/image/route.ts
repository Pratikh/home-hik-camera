import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { faceCropFile } from "@/lib/face-path";
import { isFaceId } from "@/lib/faces";
import { Messages } from "@/lib/messages";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The face crop, served only to an authenticated user.
 *
 * DATA_DIR/face-crops is never exposed as a static directory. The browser sends
 * a face id, the id is validated and looked up in the database, and only the
 * path stored on that row is resolved — and only if it stays inside the crop
 * directory. An arbitrary path can never be requested.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isFaceId(id)) return NextResponse.json({ error: Messages.faceNotFound }, { status: 404 });

  const config = getConfig();
  if (!config.faceDetectionEnabled) {
    return NextResponse.json({ error: Messages.faceImageUnavailable }, { status: 404 });
  }

  const store = openEventStore(config.dataDir);
  const face = store.faceById(id);
  if (!face || !face.hasCrop) {
    return NextResponse.json({ error: Messages.faceImageUnavailable }, { status: 404 });
  }
  const row = store.db
    .prepare("SELECT crop_path FROM event_faces WHERE id = ?")
    .get(id) as { crop_path: string | null } | undefined;
  const file = faceCropFile(config.dataDir, row?.crop_path ?? null);
  if (!file) return NextResponse.json({ error: Messages.faceImageUnavailable }, { status: 404 });

  try {
    const bytes = await readFile(file);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/jpeg",
        // Private CCTV imagery: never cached by a shared proxy.
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: Messages.faceImageUnavailable }, { status: 404 });
  }
}
