import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { isRelayPath } from "@/server/cameras/channels";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function sessionIdOk(id: string): boolean {
  return /^[A-Za-z0-9_-]{8,128}$/.test(id);
}

export async function POST(request: Request, context: { params: Promise<{ path: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { path } = await context.params;
  if (!isRelayPath(path)) return NextResponse.json({ error: Messages.streamUnavailable }, { status: 404 });

  const offer = await request.text();
  if (!offer || offer.length > 1_000_000) {
    return NextResponse.json({ error: Messages.streamUnavailable }, { status: 400 });
  }

  const config = getConfig();
  const upstreamHeaders = new Headers({ "Content-Type": request.headers.get("content-type") ?? "application/sdp" });
  const origin = request.headers.get("origin");
  if (origin) upstreamHeaders.set("Origin", origin);
  if (config.mediamtxAuthPassword) {
    upstreamHeaders.set("Authorization", `Basic ${Buffer.from(`${config.mediamtxAuthUser}:${config.mediamtxAuthPassword}`).toString("base64")}`);
  }
  try {
    const upstream = await fetch(`${config.mediamtxWhepUrl}/${path}/whep`, {
      method: "POST",
      cache: "no-store",
      headers: upstreamHeaders,
      body: offer,
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok) {
      console.error("[webrtc] whep", path, upstream.status);
      const message = upstream.status === 404 ? Messages.streamUnavailable : Messages.gatewayDown;
      return NextResponse.json({ error: message }, { status: upstream.status === 404 ? 404 : 502 });
    }
    const answer = await upstream.text();
    const headers = new Headers({
      "content-type": upstream.headers.get("content-type") ?? "application/sdp",
      "cache-control": "no-store",
    });
    const location = upstream.headers.get("location");
    const session = location?.match(/\/whep\/([A-Za-z0-9_-]{8,128})\/?$/)?.[1];
    if (session && sessionIdOk(session)) {
      headers.set("location", `/api/webrtc/${path}/session/${session}`);
    }
    return new NextResponse(answer, { status: upstream.status, headers });
  } catch (error) {
    console.error("[webrtc] whep", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: Messages.gatewayDown }, { status: 503 });
  }
}
