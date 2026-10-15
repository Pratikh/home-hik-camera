import { NextResponse } from "next/server";
import { requireUser } from "@/server/http/require-user";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { getVideoGatewayState } from "@/server/video/mediamtx";
import { getMediaStatus } from "@/server/video/media-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const [overview, videoGateway, media] = await Promise.all([
    getDvrOverview(),
    getVideoGatewayState(),
    getMediaStatus(),
  ]);
  return NextResponse.json({
    dvr: overview.state,
    message: overview.message,
    videoGateway,
    /*
     * Per-camera reality: `ready`/`bytesReceived` explain a blank tile, and
     * `drift` flags a gateway that is pulling from a different DVR address than
     * this hub is configured with. No DVR URL or credential is included.
     */
    media,
    checkedAt: new Date().toISOString(),
  });
}
