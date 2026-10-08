import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { requireAdmin } from "@/server/http/require-user";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { maskSettings } from "@/server/settings";
import { getVideoGatewayState } from "@/server/video/mediamtx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const config = getConfig();
  const [overview, videoGateway] = await Promise.all([getDvrOverview(), getVideoGatewayState()]);
  return NextResponse.json({
    ...maskSettings(config),
    backend: "Connected",
    dvr: overview.state,
    dvrMessage: overview.message,
    videoGateway,
  });
}
