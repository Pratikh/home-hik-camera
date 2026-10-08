import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { isEventType, type EventClassification, type NotificationRule } from "@/lib/events";
import { parseClock } from "@/lib/time-kolkata";
import { newRuleId, openEventStore } from "@/server/events/event-store";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseRule(value: unknown, id: string): NotificationRule | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const eventType = body.eventType === null || body.eventType === undefined || body.eventType === ""
    ? null
    : typeof body.eventType === "string" && isEventType(body.eventType)
      ? body.eventType
      : undefined;
  if (eventType === undefined) return null;
  const classification: EventClassification | "" | null | undefined =
    body.classification === null || body.classification === undefined
      ? null
      : body.classification === "" || body.classification === "person" || body.classification === "vehicle"
        ? body.classification
        : undefined;
  if (classification === undefined) return null;
  const cameraId = body.cameraId === null || body.cameraId === undefined
    ? null
    : body.cameraId === 1 || body.cameraId === 2 || body.cameraId === 3 || body.cameraId === 4
      ? body.cameraId
      : undefined;
  if (cameraId === undefined) return null;
  const quietHoursStart = typeof body.quietHoursStart === "string" ? parseClock(body.quietHoursStart) : null;
  const quietHoursEnd = typeof body.quietHoursEnd === "string" ? parseClock(body.quietHoursEnd) : null;
  if (body.quietHoursStart && !quietHoursStart) return null;
  if (body.quietHoursEnd && !quietHoursEnd) return null;
  return {
    id,
    enabled: body.enabled === true,
    cameraId,
    eventType,
    classification,
    quietHoursStart,
    quietHoursEnd,
  };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const store = openEventStore(getConfig().dataDir);
  return NextResponse.json({
    rules: store.rules(),
    retentionDays: store.setting("retention_days") ?? String(getConfig().eventRetentionDays),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const rule = parseRule(await request.json().catch(() => null), newRuleId());
  if (!rule) return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });
  openEventStore(getConfig().dataDir).saveRule(rule);
  return NextResponse.json({ rule }, { status: 201 });
}
