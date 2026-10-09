import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { dayRangeIso, isStatRange, statRangeIso } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { todayInKolkata } from "@/lib/time-kolkata";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Aggregate counts over a Kolkata calendar window. A single grouped query plus
 * one grouped camera query, both served from the timestamp indexes, rather than
 * scanning the table per metric.
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  const rangeParam = params.get("range");
  const store = openEventStore(getConfig().dataDir);

  if (rangeParam) {
    if (!isStatRange(rangeParam)) return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    const range = statRangeIso(rangeParam);
    if (!range) return NextResponse.json({ error: "Invalid range" }, { status: 400 });
    const stats = store.stats(range.start, range.end, todayInKolkata());
    return NextResponse.json({ range: rangeParam, start: range.start, end: range.end, days: range.days, ...stats });
  }

  const date = params.get("date") || todayInKolkata();
  const range = dayRangeIso(date, "00:00", "23:59");
  if (!range) return NextResponse.json({ error: Messages.invalidDate }, { status: 400 });
  const stats = store.stats(range.start, range.end, date);
  return NextResponse.json({ range: "today", start: range.start, end: range.end, days: 1, ...stats });
}