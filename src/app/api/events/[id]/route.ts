import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!/^evt_[a-f0-9]{24}$/.test(id)) return NextResponse.json({ error: Messages.backendDown }, { status: 404 });
  const event = openEventStore(getConfig().dataDir).get(id);
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  return NextResponse.json({ event });
}
