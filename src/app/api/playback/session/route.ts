import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { selectPlaybackMode } from "@/lib/playback";
import { formatKolkataIso, parseKolkataIso } from "@/lib/time-kolkata";
import { playbackPath } from "@/server/cameras/channels";
import { requireUser } from "@/server/http/require-user";
import { playbackClientFrom } from "@/server/hikvision/hikvision-playback";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { HikvisionError } from "@/server/hikvision/hikvision-types";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { closePlaybackSource, publishPlaybackSource } from "@/server/video/playback-gateway";
import { getVideoGatewayState } from "@/server/video/mediamtx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_SPAN_MS = 8 * 60 * 60 * 1000;

function cameraId(value: unknown): number | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2000) return NextResponse.json({ error: Messages.invalidTime }, { status: 400 });
    payload = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: Messages.invalidTime }, { status: 400 });
  }
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const camera = cameraId(body.camera);
  const start = typeof body.startTime === "string" ? parseKolkataIso(body.startTime) : null;
  const requestedEnd = typeof body.endTime === "string" ? parseKolkataIso(body.endTime) : null;
  if (!camera || !start || !requestedEnd || requestedEnd.getTime() <= start.getTime()) {
    return NextResponse.json({ error: Messages.invalidTime }, { status: 400 });
  }
  const end =
    requestedEnd.getTime() - start.getTime() > MAX_SPAN_MS
      ? new Date(start.getTime() + MAX_SPAN_MS)
      : requestedEnd;

  const config = getConfig();
  const [overview, videoGateway] = await Promise.all([getDvrOverview(), getVideoGatewayState()]);
  const decision = selectPlaybackMode({
    placeholder: false,
    dvr: overview.state,
    gateway: videoGateway,
    cameraOnline: null,
    requestHost: request.headers.get("host") ?? "",
    webrtcAdditionalHosts: config.webrtcAdditionalHosts,
  });
  if (decision.mode === "unavailable") {
    const status = overview.state === "not_configured" ? 409 : videoGateway !== "connected" || overview.state !== "connected" ? 503 : 502;
    return NextResponse.json({ error: decision.message ?? Messages.playbackUnavailable }, { status });
  }

  const token = typeof body.token === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(body.token) ? body.token : "play";
  const path = playbackPath();
  try {
    const playback = playbackClientFrom(
      new HikvisionClient({
        host: config.dvrHost,
        port: config.dvrHttpPort,
        username: config.dvrUsername,
        password: config.dvrPassword,
      }),
      {
        host: config.dvrHost,
        port: config.dvrRtspPort,
        username: config.dvrUsername,
        password: config.dvrPassword,
      },
    );
    const source = playback.getPlaybackUrl({
      id: "session",
      camera,
      startTime: formatKolkataIso(start),
      endTime: formatKolkataIso(end),
      type: null,
      label: "Recording",
    });
    await publishPlaybackSource(path, source, token);
  } catch (error) {
    console.error("[playback] session", error instanceof Error ? error.message : "error");
    if (error instanceof Error && error.message === "not_ready") {
      return NextResponse.json({ error: Messages.playbackUnavailable }, { status: 503 });
    }
    const message = error instanceof HikvisionError && error.code === "not_configured" ? Messages.dvrNotConfigured : Messages.gatewayDown;
    return NextResponse.json({ error: message }, { status: message === Messages.dvrNotConfigured ? 409 : 503 });
  }

  return NextResponse.json({
    path,
    mode: decision.mode,
    message: decision.message,
    whepUrl: decision.mode === "webrtc" ? `/api/webrtc/${path}/whep` : null,
    hlsUrl: decision.mode === "webrtc" || decision.mode === "hls" ? `/api/hls/${path}/index.m3u8` : null,
    startTime: formatKolkataIso(start),
    endTime: formatKolkataIso(end),
  });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const camera = cameraId(Number(url.searchParams.get("camera")));
  if (!camera) return NextResponse.json({ error: Messages.invalidCamera }, { status: 400 });
  const token = url.searchParams.get("token") ?? undefined;
  await closePlaybackSource(playbackPath(), token && /^[A-Za-z0-9_-]{1,64}$/.test(token) ? token : undefined);
  return new NextResponse(null, { status: 204 });
}
