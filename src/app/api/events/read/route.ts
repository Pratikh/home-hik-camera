import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { formatKolkataIso, isCalendarDate, kolkataDayBounds } from "@/lib/time-kolkata";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Mark every unread event for one India-time day as read.
 *
 * The Events page exposes this as an explicit "Mark all read" action. The
 * per-event route remains the only way to toggle a single event.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { date?: unknown };
  const date = typeof body.date === "string" && isCalendarDate(body.date) ? body.date : null;
  if (!date) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });

  const bounds = kolkataDayBounds(date);
  if (!bounds) return NextResponse.json({ error: "A valid date is required." }, { status: 400 });

  const now = new Date().toISOString();
  const store = openEventStore(getConfig().dataDir);
  const end = new Date(bounds.end.getTime() - 1000);
  const updated = store.markAllRead(formatKolkataIso(bounds.start), formatKolkataIso(end), now);
  return NextResponse.json({ ok: true, updated, date });
}
