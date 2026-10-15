import "server-only";
import { getConfig } from "@/lib/config";
import { describeStreamPath } from "@/server/cameras/channels";

/**
 * What the video gateway is actually doing, camera by camera.
 *
 * `/api/health` only says whether MediaMTX answers. That is not enough to explain
 * a blank tile: the gateway can be perfectly reachable while every path is idle
 * because it is pulling from an address that no longer has the DVR. This module
 * reports each path's real state, and flags the configuration drift that causes
 * exactly that (MediaMTX keeps the environment it was *created* with, so changing
 * the DVR address in .env needs a container recreate, not a restart).
 *
 * No source URL is ever returned or logged: the source carries DVR credentials,
 * so only the hostname is read, and only for comparison.
 */

export type MediaPathStatus = {
  path: string;
  cameraId: number;
  kind: "main" | "sub";
  ready: boolean;
  tracks: string[];
  bytesReceived: number;
};

export type MediaStatus = {
  reachable: boolean;
  paths: MediaPathStatus[];
  /** MediaMTX pulls from a different DVR host than the configured one. */
  drift: boolean;
  message: string | null;
};

export type MediaStatusDeps = {
  fetchImpl?: typeof fetch;
  apiUrl?: string;
  dvrHost?: string;
  timeoutMs?: number;
  log?: (message: string) => void;
};

let driftWarned = false;

/** Test seam: forget that the drift warning was already emitted. */
export function resetMediaStatusCache(): void {
  driftWarned = false;
}

type ConfiguredPath = { name?: unknown; source?: unknown };

/** Hostname of a configured source, or null when it cannot be read safely. */
export function sourceHost(source: unknown): string | null {
  if (typeof source !== "string" || !source.trim()) return null;
  try {
    const url = new URL(source.trim());
    return url.hostname ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function getMediaStatus(deps: MediaStatusDeps = {}): Promise<MediaStatus> {
  const config = getConfig();
  const apiUrl = deps.apiUrl ?? config.mediamtxApiUrl;
  const dvrHost = (deps.dvrHost ?? config.dvrHost).trim().toLowerCase();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? 2500;
  const log = deps.log ?? ((message: string) => console.warn(`[media] ${message}`));

  const get = async (path: string): Promise<unknown | null> => {
    try {
      const response = await fetchImpl(`${apiUrl}${path}`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) return null;
      return (await response.json()) as unknown;
    } catch {
      return null;
    }
  };

  const [active, configured] = await Promise.all([get("/v3/paths/list"), get("/v3/config/paths/list")]);
  if (active === null && configured === null) {
    return { reachable: false, paths: [], drift: false, message: "Video gateway unavailable" };
  }

  const paths: MediaPathStatus[] = [];
  const activeItems = ((active as { items?: unknown[] } | null)?.items ?? []) as Array<Record<string, unknown>>;
  for (const item of activeItems) {
    const name = typeof item.name === "string" ? item.name : "";
    const described = describeStreamPath(name);
    if (!described) continue;
    paths.push({
      path: name,
      cameraId: described.cameraId,
      kind: described.kind,
      ready: item.ready === true,
      tracks: Array.isArray(item.tracks) ? item.tracks.filter((track): track is string => typeof track === "string") : [],
      bytesReceived: typeof item.bytesReceived === "number" ? item.bytesReceived : 0,
    });
  }
  paths.sort((left, right) => left.path.localeCompare(right.path));

  // Drift: a configured camera path whose source host is not the configured DVR.
  const configuredItems = ((configured as { items?: unknown[] } | null)?.items ?? []) as ConfiguredPath[];
  let drift = false;
  for (const item of configuredItems) {
    const name = typeof item.name === "string" ? item.name : "";
    if (!describeStreamPath(name)) continue;
    const host = sourceHost(item.source);
    if (host && dvrHost && host !== dvrHost) {
      drift = true;
      break;
    }
  }

  if (drift && !driftWarned) {
    driftWarned = true;
    log(
      "MediaMTX is pulling from a different DVR address than the configured one. " +
        "Recreate the container so it re-reads .env (npm run mediamtx:up); a restart keeps the old environment.",
    );
  }

  return {
    reachable: true,
    paths,
    drift,
    message: drift ? "The video gateway is using a different DVR address than this hub is configured with." : null,
  };
}
