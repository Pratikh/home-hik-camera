import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import {
  faceTestWindowState,
  parseFaceListQuery,
  type FaceListResponse,
  type FaceProcessingSummary,
  type FaceTestNotificationStatus,
} from "@/lib/faces";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMPTY_PROCESSING: FaceProcessingSummary = { pending: 0, processing: 0, completed: 0, failed: 0 };

/**
 * Detected faces, newest event first.
 *
 * Any authenticated user may read this — a VIEWER can already see the events
 * the faces belong to. The face *crops* are served by a separate authenticated
 * route, never as static files.
 *
 * When FACE_DETECTION_ENABLED is not true this answers 200 with `enabled:false`
 * and an empty list rather than an error, so `/faces` still loads safely.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const config = getConfig();
  const url = new URL(request.url);
  const parsed = parseFaceListQuery({
    camera: url.searchParams.get("camera"),
    date: url.searchParams.get("date"),
    assigned: url.searchParams.get("assigned"),
    minConfidence: url.searchParams.get("minConfidence"),
    eventId: url.searchParams.get("eventId"),
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize"),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });

  // Read-only status of the temporary notification test mode. It is reported
  // whether or not detection is enabled, so the page never guesses.
  const testWindow = faceTestWindowState({
    enabled: config.faceDetectionTestNotifications,
    until: config.faceDetectionTestUntil,
  });
  const testNotifications: FaceTestNotificationStatus = {
    enabled: config.faceDetectionTestNotifications,
    active: testWindow.active,
    until: testWindow.until,
    cooldownSeconds: config.faceDetectionTestNotificationCooldownSeconds,
    reason: testWindow.reason,
  };

  if (!config.faceDetectionEnabled) {
    const body: FaceListResponse = {
      enabled: false,
      faces: [],
      total: 0,
      page: parsed.query.page,
      pageSize: parsed.query.pageSize,
      processing: EMPTY_PROCESSING,
      testNotifications,
    };
    return NextResponse.json(body);
  }

  const store = openEventStore(config.dataDir);
  const result = store.faces(parsed.query);
  const body: FaceListResponse = {
    enabled: true,
    faces: result.faces,
    total: result.total,
    page: parsed.query.page,
    pageSize: parsed.query.pageSize,
    processing: store.faceProcessingSummary(),
    testNotifications,
  };
  return NextResponse.json(body);
}
