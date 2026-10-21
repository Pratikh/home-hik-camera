import { NextResponse } from "next/server";
import { requestUsesHttps, sessionCookieOptions } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { COOKIE_NAME } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ADMIN: revoke every session for one user.
 *
 * The row is looked up first so an unknown id cannot be reported as a
 * successful revocation. Revoking the administrator's own sessions clears the
 * cookie in the same response; the browser returns to the login page.
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const config = getConfig();
  const accounts = accountStore(config.dataDir);
  const target = accounts.findById(id);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const revoked = accounts.deleteSessionsForUser(target.id);
  accounts.writeAudit({
    userId: auth.userId,
    action: "USER_SESSIONS_REVOKED",
    resource: target.username,
    metadata: { revoked },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  const response = NextResponse.json({ ok: true, revoked });
  if (target.id === auth.userId) {
    response.cookies.set(COOKIE_NAME, "", {
      ...sessionCookieOptions(config.cookieSecure || requestUsesHttps(request)),
      maxAge: 0,
    });
  }
  return response;
}
