import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { isRelayPath } from "@/server/cameras/channels";
import { requireUser } from "@/server/http/require-user";
import { rewriteHlsPlaylist } from "@/server/video/hls-rewrite";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ path: string; asset?: string[] }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { path, asset } = await context.params;
  if (!isRelayPath(path)) return NextResponse.json({ error: Messages.streamUnavailable }, { status: 404 });
  const parts = asset && asset.length > 0 ? asset : ["index.m3u8"];
  if (parts.some((part) => part === ".." || part.includes("\\") || part.includes("/"))) {
    return NextResponse.json({ error: Messages.streamUnavailable }, { status: 400 });
  }

  const incoming = new URL(request.url);
  const config = getConfig();
  const upstreamUrl = `${config.mediamtxHlsUrl}/${path}/${parts.join("/")}${incoming.search}`;
  try {
    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) headers.set("range", range);
    if (config.mediamtxAuthPassword) {
      headers.set("Authorization", `Basic ${Buffer.from(`${config.mediamtxAuthUser}:${config.mediamtxAuthPassword}`).toString("base64")}`);
    }
    const upstream = await fetch(upstreamUrl, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(15000),
    });
    if (!upstream.ok && upstream.status !== 206) {
      console.error("[hls]", path, upstream.status);
      const message = upstream.status === 404 ? Messages.streamUnavailable : Messages.gatewayDown;
      return NextResponse.json({ error: message }, { status: upstream.status === 404 ? 404 : 502 });
    }

    const playlist = parts.some((part) => part.endsWith(".m3u8"));
    const responseHeaders = new Headers({ "cache-control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) responseHeaders.set("content-type", contentType);
    for (const setCookie of upstream.headers.getSetCookie?.() ?? []) {
      responseHeaders.append("set-cookie", setCookie);
    }

    if (playlist) {
      const text = await upstream.text();
      if (text.length > 1_000_000) {
        return NextResponse.json({ error: Messages.streamUnavailable }, { status: 502 });
      }
      return new NextResponse(rewriteHlsPlaylist(text, path), { status: upstream.status, headers: responseHeaders });
    }

    const body = await upstream.arrayBuffer();
    if (body.byteLength > 20_000_000) {
      return NextResponse.json({ error: Messages.streamUnavailable }, { status: 502 });
    }
    return new NextResponse(body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("[hls]", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: Messages.gatewayDown }, { status: 503 });
  }
}
