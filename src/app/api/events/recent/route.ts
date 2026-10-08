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
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "8");
  const size = Number.isInteger(limit) && limit >= 1 && limit <= 20 ? limit : 8;
  return NextResponse.json({ events: openEventStore(getConfig().dataDir).recent(size) });
}
