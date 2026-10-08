import "server-only";
import { cookies } from "next/headers";
import { getConfig } from "@/lib/config";
import { COOKIE_NAME, verifySession } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

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
