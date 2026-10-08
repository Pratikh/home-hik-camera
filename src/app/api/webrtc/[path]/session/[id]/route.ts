import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { isRelayPath } from "@/server/cameras/channels";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ path: string; id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { path, id } = await context.params;
  if (!isRelayPath(path) || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) {
    return NextResponse.json({ error: Messages.streamUnavailable }, { status: 404 });
  }
  const config = getConfig();
  try {
    await fetch(`${config.mediamtxWhepUrl}/${path}/whep/${id}`, {
      method: "DELETE",
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    console.error("[webrtc] session", error instanceof Error ? error.name : "error");
  }
  return new NextResponse(null, { status: 204 });
}
