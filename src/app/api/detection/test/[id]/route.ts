import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { openEventStore } from "@/server/events/event-store";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REQUEST_ID = /^odt_[a-f0-9]{16}$/;

/** Poll one detection test. ADMIN only; returns the worker's safe result JSON. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!REQUEST_ID.test(id)) return NextResponse.json({ error: "Unknown test request." }, { status: 404 });

  const config = getConfig();
  const row = openEventStore(config.dataDir).db
    .prepare(
      "SELECT id, event_id, camera_id, status, result, created_at, updated_at FROM object_detection_test_requests WHERE id = ?",
    )
    .get(id) as
    | { id: string; event_id: string; camera_id: number; status: string; result: string | null; created_at: string; updated_at: string }
    | undefined;
  if (!row) return NextResponse.json({ error: "Unknown test request." }, { status: 404 });

  let result: unknown = null;
  if (row.result) {
    try {
      result = JSON.parse(row.result) as unknown;
    } catch {
      result = null;
    }
  }
  return NextResponse.json({
    id: row.id,
    eventId: row.event_id,
    cameraId: row.camera_id,
    status: row.status,
    result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}
