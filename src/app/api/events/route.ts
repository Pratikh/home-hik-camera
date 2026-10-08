import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { parseEventListQuery } from "@/lib/events";
import { ensureEventProcessor } from "@/server/events/event-processor";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  ensureEventProcessor();
  const url = new URL(request.url);
  const parsed = parseEventListQuery({
    camera: url.searchParams.get("camera"),
    type: url.searchParams.get("type"),
    classification: url.searchParams.get("classification"),
    date: url.searchParams.get("date"),
    startTime: url.searchParams.get("startTime"),
    endTime: url.searchParams.get("endTime"),
    page: url.searchParams.get("page"),
    pageSize: url.searchParams.get("pageSize"),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });
  const store = openEventStore(getConfig().dataDir);
  const result = store.query(parsed.query);
  return NextResponse.json({ ...result, page: parsed.query.page, pageSize: parsed.query.pageSize });
}
