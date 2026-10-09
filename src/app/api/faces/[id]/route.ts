import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { isFaceId } from "@/lib/faces";
import { Messages } from "@/lib/messages";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One detected face, including the event it came from.
 *
 * The response never contains a filesystem path: only the face id, which is
 * what `/api/faces/<id>/image` expects.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!isFaceId(id)) return NextResponse.json({ error: Messages.faceNotFound }, { status: 404 });

  const config = getConfig();
  if (!config.faceDetectionEnabled) {
    return NextResponse.json({ error: Messages.faceDetectionDisabled }, { status: 404 });
  }
  const face = openEventStore(config.dataDir).faceById(id);
  if (!face) return NextResponse.json({ error: Messages.faceNotFound }, { status: 404 });
  return NextResponse.json({ face });
}
