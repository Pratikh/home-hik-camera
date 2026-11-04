import "server-only";
import { getConfig } from "@/lib/config";

/**
 * Credentials for the MediaMTX Control API.
 *
 * The API is no longer reachable anonymously: the rendered MediaMTX config
 * grants the hub account `read`/`playback`/`api` and binds that account to the
 * web container's address. Every hub-to-MediaMTX API call must therefore carry
 * the hub credential. The value comes from the server environment only and is
 * never returned to the browser or written to a log.
 */
export function mediamtxAuthorizationHeader(): string | null {
  const config = getConfig();
  if (!config.mediamtxAuthPassword) return null;
  const user = config.mediamtxAuthUser || "hub";
  return `Basic ${Buffer.from(`${user}:${config.mediamtxAuthPassword}`).toString("base64")}`;
}

/** Convenience wrapper for `fetch` calls to the MediaMTX API. */
export function mediamtxAuthHeaders(): Record<string, string> {
  const header = mediamtxAuthorizationHeader();
  return header ? { Authorization: header } : {};
}
