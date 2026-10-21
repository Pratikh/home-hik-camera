import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { cameraChannels } from "@/server/cameras/channels";
import { accountStore } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const config = getConfig();
  const accounts = accountStore(config.dataDir);
  accounts.pruneExpiredSessions();
  const sessions = accounts.listSessions();
  const presence = accounts.presence();
  let mediamtx: Record<string, number> | null = null;
  try {
    const response = await fetch(`${config.mediamtxApiUrl}/v3/paths/list`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      const body = (await response.json()) as { items?: Array<{ name?: string; readers?: unknown[] }> };
      mediamtx = {};
      for (const item of body.items ?? []) {
        if (item.name) mediamtx[item.name] = Array.isArray(item.readers) ? item.readers.length : 0;
      }
    }
  } catch (error) {
    console.error("[system] mediamtx", error instanceof Error ? error.name : "error");
  }
  const cameras = cameraChannels().map((camera) => ({
    id: camera.id,
    path: camera.subPath,
    appViewers: presence.filter((item) => item.path === camera.subPath || item.path === camera.mainPath).length,
    mediamtxReaders: mediamtx ? (mediamtx[camera.subPath] ?? 0) + (mediamtx[camera.mainPath] ?? 0) : null,
  }));
  return NextResponse.json({
    activeSessions: sessions.length,
    liveViewers: presence.length,
    sessions: sessions.map(({ id, username, role, lastSeenAt }) => ({ id, username, role, lastSeenAt })),
    cameras,
  });
}
