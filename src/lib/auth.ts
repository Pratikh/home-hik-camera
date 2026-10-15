import "server-only";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/config";
import { COOKIE_NAME, verifySession } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * Should the session cookie be marked Secure?
 *
 * `COOKIE_SECURE` stays as an explicit override, but a request that arrived over
 * HTTPS (directly, or through a tunnel/proxy via `x-forwarded-proto`) always gets
 * a Secure cookie. Plain-HTTP LAN use keeps working without the flag.
 */
export function requestUsesHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim().toLowerCase();
    if (first) return first === "https";
  }
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
