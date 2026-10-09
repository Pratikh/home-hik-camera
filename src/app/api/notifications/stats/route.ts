import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { isStatRange, statRangeIso } from "@/lib/events";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const rangeParam = new URL(request.url).searchParams.get("range") ?? "today";
  if (!isStatRange(rangeParam)) return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  const range = statRangeIso(rangeParam);
  if (!range) return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  const store = openEventStore(getConfig().dataDir);
  return NextResponse.json({
    range: rangeParam,
    start: range.start,
    end: range.end,
    days: range.days,
    ...store.notificationStats(range.start, range.end),
  });
}