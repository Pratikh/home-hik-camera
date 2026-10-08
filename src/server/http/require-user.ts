import "server-only";
import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";

export async function requireUser(): Promise<
  { ok: true; username: string; role: "ADMIN" | "VIEWER"; userId: string; sessionId: string } | { ok: false; response: NextResponse }
> {
  const config = getConfig();
  if (!config.appConfigured) {
    return {
      ok: false,
      response: NextResponse.json({ error: Messages.invalidConfig }, { status: 500 }),
    };
  }
  const session = await currentSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: Messages.authFailed }, { status: 401 }),
    };
  }
  return { ok: true, username: session.username, role: session.role, userId: session.userId, sessionId: session.sessionId };
}

export async function requireAdmin(): Promise<
  { ok: true; username: string; role: "ADMIN"; userId: string; sessionId: string } | { ok: false; response: NextResponse }
> {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  if (auth.role !== "ADMIN") {
    return { ok: false, response: NextResponse.json({ error: "Authentication failed" }, { status: 403 }) };
  }
  return { ok: true, username: auth.username, role: "ADMIN", userId: auth.userId, sessionId: auth.sessionId };
}
