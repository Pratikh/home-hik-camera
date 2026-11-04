import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { SESSION_MAX_AGE, requestUsesHttps, sessionCookieOptions } from "@/lib/auth";
import { resolveClientIp } from "@/lib/client-ip";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import {
  PasswordVerificationBusyError,
  hashPassword,
  verifyPasswordAsync,
} from "@/lib/password-hash";
import { getPeerIp } from "@/lib/peer-ip";
import { consumeRateLimit } from "@/lib/rate-limit";
import { safeNext } from "@/lib/redirect";
import { COOKIE_NAME, SESSION_TTL_MS, signSession } from "@/lib/session";
import { accountStore } from "@/server/auth/accounts";
import {
  checkLoginThrottle,
  clearLoginFailures,
  pruneLoginThrottle,
  recordLoginFailure,
} from "@/server/auth/login-throttle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Largest login body accepted (JSON or form). Credentials are tiny. */
const MAX_LOGIN_BODY_BYTES = 8 * 1024;

/**
 * A real scrypt hash that no submitted password matches, used when the username
 * does not exist (or is disabled) so both branches cost the same. Without it,
 * response timing enumerates valid usernames.
 */
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(24).toString("hex"));

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

function tooManyRequests(fromForm: boolean, retryAfterMs: number): NextResponse {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  if (fromForm) return seeOther("/login?error=rate");
  return NextResponse.json(
    { error: Messages.authFailed },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

function rejected(fromForm: boolean): NextResponse {
  if (fromForm) return seeOther("/login?error=auth");
  return NextResponse.json({ error: Messages.authFailed }, { status: 401 });
}

export async function POST(request: Request) {
  const fromForm = isFormPost(request);
  const config = getConfig();

  if (!config.appConfigured) {
    if (fromForm) return seeOther("/login?error=config");
    return NextResponse.json({ error: Messages.invalidConfig }, { status: 500 });
  }

  // Bound the body before parsing: credentials are tiny, and an unauthenticated
  // endpoint must not buffer arbitrary uploads.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LOGIN_BODY_BYTES) {
    return rejected(fromForm);
  }

  // One process-wide budget blunts floods even before the per-account/per-address
  // budgets (which live in SQLite and therefore survive a restart) are consulted.
  const globalLimit = consumeRateLimit("login:global", 60, 60 * 1000);
  if (!globalLimit.allowed) return tooManyRequests(fromForm, globalLimit.retryAfterMs);

  const peerIp = getPeerIp();
  const clientIp = resolveClientIp({
    peerIp,
    trustedProxies: config.trustedProxies,
    headers: request.headers,
  });

  const credentials = await readCredentials(request, fromForm);
  if (!credentials) return rejected(fromForm);

  const { username, password, next } = credentials;
  if (username.length > 64 || password.length > 200 || password.length < 1) {
    return rejected(fromForm);
  }

  const accounts = accountStore(config.dataDir);
  const userAgent = request.headers.get("user-agent");
  const now = Date.now();

  accounts.ensureBootstrapAdmin(config.appUsername, config.appPassword);
  // Opportunistic maintenance: expired rows are never usable, and login is the
  // natural point where a returning user clears them.
  accounts.pruneExpiredSessions();
  pruneLoginThrottle(accounts.db, now);

  const throttle = checkLoginThrottle(accounts.db, { username, clientIp, now });
  if (!throttle.allowed) {
    accounts.writeAudit({
      userId: null,
      action: "LOGIN_BLOCKED",
      resource: username,
      metadata: { reason: throttle.reason },
      ip: clientIp,
      userAgent,
    });
    return tooManyRequests(fromForm, throttle.retryAfterMs);
  }

  const user = accounts.findByUsername(username);
  // Always derive a hash, even for an unknown/disabled account, so the response
  // time cannot reveal whether the username exists.
  let passwordOk = false;
  try {
    passwordOk = await verifyPasswordAsync(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  } catch (error) {
    if (error instanceof PasswordVerificationBusyError) {
      return tooManyRequests(fromForm, 5_000);
    }
    console.error("[auth] verify", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: Messages.invalidConfig }, { status: 500 });
  }

  if (!user || !user.enabled || !passwordOk) {
    recordLoginFailure(accounts.db, { username, clientIp, now: Date.now() });
    accounts.writeAudit({ userId: user?.id ?? null, action: "LOGIN_FAILED", resource: username, ip: clientIp, userAgent });
    // The failure redirect carries a reason code only — never the credentials.
    return rejected(fromForm);
  }

  clearLoginFailures(accounts.db, { username, clientIp });
  const sessionId = accounts.createSession({
    userId: user.id,
    ip: clientIp,
    userAgent,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });
  accounts.markLogin(user.id);
  accounts.writeAudit({ userId: user.id, action: "LOGIN", resource: user.username, ip: clientIp, userAgent });

  try {
    const token = await signSession(user.username, config.sessionSecret, Date.now(), { sessionId, role: user.role });
    // A native submit gets a redirect so the browser lands on the app; the
    // hydrated app gets JSON and navigates itself.
    const response = fromForm ? seeOther(next) : NextResponse.json({ ok: true, redirect: next, role: user.role });
    response.cookies.set(COOKIE_NAME, token, { ...sessionCookieOptions(config.cookieSecure || requestUsesHttps(request, peerIp, config.trustedProxies)), maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    console.error("[auth] session", error instanceof Error ? error.name : "error");
    if (fromForm) return seeOther("/login?error=config");
    return NextResponse.json({ error: Messages.invalidConfig }, { status: 500 });
  }
}
