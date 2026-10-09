import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { dayRangeIso, type NotificationStatus } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { isEventPriority, type EventPriority } from "@/lib/priority";
import { todayInKolkata } from "@/lib/time-kolkata";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES: NotificationStatus[] = ["sent", "suppressed", "failed"];

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;

  const date = params.get("date") || todayInKolkata();
  const range = dayRangeIso(date, params.get("startTime") || "00:00", params.get("endTime") || "23:59");
  if (!range) return NextResponse.json({ error: Messages.invalidDate }, { status: 400 });

  const camera = params.get("camera");
  let cameraId: number | null = null;
  if (camera && camera !== "all") {
    if (!/^[1-4]$/.test(camera)) return NextResponse.json({ error: Messages.invalidCamera }, { status: 400 });
    cameraId = Number(camera);
  }

  const statusParam = params.get("status");
  let status: NotificationStatus | null = null;
  if (statusParam && statusParam !== "all") {
    if (!STATUSES.includes(statusParam as NotificationStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    status = statusParam as NotificationStatus;
  }

  const priorityParam = params.get("priority");
  let priority: EventPriority | null = null;
  if (priorityParam && priorityParam !== "all") {
    if (!isEventPriority(priorityParam)) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    priority = priorityParam;
  }

  const page = Number(params.get("page") ?? "1");
  const pageSize = Number(params.get("pageSize") ?? "25");
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ error: "Invalid page size" }, { status: 400 });
  }

  const store = openEventStore(getConfig().dataDir);
  const result = store.notifications({ start: range.start, end: range.end, cameraId, status, priority, page, pageSize });
  const stats = store.notificationStats(range.start, range.end);
  return NextResponse.json({ ...result, page, pageSize, date, stats });
}