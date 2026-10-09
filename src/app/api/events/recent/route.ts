import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { ensureEventProcessor } from "@/server/events/event-processor";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  ensureEventProcessor();
  const params = new URL(request.url).searchParams;
  const limit = Number(params.get("limit") ?? "8");
  const size = Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : 8;
  const store = openEventStore(getConfig().dataDir);
  // "Important" is a stored priority band, so this stays an indexed lookup
  // rather than loading a page of events and filtering in the browser.
  const events = params.get("important") === "true" ? store.recentImportant(size) : store.recent(size);
  return NextResponse.json({ events });
}