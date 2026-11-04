import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requestUsesHttps, sessionCookieOptions } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { COOKIE_NAME, verifySession } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";
import { requestClientIp } from "@/server/http/client-ip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = getConfig();
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token && config.appConfigured) {
    const verified = await verifySession(token, config.sessionSecret);
    if (verified?.sessionId) {
      const accounts = accountStore(config.dataDir);
      const session = accounts.getSession(verified.sessionId);
      accounts.deleteSession(verified.sessionId);
      accounts.writeAudit({
        userId: session?.userId ?? null,
        action: "LOGOUT",
        resource: session?.username ?? verified.username,
        ip: requestClientIp(request),
        userAgent: request.headers.get("user-agent"),
      });
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { ...sessionCookieOptions(config.cookieSecure || requestUsesHttps(request)), maxAge: 0 });
  return response;
}
