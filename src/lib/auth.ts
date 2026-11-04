import "server-only";
import { cookies } from "next/headers";
import { isTrustedProxy } from "@/lib/client-ip";
import { getConfig } from "@/lib/config";
import { getPeerEncrypted, getPeerIp } from "@/lib/peer-ip";
import { COOKIE_NAME, verifySession } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Should the session cookie be marked Secure?
 *
 * `COOKIE_SECURE` stays as an explicit override. Otherwise the answer must come
 * from the transport, not from a header:
 * - behind a trusted proxy (`TRUSTED_PROXY_CIDRS`), `X-Forwarded-Proto` decides,
 *   because the app itself only speaks HTTP there;
 * - for a direct connection, the socket's own TLS state decides. `request.url`
 *   is deliberately *not* used: Next builds it from `X-Forwarded-Proto`, which a
 *   direct client controls.
 * - outside a request scope (unit tests) the URL protocol is the only signal
 *   available.
 */
export function requestUsesHttps(
  request: Request,
  peerIp: string | null = getPeerIp(),
  trustedProxies: readonly string[] = getConfig().trustedProxies,
  socketEncrypted: boolean | null = getPeerEncrypted(),
): boolean {
  if (isTrustedProxy(peerIp, trustedProxies)) {
    const forwarded = request.headers.get("x-forwarded-proto");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim().toLowerCase();
      if (first) return first === "https";
    }
    return false;
  }
  if (peerIp) return socketEncrypted === true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
    // Browsers that support it prefer this cookie when equivalent cookies exist.
    priority: "high" as const,
  };
}

export async function currentSession(): Promise<{ username: string; role: "ADMIN" | "VIEWER"; userId: string; sessionId: string } | null> {
  const config = getConfig();
  if (!config.appConfigured) return null;
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const verified = await verifySession(token, config.sessionSecret);
  if (!verified?.sessionId) return null;
  const record = accountStore(config.dataDir).getSession(verified.sessionId);
  if (!record || !record.enabled || record.expiresAt < Date.now()) return null;
  accountStore(config.dataDir).touchSession(record.id);
  return { username: record.username, role: record.role, userId: record.userId, sessionId: record.id };
}
