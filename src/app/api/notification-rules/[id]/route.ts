import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { isEventType, type EventClassification, type NotificationRule } from "@/lib/events";
import { parseClock } from "@/lib/time-kolkata";
import { openEventStore } from "@/server/events/event-store";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseBody(value: unknown, id: string): NotificationRule | { retentionDays: string } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.retentionDays === "string" && /^(0|7|14|30|60|90)$/.test(body.retentionDays)) {
    return { retentionDays: body.retentionDays };
  }
  const eventType = body.eventType == null || body.eventType === ""
    ? null
    : typeof body.eventType === "string" && isEventType(body.eventType)
      ? body.eventType
      : undefined;
  if (eventType === undefined) return null;
  const classification: EventClassification | "" | null | undefined =
    body.classification == null
      ? null
      : body.classification === "" || body.classification === "person" || body.classification === "vehicle"
        ? body.classification
        : undefined;
  if (classification === undefined) return null;
  const cameraId = body.cameraId == null
    ? null
    : body.cameraId === 1 || body.cameraId === 2 || body.cameraId === 3 || body.cameraId === 4
      ? body.cameraId
      : undefined;
  if (cameraId === undefined || typeof body.enabled !== "boolean") return null;
  const quietHoursStart = typeof body.quietHoursStart === "string" ? parseClock(body.quietHoursStart) : null;
  const quietHoursEnd = typeof body.quietHoursEnd === "string" ? parseClock(body.quietHoursEnd) : null;
  return { id, enabled: body.enabled, cameraId, eventType, classification, quietHoursStart, quietHoursEnd };
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!/^rule-[A-Za-z0-9-]+$/.test(id)) return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });
  const parsed = parseBody(await request.json().catch(() => null), id);
  if (!parsed) return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });
  const store = openEventStore(getConfig().dataDir);
  if ("retentionDays" in parsed) {
    store.setSetting("retention_days", parsed.retentionDays);
    return NextResponse.json({ retentionDays: parsed.retentionDays });
  }
  store.saveRule(parsed);
  return NextResponse.json({ rule: parsed });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!/^rule-[A-Za-z0-9-]+$/.test(id)) return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });
  const removed = openEventStore(getConfig().dataDir).deleteRule(id);
  if (!removed) return NextResponse.json({ error: "Notification rule not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
