import { NextResponse } from "next/server";
import { requireUser } from "@/server/http/require-user";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { getVideoGatewayState } from "@/server/video/mediamtx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const [overview, videoGateway] = await Promise.all([getDvrOverview(), getVideoGatewayState()]);
  return NextResponse.json({
    dvr: overview.state,
    message: overview.message,
    videoGateway,
    device: overview.device,
    checkedAt: new Date().toISOString(),
  });
}
