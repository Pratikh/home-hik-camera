import { NextResponse } from "next/server";
import { requestUsesHttps, sessionCookieOptions } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { consumeRateLimit } from "@/lib/rate-limit";
import { COOKIE_NAME } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

/**
 * The signed-in user's own local sessions.
 *
 * Session ids are returned only so the UI can mark "this device"; they are
 * meaningless without the signed cookie and are never accepted as an
 * authentication token. No token, hash or password is included.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const config = getConfig();
  const accounts = accountStore(config.dataDir);
  accounts.pruneExpiredSessions();
  const sessions = accounts.listSessionsForUser(auth.userId).map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    current: session.id === auth.sessionId,
  }));
  return NextResponse.json({ sessions });
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const limit = consumeRateLimit(`sessions:${auth.userId}`, 20, 15 * 60 * 1000);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const body = (await request.json().catch(() => null)) as { scope?: unknown } | null;
  const scope = body?.scope;
  if (scope !== "others" && scope !== "all") {
    return NextResponse.json({ error: "scope must be 'others' or 'all'." }, { status: 400 });
  }

  const config = getConfig();
  const accounts = accountStore(config.dataDir);
  const revoked =
    scope === "others"
      ? accounts.deleteSessionsForUser(auth.userId, auth.sessionId)
      : accounts.deleteSessionsForUser(auth.userId);
  accounts.writeAudit({
    userId: auth.userId,
    action: "SESSIONS_REVOKED",
    resource: auth.username,
    metadata: { scope, revoked },
    ip: clientIp(request),
    userAgent: request.headers.get("user-agent"),
  });

  const response = NextResponse.json({ ok: true, revoked });
  if (scope === "all") {
    response.cookies.set(COOKIE_NAME, "", {
      ...sessionCookieOptions(config.cookieSecure || requestUsesHttps(request)),
      maxAge: 0,
    });
  }
  return response;
}
