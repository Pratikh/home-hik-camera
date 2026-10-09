import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENT_ID = /^evt_[a-f0-9]{24}$/;

/** Mark an event read or unread. Any authenticated user may mark their own view. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!EVENT_ID.test(id)) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const read = raw.read !== false;
  const store = openEventStore(getConfig().dataDir);
  const updated = store.markRead(id, read ? new Date().toISOString() : null);
  if (!updated) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  const event = store.get(id);
  return NextResponse.json({ event });
}