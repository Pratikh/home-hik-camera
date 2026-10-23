import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { accountStore } from "@/server/auth/accounts";
import { openEventStore } from "@/server/events/event-store";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENT_ID = /^evt_[a-f0-9]{24}$/;

/**
 * Queue one on-demand detection test on an event snapshot.
 *
 * ADMIN only. The hub cannot run the model itself (that would put continuous
 * inference in the web process), so it writes a durable request row; the object
 * worker picks it up, runs the detector on that exact image and writes the
 * result back. The request contains no credential and no public URL.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const raw = (await request.json().catch(() => null)) as { eventId?: unknown } | null;
  const requested = typeof raw?.eventId === "string" && EVENT_ID.test(raw.eventId) ? raw.eventId : null;

  const config = getConfig();
  const store = openEventStore(config.dataDir);
  const event = requested
    ? store.get(requested)
    : store.db
        .prepare(
          "SELECT id FROM events WHERE snapshot_path IS NOT NULL ORDER BY timestamp DESC LIMIT 1",
        )
        .get() as { id: string } | undefined;
  const eventId = requested ?? event?.id ?? null;
  if (!eventId) {
    return NextResponse.json({ error: "No event with a snapshot exists yet." }, { status: 404 });
  }
  const row = store.db
    .prepare("SELECT camera_id, snapshot_path FROM events WHERE id = ?")
    .get(eventId) as { camera_id: number; snapshot_path: string | null } | undefined;
  if (!row?.snapshot_path) {
    return NextResponse.json({ error: "That event has no snapshot to analyse." }, { status: 404 });
  }

  const id = `odt_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const now = new Date().toISOString();
  store.db
    .prepare(
      `INSERT INTO object_detection_test_requests
         (id, event_id, camera_id, snapshot_path, status, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    )
    .run(id, eventId, row.camera_id, row.snapshot_path, now, now);

  accountStore(config.dataDir).writeAudit({
    userId: auth.userId,
    action: "OBJECT_DETECTION_TEST_REQUESTED",
    resource: eventId,
    metadata: { requestId: id, cameraId: row.camera_id },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ id, eventId, status: "pending" }, { status: 202 });
}
