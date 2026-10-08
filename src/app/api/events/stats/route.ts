import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { dayRangeIso } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";
import { todayInKolkata } from "@/lib/time-kolkata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const date = new URL(request.url).searchParams.get("date") || todayInKolkata();
  const range = dayRangeIso(date, "00:00", "23:59");
  if (!range) return NextResponse.json({ error: Messages.invalidDate }, { status: 400 });
  const stats = openEventStore(getConfig().dataDir).stats(range.start, range.end, date);
  return NextResponse.json(stats);
}
