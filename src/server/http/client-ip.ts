import { resolveClientIp } from "@/lib/client-ip";
import { getConfig } from "@/lib/config";
import { getPeerIp } from "@/lib/peer-ip";

/**
 * The audited client address for a request.
 *
 * Uses the TCP peer address unless the peer is a configured trusted proxy
 * (`TRUSTED_PROXY_CIDRS`), in which case the proxy's forwarded address is used.
 * A client-supplied `X-Forwarded-For` on a direct connection is ignored, so
 * audit rows cannot be attributed to arbitrary addresses.
 *
 * Returns `null` when no address can be established (for example in a unit test
 * that calls a handler without a socket).
 */
export function requestClientIp(request: Request): string | null {
  return resolveClientIp({
    peerIp: getPeerIp(),
    trustedProxies: getConfig().trustedProxies,
    headers: request.headers,
  });
}
