import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { eventIngestionStatus } from "@/server/events/event-processor";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const status = eventIngestionStatus();
  const config = getConfig();
  const stored = config.dvrConfigured ? openEventStore(config.dataDir).count() : 0;
  return NextResponse.json({
    ingestion: status.running ? "running" : "stopped",
    lastPoll: status.lastPoll,
    lastError: status.lastError,
    stored,
    aiEnabled: config.aiEnabled,
  });
}
