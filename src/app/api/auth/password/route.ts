import { NextResponse } from "next/server";
import { SESSION_MAX_AGE, requestUsesHttps, sessionCookieOptions } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { verifyPassword } from "@/lib/password-hash";
import { validateNewPassword } from "@/lib/passwords";
import { consumeRateLimit } from "@/lib/rate-limit";
import { COOKIE_NAME, SESSION_TTL_MS, signSession } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

type Body = { currentPassword?: unknown; newPassword?: unknown };

/**
 * Change the signed-in user's own password.
 *
 * Every existing session for the user is revoked, including the one making the
 * request, and a fresh session cookie is issued in the same response. That way
 * a token captured before the change cannot be replayed, while the browser
 * performing the change stays signed in.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const limit = consumeRateLimit(`password:${auth.userId}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new password are required." }, { status: 400 });
  }

  const policy = validateNewPassword(newPassword);
  if (!policy.ok) return NextResponse.json({ error: policy.message }, { status: 400 });

  const config = getConfig();
  const accounts = accountStore(config.dataDir);
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");

  const user = accounts.findById(auth.userId);
  if (!user || !user.enabled) return NextResponse.json({ error: Messages.authFailed }, { status: 401 });

  if (!verifyPassword(currentPassword, user.passwordHash)) {
    accounts.writeAudit({
      userId: user.id,
      action: "PASSWORD_CHANGE_FAILED",
      resource: user.username,
      ip,
      userAgent,
    });
    // 400, not 401: the session is still valid, so the shared client must not
    // treat this as a logout and bounce the user to the login page.
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  // Count before the update: changing the password deletes every existing row.
  const revoked = accounts.listSessionsForUser(user.id).length;

  // updateUser hashes with the existing scrypt implementation and revokes every
  // session for this user as soon as the password changes.
  const result = accounts.updateUser(user.id, { password: newPassword });
  if (result !== "ok") {
    // Only "missing" is possible for a self change; report it without details.
    return NextResponse.json({ error: Messages.authFailed }, { status: 401 });
  }

  const sessionId = accounts.createSession({
    userId: user.id,
    ip,
    userAgent,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  accounts.writeAudit({
    userId: user.id,
    action: "PASSWORD_CHANGED",
    resource: user.username,
    metadata: { self: true },
    ip,
    userAgent,
  });

  try {
    const token = await signSession(user.username, config.sessionSecret, Date.now(), {
      sessionId,
      role: user.role,
    });
    const response = NextResponse.json({ ok: true, sessionsRevoked: revoked });
    response.cookies.set(COOKIE_NAME, token, {
      ...sessionCookieOptions(config.cookieSecure || requestUsesHttps(request)),
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  } catch (error) {
    // The password is already changed. Clear the stale cookie so the user is
    // sent to the login page instead of looping with an invalid session.
    console.error("[auth] password session", error instanceof Error ? error.name : "error");
    const response = NextResponse.json(
      { ok: true, sessionsRevoked: revoked, message: "Password changed. Sign in again." },
      { status: 200 },
    );
    response.cookies.set(COOKIE_NAME, "", {
      ...sessionCookieOptions(config.cookieSecure || requestUsesHttps(request)),
      maxAge: 0,
    });
    return response;
  }
}
