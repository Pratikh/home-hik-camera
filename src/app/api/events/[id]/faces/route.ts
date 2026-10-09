import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import type { EventFacesResponse, FaceProcessingState } from "@/lib/faces";
import { Messages } from "@/lib/messages";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The face/event relationship: every detected face for one event, plus the
 * state of that event's detection job.
 *
 * `NONE` means the event has no snapshot at all, so detection never ran — the
 * difference between "not processed yet" and "there is nothing to process"
 * matters to the event detail panel.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!/^evt_[a-f0-9]{24}$/.test(id)) {
    return NextResponse.json({ error: Messages.eventNotFound }, { status: 404 });
  }

  const config = getConfig();
  const store = openEventStore(config.dataDir);
  const event = store.get(id);
  if (!event) return NextResponse.json({ error: Messages.eventNotFound }, { status: 404 });

  if (!config.faceDetectionEnabled) {
    const disabled: EventFacesResponse = { enabled: false, eventId: id, status: "NONE", faces: [] };
    return NextResponse.json(disabled);
  }

  const faces = store.facesForEvent(id);
  const processing = store.faceProcessing(id);
  const status: FaceProcessingState | "NONE" = processing
    ? (processing.status as FaceProcessingState)
    : event.hasSnapshot
      ? "PENDING"
      : "NONE";

  const body: EventFacesResponse = {
    enabled: true,
    eventId: id,
    status,
    faces: faces.map((face) => ({
      id: face.id,
      eventId: face.eventId,
      personId: face.personId,
      confidence: face.confidence,
      x: face.x,
      y: face.y,
      width: face.width,
      height: face.height,
      hasCrop: face.hasCrop,
    })),
  };
  return NextResponse.json(body);
}
