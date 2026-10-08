import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { eventIngestionStatus } from "@/server/events/event-processor";
import { openEventStore } from "@/server/events/event-store";
import { buildHealth } from "@/server/health";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { getVideoGatewayState } from "@/server/video/mediamtx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = getConfig();
  const report = await buildHealth({
    appConfigured: config.appConfigured,
    loadDvr: async () => (await getDvrOverview()).state,
    loadGateway: getVideoGatewayState,
  });
  try {
    openEventStore(config.dataDir).count();
    report.body.database = "ok";
  } catch (error) {
    console.error("[health] database", error instanceof Error ? error.name : "error");
    report.body.database = "error";
  }
  const events = eventIngestionStatus();
  try {
    const store = openEventStore(config.dataDir);
    const lastPoll = store.setting("events_last_poll");
    const lastError = store.setting("events_last_error");
    const fresh = lastPoll ? Date.now() - new Date(lastPoll).getTime() < config.eventPollIntervalMs * 6 : false;
    report.body.events = lastError ? "error" : fresh || events.running ? "ok" : "stopped";
  } catch {
    report.body.events = "error";
  }
  return NextResponse.json(report.body, { status: report.httpStatus });
}
