import "server-only";
import type { GatewayState } from "@/lib/api-types";
import { getConfig } from "@/lib/config";
import { mediamtxAuthHeaders } from "@/server/video/mediamtx-auth";

export async function getVideoGatewayState(): Promise<GatewayState> {
  const config = getConfig();
  try {
    const response = await fetch(`${config.mediamtxApiUrl}/v3/paths/list`, {
      cache: "no-store",
      headers: mediamtxAuthHeaders(),
      signal: AbortSignal.timeout(2000),
    });
    return response.ok ? "connected" : "disconnected";
  } catch (error) {
    console.error("[video-gateway]", error instanceof Error ? error.name : "error");
    return "disconnected";
  }
}
