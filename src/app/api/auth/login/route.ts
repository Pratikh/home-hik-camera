import { NextResponse } from "next/server";
import { SESSION_MAX_AGE, sessionCookieOptions } from "@/lib/auth";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { verifyPassword } from "@/lib/password-hash";
import { consumeRateLimit } from "@/lib/rate-limit";
import { safeNext } from "@/lib/redirect";
import { COOKIE_NAME, SESSION_TTL_MS, signSession } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

export async function POST(request: Request) {
  const config = getConfig();
  if (!config.appConfigured) {
    return NextResponse.json({ error: Messages.invalidConfig }, { status: 500 });
  }
  const limit = consumeRateLimit(`login:${clientIp(request)}`, 8, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: Messages.authFailed }, { status: 429 });
  }
  let username = "";
  let password = "";
  let next = "/";
  try {
    const body = (await request.json()) as { username?: unknown; password?: unknown; next?: unknown };
    username = typeof body.username === "string" ? body.username.trim() : "";
    password = typeof body.password === "string" ? body.password : "";
    next = safeNext(typeof body.next === "string" ? body.next : "/");
  } catch {
    return NextResponse.json({ error: Messages.authFailed }, { status: 401 });
  }
  if (username.length > 64 || password.length > 200 || password.length < 1) {
    return NextResponse.json({ error: Messages.authFailed }, { status: 401 });
  }

  const accounts = accountStore(config.dataDir);
  accounts.ensureBootstrapAdmin(config.appUsername, config.appPassword);
  const user = accounts.findByUsername(username);
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");
  if (!user || !user.enabled || !verifyPassword(password, user.passwordHash)) {
    accounts.writeAudit({ userId: user?.id ?? null, action: "LOGIN_FAILED", resource: username, ip, userAgent });
    return NextResponse.json({ error: Messages.authFailed }, { status: 401 });
  }

  const sessionId = accounts.createSession({
    userId: user.id,
    ip,
    userAgent,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  accounts.markLogin(user.id);
  accounts.writeAudit({ userId: user.id, action: "LOGIN", resource: user.username, ip, userAgent });
  try {
    const token = await signSession(user.username, config.sessionSecret, Date.now(), { sessionId, role: user.role });
    const response = NextResponse.json({ ok: true, redirect: next, role: user.role });
    response.cookies.set(COOKIE_NAME, token, { ...sessionCookieOptions(config.cookieSecure), maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    console.error("[auth] session", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: Messages.invalidConfig }, { status: 500 });
  }
}
