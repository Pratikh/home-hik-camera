import { NextResponse } from "next/server";
import { SESSION_MAX_AGE, requestUsesHttps, sessionCookieOptions } from "@/lib/auth";
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

/** A plain HTML form submission, as opposed to the app's fetch call. */
function isFormPost(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  return type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data");
}

/**
 * A 303 with a *relative* Location.
 *
 * `NextResponse.redirect` needs an absolute URL, and building one from
 * `request.url` uses the server's bind address rather than the client's host —
 * which sent browsers to `http://0.0.0.0:3000/`. A relative Location is resolved
 * by the browser against the request it just made, so it is always correct, and
 * it removes any open-redirect risk because `next` is already a site-local path
 * (validated by `safeNext`).
 */
function seeOther(path: string): NextResponse {
  const response = new NextResponse(null, { status: 303 });
  response.headers.set("location", path);
  return response;
}

/**
 * Read the credentials from either a JSON body (the hydrated app) or a form body
 * (a native submit, which can happen before React has hydrated).
 *
 * Returning them as the same shape keeps a single code path for validation,
 * rate limiting and the audit log.
 */
async function readCredentials(
  request: Request,
  fromForm: boolean,
): Promise<{ username: string; password: string; next: string } | null> {
  try {
    if (fromForm) {
      const form = await request.formData();
      const value = (key: string) => {
        const item = form.get(key);
        return typeof item === "string" ? item : "";
      };
      return { username: value("username").trim(), password: value("password"), next: safeNext(value("next")) };
    }
    const body = (await request.json()) as { username?: unknown; password?: unknown; next?: unknown };
    return {
      username: typeof body.username === "string" ? body.username.trim() : "",
      password: typeof body.password === "string" ? body.password : "",
      next: safeNext(typeof body.next === "string" ? body.next : "/"),
    };
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const fromForm = isFormPost(request);
  const config = getConfig();

  if (!config.appConfigured) {
    if (fromForm) {
      return seeOther("/login?error=config");
    }
    return NextResponse.json({ error: Messages.invalidConfig }, { status: 500 });
  }

  const limit = consumeRateLimit(`login:${clientIp(request)}`, 8, 15 * 60 * 1000);
  if (!limit.allowed) {
    if (fromForm) {
      return seeOther("/login?error=rate");
    }
    return NextResponse.json({ error: Messages.authFailed }, { status: 429 });
  }

  const credentials = await readCredentials(request, fromForm);
  if (!credentials) {
    if (fromForm) return seeOther("/login?error=auth");
    return NextResponse.json({ error: Messages.authFailed }, { status: 401 });
  }
  const { username, password, next } = credentials;
  if (username.length > 64 || password.length > 200 || password.length < 1) {
    if (fromForm) return seeOther("/login?error=auth");
    return NextResponse.json({ error: Messages.authFailed }, { status: 401 });
  }

  const accounts = accountStore(config.dataDir);
  accounts.ensureBootstrapAdmin(config.appUsername, config.appPassword);
  // Opportunistic maintenance: expired rows are never usable, and login is the
  // natural point where a returning user clears them.
  accounts.pruneExpiredSessions();
  const user = accounts.findByUsername(username);
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");
  if (!user || !user.enabled || !verifyPassword(password, user.passwordHash)) {
    accounts.writeAudit({ userId: user?.id ?? null, action: "LOGIN_FAILED", resource: username, ip, userAgent });
    // The failure redirect carries a reason code only — never the credentials.
    if (fromForm) return seeOther("/login?error=auth");
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
    // A native submit gets a redirect so the browser lands on the app; the
    // hydrated app gets JSON and navigates itself.
    const response = fromForm ? seeOther(next) : NextResponse.json({ ok: true, redirect: next, role: user.role });
    response.cookies.set(COOKIE_NAME, token, { ...sessionCookieOptions(config.cookieSecure || requestUsesHttps(request)), maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    console.error("[auth] session", error instanceof Error ? error.name : "error");
    if (fromForm) return seeOther("/login?error=config");
    return NextResponse.json({ error: Messages.invalidConfig }, { status: 500 });
  }
}
