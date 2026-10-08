import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { selectPlaybackMode } from "@/lib/playback";
import { describeStreamPath } from "@/server/cameras/channels";
import { requireUser } from "@/server/http/require-user";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { getVideoGatewayState } from "@/server/video/mediamtx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ path: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { path } = await context.params;
  const described = describeStreamPath(path);
  if (!described) return NextResponse.json({ error: Messages.streamUnavailable }, { status: 404 });

  const config = getConfig();
  const [overview, videoGateway] = await Promise.all([getDvrOverview(), getVideoGatewayState()]);
  const online = overview.channels?.find((channel) => channel.id === described.cameraId)?.online ?? null;
  const decision = selectPlaybackMode({
    placeholder: config.videoDevPlaceholder,
    dvr: overview.state,
    gateway: videoGateway,
    cameraOnline: online,
    requestHost: request.headers.get("host") ?? "",
    webrtcAdditionalHosts: config.webrtcAdditionalHosts,
  });

  return NextResponse.json({
    path,
    channel: described.channel,
    mode: decision.mode,
    message: decision.message,
    whepUrl: decision.mode === "webrtc" ? `/api/webrtc/${path}/whep` : null,
    hlsUrl: decision.mode === "webrtc" || decision.mode === "hls" ? `/api/hls/${path}/index.m3u8` : null,
  });
}
